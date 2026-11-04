import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { groundedBrief, latestTrendSlot, researchTrend, rssBrief, sameEvent, trendSlotDue, type TrendBrief } from "../services/trend-research";
import { buildTrendCard, deliverTrendCard, deliveryStatus, retryDelay } from "../services/trend-teams";
import { normalizeSettings, publicTrendSettings, withPublicBaseFallback } from "../services/trend-workflow-settings";
import { targetsReady } from "../services/trend-workflow";

const item = { title: "vf3 sạc nhanh", approxTraffic: "20K+", news: [{ title: "VinFast VF3 có trạm sạc mới", url: "https://news.example.com/vf3" }] };
const brief = (title: string, url = "https://news.example.com/a"): TrendBrief => ({ title, provider: "gemini_search", confidence: "sourced", claims: [{ text: "VF3 có thêm trạm sạc nhanh tại Hà Nội", urls: [url] }], sources: [{ title: "Tin", url }], summary: "", sensitive: false, needsReview: true, label: "Có nguồn — cần duyệt" });

describe("Trend chủ động", () => {
  test("URL mở bản nháp ưu tiên cấu hình, môi trường rồi origin khi admin lưu", () => {
    const previous = process.env.OUTLIER_PUBLIC_URL;
    try {
      process.env.OUTLIER_PUBLIC_URL = "https://env.example.com";
      const req = { headers: { origin: "https://app.example.com", "x-forwarded-host": "evil.example.com" }, protocol: "http", get: () => "internal.example.com" };
      assert.equal(withPublicBaseFallback(normalizeSettings({ publicBaseUrl: "https://saved.example.com" }), req).publicBaseUrl, "https://saved.example.com");
      assert.equal(withPublicBaseFallback(normalizeSettings({ publicBaseUrl: "" }), req).publicBaseUrl, "https://env.example.com");
      delete process.env.OUTLIER_PUBLIC_URL;
      assert.equal(withPublicBaseFallback(normalizeSettings({}), req).publicBaseUrl, "https://app.example.com");
      assert.equal(withPublicBaseFallback(normalizeSettings({}), { headers: { origin: "javascript:alert(1)" } }).publicBaseUrl, "");
      assert.equal(withPublicBaseFallback(normalizeSettings({}), { headers: {}, protocol: "http", get: () => "app.example.com" }).publicBaseUrl, "http://app.example.com");
    } finally {
      if (previous === undefined) delete process.env.OUTLIER_PUBLIC_URL; else process.env.OUTLIER_PUBLIC_URL = previous;
    }
  });
  test("lịch 2 giờ VN chỉ chạy bù một lần cho mốc gần nhất", () => {
    const now = new Date("2026-11-03T08:25:00Z"); // 15:25 VN
    assert.equal(latestTrendSlot(now), "2026-11-03T14:00+07:00");
    assert.equal(trendSlotDue(now, "2026-11-03T08:00+07:00"), true);
    assert.equal(trendSlotDue(now, "2026-11-03T14:00+07:00"), false);
    assert.equal(latestTrendSlot(new Date("2026-11-03T00:30:00Z")), null);
  });
  test("gộp từ khoá khác nhau cùng một sự kiện", () => {
    assert.equal(sameEvent(brief("clip vf3"), brief("vụ vf3")), true);
    assert.equal(sameEvent(brief("vf3", "https://a.example.com"), { ...brief("giá vàng", "https://b.example.com"), claims: [{ text: "Giá vàng tăng", urls: ["https://b.example.com"] }] }), false);
  });
  test("trend nhạy cảm bị chặn trước khi gọi tìm kiếm", async () => {
    let called = false;
    const out = await researchTrend({ ...item, title: "lộ clip riêng tư" }, { provider: "gemini_search", model: "m", maxOutputTokens: 1 }, async () => { called = true; return {} as any; });
    assert.equal(called, false);
    assert.equal(out.sensitive, true);
    assert.equal(out.claims.length, 0);
  });
  test("không có grounding support thì chưa xác minh, không gắn Đu ngay", () => {
    const out = groundedBrief(item, { text: "Có nguồn https://bia.example.com", candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://bia.example.com" } }] } }] } as any);
    assert.equal(out.confidence, "unverified");
    assert.doesNotMatch(out.label, /Đu ngay/);
  });
  test("không có bài Facebook vẫn có brief nguồn từ tin", () => {
    const out = rssBrief(item);
    assert.equal(out.sources[0].url, "https://news.example.com/vf3");
    assert.match(out.summary, /Chưa xác minh/);
  });
  test("outbox retry có giãn cách và mạng lỗi không tự gửi lại", async () => {
    assert.equal(deliveryStatus(202), "accepted");
    assert.equal(deliveryStatus(429), "retry");
    assert.ok(retryDelay(3) > retryDelay(1));
    let calls = 0;
    const out = await deliverTrendCard("https://prod.api.powerplatform.com/x", {}, (async () => { calls++; throw new Error("timeout"); }) as any);
    assert.equal(out.status, "unknown");
    assert.equal(calls, 1);
  });
  test("GET cài đặt không lộ webhook", async () => {
    process.env.OUTLIER_TEAMS_WEBHOOK_URL = "https://prod.api.powerplatform.com/secret-signature";
    const json = JSON.stringify(await publicTrendSettings());
    assert.doesNotMatch(json, /secret-signature/);
    assert.match(json, /"webhookConfigured":true/);
    delete process.env.OUTLIER_TEAMS_WEBHOOK_URL;
  });
  test("chưa có page đích thì chỉ brief, thẻ không có nút mở bản nháp", () => {
    const config = normalizeSettings({});
    assert.equal(targetsReady(config), false);
    const card = buildTrendCard(rssBrief(item), [], "https://outlier.example.com");
    // Chỉ còn nút xem chi tiết trên Outlier, không có nút mở bản nháp.
    assert.deepEqual(card.attachments[0].content.actions.map(a => a.title), ["Xem chi tiết trên Outlier"]);
  });
});
