// Test guardrail — 4 nguyên tắc ở docs/PRD.md §2 phải được cưỡng chế bằng code.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runGuardrail, findCopiedSpans, findBannedTerms, findUnverifiedClaims,
  checkAddressing, tokenize, stripDiacritics, COPY_NGRAM,
} from "../services/guardrail";

const field = <T,>(value: T) => ({ value, evidence: [], source: "extracted" as const });

describe("tokenize — phải hiểu tiếng Việt", () => {
  test("giữ nguyên chữ có dấu, không cắt vụn", () => {
    assert.deepEqual(tokenize("Người dùng Việt Nam"), ["người", "dùng", "việt", "nam"]);
  });
  test("bỏ dấu câu", () => {
    assert.deepEqual(tokenize("Xin chào, bạn!"), ["xin", "chào", "bạn"]);
  });
  test("giữ số", () => {
    assert.ok(tokenize("giảm 50% giá").includes("50"));
  });
});

describe("P2 — chặn bê nguyên câu chữ bài gốc", () => {
  const source = "Bạn có biết rằng phần lớn người mới bắt đầu đều mắc cùng một lỗi khi chọn hosting cho website của mình không";

  test(`trùng ${COPY_NGRAM} từ liên tiếp trở lên bị bắt`, () => {
    const draft = "Thật ra phần lớn người mới bắt đầu đều mắc cùng một lỗi khi chọn dịch vụ.";
    const { spans, maxOverlap } = findCopiedSpans(draft, source);
    assert.ok(spans.length > 0, "phải bắt được đoạn trùng");
    assert.ok(maxOverlap >= COPY_NGRAM, `trùng ${maxOverlap} từ`);
  });

  test("viết lại bằng lời khác thì KHÔNG bị bắt", () => {
    const draft = "Nhiều người chập chững vào nghề thường vấp phải cùng một sai lầm lúc chọn nơi đặt web.";
    const { spans } = findCopiedSpans(draft, source);
    assert.equal(spans.length, 0, "diễn đạt lại không được coi là sao chép");
  });

  test("trùng ngắn (dưới ngưỡng) thì bỏ qua — tránh báo động giả", () => {
    const draft = "Người mới bắt đầu nên cân nhắc kỹ.";
    const { spans } = findCopiedSpans(draft, source);
    assert.equal(spans.length, 0);
  });

  test("báo đúng độ dài đoạn trùng, kéo dài hết mức", () => {
    const draft = "Bạn có biết rằng phần lớn người mới bắt đầu đều mắc cùng một lỗi khi chọn hosting";
    const { maxOverlap } = findCopiedSpans(draft, source);
    assert.ok(maxOverlap >= 14, `phải kéo dài đoạn trùng, đang báo ${maxOverlap}`);
  });

  test("bài gốc rỗng → không bắt gì, không vỡ", () => {
    assert.equal(findCopiedSpans("bất kỳ nội dung nào", "").spans.length, 0);
  });
});

describe("P4 — chặn từ thương hiệu đã cấm", () => {
  test("bắt từ cấm", () => {
    const issues = findBannedTerms("Sản phẩm này giá rẻ nhất thị trường", ["giá rẻ"]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "block");
  });

  test("KHÔNG lách được bằng cách bỏ dấu", () => {
    const issues = findBannedTerms("San pham nay gia re lam", ["giá rẻ"]);
    assert.equal(issues.length, 1, "bỏ dấu vẫn phải bắt được");
  });

  test("không phân biệt hoa thường", () => {
    assert.equal(findBannedTerms("GIÁ RẺ vô địch", ["giá rẻ"]).length, 1);
  });

  test("kèm đoạn trích để biết sai ở đâu", () => {
    const issues = findBannedTerms("Đây là dịch vụ giá rẻ dành cho bạn", ["giá rẻ"]);
    assert.ok(issues[0].excerpt?.includes("giá rẻ"));
  });

  test("không có từ cấm → không báo", () => {
    assert.equal(findBannedTerms("Dịch vụ hợp túi tiền", ["giá rẻ"]).length, 0);
  });
});

