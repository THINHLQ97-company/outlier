// Dựng bản tóm tắt nhân vật của trang, dạng văn xuôi.
//
// Vì sao cần, khi đã có brand_profile_get: hồ sơ thô là JSON lồng nhau, mỗi mục
// bọc trong { value, evidence[], source } để phục vụ việc chống bịa. Đọc được,
// nhưng nặng và dễ khiến model chú ý sai chỗ. Bản brief này bỏ phần chứng minh,
// giữ lại phần dùng được, sắp theo thứ tự một người viết cần biết: trang là gì
// → nói với ai → nói giọng nào → cấm gì → mẫu.
//
// Nguyên tắc giữ nguyên như chỗ khác: mục nào thiếu thì NÓI RÕ là thiếu. Model
// đọc "chưa có dữ liệu" sẽ hỏi lại hoặc né; đọc một câu trơn tru bịa ra thì không.
import type { brands, brandFanpages } from "../db/schema";
import type { BrandField, BrandRegister, BrandBehaviorRules, BrandVisualIdentity, BrandExample } from "../db/schema";
import { statsToText } from "./fanpage-stats";

type BrandRow = typeof brands.$inferSelect;
type FanpageRow = typeof brandFanpages.$inferSelect;

function val<T>(f: BrandField<T> | null | undefined): T | null {
  if (!f) return null;
  const v = f.value;
  if (v == null) return null;
  if (Array.isArray(v) && v.length === 0) return null;
  if (typeof v === "string" && !v.trim()) return null;
  return v;
}

function bullets(items: string[]): string {
  return items.map((s) => `- ${s}`).join("\n");
}

