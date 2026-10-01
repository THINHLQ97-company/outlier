import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { buildImageSpec, imageSpecToPrompt, sanitizeSpec } from "../services/image-spec";

const base = () =>
  buildImageSpec({
    description: "Gan sits at a desk staring at a broken dashboard",
    aspectRatio: "1:1",
    characters: [
      { name: "Gàn", promptDescription: "young man", hasReference: true },
      { name: "Gèn", promptDescription: "older man in a cap", hasReference: false },
    ],
    visual: { palette: ["#4f46e5"], mustHave: ["logo góc phải"], doNots: ["ảnh người thật"] },
  });

describe("buildImageSpec — đặc tả có cấu trúc thay cho một đoạn tả bằng lời", () => {
  test("nhân vật CÓ ảnh mẫu thì trỏ tới ảnh, KHÔNG có thì tả bằng chữ", () => {
    const s = base();
    assert.equal(s.characters[0].keep_appearance_from_reference_image, "#1");
    assert.equal(s.characters[1].keep_appearance_from_reference_image, undefined);
    assert.equal(s.characters[1].note, "older man in a cap");
  });

  test("không trỏ vào ảnh mẫu không tồn tại — model sẽ bịa ra nhân vật khác", () => {
    const s = buildImageSpec({
      description: "x",
      aspectRatio: "1:1",
      characters: [{ name: "A", hasReference: false }],
    });
    assert.equal(s.characters[0].keep_appearance_from_reference_image, undefined);
    assert.doesNotMatch(JSON.stringify(s), /#1/);
  });

  test("điều cấm và bảng màu thành LUẬT riêng, không lẫn trong văn xuôi", () => {
    const s = base();
    assert.ok(s.rules.some((r) => /must NOT contain: ảnh người thật/i.test(r)));
    assert.ok(s.rules.some((r) => /palette: #4f46e5/i.test(r)));
  });

  test("không khai chữ thì cấm vẽ chữ; có khai thì bắt viết đúng dấu", () => {
    assert.ok(base().rules.some((r) => /Do NOT render any text/i.test(r)));
    const withText = buildImageSpec({ description: "x", aspectRatio: "1:1", characters: [], textInImage: "Deploy đi!" });
    assert.equal(withText.text_in_image, "Deploy đi!");
    assert.ok(withText.rules.some((r) => /CORRECT diacritics/i.test(r)));
  });

  test("prompt gửi đi có đánh số ảnh mẫu để đặc tả trỏ đúng", () => {
    const p = imageSpecToPrompt(base(), 2);
    assert.match(p, /#1\.\.#2/);
    assert.match(p, /"scene"/);
  });
});

describe("sanitizeSpec — người dùng sửa tay thì vẫn phải lọc lại", () => {
  test("giữ phần người dùng sửa", () => {
    const out = sanitizeSpec({ ...base(), scene: "cảnh mới do người dùng viết" }, base());
    assert.equal(out.scene, "cảnh mới do người dùng viết");
  });

  test("xoá mất cảnh thì từ chối — không có cảnh thì vẽ gì", () => {
    assert.throws(() => sanitizeSpec({ ...base(), scene: "   " }, base()), /thiếu phần 'Cảnh cần vẽ'/);
  });

  test("dán nhầm thứ không phải object thì lùi về bản tự dựng", () => {
    assert.deepEqual(sanitizeSpec("[]" as any, base()), base());
    assert.deepEqual(sanitizeSpec(null, base()), base());
  });

  test("nhân vật thiếu tên thì bỏ, không tạo nhân vật rỗng", () => {
    const out = sanitizeSpec({ ...base(), characters: [{ name: "" }, { name: "Gàn" }] }, base());
    assert.equal(out.characters.length, 1);
    assert.equal(out.characters[0].name, "Gàn");
  });

  test("danh sách rỗng thì bỏ hẳn, không để mảng rỗng trong prompt", () => {
    const out = sanitizeSpec({ ...base(), brand_visual: { do_not: [] } }, base());
    assert.equal(out.brand_visual.do_not, undefined);
  });
});

describe("luật trong prompt tả ảnh — canh bằng mã nguồn", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "server", "services", "remake-image.ts"), "utf8");

  test("bắt ảnh minh hoạ ĐÚNG bản viết, không phải cảnh chung chủ đề", () => {
    assert.match(src, /minh hoạ ĐÚNG nội dung bản viết/);
  });

  test("bài gốc nhiều khung thì giữ đúng hình thức nhiều khung", () => {
    assert.match(src, /giữ đúng hình thức đó \(số khung, cách chia khung\)/);
  });

  test("hướng nội dung của chủ trang thắng mọi gợi ý khác", () => {
    assert.match(src, /thắng mọi gợi ý khác/);
  });

  test("prompt đã gửi được lưu lại cùng ảnh", () => {
    assert.match(src, /promptSent: prompt/);
  });

  test("bài gốc được đọc từ bản bóc cấu trúc, không bỏ qua", () => {
    assert.match(src, /row\.deconstructionId/);
    assert.match(src, /imageReading/);
  });
});
