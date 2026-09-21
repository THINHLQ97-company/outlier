// Test lớp chống bịa của Deconstruct: AI không được mô tả đoạn không tồn tại.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sanitizeStructure, subtitleToTranscript } from "../services/deconstruct";

describe("sanitizeStructure — chặn mốc thời gian bịa", () => {
  const video60s = 60;

  test("giữ lại mốc nằm trong video", () => {
    const { structure, dropped } = sanitizeStructure({
      hook3s: { atSec: 0, what: "Đặt câu hỏi ngược đời", technique: "câu hỏi gây tò mò" },
      cta: { atSec: 55, what: "Mời để lại bình luận", style: "nhẹ nhàng" },
    }, video60s);
    assert.ok(structure.hook3s);
    assert.equal(structure.hook3s!.what, "Đặt câu hỏi ngược đời");
    assert.equal(structure.cta!.atSec, 55);
    assert.equal(dropped.length, 0);
  });

  test("LOẠI mốc nằm ngoài độ dài video", () => {
    const { structure, dropped } = sanitizeStructure({
      twist: { atSec: 400, what: "Bẻ hướng bất ngờ" },
    }, video60s);
    assert.equal(structure.twist, null, "mốc 400s trong video 60s phải bị loại");
    assert.ok(dropped.some((d) => d.includes("nằm ngoài video")), dropped.join(" | "));
  });

  test("LOẠI mục thiếu mốc thời gian", () => {
    const { structure, dropped } = sanitizeStructure({
      hook3s: { what: "Có mô tả nhưng không có giây" },
    }, video60s);
    assert.equal(structure.hook3s, null);
    assert.ok(dropped.some((d) => d.includes("thiếu mốc thời gian")));
  });

  test("LOẠI mục có giây nhưng không mô tả gì", () => {
    const { structure, dropped } = sanitizeStructure({ cta: { atSec: 30, what: "   " } }, video60s);
    assert.equal(structure.cta, null);
    assert.ok(dropped.some((d) => d.includes("không mô tả gì")));
  });

  test("lọc từng điểm giữ chân một cách độc lập", () => {
    const { structure, dropped } = sanitizeStructure({
      retentionBeats: [
        { atSec: 10, what: "Đưa ví dụ thật", whyItWorks: "khiến người xem thấy giống mình" },
        { atSec: 999, what: "Đoạn không tồn tại", whyItWorks: "bịa" },
        { atSec: 30, what: "Lật lại vấn đề", whyItWorks: "tạo bất ngờ" },
      ],
    }, video60s);
    assert.equal(structure.retentionBeats!.length, 2, "phải giữ 2, loại 1");
    assert.ok(!structure.retentionBeats!.some((b) => b.atSec === 999));
    assert.equal(dropped.length, 1);
  });

  test("không biết độ dài video thì không loại theo mốc (nhưng vẫn cần có mốc)", () => {
    const { structure } = sanitizeStructure({ twist: { atSec: 400, what: "Bẻ hướng" } }, undefined);
    assert.ok(structure.twist, "không rõ độ dài thì chấp nhận");
  });

  test("dữ liệu rác không làm vỡ", () => {
    for (const bad of [null, undefined, "chuỗi", 42, [], { hook3s: "sai kiểu" }]) {
      const { structure } = sanitizeStructure(bad as any, video60s);
      assert.equal(structure.hook3s, null);
      assert.deepEqual(structure.retentionBeats, []);
    }
  });

  test("formula rỗng → null, không giữ chuỗi trắng", () => {
    assert.equal(sanitizeStructure({ formula: "   " }, video60s).structure.formula, null);
    assert.equal(sanitizeStructure({ formula: "mở bằng câu hỏi → chốt bằng lời khuyên" }, video60s).structure.formula,
      "mở bằng câu hỏi → chốt bằng lời khuyên");
  });
});

describe("subtitleToTranscript — đọc phụ đề kèm mốc giây", () => {
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:03.500
Bạn có biết vì sao video này giữ chân được không?

00:00:03.500 --> 00:00:07.000
Bí mật nằm ở ba giây đầu tiên.

00:00:07.000 --> 00:00:09.000
Bí mật nằm ở ba giây đầu tiên.
`;

  test("gắn mốc giây vào từng câu", () => {
    const t = subtitleToTranscript(vtt);
    assert.ok(t.includes("[0s]"), t);
    assert.ok(t.includes("[3s]"), t);
  });

  test("bỏ dòng lặp của phụ đề tự động", () => {
    const t = subtitleToTranscript(vtt);
    const count = (t.match(/Bí mật nằm ở ba giây đầu tiên/g) || []).length;
    assert.equal(count, 1, "phụ đề tự động hay lặp dòng, phải gộp lại");
  });

  test("bỏ thẻ định dạng trong phụ đề", () => {
    const t = subtitleToTranscript("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<c.colorE5E5E5>Xin chào</c>\n");
    assert.ok(t.includes("Xin chào"));
    assert.ok(!t.includes("<c."));
  });

  test("phụ đề rỗng → chuỗi rỗng, không vỡ", () => {
    assert.equal(subtitleToTranscript("WEBVTT\n"), "");
    assert.equal(subtitleToTranscript(""), "");
  });
});
