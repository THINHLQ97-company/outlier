// Việc chạy nền: mỗi ngày dò lại token Meta của mọi trang đã nối, gia hạn cái
// nào sắp hết, và ghi lại tình trạng để giao diện nói được "còn bao lâu".
//
// Vì sao là việc nền chứ không phải nút bấm: token hết hạn lúc 3 giờ sáng thì
// không ai bấm. Cái người dùng cần là mở app ra thấy nó vẫn chạy, không phải
// thấy một nút "gia hạn" bên cạnh một thông báo lỗi.
//
// Không ném lỗi ra ngoài: một trang hỏng không được làm dừng các trang còn lại,
// và job hỏng không được làm sập server.
import { eq, isNotNull } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { brandFanpages } from "../db/schema";
import { encryptToken, decryptToken } from "./meta-token";
import { metaAppCreds, checkAndRenew, WARN_WHEN_DAYS_LEFT, type TokenStatus } from "./meta-token-health";

export interface PageTokenReport {
  fanpageId: string;
  pageName: string | null;
  status: TokenStatus;
  neverExpires: boolean;
  daysLeft: number | null;
  renewed: boolean;
  note?: string;
}

export interface TokenSweepResult {
  ran: boolean;
  checked: number;
  renewed: number;
  /** Trang cần người can thiệp: hết hạn, hoặc sắp hết mà gia hạn không xong. */
  needsAttention: PageTokenReport[];
  pages: PageTokenReport[];
  skippedReason?: string;
}

/** Một lượt dò toàn bộ trang đã nối Meta. Gọi được từ job định kỳ hoặc từ API. */
export async function sweepMetaTokens(): Promise<TokenSweepResult> {
  const empty = { checked: 0, renewed: 0, needsAttention: [], pages: [] };

  if (!isDbConfigured()) {
    return { ran: false, ...empty, skippedReason: "Chưa cấu hình DATABASE_URL." };
  }
  const creds = metaAppCreds();
  if (!creds) {
    return {
      ran: false,
      ...empty,
      skippedReason:
        "Chưa cấu hình META_APP_ID / META_APP_SECRET — Meta đòi App Secret cho mọi bước gia hạn, " +
        "nên không có hai biến này thì token phải dán tay.",
    };
  }

  const db = getDb();
  const rows = await db.select().from(brandFanpages).where(isNotNull(brandFanpages.metaTokenEnc));

  const pages: PageTokenReport[] = [];
  let renewedCount = 0;

  for (const row of rows) {
    const report: PageTokenReport = {
      fanpageId: row.id,
      pageName: row.pageName,
      status: "unknown",
      neverExpires: false,
      daysLeft: null,
      renewed: false,
    };
    try {
      const pageToken = decryptToken(row.metaTokenEnc!);
      const userToken = row.metaUserTokenEnc ? decryptToken(row.metaUserTokenEnc) : null;
      const out = await checkAndRenew({ pageToken, userToken, pageId: row.metaPageId }, creds);

      const patch: Record<string, any> = {
        metaTokenStatus: out.inspection.status,
        metaTokenNeverExpires: out.inspection.neverExpires,
        metaTokenExpiresAt: out.inspection.expiresAt,
        metaTokenCheckedAt: new Date(),
        metaTokenNote: out.note ?? out.inspection.note ?? null,
        updatedAt: new Date(),
      };
      if (out.pageToken) {
        patch.metaTokenEnc = encryptToken(out.pageToken);
        patch.metaTokenRenewedAt = new Date();
      }
      if (out.userToken) patch.metaUserTokenEnc = encryptToken(out.userToken);
      await db.update(brandFanpages).set(patch).where(eq(brandFanpages.id, row.id));

      report.status = out.inspection.status;
      report.neverExpires = out.inspection.neverExpires;
      report.daysLeft = out.inspection.daysLeft;
      report.renewed = out.renewed;
      report.note = out.note ?? out.inspection.note;
      if (out.renewed) renewedCount++;
    } catch (e: any) {
      // Lỗi giải mã (AUTH_SECRET đổi) hay lỗi mạng — ghi lại, đi tiếp.
      report.status = "unknown";
      report.note = `Không kiểm được: ${e?.message || e}`;
      await db
        .update(brandFanpages)
        .set({ metaTokenCheckedAt: new Date(), metaTokenNote: report.note, updatedAt: new Date() })
        .where(eq(brandFanpages.id, row.id))
        .catch(() => {});
    }
    pages.push(report);
  }

  const needsAttention = pages.filter(
    (p) =>
      p.status === "expired" ||
      p.status === "invalid" ||
      (!p.neverExpires && !p.renewed && p.daysLeft != null && p.daysLeft <= WARN_WHEN_DAYS_LEFT),
  );

  return { ran: true, checked: pages.length, renewed: renewedCount, needsAttention, pages };
}

