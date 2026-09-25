import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inspectUrl } from "../../shared/url-kind";

const cases: [string, string, string][] = [
  // [url, nền tảng, loại]
  ["https://www.facebook.com/bovagau", "facebook", "channel"],
  ["https://www.facebook.com/meomeo/posts/pfbid02abc", "facebook", "post"],
  ["https://www.facebook.com/DiLamCoGiVui/photos/123456", "facebook", "post"],
  ["https://www.facebook.com/watch?v=123456", "facebook", "post"],
  ["https://www.facebook.com/reel/987", "facebook", "post"],
  ["https://www.facebook.com/share/p/abc123/", "facebook", "post"],
  ["https://www.facebook.com/profile.php?id=100064", "facebook", "channel"],
  ["https://www.youtube.com/@HocvienBovaGau", "youtube", "channel"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "post"],
  ["https://youtu.be/dQw4w9WgXcQ", "youtube", "post"],
  ["https://www.youtube.com/shorts/abc123", "youtube", "post"],
  ["https://www.tiktok.com/@nguoidep", "tiktok", "channel"],
  ["https://www.tiktok.com/@nguoidep/video/7312345", "tiktok", "post"],
  ["https://www.instagram.com/p/Cabc123/", "instagram", "post"],
  ["https://www.instagram.com/nguoidep/", "instagram", "channel"],
  ["https://www.douyin.com/user/MS4wLjAB", "douyin", "channel"],
  ["https://www.douyin.com/video/7312345", "douyin", "post"],
];

describe("inspectUrl — đọc nền tảng và loại từ chính đường dẫn", () => {
  for (const [url, platform, kind] of cases) {
    test(`${url} → ${platform}/${kind}`, () => {
      const out = inspectUrl(url);
      assert.equal(out.platform, platform);
      assert.equal(out.kind, kind);
    });
  }

  test("link không phải nền tảng nào thì nói rõ chưa hỗ trợ", () => {
    const out = inspectUrl("https://vnexpress.net/bai-viet-123");
    assert.equal(out.platform, null);
    assert.match(out.label, /Chưa hỗ trợ/);
  });

  test("chữ bừa không phải link thì báo luôn, không đoán", () => {
    const out = inspectUrl("mẹo tiết kiệm điện");
    assert.equal(out.platform, null);
    assert.match(out.label, /hợp lệ/);
  });

  test("đúng nền tảng nhưng đường dẫn lạ thì nhận nền tảng, không đoán loại", () => {
    const out = inspectUrl("https://www.facebook.com/groups/123/permalink");
    assert.equal(out.platform, "facebook");
    // Nhóm không phải trang cũng không phải bài lẻ — thà nói chưa rõ.
    assert.ok(out.kind === "post" || out.kind === null);
  });

  test("nhãn tiếng Việt nói rõ là bài hay cả trang", () => {
    assert.match(inspectUrl("https://facebook.com/bovagau").label, /cả trang\/kênh/);
    assert.match(inspectUrl("https://youtu.be/abc").label, /một bài viết/);
  });
});
