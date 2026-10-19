import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aggregateAdsByStory, autoOrderStatus, classifyAdsError } from "../services/fanpage-ads";
import { canSetOrderStatus } from "../routes/ad-orders.routes";

// Bài trang nhà đang chạy quảng cáo + đơn đặt quảng cáo (task #6843).

describe("ghép quảng cáo vào bài", () => {
  const ads = [
    { id: "a1", creative: { effective_object_story_id: "111_1" }, insights: { data: [{ spend: "120000", impressions: "5000", reach: "4000" }] } },
    { id: "a2", creative: { effective_object_story_id: "111_1" }, insights: { data: [{ spend: "30000", impressions: "1000", reach: "900" }] } },
    { id: "a3", creative: { effective_object_story_id: "111_2" } },
    { id: "a4", creative: { effective_object_story_id: "999_7" } }, // trang khác chung tài khoản
    { id: "a5", creative: {} }, // bài chỉ để chạy QC, không đăng lên trang
  ];

  test("gom nhiều quảng cáo cùng đẩy một bài, cộng chi tiêu và hiển thị", () => {
    const { byStory } = aggregateAdsByStory(ads, "111", "VND");
    const p1 = byStory.get("111_1")!;
    assert.deepEqual(p1.adIds, ["a1", "a2"]);
    assert.equal(p1.spend, 150000);
    assert.equal(p1.impressions, 6000);
    assert.equal(p1.currency, "VND");
  });

  test("reach không cộng được giữa các quảng cáo — lấy lớn nhất", () => {
    assert.equal(aggregateAdsByStory(ads, "111").byStory.get("111_1")!.reach, 4000);
  });

  test("quảng cáo chưa có số liệu vẫn được nhận là đang chạy, số liệu để trống chứ không ghi 0", () => {
    const p2 = aggregateAdsByStory(ads, "111").byStory.get("111_2")!;
    assert.deepEqual(p2.adIds, ["a3"]);
    assert.equal(p2.spend, null);
  });

  test("bỏ quảng cáo của trang khác, đếm riêng quảng cáo không đẩy bài có sẵn", () => {
    const { byStory, unmatched } = aggregateAdsByStory(ads, "111");
    assert.equal(byStory.has("999_7"), false);
    assert.equal(byStory.size, 2);
    assert.equal(unmatched, 1);
  });
});

describe("đơn đặt quảng cáo tự chuyển trạng thái", () => {
  test("chờ chạy + thấy quảng cáo → đang chạy", () => {
    assert.equal(autoOrderStatus("cho_chay", true, false), "dang_chay");
  });
  test("đang chạy + quảng cáo đã tắt (từng thấy chạy) → đã xong", () => {
    assert.equal(autoOrderStatus("dang_chay", false, true), "da_xong");
  });
  test("người chạy tự bấm 'đang chạy' mà job chưa từng thấy quảng cáo → KHÔNG tự đóng", () => {
    assert.equal(autoOrderStatus("dang_chay", false, false), null);
  });
  test("đơn đã xong / đã huỷ thì job không đụng", () => {
    assert.equal(autoOrderStatus("da_xong", true, true), null);
    assert.equal(autoOrderStatus("huy", true, true), null);
  });
});

describe("lỗi Meta → báo rõ phải sửa gì", () => {
  test("thiếu quyền ads_read", () => {
    assert.equal(classifyAdsError({ code: 200, message: "(#200) Requires ads_read permission" }).status, "missing_ads_read");
    assert.equal(classifyAdsError({ code: 10 }).status, "missing_ads_read");
  });
  test("token hết hạn / bị chặn tạm là lỗi chung, không phải thiếu quyền", () => {
    assert.equal(classifyAdsError({ code: 190 }).status, "error");
    assert.equal(classifyAdsError({ code: 17 }).status, "error");
  });
});

