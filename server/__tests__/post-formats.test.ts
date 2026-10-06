import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { POST_FORMATS, postFormat, formatFromImageKind } from "../../shared/post-formats";
import { buildConceptPrompt, sanitizeConcepts } from "../services/image-concepts";
import { specFromConcept } from "../services/image-spec";
import { pickCharactersInUse } from "../services/remake-image";

describe("danh mục thể loại — 5 nhóm TỔNG QUAN", () => {
  test("đúng 5 nhóm, chia thô", () => {
    assert.deepEqual(POST_FORMATS.map((f) => f.id), ["cartoon", "chat", "review", "social", "text_card"]);
  });

  test("meme, kỳ vọng – thực tế nằm TRONG cartoon, không phải nhóm riêng", () => {
    assert.match(postFormat("cartoon").includes, /meme/);
    assert.match(postFormat("cartoon").includes, /kỳ vọng – thực tế/);
    assert.ok(!POST_FORMATS.some((f) => /meme|kỳ vọng/i.test(f.label)));
  });

  test("thể loại lạ thì về cartoon, không nổ", () => {
    assert.equal(postFormat("khong-co").id, "cartoon");
  });

  test("loại ảnh của bài gốc đổi ra đúng nhóm", () => {
    assert.equal(formatFromImageKind("anh_chat"), "chat");
    assert.equal(formatFromImageKind("meme"), "cartoon");
    assert.equal(formatFromImageKind("infographic"), "text_card");
    assert.equal(formatFromImageKind("anh_that"), null);
  });
});

describe("đề xuất phương án theo thể loại", () => {
  const prompt = buildConceptPrompt(
    {
      draft: "Gèn nhắn Gàn lúc 2 giờ sáng hỏi đã deploy chưa.",
      characterNames: ["Gàn", "Gèn"],
      brandName: "Mắt Bão",
      pageFormatHints: ["Khuôn ảnh quen của trang: ảnh chụp đoạn chat"],
      source: { imageReading: { imageKind: "anh_chat" } },
    },
    3,
  );

  test("prompt liệt kê đủ 5 nhóm", () => {
    for (const f of POST_FORMATS) assert.match(prompt, new RegExp(`- ${f.id} \\(`));
  });

  test("ba phương án trải ít nhất 2 thể loại, cái hợp trang nhất xếp đầu", () => {
    assert.match(prompt, /TRẢI RA ít nhất 2 thể loại/);
    assert.match(prompt, /Phương án ĐẦU TIÊN là thể loại hợp TRANG NÀY nhất/);
  });

  test("tín hiệu của trang và của bài gốc đi vào prompt", () => {
    assert.match(prompt, /ảnh chụp đoạn chat/);
    assert.match(prompt, /Bài gốc thuộc thể loại: chat/);
  });

  test("đánh giá chỉ được tên hư cấu hoặc chính thương hiệu", () => {
    assert.match(prompt, /tên doanh nghiệp CHỈ được là tên HƯ CẤU/);
    assert.match(prompt, /chính thương hiệu "Mắt Bão"/);
    assert.match(prompt, /không dùng tên doanh nghiệp, thương hiệu hay người thật khác/);
  });

  test("dặn chữ phải NGẮN vì Gemini vẽ chữ dài hay sai dấu", () => {
    assert.match(prompt, /Chữ hiện trên ảnh phải NGẮN/);
  });
});

