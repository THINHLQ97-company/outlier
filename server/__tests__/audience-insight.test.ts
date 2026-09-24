import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { analyzeComments, insightToText, MIN_COMMENTS_FOR_INSIGHT } from "../services/audience-insight";

// Bộ sinh văn bản giả — truyền thẳng vào hàm, không cần giả lập module.
let fakeResponse = "{}";
const fakeGenerate = async () => fakeResponse;

function comments(n: number, prefix = "bình luận có nội dung số") {
  return Array.from({ length: n }, (_, i) => ({ text: `${prefix} ${i}`, likes: i }));
}

describe("audience-insight", () => {
  test("mẫu quá nhỏ thì nói thẳng, không trả về phân tích trông chắc chắn", async () => {
    const { insight } = await analyzeComments(comments(5), fakeGenerate);
    assert.equal(insight.sampleSize, 5);
    assert.deepEqual(insight.themes, []);
    assert.match(insight.warning!, /dưới mức 15/);
  });

  test("ĐẾM do code tự đếm, không lấy số model khai", async () => {
    // Model khai 99 nhưng chỉ đưa 3 số thứ tự — phải tin 3.
    fakeResponse = JSON.stringify({
      themes: [{ label: "giá cả", commentIds: [0, 1, 2], count: 99, sentiment: "tiêu cực" }],
      questions: [],
      objections: [],
      remakeAngles: [],
    });
    const { insight } = await analyzeComments(comments(20), fakeGenerate);
    assert.equal(insight.themes[0].count, 3);
  });

  test("bỏ số thứ tự bịa (nằm ngoài danh sách)", async () => {
    fakeResponse = JSON.stringify({
      themes: [{ label: "cụm bịa", commentIds: [0, 999, -5, 1000] }],
    });
    const { insight } = await analyzeComments(comments(20), fakeGenerate);
    assert.equal(insight.themes[0].count, 1);
  });

  test("một bình luận không được đếm ở hai cụm", async () => {
    fakeResponse = JSON.stringify({
      themes: [
        { label: "cụm A", commentIds: [0, 1, 2] },
        { label: "cụm B", commentIds: [2, 3] }, // số 2 trùng
      ],
    });
    const { insight } = await analyzeComments(comments(20), fakeGenerate);
    const total = insight.themes.reduce((s, t) => s + t.count, 0);
    assert.equal(total, 4, "tổng các cụm không được vượt số bình luận thật");
  });

  test("câu trích lấy từ bình luận thật, không phải model tự viết", async () => {
    fakeResponse = JSON.stringify({
      themes: [{ label: "x", commentIds: [7], quotes: ["CÂU NÀY MODEL TỰ BỊA"] }],
    });
    const { insight } = await analyzeComments(comments(20), fakeGenerate);
    assert.equal(insight.themes[0].quotes[0], "bình luận có nội dung số 7");
  });

  test("câu trích ưu tiên bình luận được thích nhiều nhất trong cụm", async () => {
    fakeResponse = JSON.stringify({ themes: [{ label: "x", commentIds: [1, 9, 4] }] });
    const { insight } = await analyzeComments(comments(20), fakeGenerate);
    // likes = chỉ số, nên số 9 được thích nhiều nhất
    assert.equal(insight.themes[0].quotes[0], "bình luận có nội dung số 9");
  });

  test("cụm xếp theo số lượng giảm dần", async () => {
    fakeResponse = JSON.stringify({
      themes: [
        { label: "ít", commentIds: [0] },
        { label: "nhiều", commentIds: [1, 2, 3, 4] },
      ],
    });
    const { insight } = await analyzeComments(comments(20), fakeGenerate);
    assert.equal(insight.themes[0].label, "nhiều");
  });

  test("cảnh báo khi phần lớn bình luận không xếp được vào cụm nào", async () => {
    fakeResponse = JSON.stringify({ themes: [{ label: "x", commentIds: [0, 1] }] });
    const { insight } = await analyzeComments(comments(40), fakeGenerate);
    assert.match(insight.warning!, /2\/40 bình luận xếp được/);
  });

  test("không cụm nào thì nói rõ là bình luận không có gì để rút", async () => {
    fakeResponse = JSON.stringify({ themes: [], questions: [], objections: [] });
    const { insight } = await analyzeComments(comments(30), fakeGenerate);
    assert.match(insight.warning!, /không có gì đáng rút/);
  });

  test("cụm thiếu tên hoặc không có số thứ tự hợp lệ thì bỏ", async () => {
    fakeResponse = JSON.stringify({
      themes: [
        { label: "", commentIds: [0] },
        { label: "không có id", commentIds: [] },
        { label: "hợp lệ", commentIds: [1] },
      ],
    });
    const { insight } = await analyzeComments(comments(20), fakeGenerate);
    assert.equal(insight.themes.length, 1);
    assert.equal(insight.themes[0].label, "hợp lệ");
  });

  test("insightToText trả rỗng khi không có cụm nào", () => {
    assert.equal(
      insightToText({ sampleSize: 0, themes: [], questions: [], objections: [], remakeAngles: [] }),
      "",
    );
  });

  test("insightToText nêu số lượng và câu trích", () => {
    const text = insightToText({
      sampleSize: 42,
      themes: [{ label: "giá cả", count: 12, quotes: ["đắt quá"], sentiment: "tiêu cực" }],
      questions: ["mua ở đâu?"],
      objections: ["không tin"],
      remakeAngles: [],
    });
    assert.match(text, /42 bình luận/);
    assert.match(text, /giá cả — 12 bình luận, giọng tiêu cực/);
    assert.match(text, /"đắt quá"/);
    assert.match(text, /mua ở đâu\?/);
  });

  test("ngưỡng mẫu tối thiểu là 15", () => {
    assert.equal(MIN_COMMENTS_FOR_INSIGHT, 15);
  });
});
