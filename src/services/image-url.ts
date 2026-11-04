// Pure helper (no localStorage / window access) so it can run under node tests.
// Appends the auth token to internal "/api/files/..." URLs only. External,
// data:, protocol-relative and lookalike paths are returned untouched.
// Idempotent: a URL that already has a token param is never modified; any
// existing query and hash are preserved.
export function withImageToken(url: string | null | undefined, token: string): string | null {
  if (!url) return null;
  if (!url.startsWith("/api/files/") || url.includes("\\")) return url;
  if (!token) return url;
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt === -1 ? "" : beforeHash.slice(queryAt + 1);
  // Only the exact internal route: reject traversal out of /api/files/.
  if (/%2f|%5c/i.test(path)) return url;
  const normalizedPath = new URL(path, "http://internal.invalid").pathname;
  if (!normalizedPath.startsWith("/api/files/")) return url;
  if (new URLSearchParams(query).has("token")) return url;
  return `${path}?${query ? `${query}&` : ""}token=${encodeURIComponent(token)}${hash}`;
}
