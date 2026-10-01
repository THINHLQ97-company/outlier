import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildConceptPrompt, sanitizeConcepts, proposeImageConcepts } from "../services/image-concepts";
import { specFromConcept } from "../services/image-spec";

const input = {
  draft: "Gàn khoe deploy xong lúc 5 giờ chiều thứ sáu, Gèn đứng sau lưng mặt tái mét.",
  characterNames: ["Gàn", "Gèn"],
  source: {
    imageReading: { imageKind: "truyện tranh 4 khung", textInImage: "HÔNG BƠI NỔI NỮA", technique: "bẻ hướng ở khung cuối" },
    formula: "mở bằng tình huống quen → đẩy lên → bẻ hướng",
    direction: "nói sâu về kỹ thuật",
  },
};

const good = {
  concepts: [
    {
      title: "Deploy chiều thứ sáu",
      why: "Bám đúng câu chốt của bài",
      layout: "4 khung dọc",
      characters: ["Gàn", "Gèn", "Nhân vật lạ"],
      panels: [
        { scene: "office at 5pm", action: "Gàn presses enter", expression: "proud", dialogue: "[5 GIỜ CHIỀU THỨ SÁU] Deploy nè!" },
        { scene: "same office", action: "Gèn, a large horse in a suit, stares at the screen", expression: "pale", dialogue: null },
      ],
    },
    { title: "Phương án 2", why: "x", layout: "1 khung", characters: ["Gàn"], panels: [{ scene: "server room", action: "Gàn runs", expression: "panic", dialogue: null }] },
    { title: "Không có khung", why: "x", layout: "1 khung", characters: [], panels: [] },
  ],
};

describe("prompt đề xuất phương án — học từ marcow-crop", () => {
  const p = buildConceptPrompt(input, 3);

  test("CẤM tả ngoại hình nhân vật — chữ ngoại hình giành quyền với ảnh mẫu", () => {
    // Đây là gốc của việc Gèn vẽ ra không giống chú ngựa trong ảnh mẫu.
    assert.match(p, /TUYỆT ĐỐI KHÔNG tả ngoại hình/);
    assert.match(p, /Ngoại hình đã có ảnh mẫu lo/);
  });

  test("chỉ dùng đúng tên nhân vật được cấp", () => {
    assert.match(p, /"Gàn", "Gèn"/);
  });

  test("mỗi nhân vật một tư thế tay mỗi khung — tránh vẽ ra bốn cánh tay", () => {
    assert.match(p, /MỘT tư thế tay mỗi khung/);
  });

  test("kèm hình thức bài gốc, chữ trong ảnh gốc, công thức và hướng nội dung", () => {
    assert.match(p, /truyện tranh 4 khung/);
    assert.match(p, /HÔNG BƠI NỔI NỮA/);
    assert.match(p, /bẻ hướng/);
    assert.match(p, /nói sâu về kỹ thuật/);
  });

  test("bắt ba phương án KHÁC NHAU THẬT, không phải một ý viết lại ba lần", () => {
    assert.match(p, /KHÁC NHAU THẬT/);
  });

  test("nhân vật CHƯA có ảnh mẫu thì mới được tả ngoại hình", () => {
    const withNoRef = buildConceptPrompt(
      { ...input, charactersWithoutReference: [{ name: "Chị Bão", appearance: "woman with umbrella" }] },
      3,
    );
    assert.match(withNoRef, /Chị Bão: woman with umbrella/);
  });
});

describe("sanitizeConcepts — không tin model tuân thủ", () => {
  const out = sanitizeConcepts(good, ["Gàn", "Gèn"], 3);

  test("bỏ phương án không có khung nào", () => {
    assert.equal(out.length, 2);
  });

  test("cắt mệnh đề tả ngoại hình model lén thêm vào", () => {
    const action = out[0].panels[1].action;
    assert.doesNotMatch(action, /horse|suit/i, `vẫn còn tả ngoại hình: "${action}"`);
    assert.match(action, /Gèn/);
    assert.match(action, /stares at the screen/);
  });

  test("chỉ giữ tên nhân vật được cấp — tên lạ là nhân vật không có ảnh mẫu", () => {
    assert.deepEqual(out[0].characters, ["Gàn", "Gèn"]);
  });

  test("không chữ thì để null, không phải chuỗi rỗng", () => {
    assert.equal(out[0].panels[1].dialogue, null);
  });

  test("tôn trọng số lượng tối đa", () => {
    assert.equal(sanitizeConcepts(good, ["Gàn"], 1).length, 1);
  });
});

describe("proposeImageConcepts", () => {
  test("model trả rác thì báo lỗi rõ", async () => {
    await assert.rejects(() => proposeImageConcepts(input, 3, async () => "không phải JSON"), /Không đọc được/);
  });

  test("không phương án nào dùng được thì báo lỗi, không trả mảng rỗng im lặng", async () => {
    await assert.rejects(
      () => proposeImageConcepts(input, 3, async () => JSON.stringify({ concepts: [{ title: "x", panels: [] }] })),
      /không đưa ra phương án ảnh nào/,
    );
  });
});

describe("specFromConcept — phương án thành đặc tả vẽ", () => {
  const concept = sanitizeConcepts(good, ["Gàn", "Gèn"], 3)[0];
  const spec = specFromConcept(concept, {
    aspectRatio: "1:1",
    characters: [
      { name: "Gàn", refIndex: null, promptDescription: "young dev" },
      { name: "Gèn", refIndex: 1 },
    ],
  });

  test("nhiều khung thì có luật vẽ ĐÚNG số khung", () => {
    assert.ok(spec.rules.some((r) => /Draw EXACTLY 2 panels/.test(r)));
  });

  test("giữ từng khung kèm số thứ tự", () => {
    assert.equal(spec.panels?.length, 2);
    assert.equal(spec.panels?.[0].panel, 1);
  });

  test("có lời thoại thì bật luật vẽ chữ đúng dấu và bóng thoại", () => {
    assert.ok(spec.rules.some((r) => /CORRECT diacritics/.test(r)));
    assert.ok(spec.rules.some((r) => /speech bubble/.test(r)));
  });

  test("Gèn trỏ đúng ảnh mẫu #1", () => {
    assert.equal(spec.characters[1].keep_appearance_from_reference_image, "#1");
  });
});
