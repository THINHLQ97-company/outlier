import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildImageGenerationRequest } from "../services/prompt-builder";

// Không có GEMINI_API_KEY trong môi trường test → bước dịch cảnh tự lỗi và giữ
// nguyên tiếng Việt (hành vi đã có). Nhờ vậy test chạy offline được.
const base = {
  scene: "Gàn ngồi trước máy tính",
  characters: [],
  dialogue: [],
  layoutInstruction: "một khung",
  aspectRatio: "1:1",
  renderDialogue: false,
};

describe("prompt vẽ — phong cách phải thành LUẬT, không chỉ nằm trong JSON", () => {
  test("có mô tả nét vẽ thì nhắc đúng các trường quyết định sự giống nhau", async () => {
    const out = await buildImageGenerationRequest({
      ...base,
      style: { name: "Nét thô vui", styleJson: { medium: "vector", rendering: "flat fill" } },
    });
    assert.match(out.promptText, /line weight/i);
    assert.match(out.promptText, /character proportions/i);
  });

  test("'avoid' được tách thành luật phủ định riêng — nằm trong JSON thì model bỏ qua", async () => {
    const out = await buildImageGenerationRequest({
      ...base,
      style: { name: "Nét thô vui", styleJson: { medium: "vector", avoid: ["soft shadows", "photo realism"] } },
    });
    assert.match(out.promptText, /must NOT contain: soft shadows; photo realism/);
    assert.match(out.promptText, /even if they would look better/);
  });

  test("avoid là chuỗi đơn cũng thành luật, không rơi mất", async () => {
    const out = await buildImageGenerationRequest({
      ...base,
      style: { name: "X", styleJson: { avoid: "gradient background" } },
    });
    assert.match(out.promptText, /must NOT contain: gradient background/);
  });

  test("bảng màu thành luật giới hạn màu chủ đạo", async () => {
    const out = await buildImageGenerationRequest({
      ...base,
      style: { name: "X", styleJson: { color_palette: ["#4f46e5", "#f8fafc"] } },
    });
    assert.match(out.promptText, /Stay within this palette: #4f46e5, #f8fafc/);
  });

  test("không chọn phong cách thì không sinh luật phong cách nào", async () => {
    const out = await buildImageGenerationRequest(base);
    assert.doesNotMatch(out.promptText, /must NOT contain/);
    assert.doesNotMatch(out.promptText, /Stay within this palette/);
  });

  test("phong cách rỗng cũng không sinh luật — tránh ép model theo mô tả trống", async () => {
    const out = await buildImageGenerationRequest({ ...base, style: { name: "Trống", styleJson: {} } });
    assert.doesNotMatch(out.promptText, /Render EXACTLY in the art style/);
  });
});
