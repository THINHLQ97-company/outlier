import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildBrandBrief } from "../services/brand-brief";

const mk = (v: any) => ({ value: v, evidence: [], source: "manual" as const });

function row(extra: Record<string, any> = {}): any {
  return { name: "Trang Thử", ...extra };
}

describe("brand-brief", () => {
  test("hồ sơ rỗng thì nói rõ thiếu gì, không bịa", () => {
    const text = buildBrandBrief(row(), [], "writing");
    assert.match(text, /Còn thiếu trong hồ sơ/);
    assert.match(text, /pageRole/);
    assert.match(text, /đừng tự suy ra/);
  });

  test("mục đã có thì không bị liệt vào phần thiếu", () => {
    const text = buildBrandBrief(
      row({ pageRole: mk("sân sau của Mắt Bão, bán tên miền bằng trò đố") }),
      [],
      "writing",
    );
    assert.match(text, /Trang này là gì:.*trò đố/);
    const missingSection = text.split("Còn thiếu trong hồ sơ")[1] || "";
    assert.ok(!missingSection.includes("pageRole"));
  });

  test("phần KHÔNG BAO GIỜ đứng trước phần bài mẫu", () => {
    const text = buildBrandBrief(
      row({
        behaviorRules: mk({ always: ["hỏi, để khán giả tự lái"], never: ["tự nói ra tầng nghĩa bậy"] }),
        fewShotExamples: mk([{ kind: "caption", text: "ai lấy ib chị :))" }]),
      }),
      [],
      "writing",
    );
    assert.ok(text.indexOf("KHÔNG BAO GIỜ") < text.indexOf("Bài mẫu"));
  });

  test("gộp trendDonts và bannedTerms vào cùng phần cấm", () => {
    const text = buildBrandBrief(
      row({ trendDonts: mk(["không đu tin có người chết"]), bannedTerms: mk(["chê chủ shop"]) }),
      [],
      "writing",
    );
    assert.match(text, /không đu tin có người chết/);
    assert.match(text, /Không dùng các từ\/cụm: chê chủ shop/);
  });

  test("for=image thì nêu nhận diện hình ảnh; thiếu thì cảnh báo đúng hệ quả", () => {
    const withVisual = buildBrandBrief(
      row({ visualIdentity: mk({ template: "ảnh chat trên thanh địa chỉ", doNots: ["mặt người thật"] }) }),
      [],
      "image",
    );
    assert.match(withVisual, /Khuôn ảnh cứng: ảnh chat/);
    assert.match(withVisual, /Không bao giờ xuất hiện: mặt người thật/);

    const without = buildBrandBrief(row(), [], "image");
    assert.match(without, /đúng nội dung nhưng sai trang/);
  });

  test("có registers thì dùng registers, không có thì lùi về toneOfVoice", () => {
    const withRegisters = buildBrandBrief(
      row({ registers: mk([{ name: "ngọt với khách", when: "trong ảnh chat", pronouns: "em – anh" }]) }),
      [],
      "writing",
    );
    assert.match(withRegisters, /Ngữ vực/);
    assert.match(withRegisters, /em – anh/);

    const fallback = buildBrandBrief(row({ toneOfVoice: mk("tưng tửng") }), [], "writing");
    assert.match(fallback, /Giọng: tưng tửng/);
  });

  test("mảng rỗng được coi là chưa có dữ liệu", () => {
    const text = buildBrandBrief(row({ personality: mk([]) }), [], "writing");
    assert.match(text, /personality/);
    assert.ok(!text.includes("## Tính cách"));
  });

  test("nêu nơi sẽ đăng khi đã gắn fanpage", () => {
    const text = buildBrandBrief(
      row(),
      [{ pageName: "Ăn Thịt Anh Lập Trình", pageUrl: "https://facebook.com/x", platform: "facebook", postingCadence: "3 bài/tuần" } as any],
      "writing",
    );
    assert.match(text, /Đăng ở: Ăn Thịt Anh Lập Trình \(facebook, 3 bài\/tuần\)/);
  });
});
