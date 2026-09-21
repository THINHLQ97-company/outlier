// Test các lớp phanh chi phí Apify. KHÔNG gọi mạng — chỉ kiểm tra logic chặn,
// vì mục tiêu của lớp này là "gọi càng ít càng tốt".
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { enrichMetrics, actorFor, isApifyConfigured } from "../services/apify";

const SAVED = { ...process.env };
afterEach(() => { process.env = { ...SAVED }; });

describe("Chọn actor theo nền tảng", () => {
  test("Douyin KHÔNG dùng Apify (đã có f2 miễn phí)", () => {
    assert.equal(actorFor("douyin"), null);
  });
  test("TikTok/Instagram/YouTube có actor", () => {
    for (const p of ["tiktok", "instagram", "youtube"]) {
      assert.ok(actorFor(p), `thiếu actor cho ${p}`);
    }
  });
  test("đổi actor bằng biến môi trường, không phải sửa code", () => {
    process.env.APIFY_ACTOR_TIKTOK = "toi~actor-rieng";
    assert.equal(actorFor("tiktok"), "toi~actor-rieng");
  });
  test("nền tảng lạ → null, không gọi bừa", () => {
    assert.equal(actorFor("zalo"), null);
  });
});

describe("Không gọi mạng khi không cần", () => {
  test("danh sách rỗng → không gọi, không cảnh báo", async () => {
    const r = await enrichMetrics("tiktok", []);
    assert.equal(r.runsUsed, 0);
    assert.equal(r.metrics.length, 0);
  });

  test("Douyin → bỏ qua Apify, nêu rõ lý do", async () => {
    const r = await enrichMetrics("douyin", ["https://douyin.com/video/1"]);
    assert.equal(r.runsUsed, 0);
    assert.equal(r.skipped, 1);
    assert.match(r.warning || "", /Douyin|miễn phí/i);
  });

  test("thiếu token → KHÔNG gọi, app vẫn chạy tiếp", async () => {
    delete process.env.APIFY_TOKEN;
    assert.equal(isApifyConfigured(), false);
    const r = await enrichMetrics("tiktok", ["https://tiktok.com/@a/video/1"]);
    assert.equal(r.runsUsed, 0);
    assert.equal(r.skipped, 1);
    assert.match(r.warning || "", /APIFY_TOKEN/);
  });

  test("URL trùng nhau chỉ tính một lần", async () => {
    delete process.env.APIFY_TOKEN;
    const same = "https://tiktok.com/@a/video/1";
    const r = await enrichMetrics("tiktok", [same, same, same]);
    assert.equal(r.skipped, 1, "URL trùng phải được gộp trước khi tính");
  });

  test("URL rỗng/null bị loại trước khi gọi", async () => {
    delete process.env.APIFY_TOKEN;
    const r = await enrichMetrics("tiktok", ["", null as any, undefined as any]);
    assert.equal(r.runsUsed, 0);
    assert.equal(r.metrics.length, 0);
  });
});

describe("Ước tính chi phí (giá đo thực tế)", () => {
  test("25 kết quả — trần một phiên — dưới 10 cent", async () => {
    const { estimateCostUsd } = await import("../services/apify");
    const c = estimateCostUsd(25);
    assert.ok(c < 0.10, `một phiên không được vượt $0.10, đang $${c.toFixed(4)}`);
  });

  test("150 kết quả — trần một ngày — dưới $0.60", async () => {
    const { estimateCostUsd } = await import("../services/apify");
    assert.ok(estimateCostUsd(150) < 0.60);
  });

  test("trần ngày nhân 30 vẫn nằm trong hạn mức $29/tháng", async () => {
    const { estimateCostUsd } = await import("../services/apify");
    const monthly = estimateCostUsd(150) * 30;
    assert.ok(monthly < 29, `chi phí tháng ước tính $${monthly.toFixed(2)} vượt hạn mức`);
  });

  test("số âm không sinh chi phí âm", async () => {
    const { estimateCostUsd } = await import("../services/apify");
    assert.equal(estimateCostUsd(-100), 0);
  });
});

describe("Chuẩn hoá trường — đối chiếu dataset THẬT của từng actor", () => {
  // Dữ liệu lấy từ dataset thật ngày 2026-09-18, rút gọn.
  const youtubeRaw = {
    url: "https://www.youtube.com/watch?v=zQuCjEQborE",
    title: "Hướng Dẫn Làm Video Bán Hàng",
    viewCount: 96884, likes: 2200, commentsCount: 92,
    numberOfSubscribers: 151000,
    channelId: "UCTdISCnEQ0YNKaoB4kxpANg", channelName: "Học Viện Marketing Online",
    date: "2024-06-20T13:01:01.000Z",
  };
  const tiktokRaw = {
    webVideoUrl: "https://www.tiktok.com/@tiktok/video/1",
    playCount: 300500, diggCount: 13400, commentCount: 2213, shareCount: 1338,
    authorMeta: { id: "107955", name: "tiktok", nickName: "TikTok", fans: 95800000 },
    createTimeISO: "2026-09-02T10:00:00.000Z",
  };

  test("YouTube: đọc đúng lượt xem, lượt thích, SỐ NGƯỜI ĐĂNG KÝ và kênh", async () => {
    const { normalize } = await import("../services/apify");
    const m = normalize(youtubeRaw, "youtube")!;
    assert.ok(m, "phải chuẩn hoá được");
    assert.equal(m.views, 96884);
    assert.equal(m.likes, 2200);
    assert.equal(m.comments, 92);
    assert.equal(m.followerCount, 151000, "phải đọc được numberOfSubscribers");
    assert.equal(m.channelKey, "UCTdISCnEQ0YNKaoB4kxpANg");
    assert.equal(m.channelName, "Học Viện Marketing Online");
    assert.equal(m.publishedAt, "2024-06-20T13:01:01.000Z");
  });

  test("TikTok: đọc đúng dù tên trường hoàn toàn khác", async () => {
    const { normalize } = await import("../services/apify");
    const m = normalize(tiktokRaw, "tiktok")!;
    assert.equal(m.views, 300500);
    assert.equal(m.likes, 13400);
    assert.equal(m.shares, 1338);
    assert.equal(m.followerCount, 95800000, "phải đọc được authorMeta.fans");
    assert.equal(m.channelKey, "107955");
    assert.equal(m.channelName, "TikTok");
  });

  test("thiếu link thì bỏ qua, không tạo bản ghi rác", async () => {
    const { normalize } = await import("../services/apify");
    assert.equal(normalize({ viewCount: 100 }, "youtube"), null);
    assert.equal(normalize({}, "tiktok"), null);
  });

  test("số liệu sai kiểu không làm vỡ, chỉ để trống", async () => {
    const { normalize } = await import("../services/apify");
    const m = normalize({ url: "https://x.com/1", viewCount: "không phải số", likes: -5 }, "youtube")!;
    assert.equal(m.views, undefined);
    assert.equal(m.likes, undefined);
  });
});
