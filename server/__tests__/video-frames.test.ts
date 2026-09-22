// Test cách chọn mốc lấy khung hình.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickTimestamps, MAX_FRAME_COUNT, DEFAULT_FRAME_COUNT } from "../services/video-frames";

describe("pickTimestamps", () => {
  test("dồn khung vào đoạn mở đầu — chỗ quyết định người xem ở lại", () => {
    const ts = pickTimestamps(60, 6);
    const trongMoDau = ts.filter((t) => t <= 12).length; // 20% đầu của 60s
    assert.ok(trongMoDau >= 2, `phải có ít nhất 2 khung ở đoạn mở, đang ${trongMoDau}: ${ts}`);
  });

  test("luôn có khung ở giây 0", () => {
    assert.equal(pickTimestamps(60, 6)[0], 0);
  });

  test("không vượt quá độ dài video", () => {
    for (const d of [5, 30, 60, 300]) {
      const ts = pickTimestamps(d, 8);
      assert.ok(Math.max(...ts) < d, `mốc ${Math.max(...ts)} vượt video dài ${d}s`);
    }
  });

  test("các mốc không trùng nhau và tăng dần", () => {
    const ts = pickTimestamps(45, 8);
    assert.deepEqual(ts, [...new Set(ts)].sort((a, b) => a - b));
  });

  test("video rất ngắn chỉ lấy 1 khung", () => {
    assert.deepEqual(pickTimestamps(2, 6), [0]);
  });

  test("chặn trần số khung — tránh làm ngợp cửa sổ hội thoại", () => {
    assert.ok(pickTimestamps(600, 999).length <= MAX_FRAME_COUNT);
  });

  test("xin ít hơn 2 khung vẫn ra kết quả dùng được", () => {
    assert.ok(pickTimestamps(60, 1).length >= 1);
  });

  test("số khung mặc định hợp lý", () => {
    assert.ok(DEFAULT_FRAME_COUNT >= 4 && DEFAULT_FRAME_COUNT <= 8);
  });

  test("video dài trải khung tới tận cuối", () => {
    const ts = pickTimestamps(300, 8);
    assert.ok(Math.max(...ts) > 200, `khung cuối mới ở ${Math.max(...ts)}s, chưa trải hết video`);
  });
});
