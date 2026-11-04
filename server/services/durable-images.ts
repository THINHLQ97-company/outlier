// Best effort at write time; the exact source URL is the cache identity, so a
// refreshed CDN signature is eligible again even when the old one was dead.
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { getDb, getPool, isDbConfigured } from "../db/client";
import { cacheRemoteImage, isInternalImageUrl } from "./thumb-cache";

export function isExpiringImageUrl(value: string | null | undefined): boolean {
  if (!value || isInternalImageUrl(value)) return false;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return /^https?:$/.test(u.protocol) && (
      /(^|\.)(fbcdn\.net|cdninstagram\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|tiktokcdn-us\.net|fbsbx\.com)$/.test(host) ||
      ["oe", "x-expires", "expires", "x-amz-expires", "x-goog-expires"].some(k => [...u.searchParams.keys()].some(key => key.toLowerCase() === k))
    );
  } catch { return false; }
}
export interface ImageRecord { localUrl: string | null; dead: boolean; attempts: number; retryAt: number }
export interface ImageLedger {
  get(hash: string): Promise<ImageRecord | undefined>;
  put(hash: string, record: ImageRecord): Promise<void>;
}
const ledger: ImageLedger = {
  async get(hash) {
    const { rows } = await getPool().query('SELECT local_url, dead, attempts, retry_at FROM image_cache_entries WHERE url_hash=$1', [hash]);
    const r = rows[0];
    return r ? { localUrl: r.local_url, dead: r.dead, attempts: r.attempts, retryAt: new Date(r.retry_at).getTime() } : undefined;
  },
  async put(hash, r) {
    await getPool().query(`INSERT INTO image_cache_entries(url_hash,local_url,dead,attempts,retry_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(url_hash) DO UPDATE SET
      local_url=EXCLUDED.local_url,dead=EXCLUDED.dead,attempts=EXCLUDED.attempts,retry_at=EXCLUDED.retry_at,last_attempt_at=now()`,
    [hash, r.localUrl, r.dead, r.attempts, new Date(r.retryAt)]);
  },
};

