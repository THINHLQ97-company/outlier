// Content direction của từng trang: bản chốt hướng nội dung, đọc từ một link.
//
// Khác tài liệu nguồn (brand_sources, chỉ dùng một lần để bóc hồ sơ): bản này đi
// NGUYÊN VĂN vào brief mỗi lần AI viết hoặc đánh giá trend cho trang, nên AI đối
// chiếu được với đúng luật của trang (trụ nội dung, lằn ranh, công thức trò đùa…).
// Link được đọc lại mỗi ngày; đọc lỗi thì GIỮ bản cũ và ghi lý do.
import { and, eq, isNotNull, lt, or, isNull } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { brandFanpages } from "../db/schema";
import { ingestUrl, assertPublicUrl } from "./brand-ingest";

/** Trần ký tự mỗi trang đưa vào prompt — đủ cho bản direction đầy đủ (~40k), chặn trang rác quá dài. */
export const DIRECTION_MAX_CHARS = 60_000;
const REFRESH_MS = 24 * 3600_000;

type PageLike = { pageName?: string | null; pageUrl: string; contentDirectionText?: string | null; contentDirectionUrl?: string | null; contentDirectionFetchedAt?: Date | string | null };

/** Thuần, để test: khối brief cho content direction của các trang. Rỗng nếu không trang nào có. */
export function contentDirectionBlock(pages: PageLike[]): string {
  const withDir = pages.filter((p) => p.contentDirectionText?.trim());
  if (!withDir.length) return "";
  const parts = withDir.map((p) => {
    const at = p.contentDirectionFetchedAt ? new Date(p.contentDirectionFetchedAt).toISOString().slice(0, 10) : "";
    return `### Content direction — ${p.pageName || p.pageUrl}${at ? ` (đọc ngày ${at})` : ""}\n` +
      `Nguồn: ${p.contentDirectionUrl || "không rõ"}\n\n${p.contentDirectionText!.trim().slice(0, DIRECTION_MAX_CHARS)}`;
  });
  return `\n## Content direction của trang (bản chốt — ưu tiên cao nhất)\n` +
    `Đây là hướng nội dung team đã chốt. Khi đề xuất, viết hoặc đánh giá trend: đối chiếu với trụ nội dung, công thức, ` +
    `lằn ranh và luật thuật ngữ trong bản này. Mâu thuẫn với các mục hồ sơ phía trên thì theo bản này.` +
    (withDir.length > 1 ? ` Mỗi trang có bản riêng — chỉ áp bản của đúng trang đang viết, không trộn giọng.` : "") +
    `\n\n${parts.join("\n\n")}`;
}

/** Đọc link và lưu vào trang. Lỗi đọc: ném lỗi (khi người dùng vừa dán) hoặc ghi lý do, giữ bản cũ (khi tự làm mới). */
export async function setContentDirection(fanpageId: string, url: string | null, opts: { keepOnError?: boolean } = {}) {
  const db = getDb();
  if (!url) {
    const [row] = await db.update(brandFanpages).set({ contentDirectionUrl: null, contentDirectionTitle: null, contentDirectionText: null, contentDirectionFetchedAt: null, contentDirectionError: null, updatedAt: new Date() }).where(eq(brandFanpages.id, fanpageId)).returning();
    return row;
  }
  assertPublicUrl(url);
  try {
    const r = await ingestUrl(url);
    if (r.text.length < 500) throw new Error("Trang này quá ít chữ để làm content direction (dưới 500 ký tự). Kiểm tra lại link.");
    const [row] = await db.update(brandFanpages).set({
      contentDirectionUrl: url, contentDirectionTitle: r.title || null, contentDirectionText: r.text.slice(0, DIRECTION_MAX_CHARS),
      contentDirectionFetchedAt: new Date(), contentDirectionError: null, updatedAt: new Date(),
    }).where(eq(brandFanpages.id, fanpageId)).returning();
    return row;
  } catch (e: any) {
    if (!opts.keepOnError) throw e;
    const message = String(e?.message || e).slice(0, 300);
    await db.update(brandFanpages).set({ contentDirectionError: message }).where(eq(brandFanpages.id, fanpageId));
    return null;
  }
}

/** Đọc lại các link đã quá 24 giờ. Gọi từ job mỗi giờ; một trang lỗi không chặn trang khác. */
export async function refreshContentDirections(now = new Date()) {
  if (!isDbConfigured()) return 0;
  const db = getDb();
  const due = await db.select({ id: brandFanpages.id, url: brandFanpages.contentDirectionUrl }).from(brandFanpages)
    .where(and(isNotNull(brandFanpages.contentDirectionUrl), or(isNull(brandFanpages.contentDirectionFetchedAt), lt(brandFanpages.contentDirectionFetchedAt, new Date(now.getTime() - REFRESH_MS)))));
  let n = 0;
  for (const p of due) {
    if (await setContentDirection(p.id, p.url!, { keepOnError: true }).catch(() => null)) n++;
  }
  if (due.length) console.log(`[content-direction] Đọc lại ${n}/${due.length} content direction.`);
  return n;
}
