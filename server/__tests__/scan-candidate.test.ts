import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { toScanCandidate, METRIC_FIELDS } from "../services/scan-candidate";

const metrics: any = {
  itemKey: "post-1",
  url: "https://facebook.com/x/posts/1",
  title: "Thui sếp cắt đèn đi",
  coverUrl: "https://scontent.fbcdn.net/x.jpg",
  publishedAt: "2026-09-23T10:00:00.000Z",
  channelKey: "ch-1",
  channelName: "Mèo Méo",
  channelAvatarUrl: "https://x/avatar.jpg",
  followerCount: 623500,
  views: 1000,
  likes: 3300,
  comments: 125,
  shares: 465,
};

describe("toScanCandidate — không được đánh rơi chỉ số nào trên đường lưu", () => {
  test("SỐ BÌNH LUẬN và CHIA SẺ đi tới nơi", () => {
    // Đây là lỗi đã xảy ra thật: bảng ánh xạ chỉ chép views và likes, nên
    // comments bị vứt TRƯỚC KHI tới chỗ lưu. Sửa chỗ lưu xong vẫn không có gì.
    const c = toScanCandidate("facebook", metrics);
    assert.equal(c.comments, 125);
    assert.equal(c.shares, 465);
  });

  test("TỪNG chỉ số trong hợp đồng đều phải sang được", () => {
    // Đi qua từng trường một: thêm chỉ số mới mà quên chép là test này đỏ.
    for (const f of METRIC_FIELDS) {
      const only: any = { itemKey: "k", url: "u", [f]: 42 };
      const c: any = toScanCandidate("facebook", only);
      assert.equal(c[f], 42, `chỉ số "${f}" bị đánh rơi`);
    }
  });

  test("giữ nguyên số 0, không biến thành thiếu dữ liệu", () => {
    const c = toScanCandidate("facebook", { ...metrics, comments: 0, shares: 0 });
    assert.equal(c.comments, 0);
    assert.equal(c.shares, 0);
  });

  test("thiếu thì để trống, không bịa số", () => {
    const c = toScanCandidate("facebook", { itemKey: "k", url: "u" } as any);
    assert.equal(c.comments, undefined);
    assert.equal(c.likes, undefined);
  });

  test("giữ tên kênh, ảnh đại diện, ảnh bài và ngày đăng", () => {
    const c = toScanCandidate("facebook", metrics);
    assert.equal(c.channelName, "Mèo Méo");
    assert.equal(c.channelAvatarUrl, "https://x/avatar.jpg");
    assert.equal(c.coverUrl, "https://scontent.fbcdn.net/x.jpg");
    assert.equal(c.publishedAt, "2026-09-23T10:00:00.000Z");
  });

  test("Facebook là bài viết, nền tảng khác là video", () => {
    assert.equal(toScanCandidate("facebook", metrics).contentKind, "post");
    assert.equal(toScanCandidate("tiktok", metrics).contentKind, "video");
  });

  test("đánh dấu là số liệu lấy từ dịch vụ tính tiền", () => {
    assert.equal(toScanCandidate("facebook", metrics).__fromApify, true);
  });
});