/** Bao lâu dò một lần. Nửa ngày: đủ dày để không bỏ sót, đủ thưa để không phiền Meta. */
const SWEEP_EVERY_MS = 12 * 3600_000;
/** Chờ một chút sau khi khởi động, cho migration và kết nối DB xong đã. */
const FIRST_SWEEP_DELAY_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

async function runOnce(trigger: string) {
  try {
    const out = await sweepMetaTokens();
    if (!out.ran) {
      console.warn(`[meta-token] Bỏ qua (${trigger}): ${out.skippedReason}`);
      return;
    }
    console.log(`[meta-token] ${trigger}: kiểm ${out.checked} trang, gia hạn ${out.renewed}.`);
    for (const p of out.needsAttention) {
      console.warn(`[meta-token] CẦN XỬ LÝ — ${p.pageName || p.fanpageId}: ${p.status}. ${p.note || ""}`);
    }
  } catch (e: any) {
    console.error("[meta-token] Lượt dò thất bại:", e?.message || e);
  }
}

/** Bật job. Gọi một lần lúc khởi động server. */
export function startMetaTokenJob(): void {
  if (timer) return;
  setTimeout(() => void runOnce("lượt đầu sau khởi động"), FIRST_SWEEP_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce("lượt định kỳ"), SWEEP_EVERY_MS);
  timer.unref?.();
  console.log("[meta-token] Đã bật tự động gia hạn token Meta (12 giờ/lượt).");
}

export interface MetaTokenStatusRow {
  fanpageId: string;
  brandId: string;
  pageName: string | null;
  platform: string;
  status: TokenStatus;
  neverExpires: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  checkedAt: string | null;
  renewedAt: string | null;
  note: string | null;
}

/**
 * Tình trạng token đã ghi trong DB — KHÔNG gọi Meta.
 *
 * Tách khỏi sweepMetaTokens vì mở giao diện ra là phải thấy ngay, không đợi
 * mấy giây gọi Graph API cho từng trang. Số liệu do job nền cập nhật.
 */
export async function metaTokenStatusList(): Promise<{
  autoRenewEnabled: boolean;
  reason?: string;
  pages: MetaTokenStatusRow[];
}> {
  const creds = metaAppCreds();
  const reason = creds
    ? undefined
    : "Chưa cấu hình META_APP_ID / META_APP_SECRET nên không tự gia hạn được — token sẽ phải dán tay khi hết hạn.";

  if (!isDbConfigured()) return { autoRenewEnabled: !!creds, reason, pages: [] };

  const rows = await getDb().select().from(brandFanpages).where(isNotNull(brandFanpages.metaTokenEnc));
  const pages = rows.map((r): MetaTokenStatusRow => {
    const expiresAt = r.metaTokenExpiresAt ? new Date(r.metaTokenExpiresAt) : null;
    return {
      fanpageId: r.id,
      brandId: r.brandId,
      pageName: r.pageName,
      platform: r.platform,
      status: (r.metaTokenStatus || "unknown") as TokenStatus,
      neverExpires: r.metaTokenNeverExpires,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      daysLeft: expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000) : null,
      checkedAt: r.metaTokenCheckedAt ? new Date(r.metaTokenCheckedAt).toISOString() : null,
      renewedAt: r.metaTokenRenewedAt ? new Date(r.metaTokenRenewedAt).toISOString() : null,
      note: r.metaTokenNote,
    };
  });
  return { autoRenewEnabled: !!creds, reason, pages };
}
