// Login / session API client. Pattern: fetch + throw Error(message) on
// failure (pattern copied from share-projects/marcow-crop/src/services/*.ts).
import type { Role } from "../types";

export interface LoginResult {
  success: boolean;
  token: string;
  username: string;
  role: Role;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Đăng nhập thất bại.");
  return data;
}

// Đăng nhập Google — gửi credential (ID token từ Google Identity Services).
// 403 kèm { pending:true } = tài khoản chờ admin duyệt.
export async function googleLogin(credential: string): Promise<LoginResult> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data.error || "Đăng nhập Google thất bại.");
    err.pending = !!data.pending;
    throw err;
  }
  return data;
}

export async function verifyToken(token: string): Promise<{ valid: boolean; username?: string }> {
  const res = await fetch("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.json();
}

export async function fetchMe(token: string): Promise<{ username: string; role: Role } | null> {
  const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return res.json();
}