export function buildBrandBrief(
  row: BrandRow,
  pages: FanpageRow[],
  purpose: "writing" | "image" = "writing",
): string {
  const missing: string[] = [];
  const out: string[] = [];

  out.push(`# ${row.name}`);

  const pageRole = val<string>(row.pageRole as any);
  if (pageRole) out.push(`\n**Trang này là gì:** ${pageRole}`);
  else missing.push("pageRole (trang tồn tại để làm gì — mục quan trọng nhất)");

  const sells = val<string[]>(row.sells as any);
  const audience = val<string>(row.audience as any);
  const facts: string[] = [];
  if (sells) facts.push(`Bán: ${sells.join(", ")}`);
  else missing.push("sells (bán gì)");
  if (audience) facts.push(`Người đọc: ${audience}`);
  else missing.push("audience (khách là ai)");
  if (pages.length > 0) {
    const where = pages.map((p) => {
      const bits = [p.platform];
      if (p.followerCount != null) bits.push(`${p.followerCount.toLocaleString("vi-VN")} theo dõi`);
      if (p.postingCadence) bits.push(p.postingCadence);
      return `${p.pageName || p.pageUrl} (${bits.join(", ")})`;
    });
    facts.push(`Đăng ở: ${where.join(" · ")}`);
  }
  if (facts.length) out.push(`\n${bullets(facts)}`);

  const personality = val<string[]>(row.personality as any);
  if (personality) out.push(`\n## Tính cách\n${bullets(personality)}`);
  else missing.push("personality (tính cách)");

  const registers = val<BrandRegister[]>(row.registers as any);
  if (registers) {
    const lines = registers.map((r) => {
      const bits = [`**${r.name}** — dùng ${r.when}`];
      if (r.pronouns) bits.push(`xưng hô: ${r.pronouns}`);
      if (r.example) bits.push(`ví dụ: "${r.example}"`);
      return `- ${bits.join("; ")}`;
    });
    out.push(`\n## Ngữ vực (đổi giọng theo tình huống)\n${lines.join("\n")}`);
  } else {
    const tone = val<string>(row.toneOfVoice as any);
    const addressing = val<string>(row.addressing as any);
    if (tone || addressing) {
      const lines: string[] = [];
      if (tone) lines.push(`Giọng: ${tone}`);
      if (addressing) lines.push(`Xưng hô: ${addressing}`);
      out.push(`\n## Giọng nói\n${bullets(lines)}`);
    } else {
      missing.push("registers hoặc toneOfVoice (nói giọng gì)");
    }
  }

  const catchphrases = val<string[]>(row.catchphrases as any);
  if (catchphrases) out.push(`\n## Câu cửa miệng\n${bullets(catchphrases.map((c) => `"${c}"`))}`);

  // Phần cấm luôn đứng trước phần mẫu: đọc mẫu xong mới biết cấm thì đã muộn.
  const behavior = val<BrandBehaviorRules>(row.behaviorRules as any);
  const banned = val<string[]>(row.bannedTerms as any);
  const trendDonts = val<string[]>(row.trendDonts as any);
  const nevers: string[] = [];
  if (behavior?.never?.length) nevers.push(...behavior.never);
  if (trendDonts) nevers.push(...trendDonts);
  if (banned) nevers.push(`Không dùng các từ/cụm: ${banned.join(", ")}`);
  if (nevers.length) out.push(`\n## KHÔNG BAO GIỜ\n${bullets(nevers)}`);
  else missing.push("behaviorRules.never / bannedTerms (giới hạn)");

  const alwaysList: string[] = [];
  if (behavior?.always?.length) alwaysList.push(...behavior.always);
  const trendDos = val<string[]>(row.trendDos as any);
  if (trendDos) alwaysList.push(...trendDos);
  if (alwaysList.length) out.push(`\n## Luôn làm\n${bullets(alwaysList)}`);

  const pillars = val<string[]>(row.contentPillars as any);
  if (pillars) out.push(`\n## Mảng nội dung theo đuổi\n${bullets(pillars)}`);

  const visual = val<BrandVisualIdentity>(row.visualIdentity as any);
  if (purpose === "image") {
    if (visual) {
      const lines: string[] = [];
      if (visual.template) lines.push(`Khuôn ảnh cứng: ${visual.template}`);
      if (visual.palette?.length) lines.push(`Màu: ${visual.palette.join(", ")}`);
      if (visual.mustHave?.length) lines.push(`Luôn phải có: ${visual.mustHave.join("; ")}`);
      if (visual.doNots?.length) lines.push(`Không bao giờ xuất hiện: ${visual.doNots.join("; ")}`);
      out.push(`\n## Nhận diện hình ảnh\n${bullets(lines)}`);
    } else {
      missing.push("visualIdentity (khuôn ảnh, màu, thứ cấm xuất hiện) — thiếu thì ảnh sẽ đúng nội dung nhưng sai trang");
    }
  } else if (visual?.template) {
    out.push(`\n**Khuôn ảnh quen thuộc của trang:** ${visual.template}`);
  }

  // Số liệu thật của trang: thứ giữ cho việc viết lại bám vào cái trang này đang
  // làm được, thay vì bám cảm tính. Chỉ lấy trang chính (hoặc trang đầu có số liệu).
  const withStats = pages.find((p) => p.isPrimary && p.metaStatsJson) || pages.find((p) => p.metaStatsJson);
  if (withStats?.metaStatsJson) {
    const text = statsToText(withStats.metaStatsJson as any);
    if (text) out.push(`\n## Trang này đang chạy thế nào\n${text}`);
  } else if (pages.length > 0) {
    missing.push("số liệu thật của trang — nối Meta rồi quét bài về để có nhịp đăng, định dạng hay dùng, và bài nào ăn hơn hẳn");
  }

  const examples = val<BrandExample[]>(row.fewShotExamples as any);
  if (examples) {
    const lines = examples.map((e) => {
      const tag = [e.kind, e.register].filter(Boolean).join(" / ");
      return `- [${tag}] "${e.text}"${e.note ? ` — ${e.note}` : ""}`;
    });
    out.push(`\n## Bài mẫu đã được duyệt là đúng giọng\n${lines.join("\n")}`);
  } else {
    missing.push("fewShotExamples (bài mẫu đúng giọng)");
  }

  if (missing.length) {
    out.push(
      `\n## Còn thiếu trong hồ sơ\n${bullets(missing)}\n\n` +
        `Những mục này CHƯA có dữ liệu — đừng tự suy ra. Cần thì hỏi chủ trang rồi ghi vào bằng brand_set.`,
    );
  }

  return out.join("\n");
}
