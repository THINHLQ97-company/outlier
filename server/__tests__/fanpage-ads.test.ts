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