describe("P3 — chặn tự chế công dụng sản phẩm", () => {
  const allowed = ["tăng tốc độ tải trang", "hỗ trợ kỹ thuật 24/7"];

  test("khẳng định mạnh không có trong hồ sơ → chặn", () => {
    const issues = findUnverifiedClaims("Chúng tôi cam kết chữa dứt điểm mọi lỗi website.", allowed);
    assert.ok(issues.length > 0);
    assert.equal(issues[0].severity, "block");
  });

  test("khẳng định KHỚP công dụng đã duyệt → cho qua", () => {
    const issues = findUnverifiedClaims("Chúng tôi cam kết hỗ trợ kỹ thuật 24/7 cho mọi khách hàng.", allowed);
    assert.equal(issues.length, 0, "công dụng đã duyệt thì không được chặn");
  });

  test("câu bình thường không có từ cam kết → không đụng tới", () => {
    const issues = findUnverifiedClaims("Website của bạn sẽ hoạt động ổn định hơn.", allowed);
    assert.equal(issues.length, 0);
  });

  test("hồ sơ chưa có công dụng nào → gợi ý bổ sung, không im lặng", () => {
    const issues = findUnverifiedClaims("Đảm bảo 100% hiệu quả.", []);
    assert.ok(issues.length > 0);
    assert.ok(issues[0].hint?.includes("chưa ghi công dụng"));
  });

  test("bắt được cả khi viết không dấu", () => {
    const issues = findUnverifiedClaims("Chung toi cam ket chua khoi moi benh.", allowed);
    assert.ok(issues.length > 0, "không dấu vẫn phải bắt");
  });
});

describe("P4 — xưng hô", () => {
  test("dùng đúng xưng hô → không nhắc", () => {
    const issues = checkAddressing('Quý khách vui lòng liên hệ', 'gọi khách là "Quý khách"');
    assert.equal(issues.length, 0);
  });
  test("không thấy xưng hô quen thuộc → nhắc nhẹ (warn, không chặn)", () => {
    const issues = checkAddressing("Mày nên thử cái này", 'gọi khách là "Quý khách"');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "warn", "xưng hô chỉ nhắc, không chặn xuất bản");
  });
  test("brand không quy định xưng hô → bỏ qua", () => {
    assert.equal(checkAddressing("bất kỳ", "thân thiện, gần gũi").length, 0);
  });
});

describe("runGuardrail — tổng hợp", () => {
  const brand = {
    bannedTerms: field(["giá rẻ"]),
    allowedClaims: field(["tăng tốc độ tải trang"]),
    addressing: field('gọi khách là "bạn"'),
  };

  test("bài sạch → được xuất", () => {
    const r = runGuardrail("Bạn muốn web tải nhanh hơn? Hãy thử tối ưu ảnh trước tiên.", { brand });
    assert.equal(r.passed, true, JSON.stringify(r.issues));
  });

  test("có lỗi mức chặn → KHÔNG được xuất", () => {
    const r = runGuardrail("Dịch vụ giá rẻ nhất cho bạn.", { brand });
    assert.equal(r.passed, false);
    assert.ok(r.issues.some((i) => i.code === "banned_term"));
  });

  test("chỉ có nhắc nhở (warn) thì VẪN được xuất", () => {
    const r = runGuardrail("Anh chị nên tối ưu ảnh để trang tải nhanh hơn.", { brand });
    assert.ok(r.issues.some((i) => i.severity === "warn"));
    assert.equal(r.passed, true, "cảnh báo nhẹ không được chặn xuất bản");
  });

  test("gộp nhiều loại lỗi cùng lúc", () => {
    const source = "phần lớn người mới bắt đầu đều mắc cùng một lỗi khi chọn hosting";
    const draft = "Bạn ơi, phần lớn người mới bắt đầu đều mắc cùng một lỗi khi chọn hosting. Cam kết chữa mọi sự cố. Dịch vụ giá rẻ.";
    const r = runGuardrail(draft, { sourceText: source, brand });
    const codes = new Set(r.issues.map((i) => i.code));
    assert.ok(codes.has("copied_text"), "phải bắt sao chép");
    assert.ok(codes.has("unverified_claim"), "phải bắt khẳng định bịa");
    assert.ok(codes.has("banned_term"), "phải bắt từ cấm");
    assert.equal(r.passed, false);
  });

  test("không có hồ sơ brand vẫn chạy được, không vỡ", () => {
    const r = runGuardrail("Nội dung bất kỳ.", {});
    assert.ok(Array.isArray(r.issues));
  });

  test("thống kê phản ánh đúng mức trùng lặp", () => {
    const source = "một hai ba bốn năm sáu bảy tám chín mười";
    const r = runGuardrail("một hai ba bốn năm sáu bảy tám chín mười", { sourceText: source });
    assert.ok(r.stats.maxOverlapWords >= COPY_NGRAM);
    assert.equal(r.stats.wordCount, 10);
  });
});

