// Test công thức outperform (docs/PRD.md §4 J2).
// Ca quan trọng nhất lấy thẳng từ yêu cầu của owner:
//   kênh 2.000 follower có bài 8.000 like PHẢI xếp trên
//   kênh 14.000.000 follower có bài 6.000 like
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreOutperform, squashRatio, freshnessScore, median, MIN_SAMPLE_FOR_BASELINE } from "../services/outperform";

const NOW = new Date("2026-09-18T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("Yêu cầu cốt lõi: kênh nhỏ bật lên thắng kênh lớn ì ạch", () => {
  const kenhNho = scoreOutperform(
    { views: 120_000, likes: 8_000, followerCount: 2_000, publishedAt: daysAgo(3) },
    { medianViews: 9_000, medianLikes: 400, sampleSize: 20 },
    undefined, NOW,
  );
  const kenhLon = scoreOutperform(
    { views: 300_000, likes: 6_000, followerCount: 14_000_000, publishedAt: daysAgo(3) },
    { medianViews: 900_000, medianLikes: 30_000, sampleSize: 20 },
    undefined, NOW,
  );

  test("kênh 2k follower / 8k like xếp TRÊN kênh 14M follower / 6k like", () => {
    assert.ok(
      kenhNho.score > kenhLon.score,
      `kênh nhỏ ${kenhNho.score.toFixed(3)} phải > kênh lớn ${kenhLon.score.toFixed(3)}`,
    );
  });

  test("khoảng cách phải rõ rệt, không sát nút", () => {
    assert.ok(kenhNho.score - kenhLon.score > 0.2, `chênh lệch quá nhỏ: ${(kenhNho.score - kenhLon.score).toFixed(3)}`);
  });

  test("bài dưới mức thường ngày của kênh bị chấm thấp", () => {
    assert.ok(kenhLon.score < 0.5, `kênh lớn dưới mức thường phải < 0.5, đang ${kenhLon.score.toFixed(3)}`);
  });

  test("cả hai đều có đủ dữ liệu → độ tin cậy cao", () => {
    assert.equal(kenhNho.confidence, "high");
    assert.equal(kenhLon.confidence, "high");
  });
});

describe("squashRatio", () => {
  test("bằng đúng mức thường → 0.5", () => {
    assert.ok(Math.abs(squashRatio(1) - 0.5) < 1e-9);
  });
  test("càng vượt càng cao, nhưng không vọt quá 1", () => {
    assert.ok(squashRatio(4) > squashRatio(2));
    assert.ok(squashRatio(1000) < 1);
  });
  test("dưới mức thường → dưới 0.5", () => {
    assert.ok(squashRatio(0.25) < 0.5);
  });
  test("số vô lý không làm vỡ", () => {
    assert.equal(squashRatio(0), 0);
    assert.equal(squashRatio(-5), 0);
    assert.equal(squashRatio(NaN), 0);
  });
});

describe("freshnessScore", () => {
  test("bài hôm nay ~1", () => {
    assert.ok(freshnessScore(NOW, NOW) > 0.99);
  });
  test("sau 21 ngày còn một nửa", () => {
    assert.ok(Math.abs(freshnessScore(daysAgo(21), NOW) - 0.5) < 0.01);
  });
  test("bài cũ bị giảm mạnh", () => {
    assert.ok(freshnessScore(daysAgo(90), NOW) < 0.06);
  });
  test("không biết ngày → trung tính 0.5, không thưởng không phạt", () => {
    assert.equal(freshnessScore(null, NOW), 0.5);
    assert.equal(freshnessScore("ngày tháng linh tinh", NOW), 0.5);
  });
});

describe("Thiếu dữ liệu — phải hạ độ tin cậy, không được tự tin sai", () => {
  test("không có mốc kênh và không có follower → low", () => {
    const r = scoreOutperform({ views: 999_999, likes: 50_000, publishedAt: daysAgo(1) }, null, undefined, NOW);
    assert.equal(r.confidence, "low");
    assert.ok(r.breakdown.reasons.some((x) => x.includes("tham khảo")));
  });

  test(`mốc kênh ít hơn ${MIN_SAMPLE_FOR_BASELINE} bài thì không dùng`, () => {
    const r = scoreOutperform(
      { views: 100_000, likes: 5_000, followerCount: 1_000, publishedAt: daysAgo(1) },
      { medianViews: 1_000, medianLikes: 50, sampleSize: 2 },
      undefined, NOW,
    );
    assert.equal(r.breakdown.vsChannelMedian, null);
    assert.equal(r.confidence, "medium");
    assert.ok(r.breakdown.reasons.some((x) => x.includes("chưa đủ tin cậy")));
  });

  test("chỉ có lượt thích, thiếu lượt xem → vẫn chấm được bằng mốc thích", () => {
    const r = scoreOutperform(
      { likes: 4_000, followerCount: 5_000, publishedAt: daysAgo(2) },
      { medianLikes: 500, sampleSize: 12 },
      undefined, NOW,
    );
    assert.ok(r.breakdown.vsChannelMedian !== null);
    assert.ok(r.score > 0.5);
  });

  test("điểm luôn nằm trong 0..1", () => {
    for (const it of [
      { views: 0, likes: 0, followerCount: 0 },
      { views: 1e12, likes: 1e12, followerCount: 1 },
      { views: -5, likes: -5, followerCount: -5 },
    ]) {
      const r = scoreOutperform(it as any, { medianViews: 10, medianLikes: 10, sampleSize: 10 }, undefined, NOW);
      assert.ok(r.score >= 0 && r.score <= 1, `điểm ngoài khoảng: ${r.score}`);
    }
  });
});

describe("median — chống lệch do 1 bài viral cũ", () => {
  test("một bài viral không kéo mốc lên", () => {
    const withViral = median([100, 120, 110, 130, 90, 5_000_000]);
    assert.ok(withViral! < 200, `median bị kéo lệch: ${withViral}`);
  });
  test("mảng rỗng → null", () => {
    assert.equal(median([]), null);
  });
  test("số chẵn phần tử lấy trung bình 2 giá trị giữa", () => {
    assert.equal(median([10, 20, 30, 40]), 25);
  });
});