export type KeepOutcome = "stored" | "reused" | "dead" | "failed" | "skipped";
export function createImageKeeperDetailed(store?: ImageLedger, download = cacheRemoteImage) {
  const inFlight = new Map<string, Promise<{ url: string; outcome: KeepOutcome }>>();
  return async function keepDetailed(url: string | null | undefined): Promise<{ url: string | null; outcome: KeepOutcome }> {
    if (!url || isInternalImageUrl(url) || !/^https?:\/\//i.test(url)) return { url: url || null, outcome: "skipped" };
    if (inFlight.has(url)) return inFlight.get(url)!;
    const work = (async () => {
      const hash = createHash("sha256").update(url).digest("hex");
      let previous: ImageRecord | undefined;
      try { previous = await store?.get(hash); } catch { /* migration/DB unavailable: do not break writes */ }
      if (previous?.localUrl) return { url: previous.localUrl, outcome: "reused" as const };
      if (previous && previous.retryAt > Date.now()) return { url, outcome: previous.dead ? "dead" as const : "skipped" as const };
      let status: number | undefined;
      const localUrl = await download(url, "misc", code => { status = code; });
      const attempts = Math.min((previous?.attempts || 0) + 1, 10);
      const dead = !localUrl && (status === 403 || status === 404);
      // A dead flag only describes the failure, never a permanent tombstone.
      // Storage failures have HTTP 200 and use the transient cooldown too.
      const cooldown = dead ? (status === 404 ? 7 * 86400_000 : 86400_000) : Math.min(24, 2 ** (attempts - 1)) * 3600_000;
      const record: ImageRecord = { localUrl, dead, attempts, retryAt: Date.now() + cooldown };
      try { await store?.put(hash, record); } catch { /* storage success is still useful */ }
      return { url: localUrl || url, outcome: localUrl ? "stored" as const : record.dead ? "dead" as const : "failed" as const };
    })();
    inFlight.set(url, work);
    try { return await work; } catch { return { url, outcome: "failed" }; } finally { inFlight.delete(url); }
  };
}
export function createImageKeeper(store?: ImageLedger, download = cacheRemoteImage) {
  const detailed = createImageKeeperDetailed(store, download);
  return async (url: string | null | undefined) => (await detailed(url)).url;
}
const keepWithDb = createImageKeeperDetailed(ledger);
const keepWithoutDb = createImageKeeperDetailed();
export function keepImageDetailed(url: string | null | undefined) {
  return (isDbConfigured() ? keepWithDb : keepWithoutDb)(url);
}
export async function keepImage(url: string | null | undefined) {
  return (await keepImageDetailed(url)).url;
}

/** Per call cap, four downloads at once; untouched items retain their original URL. */
export async function keepImageFields<T>(items: T[], field: keyof T, limit = 30): Promise<void> {
  let cursor = 0;
  const deadline = Date.now() + 3000;
  const batch = items.filter(i => typeof i[field] === "string" && !isInternalImageUrl(i[field] as string)).slice(0, Math.max(0, Math.min(50, limit)));
  await Promise.all(Array.from({ length: Math.min(4, batch.length) }, async () => {
    while (cursor < batch.length && Date.now() < deadline) {
      const item = batch[cursor++];
      const url = await keepImage(item[field] as string);
      if (url) item[field] = url as T[keyof T];
    }
  }));
}

/** No downloads: safe for latency-sensitive writes. Never replace a durable
 * image with an uncached remote URL. Repair will preserve new remote records. */
export function preferDurableImage(existing: string | null | undefined, incoming: string | null | undefined): string | null {
  if (incoming && isInternalImageUrl(incoming)) return incoming;
  if (existing && isInternalImageUrl(existing)) return existing;
  return incoming || existing || null;
}
export async function storedImage(incoming: string | null | undefined, existing?: string | null): Promise<string | null> {
  let cached: string | null = null;
  if (incoming && !isInternalImageUrl(incoming) && isDbConfigured()) {
    try { cached = (await ledger.get(createHash("sha256").update(incoming).digest("hex")))?.localUrl || null; } catch { /* optional cache */ }
  }
  return preferDurableImage(existing, cached || incoming);
}
export async function resetImageRetries(): Promise<number> {
  // Admin bypass is limited to failures last tried >= 1 hour ago; successful
  // cache entries are never invalidated and a caller cannot submit a URL.
  const r = await getPool().query(`UPDATE image_cache_entries SET retry_at=now(),dead=false
    WHERE url_hash IN (SELECT url_hash FROM image_cache_entries
      WHERE local_url IS NULL AND retry_at > now() AND last_attempt_at <= now() - interval '1 hour'
      ORDER BY last_attempt_at, url_hash LIMIT 50)`);
  return r.rowCount || 0;
}

export interface ImageTarget { table: "brand_fanpages" | "fanpage_posts" | "watched_channels"; column: "meta_picture_url" | "thumbnail_url" | "channel_avatar_url" | "meta_stats_json"; id: string; postId?: string }
export function pendingImageSql(target: ImageTarget, url: string): SQL {
  return sql`INSERT INTO image_pending_updates(target_table,target_column,target_id,post_id,source_url)
    VALUES(${target.table},${target.column},${target.id}::uuid,${target.postId || ""},${url})
    ON CONFLICT(target_table,target_column,target_id,post_id)
    DO UPDATE SET source_url=EXCLUDED.source_url,queued_at=CASE WHEN image_pending_updates.source_url IS DISTINCT FROM EXCLUDED.source_url THEN now() ELSE image_pending_updates.queued_at END`;
}
/** Outside a business transaction (row already committed). Best effort. */
export async function queueImage(target: ImageTarget, url: string | null | undefined): Promise<void> {
  if (!url || isInternalImageUrl(url)) return;
  try { await getDb().execute(pendingImageSql(target, url)); }
  // Never log the source: CDN links carry signatures.
  catch (e: any) { console.warn("[images] Chưa xếp hàng nguồn ảnh mới:", e?.code || "lỗi DB"); }
}
type Exec = { execute(q: SQL): Promise<unknown>; transaction<T>(fn: (tx: Exec) => Promise<T>): Promise<T> };
/**
 * Run the business write, then enqueue new image sources in the SAME
 * transaction — only when the write really touched a row. Each enqueue sits in
 * a savepoint so a queue failure never rolls back the business data.
 */
export async function writeThenQueue(
  db: { transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> },
  write: (tx: any) => Promise<boolean>,
  pending: { target: ImageTarget; url: string | null | undefined }[],
): Promise<boolean> {
  return db.transaction(async (tx: Exec) => {
    if (!(await write(tx))) return false;
    for (const p of pending) {
      if (!p.url || isInternalImageUrl(p.url)) continue;
      try { await tx.transaction(sp => sp.execute(pendingImageSql(p.target, p.url!))); }
      catch (e: any) { console.warn("[images] Chưa xếp hàng nguồn ảnh mới:", e?.code || "lỗi DB"); }
    }
    return true;
  });
}
