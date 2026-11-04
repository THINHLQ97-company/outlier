import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildTrendCard, cardSourceNames, cardTextLength, clipText, type CardDraft } from "../services/trend-teams";
import type { TrendBrief } from "../services/trend-research";

const BASE = "https://outlier.example.com";
const ITEM = "11111111-2222-4333-8444-555555555555";
const long = (n: number) => Array.from({ length: n }, (_, i) => `Câu thứ ${i + 1} kể thêm chi tiết khá dài về diễn biến sự kiện đang được dư luận quan tâm.`).join(" ");
const brief = (over: Partial<TrendBrief> = {}): TrendBrief => ({
  title: "Tình trạng khẩn cấp", traffic: "50K+", provider: "claude_mcp", confidence: "sourced", sensitive: false, needsReview: true,
  label: "Nghiên cứu bởi Claude — cần duyệt", decision: "pursue",
  summary: "Thái Lan ban bố tình trạng khẩn cấp tại Bangkok sau mưa lũ kỷ lục. Hàng nghìn người Việt đang du lịch bị ảnh hưởng lịch bay.",
  decisionRationale: "Chủ đề du lịch đang nóng, người Việt quan tâm và dễ gắn góc thực dụng.",
  claims: [{ text: "Bangkok ban bố khẩn cấp", urls: ["https://vnexpress.net/a-very-long-path-123456789", "https://www.nationthailand.com/news/1"] }],
  sources: [
    { title: "Nguồn Claude dẫn", url: "https://vnexpress.net/a-very-long-path-123456789", publisher: "VnExpress" },
    { title: "Nguồn Claude dẫn", url: "https://www.nationthailand.com/news/1", publisher: "Nation Thailand" },
  ],
  pageAngles: [{ pageName: "Ăn Nằm Với AI", angle: "Gàn hỏi AI lập kế hoạch đổi vé khi gặp tình trạng khẩn cấp." }, { pageName: "Mắt Bão Travel", angle: "" }],
  ...over,
});
const draft = (over: Partial<CardDraft> = {}): CardDraft => ({ remakeId: "r1", pageName: "Ăn Nằm Với AI", angle: "Góc nháp", status: "ready", ...over });
const content = (card: ReturnType<typeof buildTrendCard>) => card.attachments[0].content;
const allText = (card: ReturnType<typeof buildTrendCard>) => content(card).body.map(b => b.text).join("\n");

