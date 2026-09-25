import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { limitForRefresh } from "../routes/channels.routes";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

describe("limitForRefresh — xin đúng số bài cần, không trả tiền cho bài đã có", () => {
  test("lần đầu lấy đủ để dựng mốc so sánh cho kênh", () => {
    assert.equal(limitForRefresh({ scanCount: 0, lastScanAt: null }), 20);
  });

  test("chưa từng quét thì dù có ngày cũng lấy đủ", () => {
    assert.equal(limitForRefresh({ scanCount: 0, lastScanAt: hoursAgo(24) }), 20);
  });

  test("quét lại sau một ngày chỉ xin vài bài, không xin lại cả 20", () => {
    const n = limitForRefresh({ scanCount: 3, lastScanAt: hoursAgo(24) });
    assert.ok(n < 20, `phải ít hơn 20, đang ${n}`);
    assert.ok(n >= 5, `nhưng không quá ít kẻo sót bài, đang ${n}`);
  });

  test("để lâu không quét thì xin nhiều hơn", () => {
    const motNgay = limitForRefresh({ scanCount: 3, lastScanAt: hoursAgo(24) });
    const namNgay = limitForRefresh({ scanCount: 3, lastScanAt: hoursAgo(24 * 5) });
    assert.ok(namNgay > motNgay, `5 ngày phải xin nhiều hơn 1 ngày: ${namNgay} vs ${motNgay}`);
  });

  test("không bao giờ vượt mức lần đầu, dù bỏ bẵng cả tháng", () => {
    assert.equal(limitForRefresh({ scanCount: 9, lastScanAt: hoursAgo(24 * 30) }), 20);
  });

  test("không bao giờ dưới 5 — xin một hai bài thì dễ sót", () => {
    assert.ok(limitForRefresh({ scanCount: 9, lastScanAt: hoursAgo(1) }) >= 5);
  });

  test("kênh đăng dày thì xin nhiều hơn kênh đăng thưa", () => {
    const thua = limitForRefresh({ scanCount: 3, lastScanAt: hoursAgo(48), postsPerDay: 1 });
    const day = limitForRefresh({ scanCount: 3, lastScanAt: hoursAgo(48), postsPerDay: 5 });
    assert.ok(day > thua, `kênh đăng dày phải xin nhiều hơn: ${day} vs ${thua}`);
  });

  test("có biên an toàn: xin gấp đôi số bài dự kiến", () => {
    // 2 ngày × 2 bài/ngày = 4 bài dự kiến → xin 8, phòng khi họ đăng dồn.
    assert.equal(limitForRefresh({ scanCount: 3, lastScanAt: hoursAgo(48), postsPerDay: 2 }), 8);
  });
});
