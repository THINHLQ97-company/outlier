import { useEffect, useState } from "react";
import { RefreshCw, Plus, Loader2, X, Sparkles, ExternalLink, AlertTriangle } from "lucide-react";
import {
  listSignals,
  syncSignals,
  createManualSignal,
  suggestScore,
  scoreSignal,
  type ScoreInput,
} from "../services/signals";
import type { Signal, SignalStatus } from "../types";
import { AXES, RUBRIC_CRITERIA, type AxisKey } from "../../shared/engine-data";

const STATUS_LABEL: Record<SignalStatus, string> = {
  new: "Mới",
  scored: "Đã chấm",
  queued: "Hàng đợi sản xuất",
  idea_bank: "Kho ý tưởng",
  rejected: "Đã ẩn",
};

const STATUS_BADGE: Record<SignalStatus, string> = {
  new: "bg-stone-100 text-stone-600",
  scored: "bg-blue-50 text-blue-700",
  queued: "bg-green-50 text-green-700",
  idea_bank: "bg-amber-50 text-amber-700",
  rejected: "bg-red-50 text-red-600",
};

const SOURCE_LABEL: Record<Signal["source"], string> = {
  market_radar: "Market Radar",
  group_insights: "Group Insights",
  manual: "Nhập tay",
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("vi-VN");
}

