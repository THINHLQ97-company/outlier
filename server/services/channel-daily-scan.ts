// Tự quét MỌI kênh theo dõi mỗi sáng lúc 8:00 giờ Việt Nam (task #6269).
//
// Mở app buổi sáng là đã có bài mới của đối thủ, không phải bấm "Làm mới"
// từng kênh. Mỗi kênh vẫn đi đúng đường quét tay (refreshChannelInBackground),
// nên vẫn NỐI TIẾP từ lần quét trước: kênh có phí chỉ xin bài mới hơn mốc
// cuối, kênh miễn phí chỉ xin vài bài rồi lọc bài đã thấy — không quét lại từ đầu.
//
// Ba điều phải đúng:
//   1. MỘT LẦN MỖI NGÀY — ghi ngày đã chạy vào app_settings. App khởi động lại
//      (deploy, sập) sau 8:00 thì chạy bù nếu hôm nay chưa chạy, và không bao
//      giờ chạy hai lần.
//   2. LẦN LƯỢT, không chạy song song — mấy chục kênh có phí cùng lúc là đúng
//      kịch bản dính 402 hết RAM bên Apify. Ngân sách Apify ngày vẫn áp như quét tay.
//   3. Không ném lỗi ra ngoài — một kênh hỏng không được làm dừng các kênh khác.
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { radarItems, radarJobs, watchedChannels } from "../db/schema";
import { allSettings, setSetting } from "./app-settings";

export const LAST_RUN_KEY = "channel_daily_scan_last_date";
const VN_OFFSET_MS = 7 * 3600_000; // Việt Nam không đổi giờ mùa hè
/** Kênh kẹt "đang quét" lâu hơn mức này là do app khởi động lại giữa chừng. */
const STALE_SCANNING_MS = 30 * 60_000;

export function scanHour(): number {
  const n = Number(process.env.CHANNEL_DAILY_SCAN_HOUR);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 8;
}

export function isDailyScanEnabled(): boolean {
  return !/^(off|false|0)$/i.test((process.env.CHANNEL_DAILY_SCAN || "").trim());
}