describe("ai được đổi trạng thái đơn", () => {
  const order = { requestedBy: "khoi", status: "cho_chay" };
  test("người chạy quảng cáo và admin đổi được mọi trạng thái", () => {
    assert.equal(canSetOrderStatus({ username: "thinh", isAdmin: false, runner: "thinh" }, order, "da_xong"), true);
    assert.equal(canSetOrderStatus({ username: "admin", isAdmin: true, runner: "thinh" }, order, "dang_chay"), true);
  });
  test("người đặt chỉ huỷ được khi đơn còn chờ chạy", () => {
    const me = { username: "khoi", isAdmin: false, runner: "thinh" };
    assert.equal(canSetOrderStatus(me, order, "huy"), true);
    assert.equal(canSetOrderStatus(me, order, "dang_chay"), false);
    assert.equal(canSetOrderStatus(me, { ...order, status: "dang_chay" }, "huy"), false);
  });
  test("người khác không đụng được", () => {
    assert.equal(canSetOrderStatus({ username: "trieu", isAdmin: false, runner: "thinh" }, order, "huy"), false);
  });
});

describe("chỉ coi là đang chạy khi quảng cáo THẬT SỰ phân phối (task #6850)", async () => {
  const { isAdRunning } = await import("../services/fanpage-ads");
  const now = new Date("2026-10-19T03:00:00Z");
  const recent = new Map([["dang-phat", 1200]]);

  test("ACTIVE + có lượt hiển thị 2 ngày gần nhất → đang chạy", () => {
    assert.equal(isAdRunning({ id: "dang-phat", effective_status: "ACTIVE", created_time: "2026-09-01T00:00:00Z" }, now, recent), true);
  });
  test("ACTIVE nhưng nhóm quảng cáo đã qua ngày kết thúc → KHÔNG chạy (lỗi bài đã dừng vẫn hiện)", () => {
    assert.equal(
      isAdRunning({ id: "dang-phat", effective_status: "ACTIVE", adset: { end_time: "2026-10-10T00:00:00Z" } }, now, recent),
      false,
    );
  });
  test("ACTIVE nhưng không có lượt hiển thị nào gần đây (hết ngân sách, đã hoàn tất) → KHÔNG chạy", () => {
    assert.equal(isAdRunning({ id: "im-lang", effective_status: "ACTIVE", created_time: "2026-06-23T00:00:00Z" }, now, recent), false);
  });
  test("quảng cáo vừa tạo chưa kịp phân phối vẫn tính là đang chạy", () => {
    assert.equal(isAdRunning({ id: "moi", effective_status: "ACTIVE", created_time: "2026-10-19T01:00:00Z" }, now, recent), true);
  });
  test("'Chạy từ' lấy ngày bắt đầu sớm nhất của quảng cáo, không phải lúc hệ thống phát hiện", () => {
    const ads = [
      { id: "dang-phat", effective_status: "ACTIVE", adset: { start_time: "2026-10-05T02:00:00Z" }, creative: { effective_object_story_id: "1_9" } },
      { id: "moi", effective_status: "ACTIVE", created_time: "2026-10-19T01:00:00Z", creative: { effective_object_story_id: "1_9" } },
    ];
    const s = aggregateAdsByStory(ads, "1", null, { now, recentImpressions: recent }).byStory.get("1_9")!;
    assert.equal(s.startedAt, "2026-10-05T02:00:00Z");
    assert.equal(s.adIds.length, 2);
  });
});

describe("lọc danh mục bài theo khoảng ngày (giờ Việt Nam)", async () => {
  const { parseDayRange } = await import("../routes/ad-orders.routes");
  test("đến ngày tính trọn ngày đó", () => {
    const r = parseDayRange("2026-10-01", "2026-10-19");
    assert.equal(r.from!.toISOString(), "2026-09-30T17:00:00.000Z");
    assert.equal(r.to!.toISOString(), "2026-10-19T17:00:00.000Z");
  });
  test("bỏ trống = không giới hạn; sai định dạng hoặc ngược chiều thì báo lỗi", () => {
    assert.deepEqual(parseDayRange(undefined, ""), { from: undefined, to: undefined, fromDay: undefined, toDay: undefined });
    assert.ok(parseDayRange("19/10/2026", undefined).error);
    assert.ok(parseDayRange("2026-10-20", "2026-10-01").error);
  });
});

