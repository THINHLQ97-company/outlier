// THU + LỌC client. Endpoints: server/routes/signals.routes.ts (Step 4).
import { authHeaders, asError } from "./http";
import type { Signal, SignalStatus, RubricVersion } from "../types";

export async function listSignals(status?: SignalStatus): Promise<Signal[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`/api/signals${qs}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách tín hiệu.");
  return res.json();
}

export interface CreateSignalInput {
  title: string;
  rawSummary: string;
  sourceUrl?: string;
  truc?: string;
  publishedDate?: string;
}

// FR1.3 — form nhập tay (sự cố hạ tầng toàn cầu / lịch mùa vụ / P0 thủ công).
export async function createManualSignal(input: CreateSignalInput): Promise<Signal> {
  const res = await fetch("/api/signals", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Không lưu được tín hiệu.");
  return res.json();
}

// FR1.1 — trigger THU (Market Radar + Group Insights MCP). Server fallback
// sang demo data nếu thiếu token, kèm cảnh báo trong response.
export async function syncSignals(): Promise<{ inserted: number; warnings: string[] }> {
  const res = await fetch("/api/signals/sync", { method: "POST", headers: authHeaders() });
  if (!res.ok) return asError(res, "Quét tín hiệu thất bại.");
  return res.json();
}

export interface SuggestedScore {
  do_nong: number;
  do_cham: number;
  do_hop_truc: number;
  tuoi_tho: number;
  do_an_toan: number;
  dinh_nhom_cam: boolean;
  rationale: string;
}

// FR2.3 — gợi ý điểm rule-based, KHÔNG lưu (người vận hành sửa tay trước khi chốt).
export async function suggestScore(signalId: string): Promise<SuggestedScore> {
  const res = await fetch(`/api/signals/${signalId}/suggest-score`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không gợi ý được điểm.");
  return res.json();
}

export interface ScoreInput {
  do_nong: number;
  do_cham: number;
  do_hop_truc: number;
  tuoi_tho: number;
  do_an_toan: number;
  dinh_nhom_cam: boolean;
}

// FR2.1/2.2 — chốt điểm, server tự route status theo ngưỡng rubric active.
export async function scoreSignal(signalId: string, input: ScoreInput): Promise<Signal> {
  const res = await fetch(`/api/signals/${signalId}/score`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Chấm điểm thất bại.");
  return res.json();
}

// FR2.4 — rubric hiện hành (version + lịch sử).
export async function getActiveRubric(): Promise<RubricVersion> {
  const res = await fetch("/api/rubric", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được rubric.");
  return res.json();
}

export async function updateRubric(input: {
  weightsJson: Record<string, number>;
  thresholdsJson: Record<string, number>;
  note?: string;
}): Promise<RubricVersion> {
  const res = await fetch("/api/rubric", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Cập nhật rubric thất bại.");
  return res.json();
}

export interface GoogleTrendsScanResult {
  geo: string;
  found: number;
  inserted: number;
  skipped: number;
  note: string;
}

/** Quét Google Trends — miễn phí, không cần key. */
export async function scanGoogleTrends(geo = "VN", limit = 20): Promise<GoogleTrendsScanResult> {
  const res = await fetch("/api/signals/google-trends", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ geo, limit }),
  });
  if (!res.ok) return asError(res, "Không quét được Google Trends.");
  return res.json();
}

export async function deleteSignal(id: string): Promise<void> {
  const res = await fetch(`/api/signals/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không xoá được.");
}

/** Dọn hàng loạt theo nguồn — dùng để bỏ dữ liệu mẫu còn sót lại. */
export async function purgeSignals(sources: string[]): Promise<{ deleted: number }> {
  const res = await fetch("/api/signals/purge", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ sources }),
  });
  if (!res.ok) return asError(res, "Không dọn được.");
  return res.json();
}