/** Ngày theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function vnDate(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Lần chạy kế tiếp (giờ VN `hour`:00) tính từ `now`. */
export function nextRunAt(now: Date, hour = scanHour()): Date {
  const day = vnDate(now);
  const todayRun = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+07:00`);
  return todayRun.getTime() > now.getTime() ? todayRun : new Date(todayRun.getTime() + 86_400_000);
}

/** Đã qua giờ quét hôm nay mà chưa chạy → cần chạy (dùng cả lúc khởi động để chạy bù). */
export function isDue(now: Date, lastRunDate: string | null | undefined, hour = scanHour()): boolean {
  const today = vnDate(now);
  if (lastRunDate === today) return false;
  const todayRun = new Date(`${today}T${String(hour).padStart(2, "0")}:00:00+07:00`);
  return now.getTime() >= todayRun.getTime();
}

/** Kênh nào được quét: đang bật, và không đang quét (trừ khi kẹt quá lâu). */
export function shouldScanChannel(
  c: { isActive: boolean; scanStatus: string; updatedAt: Date | string | null },
  now: Date,
): boolean {
  if (!c.isActive) return false;
  if (c.scanStatus !== "scanning") return true;
  const updated = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
  return now.getTime() - updated > STALE_SCANNING_MS;
}

/**
 * Kênh lâu chưa quét được thì quét TRƯỚC (chưa quét lần nào đứng đầu).
 *
 * Ngân sách Apify ngày có trần: 2026-10-12 lượt đầu chỉ đủ cho 14/28 kênh.
 * Quét theo thứ tự thêm kênh thì ngày nào cũng đúng những kênh cuối danh sách
 * hết tiền và không bao giờ được quét. Xếp theo mốc quét cuối thì kênh hôm nay
 * bị bỏ sẽ đứng đầu hàng ngày mai — luân phiên công bằng. Kênh lỗi không dời
 * mốc nên vẫn giữ chỗ ưu tiên.
 */
export function orderForScan<T extends { lastScanAt: Date | string | null }>(rows: T[]): T[] {
  const t = (c: T) => (c.lastScanAt ? new Date(c.lastScanAt).getTime() : -Infinity);
  return [...rows].sort((a, b) => t(a) - t(b));
}

// ── Xếp hàng theo mức hoạt động (task #6849) ──────────────────────────────
// Ngân sách Apify ngày không đủ cho mọi kênh, nên tiền phải đi vào kênh đáng
// xem: kênh người ta vừa tự bấm quét, rồi kênh đang ra bài đều. Kênh có phí
// lâu không ra bài thì quét mỗi sáng chỉ để nhận về con số 0 — ngừng quét hằng
// ngày, chỉ kiểm tra lại mỗi tuần để biết kênh "sống lại" chưa.

const DAY = 86_400_000;
const MANUAL_PRIORITY_DAYS = 7;
const ACTIVE_DAYS = 7;

export function dormantDays(): number {
  const n = Number(process.env.CHANNEL_DORMANT_DAYS);
  return Number.isFinite(n) && n >= 3 ? n : 21;
}
export function dormantRecheckDays(): number {
  const n = Number(process.env.CHANNEL_DORMANT_RECHECK_DAYS);
  return Number.isFinite(n) && n >= 1 ? n : 7;
}

export type ScanTier = "manual" | "active" | "quiet" | "dormant_check" | "dormant_skip";

export interface TierInput {
  useApify: boolean;
  lastScanAt: Date | string | null;
  lastManualScanAt?: Date | string | null;
  /** Bài mới nhất từng thấy của kênh (ngày đăng). null = chưa biết. */
  lastPostAt?: Date | string | null;
}

const ms = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : null);

/** Kênh thuộc nhóm nào trong lượt quét sáng. */
export function scanTier(c: TierInput, now: Date): ScanTier {
  const t = now.getTime();
  const manual = ms(c.lastManualScanAt);
  if (manual != null && t - manual <= MANUAL_PRIORITY_DAYS * DAY) return "manual";

  const post = ms(c.lastPostAt);
  // Chưa biết bài mới nhất (chưa quét được lần nào) thì coi như đang hoạt động.
  if (post == null || t - post <= ACTIVE_DAYS * DAY) return "active";
  // Kênh miễn phí không tốn tiền — ít ra bài cũng cứ quét mỗi ngày.
  if (!c.useApify || t - post <= dormantDays() * DAY) return "quiet";

  const scanned = ms(c.lastScanAt);
  return scanned == null || t - scanned >= dormantRecheckDays() * DAY ? "dormant_check" : "dormant_skip";
}

const TIER_ORDER: Record<ScanTier, number> = { manual: 0, active: 1, quiet: 2, dormant_check: 3, dormant_skip: 4 };

/**
 * Thứ tự quét: theo nhóm, trong nhóm thì kênh lâu chưa quét trước (luân phiên
 * công bằng khi thiếu ngân sách); nhóm "vừa quét tay" thì ai bấm gần nhất trước.
 * Bỏ hẳn nhóm dormant_skip.
 */
export function planDailyScan<T extends TierInput>(rows: T[], now: Date): { targets: T[]; dormant: T[] } {
  const withTier = rows.map((c) => ({ c, tier: scanTier(c, now) }));
  const dormant = withTier.filter((x) => x.tier === "dormant_skip").map((x) => x.c);
  const targets = withTier
    .filter((x) => x.tier !== "dormant_skip")
    .sort((a, b) => {
      if (a.tier !== b.tier) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
      if (a.tier === "manual") return (ms(b.c.lastManualScanAt) ?? 0) - (ms(a.c.lastManualScanAt) ?? 0);
      return (ms(a.c.lastScanAt) ?? -Infinity) - (ms(b.c.lastScanAt) ?? -Infinity);
    })
    .map((x) => x.c);
  return { targets, dormant };
}

/** Ngày đăng của bài mới nhất từng thấy, theo từng kênh — đọc từ bài đã lưu. */
export async function lastPostAtByChannel(): Promise<Map<string, Date>> {
  const rows = await getDb()
    .select({ channelId: radarJobs.watchedChannelId, last: sql<Date | null>`max(${radarItems.publishedAt})` })
    .from(radarItems)
    .innerJoin(radarJobs, eq(radarItems.jobId, radarJobs.id))
    .where(isNotNull(radarJobs.watchedChannelId))
    .groupBy(radarJobs.watchedChannelId);
  const out = new Map<string, Date>();
  for (const r of rows) if (r.channelId && r.last) out.set(r.channelId, new Date(r.last));
  return out;
}

/** Lỗi do tài khoản Apify hết hạn mức (tháng / gói) — không phải lỗi riêng của kênh. */
export function isApifyQuotaError(msg: string | null | undefined): boolean {
  return /not-enough-usage|monthly usage hard limit|platform-feature-disabled|exceed.*usage/i.test(msg || "");
}

export interface DailyScanResult {
  ran: boolean;
  date: string;
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  reason?: string;
}

let running = false;

export async function runDailyChannelScan(reason: string, now = new Date()): Promise<DailyScanResult> {
  const date = vnDate(now);
  const empty = { date, total: 0, ok: 0, failed: 0, skipped: 0 };
  if (!isDbConfigured()) return { ran: false, ...empty, reason: "Chưa cấu hình DATABASE_URL." };
  if (running) return { ran: false, ...empty, reason: "Lượt quét sáng đang chạy." };
  running = true;
  try {
    // Ghi ngày TRƯỚC khi quét: lượt quét dài, app khởi động lại giữa chừng thì
    // thà bỏ phần còn lại hôm nay còn hơn quét chồng lần hai (tốn tiền hai lần).
    await setSetting(LAST_RUN_KEY, date, "system");

    const db = getDb();
    const rows = await db.select().from(watchedChannels).orderBy(asc(watchedChannels.createdAt));
    const lastPost = await lastPostAtByChannel();
    const eligible = rows
      .filter((c) => shouldScanChannel(c, now))
      .map((c) => ({ ...c, lastPostAt: lastPost.get(c.id) ?? null }));
    const { targets, dormant } = planDailyScan(eligible, now);
    const skipped = rows.length - targets.length;
    const counts = targets.reduce<Record<string, number>>((m, c) => {
      const t = scanTier(c, now);
      m[t] = (m[t] || 0) + 1;
      return m;
    }, {});
    console.log(
      `[daily-scan] ${reason}: quét ${targets.length}/${rows.length} kênh — vừa quét tay ${counts.manual || 0}, ` +
        `đang hoạt động ${counts.active || 0}, ít ra bài ${counts.quiet || 0}, kiểm tra kênh ngủ đông ${counts.dormant_check || 0}; ` +
        `bỏ ${dormant.length} kênh ngủ đông, ${skipped - dormant.length} kênh tắt/đang quét.`,
    );

    const { refreshChannelInBackground } = await import("../routes/channels.routes");
    let ok = 0;
    let failed = 0;
    // Apify báo hết hạn mức của tài khoản → các kênh có phí còn lại chắc chắn
    // cũng hỏng; bỏ qua luôn thay vì gọi từng kênh để nhận cùng một lỗi.
    let paidBlocked = false;
    for (const c of targets) {
      if (paidBlocked && c.useApify) {
        failed++;
        continue;
      }
      try {
        await refreshChannelInBackground(c.id);
        const [after] = await db
          .select({ scanStatus: watchedChannels.scanStatus, errorMessage: watchedChannels.errorMessage })
          .from(watchedChannels)
          .where(eq(watchedChannels.id, c.id));
        if (after?.scanStatus === "error") {
          failed++;
          if (c.useApify && isApifyQuotaError(after.errorMessage)) {
            paidBlocked = true;
            console.warn("[daily-scan] Apify đã hết hạn mức tài khoản — bỏ qua các kênh có phí còn lại của lượt này.");
          }
          console.warn(`[daily-scan] ${c.channelName || c.channelUrl}: ${after.errorMessage || "lỗi"}`);
        } else ok++;
      } catch (e: any) {
        failed++;
        console.warn(`[daily-scan] ${c.channelName || c.channelUrl}: ${e?.message || e}`);
      }
    }
    console.log(`[daily-scan] Xong: ${ok} kênh ổn, ${failed} kênh lỗi.`);
    return { ran: true, date, total: targets.length, ok, failed, skipped };
  } catch (e: any) {
    console.error("[daily-scan] Hỏng:", e?.message || e);
    return { ran: false, ...empty, reason: String(e?.message || e) };
  } finally {
    running = false;
  }
}

async function lastRunDate(): Promise<string | null> {
  return (await allSettings())[LAST_RUN_KEY] || null;
}

export async function dailyScanStatus() {
  return {
    enabled: isDailyScanEnabled(),
    hour: scanHour(),
    lastRunDate: await lastRunDate(),
    nextRunAt: nextRunAt(new Date()).toISOString(),
    running,
  };
}

let timer: NodeJS.Timeout | null = null;

async function tick(reason: string) {
  try {
    if (isDue(new Date(), await lastRunDate())) await runDailyChannelScan(reason);
  } catch (e: any) {
    console.error("[daily-scan] tick:", e?.message || e);
  } finally {
    schedule();
  }
}

function schedule() {
  // Hẹn đúng giờ quét kế tiếp; trần 6 giờ để đồng hồ máy lệch hay bị ngủ vẫn
  // tự chỉnh lại, và tick nào chưa tới giờ thì chỉ hẹn lại, không làm gì.
  const wait = Math.min(nextRunAt(new Date()).getTime() - Date.now() + 1000, 6 * 3600_000);
  timer = setTimeout(() => void tick("lượt 8h sáng"), Math.max(1000, wait));
  timer.unref?.();
}

export function startChannelDailyScanJob(): void {
  if (timer || !isDailyScanEnabled() || !isDbConfigured()) return;
  // Đợi app ổn định rồi mới xét chạy bù (deploy lúc 9h thì vẫn có quét hôm nay).
  timer = setTimeout(() => void tick("chạy bù sau khởi động"), 60_000);
  timer.unref?.();
  console.log(`[daily-scan] Đã bật tự quét mọi kênh lúc ${scanHour()}:00 mỗi sáng (giờ Việt Nam).`);
}
