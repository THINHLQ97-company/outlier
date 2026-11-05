// Bản nháp của trend tự khớp với remake thật.
//
// Người dùng bấm "tạo lại" trong trang remake sẽ sinh một remake MỚI (cùng bản bóc
// cấu trúc + thương hiệu), không gắn vào dòng trend_workflow_drafts — thẻ trend
// vẫn kẹt "Đang soạn"/"Lỗi". Mỗi lần đọc, dòng chưa ready được nối sang remake
// đã viết xong (ưu tiên remake đang gắn, rồi bản mới nhất cùng bản bóc + thương hiệu)
// và ghi lại để thẻ Teams, trend_status và Trend Radar thấy cùng một trạng thái.
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { remakes, trendWorkflowDrafts, trendWorkflowItems } from "../db/schema";

type DraftRow = typeof trendWorkflowDrafts.$inferSelect;
type RemakeLite = { id: string; owner?: string; brandId: string; deconstructionId: string | null; status: string; draft: string | null; createdAt: Date };

/** Thuần, để test: remake nào làm bản nháp này "ready". null = giữ nguyên. */
export function pickReadyRemake(d: Pick<DraftRow, "remakeId" | "brandId" | "status">, deconstructionId: string | null | undefined, candidates: RemakeLite[], taken: Set<string> = new Set()): RemakeLite | null {
  if (d.status === "ready" && d.remakeId) return null;
  const done = (r: RemakeLite) => r.status === "ready" && !!r.draft?.trim();
  const linked = d.remakeId ? candidates.find(r => r.id === d.remakeId) : undefined;
  // Chỉ bản người dùng tự tạo lại (không phải bản workflow viết cho page khác) và chưa gắn page nào.
  const remade = deconstructionId ? candidates.filter(r => r.deconstructionId === deconstructionId && r.brandId === d.brandId && r.owner !== "trend-workflow" && !taken.has(r.id) && done(r)) : [];
  // Bản mới nhất thắng: người dùng bấm tạo lại thì thẻ mở đúng bản vừa tạo.
  return [...(linked && done(linked) ? [linked] : []), ...remade].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
}

/** Trả về danh sách drafts đã khớp; lỗi đọc/ghi thì trả nguyên để không làm hỏng màn hình. */
export async function syncTrendDrafts<T extends DraftRow>(drafts: T[], db: any = getDb()): Promise<T[]> {
  const stale = drafts.filter(d => !(d.status === "ready" && d.remakeId));
  if (!stale.length) return drafts;
  try {
    const itemIds = [...new Set(stale.map(d => d.itemId))];
    const items: { id: string; deconstructionId: string | null }[] = await db.select({ id: trendWorkflowItems.id, deconstructionId: trendWorkflowItems.deconstructionId }).from(trendWorkflowItems).where(inArray(trendWorkflowItems.id, itemIds));
    const deconOf = new Map(items.map(i => [i.id, i.deconstructionId]));
    const deconIds = [...new Set(items.map(i => i.deconstructionId).filter(Boolean))] as string[];
    const linkedIds = stale.map(d => d.remakeId).filter(Boolean) as string[];
    const cols = { id: remakes.id, owner: remakes.owner, brandId: remakes.brandId, deconstructionId: remakes.deconstructionId, status: remakes.status, draft: remakes.draft, createdAt: remakes.createdAt };
    const byDecon: RemakeLite[] = deconIds.length ? await db.select(cols).from(remakes).where(and(inArray(remakes.deconstructionId, deconIds), eq(remakes.status, "ready"))).orderBy(desc(remakes.createdAt)) : [];
    const byId: RemakeLite[] = linkedIds.length ? await db.select(cols).from(remakes).where(inArray(remakes.id, linkedIds)) : [];
    const candidates = [...new Map([...byDecon, ...byId].map(r => [r.id, r])).values()];
    // Remake đã gắn với bất kỳ draft nào của các trend này thì không gắn sang page khác.
    const all: { remakeId: string | null }[] = await db.select({ remakeId: trendWorkflowDrafts.remakeId }).from(trendWorkflowDrafts).where(inArray(trendWorkflowDrafts.itemId, itemIds));
    const taken = new Set(all.map(x => x.remakeId).filter(Boolean) as string[]);
    const out: T[] = [];
    for (const d of drafts) {
      const r = pickReadyRemake(d, deconOf.get(d.itemId), candidates, taken);
      if (!r) { out.push(d); continue; }
      // Bản viết lại thủ công chưa chạy bước ý tưởng ảnh của trend: không mang lỗi cũ sang.
      const patch = { remakeId: r.id, status: "ready", error: null };
      taken.add(r.id);
      await db.update(trendWorkflowDrafts).set(patch).where(eq(trendWorkflowDrafts.id, d.id));
      out.push({ ...d, ...patch });
    }
    return out;
  } catch (e: any) {
    console.warn("[trend-draft-sync] Chưa khớp được bản nháp với remake:", e?.message || e);
    return drafts;
  }
}
