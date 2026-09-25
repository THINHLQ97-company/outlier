import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeStyleJson, missingKeyStyleFields, styleFieldGuide } from "../../shared/style-fields";
import { generateStyleFromBrand, hasVisualIdentity, buildStyleBrief } from "../services/style-from-brand";

const manual = (value: any) => ({ value, evidence: [], source: "manual" as const });

// Thương hiệu tối thiểu để dựng brief — chỉ những cột service thật sự đọc.
function brand(extra: Record<string, any> = {}): any {
  return {
    id: "b1",
    owner: "thinhlq",
    isShared: true,
    name: "Ăn Nằm Với AI",
    pageRole: manual("sân sau của Mắt Bão, nói chuyện AI bằng giọng tếu"),
    personality: manual(["hay đùa nhưng không cợt nhả"]),
    audience: manual("dân làm nội dung 25-35 tuổi"),
    ...extra,
  };
}

describe("normalizeStyleJson — dữ liệu vào lộn xộn, ra đúng kiểu từng trường", () => {
  test("bỏ trường rỗng: trường rỗng tệ hơn trường không có", () => {
    const out = normalizeStyleJson({ medium: "  ", linework: "clean ink", mood: "" });
    assert.deepEqual(out, { linework: "clean ink" });
  });

  test("model trả mảng cho trường chữ thì ghép lại, không bỏ", () => {
    const out = normalizeStyleJson({ shading: ["hard edge", "no gradient"] });
    assert.equal(out.shading, "hard edge; no gradient");
  });

  test("trả chuỗi cho trường danh sách thì tách ra", () => {
    const out = normalizeStyleJson({ color_palette: "#4f46e5, #f8fafc; #1e1b4b" });
    assert.deepEqual(out.color_palette, ["#4f46e5", "#f8fafc", "#1e1b4b"]);
  });

  test("giữ khoá lạ — phong cách cũ và ghi tay qua MCP đều có khoá ngoài bộ chuẩn", () => {
    const out = normalizeStyleJson({ medium: "vector", cai_gi_do: "ghi chú riêng" });
    assert.equal(out.cai_gi_do, "ghi chú riêng");
  });

  test("xếp trường chuẩn theo thứ tự bộ chuẩn: chất liệu trước, tổng thể sau", () => {
    const keys = Object.keys(normalizeStyleJson({ avoid: ["soft shadow"], medium: "vector" }));
    assert.deepEqual(keys, ["medium", "avoid"]);
  });

  test("đầu vào không phải object thì ra object rỗng, không nổ", () => {
    assert.deepEqual(normalizeStyleJson(null), {});
    assert.deepEqual(normalizeStyleJson("vector"), {});
    assert.deepEqual(normalizeStyleJson([1, 2]), {});
  });
});

describe("missingKeyStyleFields — nhắc đúng trường thiếu là vẽ lại lệch", () => {
  test("phong cách rỗng thì báo thiếu toàn bộ trường then chốt", () => {
    const missing = missingKeyStyleFields({}).map((f) => f.key);
    assert.ok(missing.includes("character_proportions"), "phải nhắc tỉ lệ nhân vật");
    assert.ok(missing.includes("avoid"), "phải nhắc mục KHÔNG thuộc phong cách");
  });

  test("trường đã có thì không nhắc nữa", () => {
    const missing = missingKeyStyleFields({ medium: "vector" }).map((f) => f.key);
    assert.ok(!missing.includes("medium"));
  });

  test("bảng trường đưa cho model có kèm câu hỏi từng trường", () => {
    const guide = styleFieldGuide();
    assert.match(guide, /character_proportions/);
    assert.match(guide, /then chốt/);
  });
});

