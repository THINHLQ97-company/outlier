import { facebookPostUrl } from "./trend-facebook-url";
import { isApifyQuotaError } from "./channel-daily-scan";
import { isApifyConfigured, budgetLeftToday } from "./apify";
import { fetchPostViaApify, type FetchOutcome, type FetchedPost } from "./post-fetch";
import { sensitiveTrend, type TrendBrief } from "./trend-research";
import type { TrendSettings } from "./trend-workflow-settings";
import { TrendLeaseLost } from "./trend-model-budget";

export interface FacebookCheckpoint {
  state: "reserved" | "complete"; path: "facebook_post" | "brief_only";
  reason: string; url?: string; post?: FetchedPost;
}
export const facebookDeps = { configured: isApifyConfigured, budget: budgetLeftToday, fetch: fetchPostViaApify };
/** Reserve + checkpoint before outbound call. Unknown/interrupted reservations are
 * NOT replayed: Apify may have charged already. Successful post is durable cache.
 */
export async function obtainTrendPost(brief: TrendBrief, config: TrendSettings, cached: FacebookCheckpoint | null, io: {
  reserve: () => Promise<boolean>; save: (value: FacebookCheckpoint) => Promise<void>;
  fence: () => Promise<void>;
}, deps = facebookDeps): Promise<FacebookCheckpoint> {
  if (brief.sensitive || sensitiveTrend(brief.title)) {
    const blocked: FacebookCheckpoint = { state: "complete", path: "brief_only", reason: "Trend nhạy cảm: không lấy bài, ảnh hoặc đọc chữ trong ảnh." };
    await io.save(blocked); return blocked;
  }
  if (cached?.state === "complete") return cached;
  const selected = brief.facebookCandidates?.find(c => c.accepted && facebookPostUrl(c.url));
  const url = selected && facebookPostUrl(selected.url);
  let reason = cached?.state === "reserved" ? "Lượt lấy bài trước bị gián đoạn; không tự lấy lại để tránh tính phí hai lần." :
    !url ? (brief.facebookCandidates?.length ? "Không có link bài Facebook lẻ có nguồn hợp lệ." : "Không tìm thấy link bài Facebook trong nguồn nghiên cứu.") :
    !config.apifyEnabled ? "Lấy bài Facebook qua Apify đang tắt." :
    !config.maxFacebookPostsPerTrend ? "Đã tắt hạn mức lấy bài Facebook cho mỗi trend." :
    !deps.configured() ? "Chưa cấu hình Apify." : "";
  if (!reason) {
    const budget = await deps.budget();
    if (!budget.ok || budget.resultsLeft < 1 || budget.runsLeft < 1) reason = "Hết ngân sách Apify hôm nay.";
  }
  if (!reason && !await io.reserve()) reason = "Hết ngân sách bài Apify của lượt chạy hoặc trong ngày.";
  if (reason) {
    const result: FacebookCheckpoint = { state: "complete", path: "brief_only", reason, ...(url ? { url } : {}) };
    await io.save(result); return result;
  }
  await io.save({ state: "reserved", path: "brief_only", reason: "Đang lấy bài Facebook.", url: url! });
  await io.fence();
  let out: FetchOutcome;
  try { out = await deps.fetch(url!); }
  catch (e: any) { if (e instanceof TrendLeaseLost) throw e; out = { warning: String(e?.message || e) }; }
  await io.fence();
  const result: FacebookCheckpoint = out.post && (out.post.text?.trim() || out.post.thumbnailUrl) ?
    { state: "complete", path: "facebook_post", reason: "Đã lấy nội dung bài Facebook gốc.", url: url!, post: { ...out.post, url: url! } } :
    { state: "complete", path: "brief_only", url: url!, reason: isApifyQuotaError(out.warning) ? "Tài khoản Apify đã hết hạn mức." : "Bài riêng tư, đã xoá hoặc Apify không lấy được nội dung." };
  await io.save(result); return result;
}
