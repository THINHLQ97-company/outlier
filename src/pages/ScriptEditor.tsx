import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles, Check, AlertTriangle } from "lucide-react";
import { listSignals } from "../services/signals";
import { generateScript, selectScriptVariant } from "../services/scripts";
import type { Signal, ScriptRow } from "../types";
import { AXES, FORMATS, type AxisKey } from "../../shared/engine-data";

// DỊCH (J2): chọn 1 tín hiệu đã vào hàng đợi sản xuất → chọn trục + format
// meme → sinh 3 phương án → chọn 1 → sang VẼ (Image Studio).
export default function ScriptEditor() {
  const navigate = useNavigate();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [truc, setTruc] = useState<AxisKey>("ai");
  const [formatMeme, setFormatMeme] = useState("F1");
  const [generating, setGenerating] = useState(false);
  const [script, setScript] = useState<ScriptRow | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    listSignals("queued")
      .then(setSignals)
      .catch((e) => setError(e?.message || "Lỗi tải tín hiệu."))
      .finally(() => setLoading(false));
  }, []);

  function handlePickSignal(s: Signal) {
    setSelectedSignal(s);
    setScript(null);
    setWarning(null);
    if (s.truc && AXES[s.truc as AxisKey]) setTruc(s.truc as AxisKey);
  }

  async function handleGenerate() {
    if (!selectedSignal) return;
    setGenerating(true);
    setError(null);
    setWarning(null);
    try {
      const result: any = await generateScript({ signalId: selectedSignal.id, truc, formatMeme });
      setScript(result);
      if (result.warning) setWarning(result.warning);
    } catch (e: any) {
      setError(e?.message || "Sinh kịch bản thất bại.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelectVariant(idx: number) {
    if (!script) return;
    setSelecting(true);
    setError(null);
    try {
      const updated = await selectScriptVariant(script.id, idx);
      setScript(updated);
    } catch (e: any) {
      setError(e?.message || "Chọn phương án thất bại.");
    } finally {
      setSelecting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <div>
        <h2 className="text-sm font-semibold text-stone-700 mb-2">Tín hiệu trong hàng đợi sản xuất</h2>
        {loading ? (
          <div className="flex items-center gap-2 text-stone-400 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang tải...
          </div>
        ) : signals.length === 0 ? (
          <p className="text-sm text-stone-400">
            Chưa có tín hiệu nào ≥16 điểm. Sang màn "Tín hiệu" để chấm điểm trước.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {signals.map((s) => (
              <button
                key={s.id}
                onClick={() => handlePickSignal(s)}
                className={`text-left p-3 rounded-lg border text-sm transition-colors ${
                  selectedSignal?.id === s.id
                    ? "border-storm-500 bg-storm-50"
                    : "border-stone-200 bg-white hover:border-storm-300"
                }`}
              >
                <div className="font-medium text-stone-800 line-clamp-2">{s.title}</div>
                <div className="text-[11px] text-stone-400 mt-1">Điểm: {s.scoreJson?.total ?? "—"}/20</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        {!selectedSignal ? (
          <div className="text-center py-16 text-stone-400 text-sm">Chọn 1 tín hiệu bên trái để bắt đầu.</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="bg-white border border-stone-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-stone-800 mb-1">{selectedSignal.title}</h3>
              <p className="text-sm text-stone-500 mb-3">{selectedSignal.rawSummary}</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="se-truc">Trục</label>
                  <select id="se-truc" value={truc} onChange={(e) => setTruc(e.target.value as AxisKey)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
                    {(Object.keys(AXES) as AxisKey[]).map((k) => (
                      <option key={k} value={k}>{AXES[k].label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="se-format">Format meme</label>
                  <select id="se-format" value={formatMeme} onChange={(e) => setFormatMeme(e.target.value)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm">
                    {FORMATS.map((f) => (
                      <option key={f.code} value={f.code}>{f.code} · {f.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-4 py-2 rounded-lg disabled:opacity-60"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
                  Sinh 3 phương án
                </button>
              </div>
            </div>

            {warning && (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{warning}</span>
              </div>
            )}
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

            {script && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {script.contentJson.map((variant, idx) => {
                  const isSelected = script.selectedVariant === idx;
                  return (
                    <div
                      key={idx}
                      className={`bg-white border rounded-xl p-4 flex flex-col gap-2 ${
                        isSelected ? "border-storm-500 ring-2 ring-storm-200" : "border-stone-200"
                      }`}
                    >
                      <span className="text-[11px] font-medium text-storm-600 bg-storm-50 self-start px-1.5 py-0.5 rounded">
                        {variant.formatMeme}
                      </span>
                      <ul className="text-sm text-stone-700 list-disc list-inside">
                        {variant.panels.map((p, i) => (
                          <li key={i}>{p}</li>
                        ))}
                      </ul>
                      <p className="text-sm text-stone-500 italic">"{variant.caption}"</p>
                      {variant.ctaSoft && <p className="text-xs text-storm-600">CTA: {variant.ctaSoft}</p>}
                      <button
                        onClick={() => handleSelectVariant(idx)}
                        disabled={selecting}
                        className={`mt-auto flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg py-2 transition-colors disabled:opacity-60 ${
                          isSelected ? "bg-storm-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5" aria-hidden="true" />} {isSelected ? "Đã chọn" : "Chọn phương án này"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {script && script.selectedVariant !== null && script.selectedVariant !== undefined && (
              <button
                onClick={() => navigate(`/image-studio?scriptId=${script.id}`)}
                className="self-start flex items-center gap-1.5 text-sm font-medium text-white bg-storm-700 hover:bg-storm-800 px-4 py-2.5 rounded-lg"
              >
                Tiếp tục sang VẼ →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
