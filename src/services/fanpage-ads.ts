// Bài trang nhà + quảng cáo đang chạy + đơn đặt quảng cáo.
// Endpoint: server/routes/ad-orders.routes.ts.
import { authHeaders, asError } from "./http";

export type AdOrderStatus = "cho_chay" | "dang_chay" | "da_xong" | "huy";
export type AdsStatus = "ok" | "no_user_token" | "missing_ads_read" | "no_ad_account" | "error";

export const AD_ORDER_STATUS_LABEL: Record<AdOrderStatus, string> = {
  cho_chay: "Chờ chạy",
  dang_chay: "Đang chạy",
  da_xong: "Đã xong",
  huy: "Đã huỷ",
};

export interface AdOrder {
  id: string;
  fanpageId: string;
  postId: string;
  postMessage: string | null;
  postPermalink: string | null;
  postThumbnailUrl: string | null;
  note: string | null;
  requestedBy: string;
  assignee: string | null;
  status: AdOrderStatus;
  statusBy: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdOrderListItem extends AdOrder {
  pageName: string | null;
  brandName: string | null;
  ad: {
    active: boolean;
    spend: number | null;
    currency: string | null;
    impressions: number | null;
    reach: number | null;
    lastSeenAt: string | null;
  } | null;
}

export interface AdOrderList {
  runner: string | null;
  me: string;
  canManage: boolean;
  items: AdOrderListItem[];
}

export interface ConnectedFanpage {
  id: string;
  brandId: string;
  brandName: string;
  pageName: string | null;
  pictureUrl: string | null;
  metaPostsSyncedAt: string | null;
  metaAdsStatus: AdsStatus | null;
  metaAdsNote: string | null;
}

export interface FanpagePost {
  postId: string;
  message: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
  createdTime: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  adActive: boolean;
  adCount: number;
  adSpend: number | null;
  adCurrency: string | null;
  adImpressions: number | null;
  adReach: number | null;
  adFirstSeenAt: string | null;
  adLastSeenAt: string | null;
  openOrder: AdOrder | null;
}

export interface FanpagePostsResult {
  fanpageId: string;
  syncedAt: string | null;
  adsStatus: AdsStatus | null;
  adsNote: string | null;
  activeCount: number;
  items: FanpagePost[];
}

export async function listConnectedFanpages(): Promise<ConnectedFanpage[]> {
  const res = await fetch("/api/fanpages/connected", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách trang.");
  return res.json();
}

export async function listFanpagePosts(
  fanpageId: string,
  opts: { adsOnly?: boolean; from?: string; to?: string } = {},
): Promise<FanpagePostsResult> {
  const q = new URLSearchParams();
  if (opts.adsOnly) q.set("ads", "1");
  if (opts.from) q.set("from", opts.from);
  if (opts.to) q.set("to", opts.to);
  const qs = q.toString();
  const res = await fetch(`/api/fanpages/${fanpageId}/posts${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(false),
  });
  if (!res.ok) return asError(res, "Không tải được bài của trang.");
  return res.json();
}

export async function syncFanpagePostsNow(fanpageId: string): Promise<void> {
  const res = await fetch(`/api/fanpages/${fanpageId}/posts/sync`, {
    method: "POST",
    headers: authHeaders(false),
  });
  if (!res.ok) return asError(res, "Không làm mới được.");
}

export async function listAdOrders(status?: AdOrderStatus): Promise<AdOrderList> {
  const res = await fetch(`/api/ad-orders${status ? `?status=${status}` : ""}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được đơn đặt quảng cáo.");
  return res.json();
}

export async function createAdOrder(
  fanpageId: string,
  postId: string,
  note: string,
): Promise<AdOrder & { message: string }> {
  const res = await fetch("/api/ad-orders", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ fanpageId, postId, note }),
  });
  if (!res.ok) return asError(res, "Không đặt được.");
  return res.json();
}

export async function patchAdOrder(id: string, patch: { status?: AdOrderStatus; note?: string }): Promise<AdOrder> {
  const res = await fetch(`/api/ad-orders/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return asError(res, "Không lưu được.");
  return res.json();
}

export async function getAdsRunner(): Promise<string | null> {
  const res = await fetch("/api/ad-orders/runner", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được người chạy quảng cáo.");
  return (await res.json()).runner ?? null;
}

export async function setAdsRunner(runner: string): Promise<string | null> {
  const res = await fetch("/api/ad-orders/runner", {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ runner }),
  });
  if (!res.ok) return asError(res, "Không đổi được người chạy quảng cáo.");
  return (await res.json()).runner ?? null;
}

export async function listAdsRunnerCandidates(): Promise<{ username: string; email: string | null }[]> {
  const res = await fetch("/api/ad-orders/candidates", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách người dùng.");
  return res.json();
}

// ===== Định dạng hiển thị =====

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "—";
  const cur = (currency || "VND").toUpperCase();
  try {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: cur === "VND" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("vi-VN")} ${cur}`;
  }
}

export function formatNumber(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("vi-VN");
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDay(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}
