import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { summarizePosts, statsToText, median, engagement } from "../services/fanpage-stats";
import type { MetaPost } from "../services/meta-graph";

function post(over: Partial<MetaPost> = {}): MetaPost {
  return {
    id: Math.random().toString(36).slice(2),
    message: "một bài bình thường",
    createdTime: "2026-09-01T05:00:00+0000",
    likes: 10,
    comments: 2,
    shares: 1,
    mediaType: "photo",
    ...over,
  };
}

describe("fanpage-stats", () => {
  test("không có bài thì trả về rỗng, không chia cho 0", () => {
    const s = summarizePosts([]);
    assert.equal(s.postCount, 0);
    assert.equal(s.postsPerWeek, 0);
    assert.equal(statsToText(s), "");
  });

  test("dùng trung vị nên một bài viral không kéo lệch mốc", () => {
    const posts = [...Array(9)].map(() => post({ likes: 10 })).concat(post({ likes: 100_000 }));
    const s = summarizePosts(posts);
    assert.equal(s.medianLikes, 10);
  });

  test("bài vượt trội đo bằng bội số so với chính trang", () => {
    const posts = [...Array(9)].map(() => post({ likes: 10, comments: 0, shares: 0 }));
    posts.push(post({ likes: 50, comments: 0, shares: 0, message: "bài nổ" }));
    const s = summarizePosts(posts);
    const top = s.topPosts[0];
    assert.equal(top.message, "bài nổ");
    assert.equal(top.outperformRatio, 5);
  });

  test("trang chưa ai tương tác thì tỉ lệ là 0, không phải Infinity", () => {
    const s = summarizePosts([...Array(3)].map(() => post({ likes: 0, comments: 0, shares: 0 })));
    assert.equal(s.topPosts[0].outperformRatio, 0);
    assert.ok(Number.isFinite(s.topPosts[0].outperformRatio));
  });

  test("bình luận và chia sẻ nặng ký hơn like", () => {
    assert.ok(engagement({ likes: 0, comments: 1, shares: 0 }) > engagement({ likes: 1, comments: 0, shares: 0 }));
    assert.ok(engagement({ likes: 0, comments: 0, shares: 1 }) > engagement({ likes: 0, comments: 1, shares: 0 }));
  });

  test("giờ đăng quy về giờ Việt Nam", () => {
    // 05:00 UTC = 12:00 giờ Việt Nam
    const s = summarizePosts([post({ createdTime: "2026-09-01T05:00:00+0000" })]);
    assert.equal(s.topHours[0].hour, 12);
  });

  test("tỉ lệ định dạng cộng lại bằng 1", () => {
    const s = summarizePosts([post({ mediaType: "video" }), post({ mediaType: "photo" }), post({ mediaType: "text" }), post({ mediaType: "video" })]);
    assert.equal(s.formatMix.video, 0.5);
    const total = Object.values(s.formatMix).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 0.01);
  });

  test("nhịp đăng tính theo khoảng thời gian thật của các bài", () => {
    const s = summarizePosts([
      post({ createdTime: "2026-09-01T05:00:00+0000" }),
      post({ createdTime: "2026-09-08T05:00:00+0000" }),
      post({ createdTime: "2026-09-15T05:00:00+0000" }),
    ]);
    assert.equal(s.spanDays, 14);
    assert.equal(s.postsPerWeek, 1.5);
  });

  test("bản chữ chỉ nêu bài thật sự hơn hẳn, không nêu mọi bài top", () => {
    const posts = [...Array(9)].map(() => post({ likes: 10, comments: 0, shares: 0 }));
    posts.push(post({ likes: 40, comments: 0, shares: 0, message: "bài nổ", permalink: "https://fb.com/p/1" }));
    const text = statsToText(summarizePosts(posts));
    assert.match(text, /Những bài ăn hơn hẳn/);
    assert.match(text, /hơn bình thường 4 lần/);
    assert.match(text, /https:\/\/fb\.com\/p\/1/);
    // Các bài ngang mốc không được liệt vào danh sách vượt trội.
    assert.equal((text.match(/hơn bình thường/g) || []).length, 1);
  });

  test("cắt bớt bài quá dài để nhận ra bài nào, không phải đọc lại cả bài", () => {
    const s = summarizePosts([post({ message: "x".repeat(900) })]);
    assert.ok(s.topPosts[0].message.length <= 401);
    assert.ok(s.topPosts[0].message.endsWith("…"));
  });

  test("median trên mảng chẵn lấy trung bình hai giá trị giữa", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([5]), 5);
    assert.equal(median([]), 0);
  });
});
