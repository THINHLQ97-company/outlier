// Quản lý tài khoản (admin) + thông tin user hiện tại.
// Endpoints: server/routes/users.routes.ts + GET /api/me (auth.routes.ts).
import { authHeaders, asError } from "./http";
import type { UserRow, MeInfo, Role } from "../types";

// GET /api/me — user hiện tại (dùng để ẩn/hiện menu Quản trị theo role).
export async function getMe(): Promise<MeInfo> {
  const res = await fetch("/api/me", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được thông tin tài khoản.");
  return res.json();
}

export async function listUsers(): Promise<UserRow[]> {
  const res = await fetch("/api/users", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách tài khoản.");
  return res.json();
}

export async function createUser(input: {
  username: string;
  password: string;
  role?: Role;
}): Promise<UserRow> {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Tạo tài khoản thất bại.");
  return res.json();
}

// Cấp quyền đăng nhập Google cho 1 email (mời / duyệt nhanh).
export async function inviteUser(email: string, role: Role = "member"): Promise<UserRow> {
  const res = await fetch("/api/users/invite", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) return asError(res, "Cấp quyền email thất bại.");
  return res.json();
}

export async function updateUser(
  id: string,
  patch: { role?: Role; isActive?: boolean; password?: string }
): Promise<UserRow> {
  const res = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return asError(res, "Cập nhật tài khoản thất bại.");
  return res.json();
}
