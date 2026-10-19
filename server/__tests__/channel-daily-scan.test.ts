import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { isDue, nextRunAt, orderForScan, shouldScanChannel, vnDate } from "../services/channel-daily-scan";

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

describe("luân phiên khi ngân sách không đủ cho mọi kênh", () => {
  test("kênh chưa quét lần nào đứng đầu, rồi tới kênh lâu chưa quét nhất", () => {
    const rows = [
      { id: "moi-quet", lastScanAt: new Date("2026-10-12T03:20:00Z") },
      { id: "chua-quet", lastScanAt: null },
      { id: "bi-bo-hom-qua", lastScanAt: new Date("2026-10-10T01:00:00Z") },
    ];
    assert.deepEqual(orderForScan(rows).map((r) => r.id), ["chua-quet", "bi-bo-hom-qua", "moi-quet"]);
  });
});

describe("ưu tiên kênh hoạt động, bỏ kênh ngủ đông (task #6849)", () => {
  const now = new Date("2026-10-19T01:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
  // import trễ để không đổi dòng import ở đầu tệp
  const load = () => import("../services/channel-daily-scan");

  test("kênh vừa bấm Làm mới tay lên đầu, kể cả khi đang ngủ đông", async () => {
    const { scanTier } = await load();
    assert.equal(scanTier({ useApify: true, lastScanAt: daysAgo(1), lastManualScanAt: daysAgo(2), lastPostAt: daysAgo(60) }, now), "manual");
  });

  test("kênh có bài trong 7 ngày là đang hoạt động; chưa biết bài mới nhất cũng coi là hoạt động", async () => {
    const { scanTier } = await load();
    assert.equal(scanTier({ useApify: true, lastScanAt: daysAgo(1), lastPostAt: daysAgo(3) }, now), "active");
    assert.equal(scanTier({ useApify: true, lastScanAt: null, lastPostAt: null }, now), "active");
  });

  test("kênh có phí 21 ngày không ra bài: ngừng quét hằng ngày, chỉ kiểm tra lại mỗi tuần", async () => {
    const { scanTier } = await load();
    assert.equal(scanTier({ useApify: true, lastScanAt: daysAgo(2), lastPostAt: daysAgo(40) }, now), "dormant_skip");
    assert.equal(scanTier({ useApify: true, lastScanAt: daysAgo(8), lastPostAt: daysAgo(40) }, now), "dormant_check");
  });

  test("kênh miễn phí không bao giờ ngủ đông — không tốn tiền", async () => {
    const { scanTier } = await load();
    assert.equal(scanTier({ useApify: false, lastScanAt: daysAgo(1), lastPostAt: daysAgo(90) }, now), "quiet");
  });

  test("thứ tự: quét tay (mới bấm trước) → hoạt động → ít ra bài → kiểm tra ngủ đông; bỏ kênh ngủ đông", async () => {
    const { planDailyScan } = await load();
    const rows = [
      { id: "ngu-dong", useApify: true, lastScanAt: daysAgo(1), lastPostAt: daysAgo(50) },
      { id: "kiem-tra-tuan", useApify: true, lastScanAt: daysAgo(9), lastPostAt: daysAgo(50) },
      { id: "it-ra-bai", useApify: true, lastScanAt: daysAgo(1), lastPostAt: daysAgo(10) },
      { id: "hoat-dong-moi-quet", useApify: true, lastScanAt: daysAgo(0.5), lastPostAt: daysAgo(1) },
      { id: "hoat-dong-lau-chua-quet", useApify: true, lastScanAt: daysAgo(3), lastPostAt: daysAgo(1) },
      { id: "tay-cu", useApify: true, lastScanAt: daysAgo(1), lastManualScanAt: daysAgo(5), lastPostAt: daysAgo(1) },
      { id: "tay-moi", useApify: true, lastScanAt: daysAgo(1), lastManualScanAt: daysAgo(1), lastPostAt: daysAgo(30) },
    ];
    const { targets, dormant } = planDailyScan(rows, now);
    assert.deepEqual(targets.map((r) => r.id), [
      "tay-moi", "tay-cu", "hoat-dong-lau-chua-quet", "hoat-dong-moi-quet", "it-ra-bai", "kiem-tra-tuan",
    ]);
    assert.deepEqual(dormant.map((r) => r.id), ["ngu-dong"]);
  });

  test("bấm Làm mới tay thì ghi lại lần quét tay", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "server", "routes", "channels.routes.ts"), "utf8");
    const body = src.slice(src.indexOf('app.post("/api/channels/:id/refresh"'), src.indexOf('app.get("/api/channels/:id/items"'));
    assert.match(body, /lastManualScanAt: new Date\(\)/);
  });
});

describe("Apify hết hạn mức thì dừng gọi cho kênh có phí (task #6858)", () => {
  test("nhận ra lỗi hết hạn mức của tài khoản, không nhầm với lỗi riêng của kênh", async () => {
    const { isApifyQuotaError } = await import("../services/channel-daily-scan");
    assert.equal(
      isApifyQuotaError('Không lấy được số liệu từ Apify: Apify 402: { "error": { "type": "not-enough-usage-to-run-paid-actor", "message": "Your remaining usage of $0.000195 ..." } }'),
      true,
    );
    assert.equal(isApifyQuotaError("Không tìm thấy kết quả nào cho truy vấn này."), false);
    assert.equal(isApifyQuotaError(null), false);
  });

  test("trang Kênh theo dõi không còn hiện hộp lỗi, chỉ hiện 'Cập nhật gần nhất'", () => {
    const ui = fs.readFileSync(path.join(process.cwd(), "src", "pages", "Channels.tsx"), "utf8");
    assert.doesNotMatch(ui, /\{detail\.errorMessage\}/);
    assert.doesNotMatch(ui, />Lỗi</);
    assert.match(ui, /Cập nhật gần nhất: /);
  });
});
