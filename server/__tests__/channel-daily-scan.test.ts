import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { isDue, nextRunAt, shouldScanChannel, vnDate } from "../services/channel-daily-scan";

// Tự quét mọi kênh lúc 8:00 giờ Việt Nam (task #6269).
const at = (iso: string) => new Date(iso);

describe("lịch 8h sáng giờ Việt Nam", () => {
  test("ngày tính theo giờ VN, không theo UTC", () => {
    // 23:30 UTC ngày 11 = 06:30 sáng ngày 12 ở VN
    assert.equal(vnDate(at("2026-10-11T23:30:00Z")), "2026-10-12");
  });

  test("trước 8h thì lần tới là 8h hôm nay, sau 8h là 8h mai", () => {
    assert.equal(nextRunAt(at("2026-10-12T00:30:00Z"), 8).toISOString(), "2026-10-12T01:00:00.000Z");
    assert.equal(nextRunAt(at("2026-10-12T01:00:00Z"), 8).toISOString(), "2026-10-13T01:00:00.000Z");
  });

  test("chưa tới 8h thì chưa chạy", () => {
    assert.equal(isDue(at("2026-10-12T00:59:00Z"), "2026-10-11", 8), false);
  });

  test("qua 8h mà hôm nay chưa chạy thì chạy — kể cả chạy bù khi app khởi động lại lúc 9h", () => {
    assert.equal(isDue(at("2026-10-12T01:00:00Z"), "2026-10-11", 8), true);
    assert.equal(isDue(at("2026-10-12T02:00:00Z"), null, 8), true);
  });

  test("đã chạy hôm nay thì không chạy lần hai", () => {
    assert.equal(isDue(at("2026-10-12T10:00:00Z"), "2026-10-12", 8), false);
  });
});

describe("chọn kênh để quét", () => {
  const now = at("2026-10-12T01:00:00Z");
  test("bỏ kênh đang tắt", () => {
    assert.equal(shouldScanChannel({ isActive: false, scanStatus: "idle", updatedAt: null }, now), false);
  });
  test("quét lại kênh lỗi lần trước", () => {
    assert.equal(shouldScanChannel({ isActive: true, scanStatus: "error", updatedAt: now }, now), true);
  });
  test("bỏ kênh đang quét dở, trừ khi kẹt quá 30 phút (app khởi động lại giữa chừng)", () => {
    assert.equal(shouldScanChannel({ isActive: true, scanStatus: "scanning", updatedAt: at("2026-10-12T00:50:00Z") }, now), false);
    assert.equal(shouldScanChannel({ isActive: true, scanStatus: "scanning", updatedAt: at("2026-10-12T00:00:00Z") }, now), true);
  });
});

describe("quét nối tiếp, không quét lại từ đầu", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "server", "routes", "channels.routes.ts"), "utf8");
  const refresh = src.slice(src.indexOf("export async function refreshChannelInBackground"), src.indexOf("async function scanChannelViaApify"));

  test("quét lỗi KHÔNG dời mốc lần quét cuối — dời là bỏ sót bài giữa hai lần", () => {
    const errorBranch = refresh.slice(refresh.indexOf("if (r.candidates.length === 0) {"), refresh.indexOf("return;", refresh.indexOf("if (r.candidates.length === 0) {")));
    assert.doesNotMatch(errorBranch.slice(errorBranch.indexOf(".set({")), /lastScanAt:/);
  });

  test("kênh có phí chỉ xin bài mới hơn lần quét trước", () => {
    assert.match(refresh, /chan\.scanCount && chan\.lastScanAt \? new Date\(chan\.lastScanAt\) : null/);
  });

  test("job sáng đi đúng đường quét tay, lần lượt từng kênh", () => {
    const job = fs.readFileSync(path.join(process.cwd(), "server", "services", "channel-daily-scan.ts"), "utf8");
    assert.match(job, /for \(const c of targets\) \{[\s\S]*await refreshChannelInBackground\(c\.id\)/);
  });
});
