// Ghi và tổng hợp tiền đã tiêu cho dịch vụ ngoài.
//
// Vì sao phải có một chỗ duy nhất: trước đây chỉ lời gọi làm giàu chỉ số mới ghi
// lại, còn lấy bài lẻ và lấy bình luận thì không — nên con số "đã dùng hôm nay"
// luôn thấp hơn thực tế, mà đó lại là con số dùng để quyết định có chặn hay không.
// Mọi lời gọi tốn tiền từ giờ đi qua đây.
//
// Tiền tính theo số kết quả THỰC NHẬN, không theo số đã xin: Apify tính tiền cho
// thứ nó trả về, và nó trả nhiều hơn số xin là chuyện đã xảy ra.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { apifyUsage } from "../db/schema";
import { USD_PER_RESULT } from "./apify";

export type UsageKind = "enrich" | "post" | "comments" | "channel" | "other";

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/** Ghi lại một lượt chạy tốn tiền. Không bao giờ ném lỗi — ghi sổ hỏng không được làm hỏng việc chính. */
export async function recordUsage(opts: {
  actorId: string;
  itemCount: number;
  kind: UsageKind;
  owner?: string | null;
  note?: string;
  /** Tiền thật nếu biết; không truyền thì tính theo số kết quả. */
  costUsd?: number;
}): Promise<void> {
  if (!isDbConfigured()) return;
  const cost = opts.costUsd ?? opts.itemCount * USD_PER_RESULT;
  try {
    await getDb().insert(apifyUsage).values({
      day: todayKey(),
      actorId: opts.actorId,
      itemCount: Math.max(0, opts.itemCount),
      kind: opts.kind,
      owner: opts.owner || null,
      note: opts.note,
      costUsd: cost.toFixed(4),
    });
  } catch {
    // Bỏ qua: mất một dòng sổ còn hơn làm hỏng lượt quét người dùng vừa trả tiền.
  }
}

export interface CostSummary {
  today: { items: number; costUsd: number; runs: number };
  month: { items: number; costUsd: number; runs: number };
  /** Ngân sách kết quả mỗi ngày và phần đã dùng. */
  dailyBudget: { limit: number; used: number; remaining: number };
  /** Chia theo loại việc trong tháng — để biết tiền đi vào đâu. */
  byKind: { kind: string; items: number; costUsd: number; runs: number }[];
  /** 14 ngày gần nhất, dựng biểu đồ. */
  daily: { day: string; items: number; costUsd: number }[];
  /** Vài lượt chạy gần nhất. */
  recent: { day: string; actorId: string; kind: string | null; items: number; costUsd: string | null; note: string | null; createdAt: string }[];
}

function toNum(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getCostSummary(): Promise<CostSummary> {
  const db = getDb();
  const today = todayKey();
  const month = monthKey();

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db.select().from(apifyUsage).where(gte(apifyUsage.day, since)).orderBy(desc(apifyUsage.createdAt));

  // Bản ghi cũ chưa có cột tiền — suy ra từ số kết quả thay vì bỏ trống, để tổng
  // không bị hụt một cách khó hiểu.
  const costOf = (r: (typeof rows)[number]) => (r.costUsd ? toNum(r.costUsd) : r.itemCount * USD_PER_RESULT);

  const todayRows = rows.filter((r) => r.day === today);
  const monthRows = rows.filter((r) => r.day.startsWith(month));

  const byKindMap = new Map<string, { items: number; costUsd: number; runs: number }>();
  for (const r of monthRows) {
    const k = r.kind || "other";
    const cur = byKindMap.get(k) || { items: 0, costUsd: 0, runs: 0 };
    cur.items += r.itemCount;
    cur.costUsd += costOf(r);
    cur.runs += 1;
    byKindMap.set(k, cur);
  }

  const dailyMap = new Map<string, { items: number; costUsd: number }>();
  for (const r of rows) {
    const cur = dailyMap.get(r.day) || { items: 0, costUsd: 0 };
    cur.items += r.itemCount;
    cur.costUsd += costOf(r);
    dailyMap.set(r.day, cur);
  }

  const budgetLimit = Math.max(0, Number(process.env.APIFY_DAILY_RESULT_BUDGET ?? 150));
  const usedToday = todayRows.reduce((s, r) => s + r.itemCount, 0);

  const round = (n: number) => Math.round(n * 10000) / 10000;

  return {
    today: {
      items: usedToday,
      costUsd: round(todayRows.reduce((s, r) => s + costOf(r), 0)),
      runs: todayRows.length,
    },
    month: {
      items: monthRows.reduce((s, r) => s + r.itemCount, 0),
      costUsd: round(monthRows.reduce((s, r) => s + costOf(r), 0)),
      runs: monthRows.length,
    },
    dailyBudget: {
      limit: budgetLimit,
      used: usedToday,
      remaining: Math.max(0, budgetLimit - usedToday),
    },
    byKind: [...byKindMap.entries()]
      .map(([kind, v]) => ({ kind, items: v.items, costUsd: round(v.costUsd), runs: v.runs }))
      .sort((a, b) => b.costUsd - a.costUsd),
    daily: [...dailyMap.entries()]
      .map(([day, v]) => ({ day, items: v.items, costUsd: round(v.costUsd) }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    recent: rows.slice(0, 20).map((r) => ({
      day: r.day,
      actorId: r.actorId,
      kind: r.kind,
      items: r.itemCount,
      costUsd: r.costUsd ?? (r.itemCount * USD_PER_RESULT).toFixed(4),
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Nhãn tiếng Việt cho từng loại việc. */
export const KIND_LABEL: Record<string, string> = {
  enrich: "Lấy chỉ số bài",
  post: "Lấy bài lẻ",
  comments: "Lấy bình luận",
  channel: "Quét kênh",
  other: "Khác",
};
