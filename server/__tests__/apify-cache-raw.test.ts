import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../services/apify";
import { describeFields } from "../services/apify-runs";

// Dữ liệu thô kiểu actor apify~facebook-posts-scraper trả về.
const rawFb = {
  facebookUrl: "https://facebook.com/meomeo/posts/1",
  url: "https://facebook.com/meomeo/posts/1",
  text: "Thui sếp cắt đèn đi",
  time: "2026-09-23T10:00:00.000Z",
  likes: 3300,
  comments: 128,
  shares: 44,
  user: { id: "1", name: "Mèo Méo", profilePic: "https://x/avatar.jpg" },
  media: [{ thumbnail: "https://x/thumb.jpg" }],
};

describe("normalize — chuẩn hoá lại bản ĐÃ chuẩn hoá không sinh thêm dữ liệu", () => {
  test("đọc đủ số liệu từ bản thô", () => {
    const m = normalize(rawFb, "facebook")!;
    assert.equal(m.likes, 3300);
    assert.equal(m.comments, 128);
    assert.equal(m.shares, 44);
    assert.equal(m.channelName, "Mèo Méo");
    assert.equal(m.coverUrl, "https://x/thumb.jpg");
  });

  test("số 0 phải giữ là 0, không hoá thành 'không có'", () => {
    const m = normalize({ ...rawFb, comments: 0, shares: 0 }, "facebook")!;
    assert.equal(m.comments, 0, "0 bình luận khác với chưa biết bao nhiêu bình luận");
    assert.equal(m.shares, 0);
  });

  test("bản đã chuẩn hoá mà thiếu comment thì chuẩn hoá lại VẪN thiếu", () => {
    // Đây chính là lý do bấm "Sửa số liệu cũ" mà số bình luận vẫn trống: cache
    // cũ chỉ lưu thứ lần đầu đọc ra được, không lưu bản thô.
    const lossy = { ...normalize(rawFb, "facebook")!, comments: null, shares: null };
    const again = normalize(lossy, "facebook")!;
    assert.equal(again.comments, undefined, "không có thì phải là 'chưa biết', không phải 0");
    assert.equal(again.shares, undefined);
  });

  test("có bản thô thì vá lại được đầy đủ", () => {
    const again = normalize(rawFb, "facebook")!;
    assert.equal(again.comments, 128);
  });
});

describe("describeFields — nói ra actor thật sự trả về trường gì", () => {
  test("liệt kê tên trường kèm kiểu và mẫu giá trị", () => {
    const f = describeFields(rawFb);
    assert.equal(f.comments.type, "number");
    assert.equal(f.comments.sample, "128");
    assert.equal(f.media.type, "array(1)");
  });

  test("không nổ với dữ liệu rỗng", () => {
    assert.deepEqual(describeFields(null), {});
  });
});

describe("pick — trường rỗng KHÔNG được thành số 0", () => {
  test("null/chuỗi rỗng để trống, không hoá 0", () => {
    // Number(null) và Number("") đều ra 0 — bản cũ vì thế bịa ra "0 bình luận"
    // cho bài chưa đọc được số liệu. Để trống thì người dùng biết là chưa biết.
    const m = normalize({ ...rawFb, likes: 10, comments: null, shares: "" }, "facebook")!;
    assert.equal(m.comments, undefined);
    assert.equal(m.shares, undefined);
    assert.equal(m.likes, 10);
  });

  test("số đã định dạng kiểu '1,234' vẫn đọc ra", () => {
    const m = normalize({ ...rawFb, comments: "1,234" }, "facebook")!;
    assert.equal(m.comments, 1234);
  });

  test("actor gói số trong object { count } cũng đọc được", () => {
    const m = normalize({ ...rawFb, comments: { count: 77 } }, "facebook")!;
    assert.equal(m.comments, 77);
  });

  test("chuỗi không phải số thì bỏ qua, đừng đoán", () => {
    const m = normalize({ ...rawFb, comments: "nhiều lắm" }, "facebook")!;
    assert.equal(m.comments, undefined);
  });
});
