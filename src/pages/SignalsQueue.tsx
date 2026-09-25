import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deconstructFromTrend } from "../services/deconstruct";
import { RefreshCw, Plus, Loader2, X, ExternalLink, AlertTriangle, Wand2, Sparkles, TrendingUp, Trash2, Eraser, Scissors } from "lucide-react";
import { listSignals, syncSignals, createManualSignal, scanGoogleTrends, deleteSignal, purgeSignals } from "../services/signals";
import type { Signal } from "../types";
import { AXES, type AxisKey } from "../../shared/engine-data";
import GoogleTrendsMark from "../components/GoogleTrendsMark";
import TrendNewsList, { parseLegacySummary } from "../components/TrendNewsList";

const SOURCE_LABEL: Record<Signal["source"], string> = {
  market_radar: "Market Radar",
  group_insights: "Group Insights",
  manual: "Nhập tay",
  claude_research: "Claude tìm",
  // Nguồn này có nhãn riêng kèm dấu nhận diện, chuỗi ở đây chỉ dùng khi cần tên trần.
  google_trends: "Google Trends",
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

/** Đọc lượt tìm kiếm của một mục, 0 nếu nguồn không có con số này. */
function trafficOf(s: Signal): number {
  const raw = s.sourceMetaJson?.approxTraffic || parseLegacySummary(s.rawSummary)?.approxTraffic;
  if (!raw) return 0;
  const m = /([\d.,]+)\s*([KMBN])?/i.exec(raw.replace(/\s/g, ""));
  if (!m) return 0;
  const suffix = (m[2] || "").toUpperCase();
  const n = Number(suffix ? m[1].replace(/,/g, ".") : m[1].replace(/[,.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return n * ({ K: 1e3, N: 1e3, M: 1e6, B: 1e9 }[suffix] || 1);
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
  // Trend đi qua bóc cấu trúc như mọi nguồn khác: có công thức xem lại được, và
  // qua được chỗ điều hướng nội dung ở bước viết.
  const [trendBusyId, setTrendBusyId] = useState<string | null>(null);

  async function handleTrendToRemake(s: { id: string; title: string; rawSummary?: string | null; sourceUrl?: string | null }) {
    setTrendBusyId(s.id);
    try {
      const out = await deconstructFromTrend({
        title: s.title,
        summary: s.rawSummary || undefined,
        sourceUrl: s.sourceUrl || undefined,
      });
      navigate(`/deconstruct?id=${out.id}`);
    } catch (e: any) {
      window.alert(e?.message || "Không lên góc được từ xu hướng này.");
    } finally {
      setTrendBusyId(null);
    }
  }
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [scanningTrends, setScanningTrends] = useState(false);
  // Mặc định theo độ nóng: người dùng vào đây để tìm cái đang được quan tâm
  // nhất, không phải để xem cái nào vừa quét về.
  const [sortBy, setSortBy] = useState<"hot" | "new">("hot");
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

  async function handleGoogleTrends() {
    setScanningTrends(true);
    setError(null);
    setWarnings([]);
    try {
      const r = await scanGoogleTrends("VN", 20);
      // Nói rõ cả phần bỏ qua: quét mỗi ngày sẽ gặp lại từ khoá cũ, thấy
      // "thêm 0" mà không giải thích thì dễ tưởng hỏng.
      setWarnings([
        `Google Trends: tìm thấy ${r.found}, thêm mới ${r.inserted}` +
          (r.upgraded ? `, làm mới ${r.upgraded} mục cũ` : "") +
          (r.skipped ? `, bỏ qua ${r.skipped} từ khoá đã có` : "") +
          `. ${r.note}`,
      ]);
      await reload();
    } catch (e: any) {
      setError(e?.message || "Không quét được Google Trends.");
    } finally {
      setScanningTrends(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteSignal(id);
      setSignals((prev) => prev.filter((x) => x.id !== id));
    } catch (e: any) {
      setError(e?.message || "Không xoá được.");
    }
  }

  async function handlePurgeDemo() {
    if (!confirm("Xoá toàn bộ dữ liệu mẫu (Market Radar, Group Insights)? Xu hướng thật vẫn giữ nguyên.")) return;
    try {
      const r = await purgeSignals(["market_radar", "group_insights"]);
      setWarnings([`Đã xoá ${r.deleted} mục dữ liệu mẫu.`]);
      await reload();
    } catch (e: any) {
      setError(e?.message || "Không dọn được.");
    }
  }

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

  // Dữ liệu mẫu đến từ hai nguồn MCP nội bộ đang tắt — nếu còn thì chúng chỉ là
  // rác làm rối danh sách.
  const hasDemoData = signals.some((s) => s.source === "market_radar" || s.source === "group_insights");

  // Sắp lại ngay trước khi hiển thị. Sắp lúc quét là vô nghĩa vì danh sách đọc
  // từ cơ sở dữ liệu theo thứ tự khác.
  const sorted = [...signals].sort((a, b) => {
    if (sortBy === "hot") {
      const d = trafficOf(b) - trafficOf(a);
      if (d !== 0) return d;
    }
    return new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime();
  });
  const hasTraffic = signals.some((s) => trafficOf(s) > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Xu hướng</h1>
          <p className="text-sm text-stone-500">
            Chuyện đang nóng ngoài thị trường: tin báo chí, trend, drama — nguồn để bắt trend. Khác{" "}
            <strong>Bài hay đã quét</strong> (bài thật của kênh khác, để học cách triển khai).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasTraffic && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-stone-400">Sắp theo</span>
              {([
                ["hot", "Độ nóng"],
                ["new", "Mới nhất"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSortBy(k)}
                  aria-pressed={sortBy === k}
                  className={`ds-badge ${sortBy === k ? "ds-badge-info" : "hover:bg-stone-100"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {hasDemoData && (
            <button type="button" onClick={handlePurgeDemo} className="ds-btn ds-btn-ghost" title="Xoá dữ liệu mẫu còn sót">
              <Eraser className="w-4 h-4" aria-hidden="true" /> Dọn dữ liệu mẫu
            </button>
          )}
          <button onClick={() => setShowManualForm(true)} className="ds-btn">
            <Plus className="w-4 h-4" aria-hidden="true" /> Thêm xu hướng tay
          </button>
          <button type="button" onClick={handleGoogleTrends} disabled={scanningTrends} className="ds-btn">
            {scanningTrends ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <TrendingUp className="w-4 h-4" aria-hidden="true" />
            )}
            Quét Google Trends
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
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Thêm xu hướng tay
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((s) => (
            <div key={s.id} className="ds-card">
            <div className="ds-card-body flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {s.source === "google_trends" ? (
                  <span className="ds-badge inline-flex items-center gap-1">
                    <GoogleTrendsMark className="w-3 h-3" /> Google Trends
                  </span>
                ) : (
                  <span className="ds-badge">{SOURCE_LABEL[s.source] || s.source}</span>
                )}
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
                {s.radar && s.source !== "google_trends" && (
                  <span className="text-[11px] text-stone-400">{s.radar}</span>
                )}
                {s.truc && <span className="text-[11px] text-storm-600">{AXES[s.truc as AxisKey]?.label || s.truc}</span>}
              </div>
              <h3 className="text-sm font-semibold text-stone-800">{s.title}</h3>
              {/* Nguồn có dữ liệu cấu trúc thì dựng riêng; còn lại vẫn là một
                  đoạn chữ như cũ. */}
              {(() => {
                // Mục cũ chưa có dữ liệu cấu trúc thì đọc ngược từ phần tóm tắt,
                // để không phải chờ quét lại mới thấy giao diện mới.
                const meta = s.sourceMetaJson || (s.source === "google_trends" ? parseLegacySummary(s.rawSummary) : null);
                return meta ? (
                  <TrendNewsList
                    meta={meta}
                    scannedAt={new Date(s.createdAt).toLocaleString("vi-VN", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  />
                ) : (
                  <p className="text-sm text-stone-500 mt-0.5">{s.rawSummary}</p>
                );
              })()}

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
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    className="text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors"
                    title="Xoá xu hướng này"
                    aria-label="Xoá xu hướng này"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => navigate(buildStudioLink(s))}
                    className="ds-btn ds-btn-primary ds-btn-sm"
                    title={s.suggestionJson?.scene ? "Mở Sáng tạo với góc hài + nhân vật + thoại điền sẵn" : "Mở trang Sáng tạo với mô tả bối cảnh điền sẵn từ tín hiệu này"}
                  >
                    <Wand2 className="w-3.5 h-3.5" aria-hidden="true" /> Đưa sang Sáng tạo
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTrendToRemake(s)}
                    disabled={trendBusyId === s.id}
                    className="ds-btn ds-btn-primary ds-btn-sm"
                    title="Lên góc tiếp cận từ trend này rồi sang viết bài cho thương hiệu — đi qua bước bóc cấu trúc như mọi nguồn khác"
                  >
                    {trendBusyId === s.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Scissors className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    Bóc góc & viết bài
                  </button>
                </div>
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
