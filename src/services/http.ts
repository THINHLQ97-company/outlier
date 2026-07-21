// Shared fetch helpers for authenticated API calls. Pattern copied from
// share-projects/marcow-crop/src/services/characters.ts: Bearer token header
// (never in the URL/logs) + asError() that clears the session on 401.
export function authHeaders(json = true): HeadersInit {
  const token = localStorage.getItem("authToken") || "";
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function asError(res: Response, fallback: string): Promise<never> {
  if (res.status === 401) {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    throw new Error("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
  }
  const data = await res.json().catch(() => ({}));
  throw new Error(data.error || fallback);
}
