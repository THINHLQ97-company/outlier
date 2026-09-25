import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { authHeaders } from "../services/http";

// Trần chi phí ngày — quản trị viên đổi ngay trong app.
//
// Trước đây chỉ đổi được bằng biến môi trường, tức muốn nâng trần lúc đang cần
// thì phải triển khai lại cả ứng dụng. Chặn chi phí là đúng, nhưng chặn luôn cả
// đường nâng trần thì thành chặn nhầm chỗ: người đang cần quét gấp phải đi tìm
// người deploy.

interface BudgetInfo {
  runsLeft: number;
  resultsLeft: number;
  runCap: number;
  resultCap: number;
  ok: boolean;
  reason?: string;
}

export default function BudgetSettings() {
  const [info, setInfo] = useState<BudgetInfo | null>(null);
  const [runCap, setRunCap] = useState("");
  const [resultCap, setResultCap] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/budget", { headers: authHeaders(false) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Không đọc được hạn mức.");
      const d: BudgetInfo = await r.json();
      setInfo(d);
      setRunCap(String(d.runCap));
      setResultCap(String(d.resultCap));
    } catch (e: any) {
      setError(e?.message || "Không đọc được hạn mức.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch("/api/admin/budget", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ runCap: Number(runCap), resultCap: Number(resultCap) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Không lưu được.");
      setSaved(true);
      await load();
    } catch (e: any) {
      setError(e?.message || "Không lưu được hạn mức.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-stone-400 py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang đọc hạn mức...
      </div>
    );
  }

  return (
    <div className="ds-card">
      <div className="ds-card-body">
        <h3 className="ds-card-title flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-storm-500" aria-hidden="true" /> Trần chi phí mỗi ngày
        </h3>
        <p className="text-xs text-stone-500 mt-1">
          Hết trần là công cụ dừng mọi việc có tính phí cho tới hôm sau — không hỏi, không cho bấm tiếp. Nâng ở đây có
          hiệu lực ngay, không cần triển khai lại.
        </p>

        {info && !info.ok && (
          <div role="alert" className="ds-alert ds-alert-warning mt-2 !text-xs">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{info.reason}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div>
            <label className="ds-label" htmlFor="bg-runs">
              Số lượt quét / ngày
            </label>
            <input
              id="bg-runs"
              type="number"
              min={0}
              className="ds-input w-full"
              value={runCap}
              onChange={(e) => setRunCap(e.target.value)}
              disabled={saving}
            />
            <p className="text-[11px] text-stone-400 mt-1">Còn lại hôm nay: {info?.runsLeft ?? "—"}</p>
          </div>
          <div>
            <label className="ds-label" htmlFor="bg-results">
              Số bài lấy về / ngày
            </label>
            <input
              id="bg-results"
              type="number"
              min={0}
              className="ds-input w-full"
              value={resultCap}
              onChange={(e) => setResultCap(e.target.value)}
              disabled={saving}
            />
            <p className="text-[11px] text-stone-400 mt-1">
              Còn lại hôm nay: {info?.resultsLeft ?? "—"} · đây mới là thứ tính tiền (~0.0035 USD/bài)
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="ds-alert ds-alert-danger mt-3">
            {error}
          </div>
        )}
        {saved && !error && <p className="text-xs text-green-700 mt-2">Đã lưu, có hiệu lực ngay.</p>}

        <button type="button" onClick={save} disabled={saving} className="ds-btn ds-btn-primary mt-3">
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu trần mới
        </button>
      </div>
    </div>
  );
}