export default function SignalsQueue() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<SignalStatus | "all">("all");
  const [showManualForm, setShowManualForm] = useState(false);
  const [scoringSignal, setScoringSignal] = useState<Signal | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setSignals(await listSignals());
    } catch (e: any) {
      setError(e?.message || "Lỗi tải tín hiệu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    setWarnings([]);
    try {
      const result = await syncSignals();
      setWarnings(result.warnings || []);
      await reload();
    } catch (e: any) {
      setError(e?.message || "Quét tín hiệu thất bại.");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = statusFilter === "all" ? signals : signals.filter((s) => s.status === statusFilter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Hàng đợi tín hiệu</h1>
          <p className="text-sm text-stone-500">
            THU (Market Radar + Group Insights, 14 ngày gần nhất) → LỌC (rubric 5 tiêu chí, ngưỡng 16/12).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowManualForm(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Thêm tín hiệu thủ công
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
            Quét tín hiệu mới
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex flex-col gap-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        {(["all", "new", "scored", "queued", "idea_bank", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              statusFilter === s ? "bg-storm-700 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            {s === "all" ? "Tất cả" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-400 text-sm">
          Chưa có tín hiệu nào. Bấm "Quét tín hiệu mới" hoặc thêm thủ công.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((s) => (
            <div key={s.id} className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[11px] font-medium bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
                      {SOURCE_LABEL[s.source]}
                    </span>
                    {s.radar && <span className="text-[11px] text-stone-400">{s.radar}</span>}
                    {s.truc && <span className="text-[11px] text-storm-600">{AXES[s.truc as AxisKey]?.label || s.truc}</span>}
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${STATUS_BADGE[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-stone-800">{s.title}</h3>
                  <p className="text-sm text-stone-500 mt-0.5 line-clamp-2">{s.rawSummary}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-stone-400">
                    <span>{fmtDate(s.publishedDate)}</span>
                    {typeof s.scoreJson?.total === "number" && (
                      <span className="font-medium text-stone-600">Điểm: {s.scoreJson.total}/20</span>
                    )}
                    {s.sourceUrl && (
                      <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-storm-600 hover:underline">
                        Nguồn <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setScoringSignal(s)}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Chấm điểm
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showManualForm && (
        <ManualSignalForm
          onClose={() => setShowManualForm(false)}
          onCreated={() => {
            setShowManualForm(false);
            reload();
          }}
        />
      )}

      {scoringSignal && (
        <ScoreModal
          signal={scoringSignal}
          onClose={() => setScoringSignal(null)}
          onScored={() => {
            setScoringSignal(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ManualSignalForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [rawSummary, setRawSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [truc, setTruc] = useState<AxisKey | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createManualSignal({
        title,
        rawSummary,
        sourceUrl: sourceUrl || undefined,
        truc: truc || undefined,
      });
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Lưu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="font-semibold text-stone-800">Thêm tín hiệu thủ công (FR1.3)</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3">
          <p className="text-xs text-stone-500">
            Dùng cho sự cố hạ tầng toàn cầu / thay đổi chính sách thuế / lịch mùa vụ — chưa có nguồn tự động (FR1.3).
          </p>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ms-title">Tiêu đề</label>
            <input id="ms-title" required value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ms-summary">Tóm tắt</label>
            <textarea id="ms-summary" required rows={3} value={rawSummary} onChange={(e) => setRawSummary(e.target.value)} className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ms-url">Link nguồn (tuỳ chọn)</label>
            <input id="ms-url" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ms-truc">Trục (tuỳ chọn)</label>
            <select id="ms-truc" value={truc} onChange={(e) => setTruc(e.target.value as AxisKey | "")} className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm">
              <option value="">— Chưa gán —</option>
              {(Object.keys(AXES) as AxisKey[]).map((k) => (
                <option key={k} value={k}>{AXES[k].label}</option>
              ))}
            </select>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <button type="submit" disabled={saving} className="mt-2 flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu tín hiệu
          </button>
        </form>
      </div>
    </div>
  );
}

function ScoreModal({ signal, onClose, onScored }: { signal: Signal; onClose: () => void; onScored: () => void }) {
  const [scores, setScores] = useState<ScoreInput>({
    do_nong: signal.scoreJson?.do_nong ?? 3,
    do_cham: signal.scoreJson?.do_cham ?? 3,
    do_hop_truc: signal.scoreJson?.do_hop_truc ?? 3,
    tuoi_tho: signal.scoreJson?.tuoi_tho ?? 3,
    do_an_toan: signal.scoreJson?.do_an_toan ?? 5,
    dinh_nhom_cam: signal.scoreJson?.dinh_nhom_cam ?? false,
  });
  const [rationale, setRationale] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setSuggesting(true);
    setError(null);
    try {
      const s = await suggestScore(signal.id);
      setScores({
        do_nong: s.do_nong,
        do_cham: s.do_cham,
        do_hop_truc: s.do_hop_truc,
        tuoi_tho: s.tuoi_tho,
        do_an_toan: s.do_an_toan,
        dinh_nhom_cam: s.dinh_nhom_cam,
      });
      setRationale(s.rationale);
    } catch (e: any) {
      setError(e?.message || "Không gợi ý được điểm.");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await scoreSignal(signal.id, scores);
      onScored();
    } catch (e: any) {
      setError(e?.message || "Chấm điểm thất bại.");
    } finally {
      setSaving(false);
    }
  }

  const total = scores.do_nong + scores.do_cham + scores.do_hop_truc + scores.tuoi_tho;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <div>
            <h3 className="font-semibold text-stone-800">Chấm điểm LỌC</h3>
            <p className="text-xs text-stone-500 line-clamp-1">{signal.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-4">
          <button
            onClick={handleSuggest}
            disabled={suggesting}
            className="self-start flex items-center gap-1.5 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-1.5 rounded-lg disabled:opacity-60"
          >
            {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
            Gợi ý điểm (rule-based)
          </button>
          {rationale && <p className="text-xs text-stone-500 bg-stone-50 rounded-lg p-2">{rationale}</p>}

          {RUBRIC_CRITERIA.filter((c) => c.key !== "do_an_toan").map((c) => (
            <div key={c.key}>
              <label className="flex items-center justify-between text-xs font-medium text-stone-600 mb-1">
                <span>{c.label} — <span className="font-normal text-stone-400">{c.question}</span></span>
                <span className="text-storm-700 font-semibold">{(scores as any)[c.key]}</span>
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={(scores as any)[c.key]}
                onChange={(e) => setScores((prev) => ({ ...prev, [c.key]: Number(e.target.value) }))}
                className="w-full accent-storm-600"
              />
            </div>
          ))}

          <label className="flex items-center gap-2 text-sm text-stone-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              checked={scores.dinh_nhom_cam}
              onChange={(e) => setScores((prev) => ({ ...prev, dinh_nhom_cam: e.target.checked }))}
              className="accent-red-600"
            />
            Dính nhóm ⛔ (chính trị/tôn giáo/thiên tai/tai nạn/người nổi tiếng bị chỉ trích) — loại thẳng bất kể điểm khác
          </label>

          <div className="flex items-center justify-between bg-stone-50 rounded-lg px-3 py-2 text-sm">
            <span className="text-stone-500">Tổng điểm (4 tiêu chí cộng dồn)</span>
            <span className="font-bold text-stone-800">{total}/20</span>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Chốt điểm
          </button>
        </div>
      </div>
    </div>
  );
}
