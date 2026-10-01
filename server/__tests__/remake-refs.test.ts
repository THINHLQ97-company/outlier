import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildImageSpec } from "../services/image-spec";
import { loadImageForModel } from "../services/image-loader";
import { pickCharactersInUse } from "../services/remake-image";

const char = (name: string, extra: any = {}): any => ({
  id: name,
  name,
  promptDescription: `${name} desc`,
  referenceImageUrl: `/api/files/characters/${name}.png`,
  ...extra,
});
const GAN = char("Gàn");
const GEN = char("Gèn");

describe("chỉ đính nhân vật CÓ TRONG BÀI", () => {
  test("phương án ghi rõ chỉ có Gèn thì chỉ đính Gèn", () => {
    const out = pickCharactersInUse([GAN, GEN], { characters: ["Gèn"] });
    assert.deepEqual(out.map((c) => c.name), ["Gèn"]);
  });

  test("ghi cả hai thì đính cả hai, theo thứ tự phương án", () => {
    const out = pickCharactersInUse([GAN, GEN], { characters: ["Gèn", "Gàn"] });
    assert.deepEqual(out.map((c) => c.name), ["Gèn", "Gàn"]);
  });

  test("phương án quên ghi tên thì dò tên trong lời tả các khung", () => {
    const out = pickCharactersInUse([GAN, GEN], {
      characters: [],
      panels: [{ scene: "office", action: "Gàn leans on the wall" }],
    });
    assert.deepEqual(out.map((c) => c.name), ["Gàn"]);
  });

  test("không thấy ai thì đính đủ — thà đủ còn hơn vẽ nhân vật không có mẫu", () => {
    const out = pickCharactersInUse([GAN, GEN], { characters: [], panels: [{ scene: "empty room" }] });
    assert.equal(out.length, 2);
  });

  test("tên lạ không có trong thư viện thì bỏ", () => {
    const out = pickCharactersInUse([GAN, GEN], { characters: ["Chú Ngựa", "Gèn"] });
    assert.deepEqual(out.map((c) => c.name), ["Gèn"]);
  });
});

describe("ảnh gốc làm mẫu BỐ CỤC, không làm mẫu NHÂN VẬT", () => {
  const spec = buildImageSpec({
    description: "x",
    aspectRatio: "1:1",
    characters: [{ name: "Gèn", refIndex: 1 }],
    sourceIndex: 2,
  });

  test("đặc tả trỏ đúng số hiệu ảnh gốc", () => {
    assert.equal(spec.source_layout_reference, "#2");
  });

  test("bắt giữ bố cục, tư thế, cách chia khung", () => {
    assert.ok(spec.rules.some((r) => /Reproduce its layout, panel structure, camera angle, poses/.test(r)));
  });

  test("bắt THAY nhân vật gốc bằng nhân vật trang — không vẽ lại chú ngựa", () => {
    const r = spec.rules.find((x) => /REPLACE every character/.test(x));
    assert.ok(r, "thiếu luật thay nhân vật");
    assert.match(r!, /\(Gèn\)/);
    assert.match(r!, /Do NOT copy the original characters' appearance, species/);
  });

  test("không chép chữ, watermark, logo của bài gốc", () => {
    assert.ok(spec.rules.some((r) => /Do NOT copy any text, watermark or logo/.test(r)));
  });

  test("không có ảnh gốc thì không sinh luật bố cục", () => {
    const s2 = buildImageSpec({ description: "x", aspectRatio: "1:1", characters: [] });
    assert.equal(s2.source_layout_reference, undefined);
    assert.ok(!s2.rules.some((r) => /ORIGINAL post/.test(r)));
  });
});

describe("loadImageForModel — đọc ảnh từ mọi nơi, hỏng thì nói lý do", () => {
  test("data URL đọc được", async () => {
    const png1x1 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const out = await loadImageForModel(png1x1);
    assert.ok(out.image);
    assert.equal(out.image!.mimeType, "image/png");
  });

  test("không có đường dẫn thì trả lý do, không ném lỗi", async () => {
    const out = await loadImageForModel(null);
    assert.equal(out.image, null);
    assert.match(out.reason || "", /không có đường dẫn/);
  });

  test("đường dẫn lạ thì trả lý do", async () => {
    const out = await loadImageForModel("ftp://x/y.png");
    assert.equal(out.image, null);
    assert.match(out.reason || "", /đường dẫn lạ/);
  });
});