describe("Chống báo động giả — bài học từ lần chạy thật 2026-09-18", () => {
  test('"chưa" KHÔNG được nhầm thành "chữa" (lỗi thật đã gặp)', async () => {
    const { matchTerm } = await import("../services/guardrail");
    // "chữa" bỏ dấu thành "chua", trùng "chưa" — từ xuất hiện khắp nơi.
    assert.equal(matchTerm("bài viết chưa đánh trúng tâm lý người mua", "chữa"), -1);
  });

  test("câu văn bình thường có chữ 'chưa' không bị chặn", () => {
    const r = findUnverifiedClaims(
      "Nhiều người nghĩ sản phẩm chưa đủ sức hút, hoặc bài viết chưa đánh trúng tâm lý.",
      ["hỗ trợ kỹ thuật 24/7"],
    );
    assert.equal(r.length, 0, "câu này hoàn toàn vô hại, không được chặn");
  });

  test('vẫn bắt được "chữa" thật khi viết đúng dấu', () => {
    const r = findUnverifiedClaims("Chúng tôi chữa mọi lỗi website.", ["hỗ trợ kỹ thuật"]);
    assert.ok(r.length > 0);
  });

  test("khớp theo ranh giới từ, không khớp giữa từ khác", async () => {
    const { matchTerm } = await import("../services/guardrail");
    assert.equal(matchTerm("trẻ em", "rẻ"), -1, '"rẻ" không được khớp trong "trẻ"');
    assert.ok(matchTerm("hàng rẻ lắm", "rẻ") >= 0, '"rẻ" đứng riêng thì phải khớp');
  });

  test("cụm nhiều từ VẪN chặn được kiểu lách bỏ dấu", async () => {
    const { matchTerm } = await import("../services/guardrail");
    assert.ok(matchTerm("hosting gia re cho ban", "giá rẻ") >= 0, 'lách "gia re" vẫn phải bắt');
  });

  test("từ cấm một chữ chỉ khớp khi đúng dấu — tránh kêu oan", () => {
    assert.equal(findBannedTerms("Chưa có gì để nói", ["chữa"]).length, 0);
    assert.equal(findBannedTerms("Thuốc này chữa bệnh", ["chữa"]).length, 1);
  });

  test('xưng hô viết gộp "t/mẹ/má" được tách thành từng lựa chọn', () => {
    // Trang ghi gộp ba cách xưng vào một cặp ngoặc. Bài chỉ dùng một trong ba
    // vẫn là xưng hô đúng — trước đây bị báo sai vì đi tìm nguyên cụm.
    const addressing = `tự xưng là "em", "chị", "t/mẹ/má", gọi khách là "anh", "mấy chị"`;
    assert.equal(checkAddressing("t đọc là năm cũ mà mấy má nghĩ đi đâu á", addressing).length, 0);
    assert.equal(checkAddressing("dạ tên này còn trống nè anh", addressing).length, 0);
    // Không dùng cách xưng nào của trang thì vẫn phải cảnh báo.
    assert.equal(checkAddressing("Sản phẩm phù hợp cho mọi doanh nghiệp.", addressing).length, 1);
  });
});
