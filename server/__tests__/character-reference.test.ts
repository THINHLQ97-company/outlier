import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { buildReferencePrompt } from "../services/character-reference";
import { CHARACTERS } from "../../shared/engine-data";

describe("prompt vẽ ảnh mẫu — tôn trọng ràng buộc riêng của nhân vật", () => {
  test("mô tả đi nguyên vào prompt, kèm tên", () => {
    const p = buildReferencePrompt({
      id: "1",
      name: "Chị Kế Toán",
      promptDescription: "woman in her 30s, bun hair, glasses, holding a calculator",
    });
    assert.match(p, /Chị Kế Toán: woman in her 30s/);
  });

  test("dặn model KHÔNG bịa mặt khi mô tả nói không lộ mặt", () => {
    // "Sếp" không bao giờ lộ mặt — ép vẽ chính diện là phá đúng thứ làm nhân
    // vật đó nhận ra được.
    const p = buildReferencePrompt({ id: "1", name: "Sếp", promptDescription: "never shows face, only back" });
    assert.match(p, /do not invent a face/i);
  });

  test("không có chữ trong ảnh mẫu", () => {
    const p = buildReferencePrompt({ id: "1", name: "X", promptDescription: "abc" });
    assert.match(p, /no text/i);
  });
});

describe("MCP — dàn nhân vật gốc được bảo vệ", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "server", "routes", "mcp-signals.routes.ts"),
    "utf8",
  );

  test("danh sách nhân vật gốc lấy từ nguồn dữ liệu chung, không chép tay", () => {
    // Chép tay thì thêm nhân vật vào seed mà quên cập nhật ở đây là hở ngay.
    assert.match(src, /CORE_CHARACTER_NAMES = new Set\(CHARACTERS\.map/);
  });

  test("có đủ dàn gốc để bảo vệ", () => {
    const names = CHARACTERS.map((c) => c.name);
    for (const must of ["Gàn", "Gèn", "Chị Bão", "Sếp", "Claude"]) {
      assert.ok(names.includes(must), `thiếu ${must} trong dàn gốc`);
    }
  });

  test("nhân vật gốc: khoá tên/tính cách/câu cửa miệng", () => {
    assert.match(src, /lockedFields\.push\("personality"\)/);
    assert.match(src, /lockedFields\.push\("catchphrase"\)/);
    assert.match(src, /không sửa qua MCP/);
  });

  test("nhưng NGOẠI HÌNH của nhân vật gốc thì sửa được", () => {
    // Mô tả ngoại hình sai (găng trắng trong khi ảnh thật không có) là gốc của
    // việc vẽ ra không giống trang — chặn lại thì mãi không sửa được.
    assert.doesNotMatch(src, /lockedFields\.push\("prompt_description"\)/);
    assert.match(src, /Ngoại hình \(prompt_description\) và ảnh mẫu thì sửa được/);
  });

  test("có đường THAY ảnh mẫu, không chỉ vẽ lại bằng AI", () => {
    // Ảnh mẫu trong thư viện sai nét thì vẽ lại bằng AI không cứu được.
    assert.match(src, /name: "character_image_set"/);
    assert.match(src, /name: "character_image_get"/);
  });

  test("character_create chặn trùng tên nhân vật gốc", () => {
    assert.match(src, /CORE_CHARACTER_NAMES\.has\(nm\)/);
  });

  test("bắt mô tả ngoại hình đủ dài — tả sơ sài thì mỗi bài vẽ ra một người", () => {
    assert.match(src, /desc\.length < 20/);
  });
});