describe("hasVisualIdentity — biết nét vẽ bám hồ sơ hay chỉ suy ra", () => {
  test("chưa khai gì = chưa có", () => {
    assert.equal(hasVisualIdentity(brand()), false);
    assert.equal(hasVisualIdentity(brand({ visualIdentity: manual({}) })), false);
  });

  test("khai được một mục cũng tính là có", () => {
    assert.equal(hasVisualIdentity(brand({ visualIdentity: manual({ palette: ["#4f46e5"] }) })), true);
  });

  test("thiếu nhận diện hình ảnh thì brief phải cảnh báo, không im lặng", () => {
    const { grounded, caveat } = buildStyleBrief(brand(), []);
    assert.equal(grounded, false);
    assert.match(caveat || "", /CHƯA khai nhận diện hình ảnh/);
  });

  test("có nhận diện hình ảnh thì không cảnh báo, và màu đã khai đi vào brief", () => {
    const { grounded, caveat, brief } = buildStyleBrief(
      brand({ visualIdentity: manual({ palette: ["#4f46e5"], doNots: ["ảnh người thật"] }) }),
      [],
    );
    assert.equal(grounded, true);
    assert.equal(caveat, undefined);
    assert.match(brief, /#4f46e5/);
    assert.match(brief, /ảnh người thật/);
  });
});

describe("generateStyleFromBrand — sinh nét vẽ từ hồ sơ, không cần ảnh mẫu", () => {
  const goodReply = JSON.stringify({
    style_name: "Nét thô vui",
    rationale: "Trang nói giọng tếu nên nét thô hợp hơn nét tả thực.",
    medium: "digital vector",
    linework: "clean confident ink",
    color_palette: ["#4f46e5", "#f8fafc"],
    character_proportions: "4 heads tall, chunky limbs",
    avoid: "soft shadows, photo realism",
  });

  test("lấy tên, lý do và bộ trường đã chuẩn hoá", async () => {
    const out = await generateStyleFromBrand(brand(), [], async () => goodReply);
    assert.equal(out.name, "Nét thô vui");
    assert.match(out.rationale || "", /giọng tếu/);
    assert.deepEqual(out.styleJson.color_palette, ["#4f46e5", "#f8fafc"]);
    // "avoid" là danh sách — chuỗi phải được tách.
    assert.deepEqual(out.styleJson.avoid, ["soft shadows", "photo realism"]);
  });

  test("style_name và rationale không lọt vào bộ trường nét vẽ", async () => {
    const out = await generateStyleFromBrand(brand(), [], async () => goodReply);
    assert.ok(!("style_name" in out.styleJson));
    assert.ok(!("rationale" in out.styleJson));
  });

  test("model bọc JSON trong lời dẫn vẫn đọc được", async () => {
    const out = await generateStyleFromBrand(brand(), [], async () => `Đây nhé:\n\`\`\`json\n${goodReply}\n\`\`\``);
    assert.equal(out.name, "Nét thô vui");
  });

  test("báo lại trường then chốt model không điền được", async () => {
    const out = await generateStyleFromBrand(brand(), [], async () => goodReply);
    assert.ok(out.missingKeyFields.length > 0, "thiếu face_style, rendering… phải nói ra");
    assert.ok(out.missingKeyFields.some((f) => /mặt/i.test(f)));
  });

  test("không có tên thì lấy theo tên thương hiệu, không để trống", async () => {
    const out = await generateStyleFromBrand(brand(), [], async () => JSON.stringify({ medium: "vector" }));
    assert.equal(out.name, "Nét vẽ Ăn Nằm Với AI");
  });

  test("model không trả JSON thì lỗi rõ ràng, không lưu phong cách rỗng", async () => {
    await assert.rejects(
      () => generateStyleFromBrand(brand(), [], async () => "Tôi không chắc lắm."),
      /không trả về JSON/i,
    );
  });

  test("JSON đúng cú pháp nhưng không có trường nét vẽ nào cũng phải lỗi", async () => {
    await assert.rejects(
      () => generateStyleFromBrand(brand(), [], async () => JSON.stringify({ style_name: "Có tên thôi" })),
      /không mô tả được trường nét vẽ/i,
    );
  });

  test("prompt gửi đi có kèm hồ sơ thương hiệu và bảng trường", async () => {
    let sent = "";
    await generateStyleFromBrand(brand(), [], async (p) => {
      sent = p;
      return goodReply;
    });
    assert.match(sent, /sân sau của Mắt Bão/, "phải kèm vai của trang");
    assert.match(sent, /character_proportions/, "phải kèm bảng trường");
  });
});
