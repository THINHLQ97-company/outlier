import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mergeChannelItems, mergeOne } from "../services/merge-items";

const row = (over: Partial<any> = {}): any => ({
  id: "r1",
  jobId: "j1",
  itemKey: "post-1",
  url: "https://facebook.com/x/posts/1",
  metricsSource: "scan",
  isNew: false,
  ...over,
});

describe("gộp nhiều lần quét của cùng một bài — bổ sung nhau, không tranh nhau", () => {
  test("bình luận ở dòng CŨ vẫn giữ khi dòng mới chưa có", () => {
    // Đúng lỗi đã xảy ra: dòng cũ đã vá bình luận nhưng mang nhãn "quét chay",
    // bị dòng mới có nhãn tính tiền đánh bại — bình luận biến mất khỏi màn hình.
    const merged = mergeOne([
      row({ id: "moi", metricsSource: "apify", likes: 3300, comments: null, coverUrl: "/api/files/a.jpg" }),
      row({ id: "cu", metricsSource: "scan", comments: 125, shares: 465 }),
    ]);
    assert.equal(merged.comments, 125);
    assert.equal(merged.shares, 465);
    assert.equal(merged.likes, 3300);
  });

  test("số liệu MỚI thắng số liệu cũ khi cả hai đều có", () => {
    const merged = mergeOne([row({ likes: 3300 }), row({ likes: 100 })]);
    assert.equal(merged.likes, 3300);
  });

  test('"chưa biết" không bao giờ đè lên "đã biết"', () => {
    const merged = mergeOne([row({ comments: null }), row({ comments: 0 })]);
    assert.equal(merged.comments, 0, "0 bình luận là một dữ kiện, không phải thiếu dữ liệu");
  });

  test("ảnh trong kho của mình thắng link ngoài — link ngoài có chữ ký sẽ hết hạn", () => {
    const merged = mergeOne([
      row({ coverUrl: "https://scontent.fbcdn.net/x.jpg?sig=abc" }),
      row({ coverUrl: "/api/files/deconstruct/x.jpg" }),
    ]);
    assert.equal(merged.coverUrl, "/api/files/deconstruct/x.jpg");
  });

  test("từng lấy bằng dịch vụ tính tiền thì giữ nhãn đó", () => {
    const merged = mergeOne([row({ metricsSource: "scan" }), row({ metricsSource: "apify", comments: 12 })]);
    assert.equal(merged.metricsSource, "apify");
  });

  test("từng là bài mới thì giữ nhãn mới", () => {
    assert.equal(mergeOne([row({ isNew: false }), row({ isNew: true })]).isNew, true);
  });

  test('loại nội dung: "unknown" là chưa biết, không phải kết luận', () => {
    const merged = mergeOne([row({ contentKind: "unknown" }), row({ contentKind: "post" })]);
    assert.equal(merged.contentKind, "post");
  });

  test("giữ mức tin cậy cao nhất từng đạt", () => {
    const merged = mergeOne([row({ confidence: "low" }), row({ confidence: "high" })]);
    assert.equal(merged.confidence, "high");
  });

  test("điểm đã chấm ở lần trước vẫn dùng được nếu lần mới chưa chấm", () => {
    const merged = mergeOne([row({ outperformScore: null }), row({ outperformScore: 747 })]);
    assert.equal(merged.outperformScore, 747);
  });

  test("gộp cả danh sách: mỗi bài một dòng", () => {
    const out = mergeChannelItems([
      row({ itemKey: "a", comments: null, metricsSource: "apify" }),
      row({ itemKey: "b", comments: 5 }),
      row({ itemKey: "a", comments: 99 }),
    ]);
    assert.equal(out.length, 2);
    assert.equal(out.find((x) => x.itemKey === "a")!.comments, 99);
    assert.equal(out.find((x) => x.itemKey === "b")!.comments, 5);
  });

  test("bài không có itemKey thì gộp theo đường dẫn", () => {
    const out = mergeChannelItems([
      row({ itemKey: null, url: "u1", comments: null }),
      row({ itemKey: null, url: "u1", comments: 7 }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].comments, 7);
  });
});
