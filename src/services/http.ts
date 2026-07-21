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

// URL ảnh dùng cho <img src>. Ảnh lưu trong storage nội bộ trỏ vào
// "/api/files/<key>" (requireAuth) — <img> không gửi được header Authorization
// nên phải đính token qua query string (extractToken hỗ trợ sẵn, xem
// server/auth-shared.ts). data:/http(s) URL ngoài giữ nguyên. Dùng chung cho
// ảnh nhân vật (Characters) lẫn ảnh bài viết (ImageStudio/Approval/Ready).
export function imageDisplayUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith("/api/files/")) return url;
  const token = localStorage.getItem("authToken") || "";
  return `${url}?token=${encodeURIComponent(token)}`;
}
