// DỊCH client. Endpoints: server/routes/scripts.routes.ts (Step 5).
import { authHeaders, asError } from "./http";
import type { ScriptRow } from "../types";

export async function listScripts(signalId: string): Promise<ScriptRow[]> {
  const res = await fetch(`/api/scripts?signalId=${encodeURIComponent(signalId)}`, {
    headers: authHeaders(false),
  });
  if (!res.ok) return asError(res, "Không tải được kịch bản.");
  return res.json();
}

export async function getScript(id: string): Promise<ScriptRow> {
  const res = await fetch(`/api/scripts/${id}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được kịch bản.");
  return res.json();
}

// FR3.1/3.2 — sinh 3 phương án kịch bản theo prompt template mục 4.2. Server
// fallback sang template demo nếu thiếu SOCIAL_BACKEND_URL (ScriptRow.isDemo=true).
export async function generateScript(input: {
  signalId: string;
  truc: string;
  formatMeme: string;
}): Promise<ScriptRow> {
  const res = await fetch("/api/scripts/generate", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Sinh kịch bản thất bại.");
  return res.json();
}

// Tự viết kịch bản (freeform) — mô tả trực tiếp ý tưởng, không gắn tín hiệu.
export async function generateFreeformScript(input: {
  title: string;
  truc: string;
  formatMeme: string;
  description: string;
}): Promise<ScriptRow> {
  const res = await fetch("/api/scripts/freeform", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Sinh kịch bản tự viết thất bại.");
  return res.json();
}

// FR3.3 — chọn 1 trong 3 phương án.
export async function selectScriptVariant(id: string, variantIndex: number): Promise<ScriptRow> {
  const res = await fetch(`/api/scripts/${id}/select`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ variantIndex }),
  });
  if (!res.ok) return asError(res, "Chọn phương án thất bại.");
  return res.json();
}
