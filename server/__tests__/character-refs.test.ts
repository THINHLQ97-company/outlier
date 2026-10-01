import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { buildImageSpec } from "../services/image-spec";

// Lỗi đã xảy ra thật: ảnh mẫu được đánh số theo vị trí trong danh sách nhân vật
// ĐẦY ĐỦ, trong khi chỉ nhân vật CÓ ảnh mới được gửi đi. Nhân vật đầu không có
// ảnh là mọi số lệch một bậc, đặc tả trỏ vào ảnh không tồn tại, và model bịa ra
// một nhân vật khác hẳn.
describe("đánh số ảnh mẫu — số trong đặc tả phải trỏ đúng ảnh đã gửi", () => {
  test("nhân vật ĐẦU không có ảnh thì nhân vật sau vẫn phải là #1", () => {
    const spec = buildImageSpec({
      description: "x",
      aspectRatio: "1:1",
      // Đây là thứ chỗ gom ảnh cấp: Gèn là ảnh đầu tiên THẬT SỰ được gửi.
      characters: [
        { name: "Gàn", promptDescription: "tả bằng chữ", refIndex: null },
        { name: "Gèn", refIndex: 1 },
      ],
    });
    assert.equal(spec.characters[0].keep_appearance_from_reference_image, undefined);
    assert.equal(spec.characters[1].keep_appearance_from_reference_image, "#1");
  });

  test("nhân vật không có ảnh thì tả bằng chữ, KHÔNG trỏ số nào", () => {
    const spec = buildImageSpec({
      description: "x",
      aspectRatio: "1:1",
      characters: [{ name: "Gàn", promptDescription: "young man", refIndex: null }],
    });
    assert.equal(spec.characters[0].keep_appearance_from_reference_image, undefined);
    assert.equal(spec.characters[0].note, "young man");
    assert.doesNotMatch(JSON.stringify(spec), /#\d/, "không được trỏ vào ảnh nào cả");
  });

  test("nhiều nhân vật có ảnh thì số hiệu chạy liên tục theo đúng thứ tự gửi", () => {
    const spec = buildImageSpec({
      description: "x",
      aspectRatio: "1:1",
      characters: [
        { name: "A", refIndex: 1 },
        { name: "B", refIndex: null },
        { name: "C", refIndex: 2 },
      ],
    });
    assert.equal(spec.characters[0].keep_appearance_from_reference_image, "#1");
    assert.equal(spec.characters[1].keep_appearance_from_reference_image, undefined);
    assert.equal(spec.characters[2].keep_appearance_from_reference_image, "#2");
  });
});

describe("gom ảnh mẫu — canh bằng mã nguồn", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "server", "services", "character-refs.ts"), "utf8");

  test("số hiệu sinh TỪ mảng ảnh, không suy theo vị trí nhân vật", () => {
    assert.match(src, /refIndex = images\.length/);
  });

  const loader = fs.readFileSync(path.join(process.cwd(), "server", "services", "image-loader.ts"), "utf8");

  test("khai đúng kiểu file, không ghi cứng image/png", () => {
    assert.match(loader, /contentTypeForKey\(key\)/);
    assert.doesNotMatch(src + loader, /mimeType: "image\/png"/);
  });

  test("đọc được ảnh NGOÀI kho — lỗi cũ: ảnh mẫu dạng link ngoài bị bỏ qua im lặng", () => {
    assert.match(loader, /https\?:/);
  });

  test("thiếu ảnh nào cũng ghi LÝ DO, không im lặng", () => {
    assert.match(src, /missingReason/);
    assert.match(src, /sourceMissingReason/);
  });

  test("ảnh gốc đứng CUỐI, sau ảnh nhân vật", () => {
    assert.match(src, /sourceIndex = images\.length/);
  });
});
