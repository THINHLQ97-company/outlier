import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { radarItemRow, type ScanCandidate } from "../services/radar-item-row";

const ctx = { jobId: "job-1", knownFollowers: 623500, isNew: true };

const full: ScanCandidate = {
  platform: "facebook",
  itemKey: "post-1",
  url: "https://facebook.com/x/posts/1",
  title: "Thui sếp cắt đèn đi",
  coverUrl: "/api/files/deconstruct/abc.jpg",
  publishedAt: "2026-09-23T10:00:00.000Z",
  channelKey: "ch-1",
  channelName: "Mèo Méo",
  views: 1000,
  likes: 3300,
  comments: 125,
  shares: 465,
  contentKind: "post",
  __fromApify: true,
};

describe("radarItemRow — không được bỏ sót cột nào khi lưu bài quét", () => {
  test("GIỮ số bình luận và chia sẻ", () => {
    // Đây là lỗi đã xảy ra thật: hai cột này bị quên trong câu insert, nên quét
    // bao nhiêu lần cũng mất bình luận, trong khi "Sửa số liệu cũ" lại có.
    const row = radarItemRow(full, ctx);
    assert.equal(row.comments, 125);
    assert.equal(row.shares, 465);
  });

  test("giữ đủ mọi chỉ số còn lại", () => {
    const row = radarItemRow(full, ctx);
    assert.equal(row.views, 1000);
    assert.equal(row.likes, 3300);
    assert.equal(row.followerCount, 623500);
    assert.equal(row.coverUrl, "/api/files/deconstruct/abc.jpg");
    assert.equal(row.channelName, "Mèo Méo");
    assert.equal(row.contentKind, "post");
  });

  test("mọi cột chỉ số đều có mặt trong dòng ghi ra", () => {
    // Liệt kê tường minh: thêm chỉ số mới mà quên ghi là test này đỏ.
    const row = radarItemRow(full, ctx) as Record<string, unknown>;
    for (const k of ["views", "likes", "comments", "shares", "followerCount"]) {
      assert.ok(k in row, `thiếu cột ${k}`);
    }
  });

  test("thiếu số liệu thì để trống, KHÔNG thành 0", () => {
    const row = radarItemRow({ platform: "facebook", itemKey: "k", url: "u" }, ctx);
    assert.equal(row.comments, null, "chưa biết khác với 0 bình luận");
    assert.equal(row.shares, null);
    assert.equal(row.likes, null);
  });

  test("0 bình luận thì giữ đúng là 0", () => {
    const row = radarItemRow({ ...full, comments: 0, shares: 0 }, ctx);
    assert.equal(row.comments, 0);
    assert.equal(row.shares, 0);
  });

  test("bài không kèm người theo dõi thì lấy của kênh", () => {
    const row = radarItemRow({ ...full, followerCount: undefined }, ctx);
    assert.equal(row.followerCount, 623500);
  });

  test("bài có người theo dõi riêng thì ưu tiên số của bài", () => {
    const row = radarItemRow({ ...full, followerCount: 999 }, ctx);
    assert.equal(row.followerCount, 999);
  });

  test("ghi rõ số liệu lấy từ nguồn tính tiền hay quét chay", () => {
    assert.equal(radarItemRow(full, ctx).metricsSource, "apify");
    assert.equal(radarItemRow({ ...full, __fromApify: false }, ctx).metricsSource, "scan");
  });

  test("ngày đăng đổi sang Date, thiếu thì null chứ không thành 1970", () => {
    assert.ok(radarItemRow(full, ctx).publishedAt instanceof Date);
    assert.equal(radarItemRow({ ...full, publishedAt: null }, ctx).publishedAt, null);
  });
});
