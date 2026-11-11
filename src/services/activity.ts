import { authHeaders, asError } from "./http";
export interface ActivityUser { username: string; email?: string | null; role: string; isActive: boolean; lastActivityAt?: string | null; lastEvent?: string | null; online: boolean; createdAt: string }
export interface ActivityLog { id: string; username: string; event: string; path?: string | null; createdAt: string }
export interface ActivitySnapshot { online: ActivityUser[]; users: ActivityUser[]; history: ActivityLog[] }
export async function getActivity(): Promise<ActivitySnapshot> {
  const res = await fetch("/api/admin/activity", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được lịch sử hoạt động.");
  return res.json();
}