test("danh mục bài xếp theo thời gian, không đẩy bài chạy QC lên trước", async () => {
  const fs = await import("fs");
  const path = await import("path");
  const src = fs.readFileSync(path.join(process.cwd(), "server", "routes", "ad-orders.routes.ts"), "utf8");
  const body = src.slice(src.indexOf('app.get("/api/fanpages/:fid/posts"'), src.indexOf('app.post("/api/fanpages/:fid/posts/sync"'));
  assert.match(body, /orderBy\(desc\(fanpagePosts\.createdTime\)\)/);
  assert.doesNotMatch(body, /\.sort\(/);
});

describe("bài đã chạy quảng cáo nay đã dừng (task #6856)", () => {
  const now = new Date("2026-10-19T03:00:00Z");
  const recent = new Map([["chay", 500]]);
  const ins = (impressions: string, spend = "10000") => ({ data: [{ impressions, spend }] });

  test("quảng cáo đã tạm dừng nhưng từng có lượt hiển thị → bài 'đã dừng', kèm ngày dừng", () => {
    const { byStory } = aggregateAdsByStory(
      [{
        id: "tam-dung", effective_status: "PAUSED", updated_time: "2026-10-12T08:00:00Z",
        adset: { start_time: "2026-10-01T00:00:00Z" }, creative: { effective_object_story_id: "1_5" }, insights: ins("9000", "250000"),
      }],
      "1", "VND", { now, recentImpressions: recent },
    );
    const s = byStory.get("1_5")!;
    assert.equal(s.running, false);
    assert.equal(s.endedAt, "2026-10-12T08:00:00Z");
    assert.equal(s.startedAt, "2026-10-01T00:00:00Z");
    assert.equal(s.spend, 250000);
  });

  test("hết lịch nhóm quảng cáo thì ngày dừng là ngày kết thúc lịch", () => {
    const s = aggregateAdsByStory(
      [{ id: "het-lich", effective_status: "ACTIVE", adset: { end_time: "2026-10-15T17:00:00Z" }, updated_time: "2026-10-01T00:00:00Z",
         creative: { effective_object_story_id: "1_6" }, insights: ins("100") }],
      "1", null, { now, recentImpressions: recent },
    ).byStory.get("1_6")!;
    assert.equal(s.running, false);
    assert.equal(s.endedAt, "2026-10-15T17:00:00Z");
  });

  test("quảng cáo chưa từng phân phối (bản nháp, bị từ chối) không tính là đã chạy", () => {
    const { byStory } = aggregateAdsByStory(
      [{ id: "nhap", effective_status: "PAUSED", creative: { effective_object_story_id: "1_7" }, insights: ins("0") },
       { id: "khong-so", effective_status: "PAUSED", creative: { effective_object_story_id: "1_8" } }],
      "1", null, { now, recentImpressions: recent },
    );
    assert.equal(byStory.size, 0);
  });

  test("còn một quảng cáo đang chạy thì bài là đang chạy, không có ngày dừng; chi tiêu cộng cả QC cũ", () => {
    const s = aggregateAdsByStory(
      [{ id: "cu", effective_status: "PAUSED", updated_time: "2026-10-10T00:00:00Z", creative: { effective_object_story_id: "1_9" }, insights: ins("800", "40000") },
       { id: "chay", effective_status: "ACTIVE", creative: { effective_object_story_id: "1_9" }, insights: ins("500", "20000") }],
      "1", null, { now, recentImpressions: recent },
    ).byStory.get("1_9")!;
    assert.equal(s.running, true);
    assert.equal(s.endedAt, null);
    assert.equal(s.spend, 60000);
  });

  test("đơn đặt quảng cáo chỉ dựa vào bài ĐANG chạy, không phải bài đã dừng", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const job = fs.readFileSync(path.join(process.cwd(), "server", "services", "fanpage-ads-job.ts"), "utf8");
    assert.match(job, /const running = byStory\.get\(o\.postId\)\?\.running === true;/);
  });
});
