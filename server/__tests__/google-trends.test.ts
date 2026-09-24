import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseTrendsRss, trendToSummary, trendToMeta, parseTraffic } from "../services/google-trends";

// Mẫu rút gọn từ phản hồi thật của trends.google.com/trending/rss?geo=VN
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss">
<channel>
<item>
  <title>trần bá dương</title>
  <ht:approx_traffic>1000+</ht:approx_traffic>
  <pubDate>Tue, 23 Sep 2026 01:00:00 +0700</pubDate>
  <ht:picture>https://example.com/anh.jpg</ht:picture>
  <ht:news_item>
    <ht:news_item_title><![CDATA[Doanh nhân &amp; câu chuyện mới]]></ht:news_item_title>
    <ht:news_item_url>https://bao.vn/bai-1</ht:news_item_url>
    <ht:news_item_source>Báo Một</ht:news_item_source>
  </ht:news_item>
  <ht:news_item>
    <ht:news_item_title>Tin thứ hai</ht:news_item_title>
    <ht:news_item_url>https://bao.vn/bai-2</ht:news_item_url>
  </ht:news_item>
</item>
<item>
  <title>từ khoá trần</title>
  <ht:approx_traffic>200+</ht:approx_traffic>
</item>
</channel>
</rss>`;

describe("google-trends", () => {
  test("đọc được tiêu đề, lượng tìm kiếm và tin kèm theo", () => {
    const items = parseTrendsRss(SAMPLE);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, "trần bá dương");
    assert.equal(items[0].approxTraffic, "1000+");
    assert.equal(items[0].news.length, 2);
    assert.equal(items[0].news[0].url, "https://bao.vn/bai-1");
    assert.equal(items[0].news[0].source, "Báo Một");
  });

  test("gỡ CDATA và ký tự đã mã hoá", () => {
    const items = parseTrendsRss(SAMPLE);
    assert.equal(items[0].news[0].title, "Doanh nhân & câu chuyện mới");
  });

  test("tin thiếu nguồn vẫn nhận, chỉ bỏ trống nguồn", () => {
    const items = parseTrendsRss(SAMPLE);
    assert.equal(items[0].news[1].title, "Tin thứ hai");
    assert.equal(items[0].news[1].source, undefined);
  });

  test("từ khoá không có tin nào thì nói rõ là chưa có, không bịa", () => {
    const items = parseTrendsRss(SAMPLE);
    const summary = trendToSummary(items[1]);
    assert.match(summary, /Khoảng 200\+ lượt tìm kiếm/);
    assert.match(summary, /chưa gắn tin nào/);
  });

  test("tóm tắt là MỘT dòng ngắn, không nhét đường dẫn vào", () => {
    // Đường dẫn đi vào sourceMetaJson để giao diện dựng thành dòng bấm được;
    // nhồi vào chuỗi thì chỉ in ra được một khối chữ dày đặc.
    const summary = trendToSummary(parseTrendsRss(SAMPLE)[0]);
    assert.match(summary, /Khoảng 1000\+ lượt tìm kiếm/);
    assert.match(summary, /2 tin liên quan/);
    assert.ok(!summary.includes("http"), "tóm tắt không được chứa đường dẫn");
    assert.ok(!summary.includes("\n"), "tóm tắt phải nằm trên một dòng");
  });

  test("phần dữ liệu có cấu trúc giữ đủ tin, tối đa 5, kèm mã nước", () => {
    const meta = trendToMeta(parseTrendsRss(SAMPLE)[0], "VN");
    assert.equal(meta.geo, "VN");
    assert.equal(meta.approxTraffic, "1000+");
    assert.equal(meta.news.length, 2);
    assert.equal(meta.news[0].url, "https://bao.vn/bai-1");
    assert.ok(meta.news.length <= 5);
  });

  test("đọc được lượt tìm kiếm để sắp thứ tự", () => {
    // Google trả dạng chữ, và bản tiếng Việt dùng "N" cho nghìn.
    assert.equal(parseTraffic("200+"), 200);
    assert.equal(parseTraffic("2000+"), 2000);
    assert.equal(parseTraffic("20K+"), 20000);
    assert.equal(parseTraffic("1N+"), 1000);
    assert.equal(parseTraffic("1M+"), 1000000);
    // Dấu phẩy đổi nghĩa theo ngữ cảnh: có hậu tố nhân thì là thập phân,
    // không có thì là dấu ngăn nghìn.
    assert.equal(parseTraffic("1,5K+"), 1500);
    assert.equal(parseTraffic("1,500+"), 1500);
  });

  test("thiếu hoặc không đọc được lượt tìm thì coi như 0, không ném lỗi", () => {
    assert.equal(parseTraffic(undefined), 0);
    assert.equal(parseTraffic(""), 0);
    assert.equal(parseTraffic("không rõ"), 0);
  });

  test("XML rỗng hoặc hỏng trả về mảng rỗng, không ném lỗi", () => {
    assert.deepEqual(parseTrendsRss(""), []);
    assert.deepEqual(parseTrendsRss("<rss><channel></channel></rss>"), []);
    assert.deepEqual(parseTrendsRss("<item>không có tiêu đề</item>"), []);
  });
});