describe("sanitizeConcepts — từng thể loại phải có đúng nội dung của nó", () => {
  const raw = {
    concepts: [
      { format: "chat", title: "Nhắn lúc 2h sáng", why: "x", layout: "chat 2 người", characters: ["Gàn", "Gèn"],
        caption: "Gàn 🐞", messages: [{ from: "Gèn", text: "Deploy chưa?" }, { from: "Gàn", text: "Rồi… hình như" }] },
      { format: "review", title: "Review 1 sao", why: "x", layout: "review",
        review: { business: "Quán Bug Đêm", rating: 9, reviewer: "Gèn", text: "Phục vụ lúc 2h sáng." } },
      { format: "chat", title: "Chat rỗng", why: "x", layout: "chat", messages: [] },
      { format: "lung-tung", title: "Không rõ thể loại", why: "x", layout: "1 khung",
        panels: [{ scene: "office", action: "Gàn sighs", expression: "tired", dialogue: null }] },
    ],
  };
  const out = sanitizeConcepts(raw, ["Gàn", "Gèn"], 5);

  test("chat thiếu tin nhắn thì bỏ — không có gì để vẽ", () => {
    assert.ok(!out.some((c) => c.title === "Chat rỗng"));
  });

  test("giữ tin nhắn nguyên văn", () => {
    const chat = out.find((c) => c.format === "chat")!;
    assert.equal(chat.messages![1].text, "Rồi… hình như");
  });

  test("số sao kẹp về 1–5", () => {
    assert.equal(out.find((c) => c.format === "review")!.review!.rating, 5);
  });

  test("thể loại lạ thì về cartoon", () => {
    assert.equal(out.find((c) => c.title === "Không rõ thể loại")!.format, "cartoon");
  });

  test("cắt cứng chữ quá dài — không chỉ dặn trong prompt", () => {
    const long = sanitizeConcepts(
      { concepts: [{ format: "chat", title: "t", why: "", layout: "", messages: [{ from: "A", text: "x".repeat(200) }] }] },
      [],
      1,
    );
    assert.ok(long[0].messages![0].text.length <= 80);
  });

  test("tối đa 6 tin nhắn", () => {
    const many = sanitizeConcepts(
      { concepts: [{ format: "chat", title: "t", why: "", layout: "",
        messages: Array.from({ length: 10 }, (_, i) => ({ from: "A", text: `m${i}` })) }] },
      [],
      1,
    );
    assert.equal(many[0].messages!.length, 6);
  });
});

describe("lệnh vẽ theo thể loại", () => {
  const input = { aspectRatio: "1:1", characters: [{ name: "Gàn", refIndex: 1 }, { name: "Gèn", refIndex: 2 }] };

  test("chat: vẽ như ảnh chụp màn hình, chữ chép NGUYÊN VĂN, người gửi đầu ở bên phải", () => {
    const spec = specFromConcept(
      { format: "chat", title: "t", layout: "chat", panels: [],
        messages: [{ from: "Gèn", text: "Deploy chưa?" }, { from: "Gàn", text: "Rồi" }] },
      input,
    );
    assert.equal(spec.post_format?.id, "chat");
    assert.deepEqual(spec.messages?.map((m) => m.text), ["Deploy chưa?", "Rồi"]);
    assert.ok(spec.rules.some((r) => /smartphone screenshot of a messaging app/.test(r)));
    assert.ok(spec.rules.some((r) => /copied EXACTLY as given/.test(r)));
    assert.ok(spec.rules.some((r) => /"Gèn" sit on the RIGHT/.test(r)));
    assert.equal(spec.panels, undefined, "chat không có khung");
  });

  test("review: đúng số sao", () => {
    const spec = specFromConcept(
      { format: "review", title: "t", layout: "review", panels: [],
        review: { business: "Quán Bug Đêm", rating: 1, reviewer: "Gèn", text: "Tệ." } },
      input,
    );
    assert.ok(spec.rules.some((r) => /exactly 1 out of 5 stars/.test(r)));
  });

  test("cartoon giữ nguyên luật khung như trước", () => {
    const spec = specFromConcept(
      { format: "cartoon", title: "t", layout: "2 khung", panels: [
        { scene: "a", action: "b", expression: "c", dialogue: null },
        { scene: "d", action: "e", expression: "f", dialogue: null },
      ] },
      input,
    );
    assert.ok(spec.rules.some((r) => /Draw EXACTLY 2 panels/.test(r)));
  });
});

describe("nhân vật trong tin nhắn cũng được đính ảnh mẫu (làm ảnh đại diện)", () => {
  const ch = (name: string): any => ({ id: name, name, referenceImageUrl: `/api/files/c/${name}.png` });
  test("người gửi là nhân vật thì được chọn", () => {
    const out = pickCharactersInUse([ch("Gàn"), ch("Gèn")], {
      characters: [],
      messages: [{ from: "Gèn", text: "Deploy chưa?" }],
    });
    assert.deepEqual(out.map((c) => c.name), ["Gèn"]);
  });
});
