import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
/** Evaluated by PostgreSQL against the CURRENT row, not a stale JS snapshot. */
export function durableImageWrite(current: SQLWrapper, incoming: string | null | undefined): SQL {
  return sql`CASE WHEN ${incoming || null} LIKE '/api/files/%' THEN ${incoming || null}
    WHEN ${current} LIKE '/api/files/%' THEN ${current} ELSE COALESCE(${incoming || null},${current}) END`;
}
/** Merge thumbnails by post id against the current JSON during UPDATE.
 * topPosts of either side may be missing, JSON null, an object or a scalar:
 * only a real array is iterated; anything else counts as an empty list. */
export function durableStatsWrite(current: SQLWrapper, incoming: unknown): SQL {
  const next = sql`${JSON.stringify(incoming ?? null)}::jsonb`;
  const posts = (doc: SQL | SQLWrapper) =>
    sql`CASE WHEN jsonb_typeof((${doc})->'topPosts')='array' THEN (${doc})->'topPosts' ELSE '[]'::jsonb END`;
  return sql`CASE WHEN jsonb_typeof(${next}->'topPosts')='array' THEN jsonb_set(${next}, '{topPosts}', COALESCE((SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(n.value)<>'object' THEN n.value
      WHEN n.value->>'thumbnailUrl' LIKE '/api/files/%' THEN n.value
      WHEN o.value->>'thumbnailUrl' LIKE '/api/files/%' THEN jsonb_set(n.value,'{thumbnailUrl}',o.value->'thumbnailUrl')
      ELSE n.value END ORDER BY n.ordinality)
    FROM jsonb_array_elements(${posts(next)}) WITH ORDINALITY n(value,ordinality)
    LEFT JOIN LATERAL (SELECT c.value FROM jsonb_array_elements(${posts(current)}) c(value)
      WHERE jsonb_typeof(c.value)='object' AND jsonb_typeof(n.value)='object' AND c.value->>'id'=n.value->>'id' LIMIT 1) o ON true),'[]'::jsonb))
    ELSE ${next} END`;
}
