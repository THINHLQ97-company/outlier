// Tình trạng token Meta. Endpoints: server/routes/brands.routes.ts (/api/meta-tokens).
import { authHeaders, asError } from "./http";

export interface MetaTokenStatusRow {
  fanpageId: string;
  brandId: string;
  pageName: string | null;
  platform: string;
  status: "active" | "expiring" | "expired" | "invalid" | "unknown";
  neverExpires: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
  checkedAt: string | null;
  renewedAt: string | null;
  note: string | null;
}

// Đọc số liệu job nền đã ghi — KHÔNG gọi sang Meta, nên mở ra là có ngay.
export async function listMetaTokens(): Promise<{
  autoRenewEnabled: boolean;
  reason?: string;
  pages: MetaTokenStatusRow[];
}> {
  const res = await fetch("/api/meta-tokens", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không đọc được tình trạng token.");
  return res.json();
}

// Dò lại ngay (có gọi Meta) + gia hạn cái nào sắp hết.
export async function checkMetaTokens(): Promise<{
  ran: boolean;
  checked: number;
  renewed: number;
  needsAttention: { fanpageId: string; pageName: string | null; status: string; note?: string }[];
  skippedReason?: string;
}> {
  const res = await fetch("/api/meta-tokens/check", { method: "POST", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Dò token thất bại.");
  return res.json();
}
