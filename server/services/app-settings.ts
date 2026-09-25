// Tuỳ chỉnh admin đổi được ngay, không cần triển khai lại.
//
// Thứ tự ưu tiên: giá trị admin đặt trong DB → biến môi trường → mặc định.
// Giữ env làm lớp giữa để những nơi chưa có DB (hoặc chạy cục bộ) vẫn dùng được.
//
// Đọc rất nhiều lần (mỗi lượt quét đều hỏi hạn mức) nên nhớ trong bộ nhớ vài
// giây — đủ để không đánh DB liên tục, mà vẫn thấy thay đổi gần như ngay.
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { appSettings } from "../db/schema";

const CACHE_MS = 10_000;
let cache: { at: number; values: Map<string, string> } | null = null;

export const SETTING_KEYS = {
  dailyRunBudget: "apify_daily_run_budget",
  dailyResultBudget: "apify_daily_result_budget",
} as const;

async function load(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  const values = new Map<string, string>();
  if (isDbConfigured()) {
    try {
      for (const row of await getDb().select().from(appSettings)) values.set(row.key, row.value);
    } catch {
      // Chưa chạy migration hoặc DB trục trặc — lùi về env, đừng chặn việc.
    }
  }
  cache = { at: Date.now(), values };
  return values;
}

/** Số nguyên không âm theo thứ tự: admin đặt → env → mặc định. */
export async function numberSetting(key: string, envName: string, fallback: number): Promise<number> {
  const fromDb = (await load()).get(key);
  if (fromDb != null && fromDb.trim() !== "") {
    const n = Number(fromDb);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const fromEnv = process.env[envName];
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    const n = Number(fromEnv);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

export async function setSetting(key: string, value: string, by: string): Promise<void> {
  if (!isDbConfigured()) throw new Error("Chưa cấu hình DATABASE_URL.");
  await getDb()
    .insert(appSettings)
    .values({ key, value, updatedBy: by, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: by, updatedAt: new Date() },
    });
  cache = null; // thấy ngay, không đợi hết hạn nhớ
}

export async function allSettings(): Promise<Record<string, string>> {
  return Object.fromEntries(await load());
}