describe("Thẻ Teams Trend chủ động — bản gọn", () => {
  test("tiêu đề chào team, dùng tên trend dễ đọc, không còn dòng kỹ thuật hay URL nguồn", () => {
    const card = buildTrendCard(brief(), [draft()], BASE, ITEM);
    const body = content(card).body;
    assert.match(body[0].text, /^Hi team, có trend “Tình trạng khẩn cấp” đang lên/);
    assert.equal(body[0].weight, "Bolder");
    assert.equal(body[0].size, "Large");
    const text = allText(card);
    for (const banned of ["Nguồn Claude dẫn", "Lượng tìm kiếm", "Chưa chọn trang đích", "Dựng từ tóm tắt", "Dựng từ bài Facebook", "Nghiên cứu bởi Claude", "Bản nháp chưa được duyệt", "Chưa vẽ ảnh"]) assert.ok(!text.includes(banned), banned);
    assert.doesNotMatch(text, /https?:\/\//);
    assert.doesNotMatch(text, /vnexpress\.net\//);
    assert.match(text, /Nguồn: VnExpress, Nation Thailand/);
  });

  test("summary dài cắt theo câu, ≤ 220 ký tự, có lý do ngắn", () => {
    const card = buildTrendCard(brief({ summary: long(10), decisionRationale: long(4) }), [], BASE, ITEM);
    const body = content(card).body;
    const summary = body[1].text;
    assert.ok(summary.length <= 220, `${summary.length}`);
    assert.match(summary, /\.$/);
    assert.ok(long(10).startsWith(summary));
    const why = body.find(b => b.text.startsWith("**Vì sao đáng làm:**"))!;
    assert.ok(why.text.replace("**Vì sao đáng làm:** ", "").length <= 160);
  });

  test("clipText không cắt giữa từ khi không có ranh giới câu", () => {
    const out = clipText("một hai ba bốn năm sáu bảy tám chín mười mười một mười hai", 20);
    assert.ok(out.length <= 20);
    assert.match(out, /…$/);
    assert.ok("một hai ba bốn năm sáu bảy".startsWith(out.slice(0, -1)));
    assert.equal(clipText("Ngắn gọn.", 50), "Ngắn gọn.");
  });

  test("nguồn: tối đa 3 tên, gộp trùng, fallback hostname bỏ www", () => {
    const names = cardSourceNames([
      { title: "a", url: "https://vnexpress.net/1", publisher: "VnExpress" },
      { title: "b", url: "https://vnexpress.net/2", publisher: "vnexpress" },
      { title: "Nguồn Claude dẫn", url: "https://www.tuoitre.vn/x" },
      { title: "c", url: "javascript:alert(1)" },
      { title: "d", url: "https://thanhnien.vn/y" },
      { title: "e", url: "https://zingnews.vn/z" },
    ]);
    assert.deepEqual(names, ["VnExpress", "tuoitre.vn", "thanhnien.vn"]);
    const legacy = buildTrendCard(brief({ sources: [{ title: "Nguồn Claude dẫn", url: "https://www.nationthailand.com/news/1" }] }), [], BASE, ITEM);
    assert.match(allText(legacy), /Nguồn: nationthailand\.com$/m);
  });

  test("chỉ page có góc mới có dòng gợi ý; không có góc thì bỏ khối", () => {
    const text = allText(buildTrendCard(brief(), [], BASE, ITEM));
    assert.match(text, /• \*\*Ăn Nằm Với AI:\*\* Gàn hỏi AI/);
    assert.doesNotMatch(text, /Mắt Bão Travel/);
    const none = allText(buildTrendCard(brief({ pageAngles: [], suggestedAngle: "" }), [], BASE, ITEM));
    assert.doesNotMatch(none, /Gợi ý theo trang/);
    // Dữ liệu cũ không có pageAngles: lấy theo trang đích + góc nháp/suggestedAngle.
    const legacy = allText(buildTrendCard(brief({ pageAngles: undefined, suggestedAngle: "Góc chung" }), [draft({ angle: "" })], BASE, ITEM));
    assert.match(legacy, /• \*\*Ăn Nằm Với AI:\*\* Góc chung/);
  });

  test("nút: luôn có xem chi tiết; bản nháp chỉ khi sẵn sàng, tối đa 2", () => {
    const noDraft = content(buildTrendCard(brief(), [draft({ status: "processing" })], BASE, ITEM)).actions;
    assert.deepEqual(noDraft.map(a => a.title), ["Xem chi tiết trên Outlier"]);
    assert.equal(noDraft[0].url, `${BASE}/trend-radar?item=${ITEM}`);
    const one = content(buildTrendCard(brief(), [draft()], BASE, ITEM)).actions;
    assert.deepEqual(one.map(a => a.title), ["Xem chi tiết trên Outlier", "Mở bản nháp"]);
    assert.equal(one[1].url, `${BASE}/remakes?remakeId=r1`);
    const many = content(buildTrendCard(brief(), [draft({ remakeId: "a", pageName: "P1" }), draft({ remakeId: "b", pageName: "P2" }), draft({ remakeId: "c", pageName: "P3" })], BASE, ITEM)).actions;
    assert.deepEqual(many.map(a => a.title), ["Xem chi tiết trên Outlier", "Mở bản nháp P1", "Mở bản nháp P2"]);
    assert.equal(content(buildTrendCard(brief(), [draft()], "", ITEM)).actions.length, 0);
  });

  test("nhãn cần duyệt chỉ khi nhạy cảm hoặc chưa xác minh", () => {
    const has = (b: TrendBrief) => content(buildTrendCard(b, [], BASE, ITEM)).body.some(x => x.text === "Cần duyệt kỹ trước khi đăng" && x.color === "Attention");
    assert.equal(has(brief()), false);
    assert.equal(has(brief({ confidence: "unverified" })), true);
    assert.equal(has(brief({ sensitive: true })), true);
  });

  test("input rất dài vẫn < 700 ký tự và không mất page nào có góc", () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({ pageName: `Trang số ${i + 1} có tên khá dài để thử`, angle: long(2) }));
    const card = buildTrendCard(brief({
      title: "Tình trạng khẩn cấp " + "rất dài ".repeat(30), summary: long(30), decisionRationale: long(10), pageAngles: pages,
      sources: Array.from({ length: 10 }, (_, i) => ({ title: "x", url: `https://site${i}.example.com/${"p".repeat(200)}` })), confidence: "unverified",
    }), Array.from({ length: 8 }, (_, i) => draft({ remakeId: `r${i}`, pageName: `Trang số ${i + 1} có tên khá dài để thử` })), BASE, ITEM);
    assert.ok(cardTextLength(card) < 700, `${cardTextLength(card)}`);
    assert.equal(content(card).body.filter(b => b.text.startsWith("• ")).length, 8);
    assert.ok(content(card).actions.length <= 3);
    assert.doesNotMatch(allText(card), /https?:\/\//);
  });

  test("markdown/URL trong chữ Claude không lọt vào thẻ", () => {
    const text = allText(buildTrendCard(brief({ summary: "Xem **ngay** [bài gốc](https://evil.example.com) tại https://x.example.com/abc nhé." }), [], BASE, ITEM));
    assert.doesNotMatch(text, /evil|x\.example|\*\*ngay\*\*/);
    assert.match(text, /Xem ngay bài gốc tại nhé\./);
  });
});
