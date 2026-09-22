import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Plus, Loader2, X, ExternalLink, AlertTriangle, Wand2, Sparkles } from "lucide-react";
import { listSignals, syncSignals, createManualSignal } from "../services/signals";
import type { Signal } from "../types";
import { AXES, type AxisKey } from "../../shared/engine-data";

const SOURCE_LABEL: Record<Signal["source"], string> = {
  market_radar: "Market Radar",
  group_insights: "Group Insights",
  manual: "Nhập tay",
  claude_research: "Claude tìm",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "Mới", cls: "" },
  queued: { label: "Nên làm", cls: "ds-badge-success" },
  idea_bank: { label: "Kho ý tưởng", cls: "ds-badge-warning" },
  rejected: { label: "Loại", cls: "ds-badge-danger" },
  scored: { label: "Đã chấm", cls: "" },
};

// Link "Đưa sang Sáng tạo": ưu tiên góc hài Claude gợi ý (scene + nhân vật +
// thoại); không có thì dùng tiêu đề + tóm tắt như cũ.
function buildStudioLink(s: Signal): string {
  const sug = s.suggestionJson;
  if (sug?.scene) {
    const params = new URLSearchParams({ scene: sug.scene });
    if (sug.characters?.length) params.set("chars", sug.characters.join(","));
    if (sug.dialogue?.length) params.set("dialogue", JSON.stringify(sug.dialogue));
    return `/studio?${params.toString()}`;
  }
  return `/studio?scene=${encodeURIComponent(`${s.title}. ${s.rawSummary}`)}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("vi-VN");
}

// Tín hiệu — bản gọn: chỉ còn danh sách ý tưởng thu thập được (tiêu đề, tóm
// tắt, nguồn, ngày) + thêm ý tưởng thủ công + quét tín hiệu mới. Đã bỏ hẳn
// phần chấm điểm/rubric để trang này dễ dùng, không cần biết thuật ngữ nội bộ.
export default function SignalsQueue() {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showManualForm, setShowManualForm] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setSignals(await listSignals());
    } catch (e: any) {
      setError(e?.message || "Lỗi tải danh sách tín hiệu.");
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Tín hiệu</h1>
          <p className="text-sm text-stone-500">Ý tưởng và sự kiện đang được nhắc tới gần đây — dùng để lên ý tưởng nội dung mới.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowManualForm(true)} className="ds-btn">
            <Plus className="w-4 h-4" aria-hidden="true" /> Thêm tín hiệu tay
          </button>
          <button onClick={handleSync} disabled={syncing} className="ds-btn ds-btn-primary">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
            Quét tín hiệu mới
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="ds-alert ds-alert-warning flex-col !items-stretch gap-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" className="ds-alert ds-alert-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="ds-card">
          <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
          </div>
        </div>
      ) : signals.length === 0 ? (
        <div className="ds-card">
          <div className="ds-empty">
            <div className="ds-empty-icon">
              <Sparkles className="w-8 h-8" aria-hidden="true" />
            </div>
            <p className="ds-empty-title">Chưa có tín hiệu nào</p>
            <p className="ds-empty-desc">Bấm "Quét tín hiệu mới" để tự động thu thập, hoặc thêm tín hiệu thủ công.</p>
            <button onClick={() => setShowManualForm(true)} className="ds-btn ds-btn-primary ds-btn-sm mt-1">
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Thêm tín hiệu tay
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {signals.map((s) => (
            <div key={s.id} className="ds-card">
            <div className="ds-card-body flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="ds-badge">{SOURCE_LABEL[s.source] || s.source}</span>
                {s.status && STATUS_META[s.status] && (
                  <span className={`ds-badge ${STATUS_META[s.status].cls}`}>
                    {STATUS_META[s.status].label}
                    {typeof s.scoreJson?.total === "number" ? ` · ${s.scoreJson.total}/20` : ""}
                  </span>
                )}
                {s.clusterLabel && (
                  <span className="ds-badge ds-badge-primary" title="Cụm chủ đề (Claude gom)">
                    🧩 {s.clusterLabel}
                  </span>
                )}
                {s.radar && <span className="text-[11px] text-stone-400">{s.radar}</span>}
                {s.truc && <span className="text-[11px] text-storm-600">{AXES[s.truc as AxisKey]?.label || s.truc}</span>}
              </div>
              <h3 className="text-sm font-semibold text-stone-800">{s.title}</h3>
              <p className="text-sm text-stone-500 mt-0.5">{s.rawSummary}</p>

              {/* Lý do chấm điểm (Claude) */}
              {s.scoreJson?.reasoning && (
                <p className="text-xs text-stone-500 bg-stone-50 border border-stone-100 rounded-lg px-2.5 py-1.5">
                  <span className="font-medium text-stone-600">Vì sao điểm này:</span> {s.scoreJson.reasoning}
                </p>
              )}

              {/* Góc hài Claude gợi ý */}
              {s.suggestionJson?.scene && (
                <div className="bg-storm-50 border border-storm-100 rounded-lg px-3 py-2 flex flex-col gap-1">
                  <p className="text-[11px] font-semibold text-storm-700 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Góc hài gợi ý
                  </p>
                  <p className="text-xs text-stone-700 leading-snug">{s.suggestionJson.scene}</p>
                  {!!s.suggestionJson.characters?.length && (
                    <p className="text-[11px] text-stone-500">Nhân vật: {s.suggestionJson.characters.join(", ")}</p>
                  )}
                  {!!s.suggestionJson.dialogue?.length && (
                    <div className="flex flex-col gap-0.5 mt-0.5">
                      {s.suggestionJson.dialogue.map((d, i) => (
                        <p key={i} className="text-[11px] text-stone-600">
                          <span className="font-medium text-storm-700">{d.character}:</span> "{d.text}"
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 mt-1">
                <div className="flex items-center gap-3 text-[11px] text-stone-400">
                  <span>{fmtDate(s.publishedDate)}</span>
                  {s.sourceUrl && (
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-storm-600 hover:underline">
                      Nguồn <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
                <button
                  onClick={() => navigate(buildStudioLink(s))}
                  className="ds-btn ds-btn-primary ds-btn-sm shrink-0"
                  title={s.suggestionJson?.scene ? "Mở Sáng tạo với góc hài + nhân vật + thoại điền sẵn" : "Mở trang Sáng tạo với mô tả bối cảnh điền sẵn từ tín hiệu này"}
                >
                  <Wand2 className="w-3.5 h-3.5" aria-hidden="true" /> Đưa sang Sáng tạo
                </button>
              </div>
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
    </div>
  );
}

function ManualSignalForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [rawSummary, setRawSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
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
      });
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Lưu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="manual-signal-title">
        <div className="ds-modal-header">
          <h3 id="manual-signal-title" className="ds-modal-title">
            Thêm tín hiệu thủ công
          </h3>
          <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <p className="text-xs text-stone-500">
            Dùng khi bạn biết trước 1 sự kiện/ý tưởng đáng làm nội dung nhưng hệ thống chưa tự quét được (vd sự cố hạ tầng, thay đổi chính sách thuế, lịch mùa vụ).
          </p>
          <div>
            <label className="ds-label" htmlFor="ms-title">Tiêu đề</label>
            <input id="ms-title" required value={title} onChange={(e) => setTitle(e.target.value)} className="ds-input" />
          </div>
          <div>
            <label className="ds-label" htmlFor="ms-summary">Tóm tắt</label>
            <textarea id="ms-summary" required rows={3} value={rawSummary} onChange={(e) => setRawSummary(e.target.value)} className="ds-textarea" />
          </div>
          <div>
            <label className="ds-label" htmlFor="ms-url">Link nguồn (tuỳ chọn)</label>
            <input id="ms-url" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className="ds-input" />
          </div>
          {error && <div className="ds-alert ds-alert-danger">{error}</div>}
          <button type="submit" disabled={saving} className="ds-btn ds-btn-primary justify-center mt-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu tín hiệu
          </button>
        </form>
      </div>
    </div>
  );
}
