// Hourly repair for expiring social CDN image URLs already in the database.
// Each run is capped and records failed URLs so dead links are not retried forever.
import { getPool, isDbConfigured } from "../db/client";
import { isExpiringImageUrl, keepImageDetailed, type KeepOutcome } from "./durable-images";

const EVERY_MS = 60 * 60_000;
const FIRST_RUN_DELAY_MS = 5 * 60_000;
export const DEFAULT_REPAIR_LIMIT = 30;
export const MAX_REPAIR_LIMIT = 50;
const TARGETS = [
  ["watched_channels", "channel_avatar_url"],
  ["brand_fanpages", "meta_picture_url"],
  ["fanpage_posts", "thumbnail_url"],
  ["ad_orders", "post_thumbnail_url"],
  ["radar_items", "cover_url"],
  ["deconstructions", "thumbnail_url"],
] as const;
type Candidate = {
  table: string; column: string; id: string; url: string; snapshotIndex?: number;
  /** Scanner position to commit only after this item was processed. */
  source?: string; position?: string;
  /** Queued newer source for a row whose current image is already durable. */
  pendingId?: string; postId?: string;
};
export interface ImageRepairResult { checked: number; fixed: number; dead: number; failed: number }
export interface ImageRepairDeps {
  find(limit: number): Promise<Candidate[]>;
  keep(url: string): Promise<{ url: string | null; outcome: KeepOutcome }>;
  update(c: Candidate, url: string): Promise<boolean>;
  /** Item reached a terminal decision for this run; persist scanner progress. */
  commit?(c: Candidate, outcome: KeepOutcome): Promise<void> | void;
  now?(): number;
}
type Query = (sql: string, args: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
const UUID_MIN = "00000000-0000-0000-0000-000000000000";

/** Scanner/apply queries cannot hang the hourly job behind a slow plan or lock. */
async function boundedQuery(sql: string, args: unknown[]) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const r = await client.query(sql, args);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Keyset scan over native uuid (+ JSON ordinality), so indexes on id are usable.
// The cursor is NOT advanced by find(): only commit() after real processing.
export function createRepairScanner(query: Query = boundedQuery) {
  const cursors = new Map<string, { id: string; ord: number }>();
  let nextSource = 0;
  async function find(limit: number): Promise<Candidate[]> {
    const found: Candidate[] = [];
    const pending = await query(`SELECT p.id::text AS pending_id, p.target_table, p.target_column, p.target_id::text, p.post_id, p.source_url
      FROM image_pending_updates p
      LEFT JOIN image_cache_entries e ON e.url_hash=encode(sha256(convert_to(p.source_url,'UTF8')),'hex')
      WHERE e.url_hash IS NULL OR e.local_url IS NOT NULL OR e.retry_at <= now()
      ORDER BY p.queued_at, p.id LIMIT $1`, [Math.max(1, Math.ceil(limit / 2))]);
    for (const r of pending.rows) found.push({ table: r.target_table, column: r.target_column, id: r.target_id, url: r.source_url, pendingId: r.pending_id, postId: r.post_id || undefined });

    const sources = [...TARGETS, ["brand_fanpages", "meta_stats_json"]] as readonly (readonly [string, string])[];
    const start = nextSource++ % sources.length;
    for (let i = 0; i < sources.length && found.length < limit; i++) {
      const [table, column] = sources[(start + i) % sources.length];
      const key = `${table}.${column}`;
      const snapshot = column === "meta_stats_json";
      const value = snapshot ? "p.value->>'thumbnailUrl'" : `t.${column}`;
      const cursor = cursors.get(key) || { id: UUID_MIN, ord: -1 };
      const lateral = snapshot ? `CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.meta_stats_json->'topPosts')='array' THEN t.meta_stats_json->'topPosts' ELSE '[]'::jsonb END
      ) WITH ORDINALITY p(value, ordinality)` : "";
      const position = snapshot ? "(t.id, p.ordinality::int) > ($1::uuid, $2::int)" : "t.id > $1::uuid AND $2::int >= -1";
      const { rows } = await query(`SELECT t.id::text AS id, ${value} AS url, ${snapshot ? "p.ordinality::int" : "0"} AS ord
        FROM ${table} t ${lateral}
        LEFT JOIN image_cache_entries e ON e.url_hash=encode(sha256(convert_to(${value},'UTF8')),'hex')
        WHERE ${position} AND ${value} ~* '^https?://'
          AND (e.url_hash IS NULL OR e.local_url IS NOT NULL OR e.retry_at <= now())
        ORDER BY t.id${snapshot ? ", p.ordinality" : ""} LIMIT $3`, [cursor.id, cursor.ord, 100]);
      if (!rows.length) { cursors.delete(key); continue; } // wrap next turn
      let lastCandidate = -1;
      for (let j = 0; j < rows.length && found.length < limit; j++) {
        const r = rows[j];
        if (!isExpiringImageUrl(r.url)) continue;
        lastCandidate = found.length;
        found.push({ table, column, id: r.id, url: r.url, source: key, position: `${r.id}|${r.ord}`, ...(snapshot ? { snapshotIndex: r.ord - 1 } : {}) });
      }
      const last = rows[rows.length - 1];
      const scannedAll = found.length < limit;
      // Trailing lookalikes after the final candidate are skipped only once
      // that candidate is processed; a candidate-free page is skipped now.
      if (lastCandidate < 0 && scannedAll) cursors.set(key, { id: last.id, ord: last.ord });
      else if (lastCandidate >= 0 && scannedAll) found[lastCandidate].position = `${last.id}|${last.ord}`;
    }
    return found.slice(0, limit);
  }
  function commit(c: Candidate) {
    if (!c.source || !c.position) return;
    const [id, ord] = c.position.split("|");
    cursors.set(c.source, { id, ord: Number(ord) });
  }
  return Object.assign(find, { commit, cursors });
}
const scanner = createRepairScanner();
const COLUMNS: Record<string, string> = {
  "watched_channels.channel_avatar_url": "channel_avatar_url",
  "brand_fanpages.meta_picture_url": "meta_picture_url",
  "fanpage_posts.thumbnail_url": "thumbnail_url",
  "ad_orders.post_thumbnail_url": "post_thumbnail_url",
  "radar_items.cover_url": "cover_url",
  "deconstructions.thumbnail_url": "thumbnail_url",
};
export function createRepairUpdater(query: Query = boundedQuery) {
  return async function update(c: Candidate, url: string): Promise<boolean> {
    if (c.pendingId) {
      if (c.column === "meta_stats_json") {
        if (c.table !== "brand_fanpages" || !c.postId) return false;
        const r = await query(`WITH target AS MATERIALIZED (
          SELECT id FROM brand_fanpages WHERE id=$5::uuid FOR UPDATE
        ), pending AS MATERIALIZED (
          SELECT p.id, p.source_url FROM image_pending_updates p JOIN target t ON t.id=p.target_id
          WHERE p.id=$1::uuid AND p.source_url=$2 AND p.target_table='brand_fanpages' AND p.target_column='meta_stats_json' AND p.post_id=$3
          FOR UPDATE OF p
        ), updated AS (
          UPDATE brand_fanpages t SET meta_stats_json=jsonb_set(t.meta_stats_json,'{topPosts}',(
            SELECT jsonb_agg(CASE WHEN x.value->>'id'=$3 THEN jsonb_set(x.value,'{thumbnailUrl}',to_jsonb($4::text)) ELSE x.value END ORDER BY x.ordinality)
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.meta_stats_json->'topPosts')='array' THEN t.meta_stats_json->'topPosts' ELSE '[]'::jsonb END) WITH ORDINALITY x(value,ordinality)))
          WHERE t.id=$5::uuid AND EXISTS (SELECT 1 FROM pending)
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.meta_stats_json->'topPosts')='array' THEN t.meta_stats_json->'topPosts' ELSE '[]'::jsonb END) x WHERE jsonb_typeof(x)='object' AND x->>'id'=$3)
          RETURNING t.id
        ) DELETE FROM image_pending_updates p USING pending, updated
          WHERE p.id=pending.id AND p.source_url=pending.source_url AND p.target_id=updated.id RETURNING p.id`, [c.pendingId, c.url, c.postId, url, c.id]);
        return (r.rowCount || 0) > 0;
      }
      const col = COLUMNS[`${c.table}.${c.column}`];
      if (!col) return false;
      const r = await query(`WITH target AS MATERIALIZED (
          SELECT id FROM ${c.table} WHERE id=$4::uuid FOR UPDATE
        ), pending AS MATERIALIZED (
          SELECT p.id,p.source_url FROM image_pending_updates p JOIN target t ON t.id=p.target_id
          WHERE p.id=$1::uuid AND p.source_url=$2 AND p.target_table=$5 AND p.target_column=$6 AND p.post_id='' FOR UPDATE OF p
        ), updated AS (
          UPDATE ${c.table} SET ${col}=$3 WHERE id=$4::uuid AND EXISTS (SELECT 1 FROM pending) RETURNING id
        ) DELETE FROM image_pending_updates p USING pending,updated
          WHERE p.id=pending.id AND p.source_url=pending.source_url AND p.target_id=updated.id RETURNING p.id`, [c.pendingId, c.url, url, c.id, c.table, c.column]);
      return (r.rowCount || 0) > 0;
    }
    // Compare source URL: a concurrent sync always wins.
    if (c.snapshotIndex != null) {
      const path = ["topPosts", String(c.snapshotIndex), "thumbnailUrl"];
      const r = await query(`UPDATE brand_fanpages SET meta_stats_json=jsonb_set(meta_stats_json,$1::text[],to_jsonb($2::text))
        WHERE id=$3::uuid AND meta_stats_json #>> $1::text[]=$4`, [path, url, c.id, c.url]);
      return (r.rowCount || 0) > 0;
    }
    const col = COLUMNS[`${c.table}.${c.column}`];
    if (!col) return false;
    const r = await query(`UPDATE ${c.table} SET ${col}=$1 WHERE id=$2::uuid AND ${col}=$3`, [url, c.id, c.url]);
    return (r.rowCount || 0) > 0;
  };
}
/** Pending signed URLs live at most 7 days; orphan cleanup is separate from
 * successful repair and never contributes to fixed. A backup can retain URLs
 * beyond this TTL according to the backup retention policy. */
export async function cleanupPendingImages(query: Query = boundedQuery): Promise<number> {
  const r = await query(`WITH stale AS (
    SELECT p.id FROM image_pending_updates p WHERE p.queued_at < now()-interval '7 days'
    OR (p.target_table='fanpage_posts' AND p.target_column='thumbnail_url' AND NOT EXISTS (SELECT 1 FROM fanpage_posts t WHERE t.id=p.target_id))
    OR (p.target_table='watched_channels' AND p.target_column='channel_avatar_url' AND NOT EXISTS (SELECT 1 FROM watched_channels t WHERE t.id=p.target_id))
    OR (p.target_table='brand_fanpages' AND p.target_column IN ('meta_picture_url','meta_stats_json') AND NOT EXISTS (
      SELECT 1 FROM brand_fanpages t WHERE t.id=p.target_id AND (p.target_column='meta_picture_url' OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.meta_stats_json->'topPosts')='array' THEN t.meta_stats_json->'topPosts' ELSE '[]'::jsonb END) x
        WHERE jsonb_typeof(x)='object' AND x->>'id'=p.post_id))))
    ORDER BY p.queued_at,p.id LIMIT 100
  ) DELETE FROM image_pending_updates p USING stale WHERE p.id=stale.id RETURNING p.id` , []);
  return r.rowCount || 0;
}
const deps: ImageRepairDeps = {
  find: scanner,
  keep: keepImageDetailed,
  update: createRepairUpdater(),
  async commit(c, outcome) {
    scanner.commit(c);
  },
};

export async function repairExpiringImagesWith(d: ImageRepairDeps, requested = DEFAULT_REPAIR_LIMIT): Promise<ImageRepairResult> {
  const limit = Math.max(1, Math.min(MAX_REPAIR_LIMIT, Math.floor(Number(requested)) || DEFAULT_REPAIR_LIMIT));
  const items = (await d.find(limit)).slice(0, limit);
  const result = { checked: 0, fixed: 0, dead: 0, failed: 0 };
  const now = d.now || Date.now;
  const deadline = now() + 15_000;
  for (const item of items) {
    // Unstarted items are not committed, so the next run sees them again.
    if (now() >= deadline) break;
    result.checked++;
    const out = await d.keep(item.url);
    if (out.url && out.url !== item.url && (out.outcome === "stored" || out.outcome === "reused")) {
      if (await d.update(item, out.url)) result.fixed++;
    } else if (out.outcome === "dead") result.dead++;
    else if (out.outcome === "failed") result.failed++;
    await d.commit?.(item, out.outcome);
  }
  return result;
}

let running: Promise<ImageRepairResult> | null = null;
export function repairExpiringImages(limit = DEFAULT_REPAIR_LIMIT): Promise<ImageRepairResult> {
  if (!isDbConfigured()) return Promise.resolve({ checked: 0, fixed: 0, dead: 0, failed: 0 });
  if (running) return running;
  running = cleanupPendingImages().then(() => repairExpiringImagesWith(deps, limit)).finally(() => { running = null; });
  return running;
}

/**
 * Tác vụ nền sửa ảnh cũ MẶC ĐỊNH TẮT (quyết định chủ dự án 2026-11-04): các câu
 * SQL của nó mới kiểm trên DB giả lập, nên lần deploy đầu chỉ chạy migration và
 * lưu ảnh mới khi quét/đồng bộ. Bật bằng IMAGE_REPAIR_JOB=on sau khi theo dõi
 * production ổn. Admin vẫn chạy tay được qua POST /api/admin/images/repair.
 */
export function isImageRepairJobEnabled(): boolean {
  return /^(on|true|1)$/i.test((process.env.IMAGE_REPAIR_JOB || "").trim());
}

export function startImageRepairJob(): void {
  if (!isDbConfigured()) return;
  if (!isImageRepairJobEnabled()) {
    console.log("[image-repair] Tác vụ sửa ảnh cũ đang TẮT (đặt IMAGE_REPAIR_JOB=on để bật).");
    return;
  }
  const run = () => repairExpiringImages().then(r => {
    if (r.checked) console.log(`[image-repair] checked=${r.checked} fixed=${r.fixed} dead=${r.dead} failed=${r.failed}`);
  }).catch(e => console.warn("[image-repair]", e?.code || "repair failed"));
  setTimeout(run, FIRST_RUN_DELAY_MS).unref?.();
  setInterval(run, EVERY_MS).unref?.();
}
