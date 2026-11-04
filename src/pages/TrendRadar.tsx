import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Telescope, ExternalLink, Eye, Play, Send, KeyRound, AlertTriangle, X } from "lucide-react";
import { useAppContext } from "../AppContext";
import ConfirmDialog from "../components/ConfirmDialog";
import * as api from "../services/trend-workflow";
import type { TrendItem, TrendSettings, TrendStatus, TrendTargets, TrendCard } from "../services/trend-workflow";

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { hour12: false }) : "Chưa có");
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");
const msg = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);

function level(it: TrendItem): { label: string; cls: string; note?: string } {
  const b = it.brief;
  if (it.status === "excluded") return { label: "Đã bỏ qua", cls: "ds-badge-danger", note: b?.reason || it.error || "Nội dung nhạy cảm nên hệ thống không dùng." };
  if (it.status === "duplicate") return { label: "Đã bỏ qua", cls: "ds-badge", note: "Trùng với một trend đã dò trước đó." };
  if (b?.sensitive) return { label: "Nhạy cảm — cần duyệt kỹ", cls: "ds-badge-warning" };
  if (b?.confidence === "sourced") return { label: "Đu ngay", cls: "ds-badge-success" };
  return { label: "Chưa xác minh", cls: "ds-badge-info" };
}
function step(it: TrendItem): { label: string; cls: string } {
  if (it.status === "error") return { label: it.attempts >= 3 ? "Đã hết lượt thử" : `Chờ thử lại (${it.attempts ?? 0}/3 lần)`, cls: "ds-badge-danger" };
  if (it.status === "budget_exhausted") return { label: "Đã hết giới hạn sử dụng AI", cls: "ds-badge-warning" };
  if (it.status === "awaiting_research") return { label: "Chờ Claude nghiên cứu", cls: "ds-badge-info" };
  if (it.status === "pending") return { label: "Đang nghiên cứu", cls: "ds-badge-info" };
  if (it.status === "researched") return { label: "Đang viết bản nháp", cls: "ds-badge-info" };
  if (it.drafts.length) return { label: "Đã có bản nháp", cls: "ds-badge-success" };
  return { label: "Chỉ có tóm tắt", cls: "ds-badge" };
}

export default function TrendRadar() {
  const { isAdmin } = useAppContext();
  const [items, setItems] = useState<TrendItem[]>([]);
  const [status, setStatus] = useState<TrendStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState("");
  const [card, setCard] = useState<{ item: TrendItem; data?: TrendCard; err?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [resolve, setResolve] = useState<{ id: string; action: "resolved" | "resend" } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  async function load() {
    try {
      const [s, t] = await Promise.all([api.getStatus(), api.getTrends()]);
      setStatus(s); setItems(t.items); setError(null);
      return s;
    } catch (e) { setError(msg(e, "Không tải được dữ liệu.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);

  const days = useMemo(() => Array.from(new Set(items.map((i) => dayKey(i.createdAt)))), [items]);
  const shown = day ? items.filter((i) => dayKey(i.createdAt) === day) : items;
  const lastRun = status?.runs.find((r) => !r.dryRun) || status?.runs[0];
  const lastOutbox = status?.outbox[0];
  const s = status?.settings;

  async function openCard(item: TrendItem) {
    setCard({ item });
    try { setCard({ item, data: await api.getCard(item.id) }); }
    catch (e) { setCard({ item, err: msg(e, "Không tải được thẻ Teams.") }); }
  }

  async function dryRun() {
    setRunning(true); setRunMsg({ ok: true, text: "Đang bắt đầu lượt chạy thử..." });
    try {
      const { runId } = await api.runDry();
      if (!runId) throw new Error("Chưa nhận được mã lượt chạy; chưa biết kết quả. Hãy kiểm tra lại sau.");
      const started = Date.now();
      const poll = async () => {
        if (!mounted.current) return;
        if (Date.now() - started >= 25 * 60_000) {
          setRunning(false); setRunMsg({ ok: false, text: "Đã hết thời gian theo dõi, chưa biết kết quả lượt chạy. Hãy kiểm tra lại sau." }); return;
        }
        try {
          const run = await api.getRun(runId);
          if (!mounted.current) return;
          if (run.status === "pending" || run.status === "running") {
            setRunMsg({ ok: true, text: "Lượt chạy thử đang được xử lý. Chưa gửi gì lên Teams." });
            timer.current = setTimeout(poll, 5000); return;
          }
          setRunning(false);
          const text = run.status === "done" ? "Chạy thử xong. Bản nháp có thể đã được lưu thật; chưa gửi gì lên Teams." :
            run.status === "partial" ? "Chạy thử xong một phần: có trend chưa xử lý xong, gặp lỗi hoặc hết giới hạn sử dụng AI. Hãy xem danh sách bên dưới." :
            run.status === "error" ? `Lượt chạy thử gặp lỗi${run.error ? `: ${run.error}` : ". Hãy thử lại sau."}` : "Chưa biết kết quả lượt chạy. Hãy kiểm tra lại sau.";
          setRunMsg({ ok: run.status === "done", text });
          void load();
        } catch {
          if (mounted.current) { setRunning(false); setRunMsg({ ok: false, text: "Không tải được trạng thái lượt chạy, chưa biết kết quả. Hãy kiểm tra lại sau." }); }
        }
      };
      await poll();
    } catch (e) { if (mounted.current) { setRunMsg({ ok: false, text: msg(e, "Không chạy thử được.") }); setRunning(false); } }
  }

  async function resolveCard() {
    if (!resolve) return;
    setResolving(true); setResolveMsg(null);
    try {
      await api.resolveOutbox(resolve.id, resolve.action);
      setResolveMsg(resolve.action === "resolved" ? "Đã ghi nhận bạn đã kiểm tra thẻ." : "Đã yêu cầu gửi lại. Hãy kiểm tra kết quả trên Teams.");
      setResolve(null); await load();
    } catch (e) { setResolveMsg(msg(e, "Chưa xử lý được thẻ. Hãy thử lại.")); setResolve(null); }
    finally { setResolving(false); }
  }

  const head = !s ? null : !s.enabled ? "Đang tắt" : "Đang bật";
  const problem = lastRun?.status === "error" ? lastRun.error || "Lần dò gần nhất gặp lỗi." : null;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold font-display text-stone-800">Trend chủ động</h1>
          <p className="text-sm text-stone-500 mt-1">Hệ thống tự dò xu hướng mỗi 2 giờ (từ 8 giờ đến 22 giờ), tìm tin có nguồn và soạn sẵn bản nháp cho từng trang. Mọi bản nháp đều cần người duyệt.</p>
        </div>
        {isAdmin && (
          <button type="button" className="ds-btn" onClick={dryRun} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
            {running ? "Đang chạy thử..." : "Chạy thử ngay"}
          </button>
        )}
      </div>
      {isAdmin && <p className="text-xs text-stone-500 -mt-2">Chạy thử không gửi gì lên Teams, nhưng vẫn lưu bản nháp thật nếu bạn đã chọn trang đích.</p>}
      {runMsg && <div role={runMsg.ok ? "status" : "alert"} className={`ds-alert ${runMsg.ok ? "ds-alert-success" : "ds-alert-warning"}`}>{runMsg.text}</div>}
      {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-400 gap-2"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...</div>
      ) : (
        <>
          <section className="ds-card" aria-label="Tình trạng">
            <div className="ds-card-body grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-stone-500">Dò tự động</div><span className={`ds-badge ${s?.enabled ? "ds-badge-success" : ""}`}>{head || "Chưa rõ"}</span></div>
              <div><div className="text-xs text-stone-500">Lần dò gần nhất</div><div className="font-medium">{fmt(lastRun?.createdAt)}</div></div>
              <div><div className="text-xs text-stone-500">Lần dò tới</div><div className="font-medium">{s?.enabled ? "Theo lịch mỗi 2 giờ, từ 8 đến 22 giờ" : "Chưa bật nên chưa có lịch"}</div></div>
              <div><div className="text-xs text-stone-500">Gửi Teams</div><div className="font-medium">{teamsText(s, lastOutbox)}</div></div>
            </div>
            {(problem || (lastOutbox && (lastOutbox.status === "failed" || lastOutbox.status === "unknown"))) && (
              <div className="ds-card-footer flex flex-col gap-1.5">
                {problem && <div role="alert" className="ds-alert ds-alert-danger"><AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /><span>Lần dò gần nhất chưa thành công: {problem}</span></div>}
                {lastOutbox?.status === "failed" && <div role="alert" className="ds-alert ds-alert-warning">Thẻ gần nhất chưa gửi được lên Teams{lastOutbox.lastError ? `: ${lastOutbox.lastError}` : "."}</div>}
                {lastOutbox?.status === "unknown" && <div role="alert" className="ds-alert ds-alert-warning">Chưa rõ thẻ gần nhất đã lên Teams chưa. Hệ thống không tự gửi lại để tránh đăng trùng; hãy kiểm tra kênh Teams.</div>}
              </div>
            )}
          </section>

          {isAdmin && (status?.outbox.some((o) => o.status === "unknown") || resolveMsg) && <section className="ds-card" aria-label="Thẻ Teams cần kiểm tra"><div className="ds-card-body flex flex-col gap-3">
            <h2 className="ds-card-title">Thẻ Teams cần kiểm tra</h2>
            <p className="text-sm text-stone-600">Các thẻ dưới đây đã được gửi nhưng chưa rõ Teams có nhận không. Hệ thống không tự gửi lại để tránh trùng. Hãy kiểm tra kênh Teams trước khi xử lý.</p>
            {resolveMsg && <div role="status" className="ds-alert ds-alert-warning">{resolveMsg}</div>}
            {status?.outbox.filter((o) => o.status === "unknown").map((o) => <div key={o.id} className="border border-stone-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
              <span className="text-sm break-all flex-1">Mã lượt gửi: {o.id} · Đã thử {o.attempts} lần</span>
              <button type="button" className="ds-btn ds-btn-sm" disabled={resolving} onClick={() => setResolve({ id: o.id, action: "resolved" })}>Đã kiểm, Teams đã nhận</button>
              <button type="button" className="ds-btn ds-btn-sm" disabled={resolving} onClick={() => setResolve({ id: o.id, action: "resend" })}>Gửi lại</button>
            </div>)}
          </div></section>}
          <section aria-label="Danh sách trend" className="flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor="tr-day" className="text-sm font-medium text-stone-700">Lọc theo ngày</label>
              <select id="tr-day" className="ds-select" value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">Tất cả</option>
                {days.map((d) => <option key={d} value={d}>{new Date(d).toLocaleDateString("vi-VN")}</option>)}
              </select>
            </div>
            {shown.length === 0 ? (
              <div className="ds-card"><div className="ds-empty">
                <div className="ds-empty-icon"><Telescope className="w-8 h-8" aria-hidden="true" /></div>
                <p className="ds-empty-title">{items.length ? "Không có trend trong ngày này" : "Chưa dò lần nào"}</p>
                <p className="ds-empty-desc">{items.length ? "Chọn ngày khác hoặc chọn Tất cả." : s?.enabled ? "Hệ thống sẽ dò ở lần tới, kết quả hiện ở đây." : "Tính năng đang tắt. Quản trị viên bật ở phần cài đặt bên dưới."}</p>
              </div></div>
            ) : shown.map((it) => <TrendCardView key={it.id} it={it} onCard={() => openCard(it)} />)}
          </section>

          <Settings isAdmin={isAdmin} onSaved={load} />
        </>
      )}

      <ConfirmDialog isOpen={!!resolve} title={resolve?.action === "resend" ? "Gửi lại thẻ?" : "Xác nhận đã kiểm tra?"} message={resolve?.action === "resend" ? "Thẻ có thể đã được Teams nhận. Gửi lại có thể tạo thông báo trùng. Bạn đã kiểm tra và vẫn muốn gửi lại?" : "Bạn đã kiểm tra và xác nhận Teams đã nhận thẻ này?"} confirmText={resolve?.action === "resend" ? "Gửi lại" : "Đã kiểm tra"} onConfirm={resolveCard} onCancel={() => setResolve(null)} />
      {card && (
        <div className="ds-modal-overlay open" onClick={() => setCard(null)}>
          <div className="ds-modal" role="dialog" aria-modal="true" aria-labelledby="tr-card-title" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="ds-modal-header">
              <h3 id="tr-card-title" className="ds-modal-title">Xem trước thẻ Teams</h3>
              <button type="button" className="ds-modal-close" aria-label="Đóng" title="Đóng" onClick={() => setCard(null)}><X className="w-4 h-4" aria-hidden="true" /></button>
            </div>
            <div className="ds-modal-body flex flex-col gap-2 max-h-[70vh] overflow-y-auto">
              {!card.data && !card.err && <div className="flex items-center gap-2 text-stone-400"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang tạo thẻ...</div>}
              {card.err && <div role="alert" className="ds-alert ds-alert-danger">{card.err}</div>}
              {card.data && (() => {
                const c = card.data.payload.attachments?.[0]?.content;
                return (
                  <div className="border border-stone-200 rounded-lg p-3 bg-white flex flex-col gap-2 text-sm">
                    {(c?.body || []).map((b, i) => <p key={i} className={`whitespace-pre-wrap break-words ${i === 0 ? "font-bold" : ""}`}>{b.text}</p>)}
                    <div className="flex flex-wrap gap-2 pt-1">{(c?.actions || []).map((a, i) => <span key={i} className="ds-badge ds-badge-primary">{a.title}</span>)}</div>
                  </div>
                );
              })()}
              <p className="text-xs text-stone-500">Đây chỉ là bản mô phỏng gọn, thẻ thật trên Teams có thể trình bày hơi khác. Xem trước không gửi gì đi.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function teamsText(s?: TrendSettings, o?: TrendStatus["outbox"][number]): string {
  if (!s) return "Chưa rõ";
  if (!s.teamsEnabled) return "Đang tắt";
  if (!s.webhookConfigured) return "Chưa cấu hình URL Teams";
  if (!o) return "Chưa gửi thẻ nào";
  if (o.status === "accepted") return "Teams đã nhận (chưa xác nhận đã hiển thị)";
  if (o.status === "failed") return "Gửi chưa được";
  if (o.status === "unknown") return "Chưa rõ kết quả";
  return "Đang gửi";
}

function TrendCardView({ it, onCard }: { it: TrendItem; onCard: () => void }) {
  const b = it.brief; const lv = level(it); const st = step(it);
  return (
    <article className="ds-card"><div className="ds-card-body flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-stone-800 break-words">{b?.title || it.title}</h2>
          <p className="text-xs text-stone-500 mt-0.5">{fmt(it.createdAt)}{b?.traffic ? ` · Lượng tìm kiếm: ${b.traffic}` : ""}</p>
        </div>
        <div className="flex gap-1.5 flex-wrap"><span className={`ds-badge ${lv.cls}`}>{lv.label}</span><span className={`ds-badge ${st.cls}`}>{st.label}</span></div>
      </div>
      {b?.provider === "claude_mcp" && <span className="ds-badge ds-badge-info">Nghiên cứu bởi Claude</span>}
      {it.contentPath && <span className="ds-badge">{it.contentPath === "facebook_post" ? "Dựng từ bài Facebook" : "Dựng từ tóm tắt tin tức"}</span>}
      {it.facebookSourceUrl && <a className="text-sm text-storm-600 underline" href={it.facebookSourceUrl} target="_blank" rel="noreferrer">Mở bài Facebook gốc</a>}
      {it.facebookReason && <p className="text-xs text-stone-500">{it.facebookReason}</p>}
      {lv.note && <p className="text-xs text-stone-500">Lý do: {lv.note}</p>}
      {b?.summary && <div><div className="text-xs font-semibold text-stone-600">Chuyện gì đang xảy ra</div><p className="text-sm text-stone-700 mt-0.5 whitespace-pre-wrap">{b.summary}</p></div>}
      {b && b.sources.length > 0 && (
        <div><div className="text-xs font-semibold text-stone-600">Nguồn tin</div>
          <ul className="mt-0.5 flex flex-col gap-0.5">{b.sources.map((x, i) => (
            <li key={i}><a href={x.url} target="_blank" rel="noreferrer" className="text-xs text-storm-700 hover:underline inline-flex items-center gap-1 break-all">{x.title || x.url}<ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" /></a></li>
          ))}</ul></div>
      )}
      {it.error && <div role="alert" className="ds-alert ds-alert-danger">Không xử lý được trend này: {it.error}</div>}
      {it.drafts.length > 0 ? (
        <div className="flex flex-col gap-2">{it.drafts.map((d) => (
          <div key={d.remakeId} className="border border-stone-200 rounded-lg p-2.5 flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0"><div className="text-sm font-medium text-stone-800">{d.pageName}</div><div className="text-xs text-stone-500">Góc khai thác: {d.angle}</div>
              <span className={`ds-badge mt-1 ${d.status === "ready" ? "ds-badge-warning" : d.status === "error" ? "ds-badge-danger" : "ds-badge-info"}`}>{d.status === "ready" ? "Bản nháp tự động, cần duyệt" : d.status === "error" ? "Lỗi khi viết" : "Đang viết"}</span></div>
            <Link to={`/remakes?remakeId=${encodeURIComponent(d.remakeId)}`} className="ds-btn ds-btn-sm">Mở bản nháp</Link>
          </div>))}</div>
      ) : (b && it.status !== "excluded" && it.status !== "duplicate" && <p className="text-xs text-stone-500">Chỉ có tóm tắt: chưa chọn trang đích để soạn bản nháp.</p>)}
      {b && it.status !== "excluded" && <div><button type="button" className="ds-btn ds-btn-sm" onClick={onCard}><Eye className="w-3.5 h-3.5" aria-hidden="true" /> Xem trước thẻ Teams</button></div>}
    </div></article>
  );
}

const usagePresets = {
  economy: { label: "Tiết kiệm", description: "Tối đa 2 trend mỗi lần dò, lấy ít bài Facebook.", values: { maxTrends: 2, maxFacebookPostsPerTrend: 1, maxApifyPosts: 2, maxApifyPostsDaily: 6, maxModelCalls: 8, maxModelCallsDaily: 40, maxOutputTokens: 2048, modelTimeoutMs: 45000 } },
  medium: { label: "Vừa", description: "Tối đa 3 trend mỗi lần dò, phù hợp sử dụng hằng ngày.", values: { maxTrends: 3, maxFacebookPostsPerTrend: 1, maxApifyPosts: 3, maxApifyPostsDaily: 10, maxModelCalls: 12, maxModelCallsDaily: 60, maxOutputTokens: 2048, modelTimeoutMs: 45000 } },
  high: { label: "Nhiều", description: "Tối đa 5 trend mỗi lần dò, dùng nhiều tài nguyên hơn.", values: { maxTrends: 5, maxFacebookPostsPerTrend: 1, maxApifyPosts: 5, maxApifyPostsDaily: 20, maxModelCalls: 20, maxModelCallsDaily: 120, maxOutputTokens: 2048, modelTimeoutMs: 45000 } },
} as const;

type UsageKey = keyof typeof usagePresets;

function Settings({ isAdmin, onSaved }: { isAdmin: boolean; onSaved: () => void }) {
  const [cfg, setCfg] = useState<TrendSettings | null>(null);
  const [targets, setTargets] = useState<TrendTargets | null>(null);
  const [webhook, setWebhook] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [clearHook, setClearHook] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [confirmTest, setConfirmTest] = useState(false);
  const [testItem, setTestItem] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [items, setItems] = useState<TrendItem[]>([]);

  useEffect(() => {
    api.getSettings().then(setCfg).catch((e) => setErr(msg(e, "Không đọc được cài đặt.")));
    api.getTargets().then(setTargets).catch(() => {});
    api.getTrends().then((r) => { setItems(r.items.filter((i) => i.brief && i.status !== "excluded")); }).catch(() => {});
  }, []);
  if (!cfg) return err ? <div role="alert" className="ds-alert ds-alert-danger">{err}</div> : null;

  const set = <K extends keyof TrendSettings>(k: K, v: TrendSettings[K]) => setCfg({ ...cfg, [k]: v });
  const num = (id: string, label: string, k: "maxFacebookPostsPerTrend" | "maxApifyPosts" | "maxApifyPostsDaily" | "maxTrends" | "maxModelCalls" | "maxModelCallsDaily" | "maxOutputTokens" | "modelTimeoutMs", hint: string, min: number, max: number) => (
    <div><label className="ds-label" htmlFor={id}>{label}</label>
      <input id={id} type="number" min={min} max={max} step={1} className="ds-input w-full" value={cfg[k]} disabled={!isAdmin || saving} onChange={(e) => set(k, Number(e.target.value))} />
      <p className="text-[11px] text-stone-500 mt-0.5">{hint}</p></div>
  );
  const usage = (Object.keys(usagePresets) as UsageKey[]).find((key) => Object.entries(usagePresets[key].values).every(([k, v]) => cfg[k as keyof TrendSettings] === v));
  const picked = (id: string) => cfg.targets.some((t) => t.fanpageId === id);

  async function save() {
    if (!cfg) return;
    const limits = [[cfg.maxFacebookPostsPerTrend, 0, 1], [cfg.maxApifyPosts, 0, 10], [cfg.maxApifyPostsDaily, 0, 50], [cfg.maxTrends, 0, 10], [cfg.maxModelCalls, 0, 50], [cfg.maxModelCallsDaily, 0, 200], [cfg.maxOutputTokens, 0, 4096], [cfg.modelTimeoutMs, 1000, 90000]];
    if (limits.some(([v, min, max]) => !Number.isInteger(v) || v < min || v > max)) { setErr("Hãy nhập số nguyên trong giới hạn ghi bên dưới mỗi ô."); return; }
    setSaving(true); setErr(null); setOk(false);
    try {
      const body: Partial<TrendSettings> & { teamsWebhookUrl?: string } = {
        researchProvider: cfg.researchProvider, apifyEnabled: cfg.apifyEnabled, maxFacebookPostsPerTrend: cfg.maxFacebookPostsPerTrend, maxApifyPosts: cfg.maxApifyPosts, maxApifyPostsDaily: cfg.maxApifyPostsDaily,
        enabled: cfg.enabled, teamsEnabled: cfg.teamsEnabled, targets: cfg.targets, publicBaseUrl: cfg.publicBaseUrl || window.location.origin,
        maxTrends: cfg.maxTrends, maxModelCalls: cfg.maxModelCalls, maxModelCallsDaily: cfg.maxModelCallsDaily, maxOutputTokens: cfg.maxOutputTokens, modelTimeoutMs: cfg.modelTimeoutMs,
      };
      if (clearHook) body.teamsWebhookUrl = "";
      else if (webhook.trim()) body.teamsWebhookUrl = webhook.trim();
      setCfg(await api.saveSettings(body));
      setWebhook(""); setReplacing(false); setClearHook(false); setOk(true); onSaved();
    } catch (e) { setErr(msg(e, "Không lưu được cài đặt.")); }
    finally { setSaving(false); }
  }
  async function send() {
    setConfirmTest(false); setTesting(true); setTestMsg(null);
    try { const r = await api.sendTest(testItem, `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`); setTestMsg({ ok: true, text: r.message }); onSaved(); }
    catch (e) { setTestMsg({ ok: false, text: msg(e, "Chưa gửi thử được.") }); }
    finally { setTesting(false); }
  }

  return (
    <section className="ds-card" aria-label="Cài đặt"><div className="ds-card-body flex flex-col gap-4">
      <div>
        <h2 className="ds-card-title flex items-center gap-1.5"><KeyRound className="w-4 h-4 text-storm-500" aria-hidden="true" /> Cài đặt Trend chủ động</h2>
        {!isAdmin && <p className="text-xs text-stone-500 mt-1">Bạn chỉ xem được. Chỉ quản trị viên mới đổi được cài đặt.</p>}
      </div>
      {!cfg.keyConfigured && <div className="ds-alert ds-alert-warning">Máy chủ chưa có khoá để nghiên cứu tin tức, nên chưa dò được. Nhờ người quản lý hệ thống bổ sung.</div>}
      <div className="flex items-center gap-3">
        <input id="tr-enabled" type="checkbox" role="switch" className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-stone-300 transition-colors checked:bg-storm-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-storm-600 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-1 before:top-1 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-5" checked={cfg.enabled} disabled={!isAdmin || saving} onChange={(e) => set("enabled", e.target.checked)} />
        <label htmlFor="tr-enabled" className="ds-label !mb-0">Bật Trend chủ động</label>
      </div>
      <div>
        <div className="ds-label">Trang nhận bản nháp</div>
        {!targets ? <p className="text-xs text-stone-500">Chưa tải được danh sách trang.</p> : targets.fanpages.length === 0 ? <p className="text-xs text-stone-500">Chưa có trang nào. Thêm trang ở mục Thương hiệu.</p> : (
          <div className="flex flex-col gap-1">{targets.fanpages.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <input id={`tr-page-${p.id}`} type="checkbox" checked={picked(p.id)} disabled={!isAdmin || saving} onChange={(e) => set("targets", e.target.checked ? [...cfg.targets, { brandId: p.brandId, fanpageId: p.id }] : cfg.targets.filter((t) => t.fanpageId !== p.id))} />
              <label htmlFor={`tr-page-${p.id}`}>{p.pageName} <span className="text-xs text-stone-500">({targets.brands.find((b) => b.id === p.brandId)?.name || "Thương hiệu"})</span></label></div>))}</div>
        )}
        <p className="text-xs text-stone-500 mt-1">Chưa chọn trang thì chỉ tạo tóm tắt, không soạn bản nháp.</p>
      </div>
      <div className="flex items-center gap-3">
        <input id="tr-teams" type="checkbox" role="switch" className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-stone-300 transition-colors checked:bg-storm-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-storm-600 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-1 before:top-1 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-5" checked={cfg.teamsEnabled} disabled={!isAdmin || saving} onChange={(e) => set("teamsEnabled", e.target.checked)} />
        <label htmlFor="tr-teams" className="ds-label !mb-0">Gửi thẻ lên Teams</label>
      </div>
      {cfg.teamsEnabled &&       <div>
        <div className="ds-label">Đường dẫn gửi lên Teams</div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`ds-badge ${cfg.webhookConfigured && !clearHook ? "ds-badge-success" : ""}`}>{cfg.webhookConfigured && !clearHook ? "Đã cấu hình" : "Chưa cấu hình"}</span>
          {isAdmin && cfg.webhookConfigured && !clearHook && <>
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => setReplacing(true)}>Thay đường dẫn</button>
            <button type="button" className="ds-btn ds-btn-sm ds-btn-danger" onClick={() => { setClearHook(true); setReplacing(false); setWebhook(""); }}>Xoá</button></>}
          {clearHook && <span className="text-xs text-stone-500">Sẽ xoá khi bấm Lưu. <button type="button" className="underline" onClick={() => setClearHook(false)}>Hoàn tác</button></span>}
        </div>
        {isAdmin && (!cfg.webhookConfigured || replacing) && !clearHook && (
          <div className="mt-2"><label className="ds-label" htmlFor="tr-hook">Dán đường dẫn Teams Workflow</label>
            <input id="tr-hook" type="password" autoComplete="off" className="ds-input w-full" value={webhook} disabled={saving} onChange={(e) => setWebhook(e.target.value)} placeholder="https://..." /></div>
        )}
        <p className="text-xs text-stone-500 mt-1">Đường dẫn này ai có cũng đăng được vào kênh, đừng chia sẻ. Sau khi lưu sẽ không hiện lại được.</p>
      </div>}

      <div>
        <div className="flex items-center gap-3">
          <input id="tr-apify" type="checkbox" role="switch" className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-stone-300 transition-colors checked:bg-storm-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-storm-600 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-1 before:top-1 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-5" checked={cfg.apifyEnabled} disabled={!isAdmin || saving} onChange={(e) => set("apifyEnabled", e.target.checked)} />
          <label htmlFor="tr-apify" className="ds-label !mb-0">Lấy nội dung bài Facebook khi tìm thấy</label>
        </div>
        <p className="text-xs text-stone-500 mt-1">Tốn phí Apify; chỉ lấy đúng bài Claude tìm được.</p>
      </div>
      <fieldset disabled={!isAdmin || saving}>
        <legend className="ds-label">Mức sử dụng</legend>
        {!usage && <p className="text-sm text-stone-600 mb-2">Đang chọn: Tuỳ chỉnh</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(Object.keys(usagePresets) as UsageKey[]).map((key) => <label key={key} htmlFor={`tr-usage-${key}`} className={`cursor-pointer rounded-lg border p-3 text-sm ${usage === key ? "border-storm-600 bg-storm-50" : "border-stone-200"}`}>
            <span className="flex items-center gap-2 font-semibold"><input id={`tr-usage-${key}`} type="radio" name="tr-usage" checked={usage === key} onChange={() => setCfg({ ...cfg, ...usagePresets[key].values })} />{usagePresets[key].label}</span>
            <span className="block text-xs text-stone-500 mt-1">{usagePresets[key].description}</span>
          </label>)}
        </div>
      </fieldset>
      <details className="border border-stone-200 rounded-lg p-3">
        <summary className="cursor-pointer text-sm font-semibold text-stone-700">Nâng cao (ít khi cần đổi)</summary>
        <p className="text-xs text-stone-500 mt-2">Chỉnh giới hạn chi tiết tại đây nếu các mức trên chưa phù hợp.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {num("tr-fb1", "Số bài Facebook mỗi trend", "maxFacebookPostsPerTrend", "0 để tắt, tối đa 1 bài; không dùng Apify tìm bài.", 0, 1)}
        {num("tr-fb2", "Số bài Apify mỗi lượt", "maxApifyPosts", "Từ 0 đến 10, tính cả lượt lấy không thành công.", 0, 10)}
        {num("tr-fb3", "Số bài Apify mỗi ngày", "maxApifyPostsDaily", "Từ 0 đến 50; vẫn chịu trần Apify chung.", 0, 50)}
        {num("tr-n1", "Số trend mỗi lượt", "maxTrends", "Từ 0 đến 10.", 0, 10)}
        {num("tr-n2", "Số lần dùng AI mỗi lượt", "maxModelCalls", "Từ 0 đến 50, giúp giới hạn chi phí mỗi lượt.", 0, 50)}
        {num("tr-n3", "Số lần dùng AI mỗi ngày", "maxModelCallsDaily", "Từ 0 đến 200; hết số này hệ thống nghỉ tới hôm sau.", 0, 200)}
        {num("tr-n4", "Độ dài tối đa mỗi câu trả lời", "maxOutputTokens", "Từ 0 đến 4096; số lớn hơn thì tốn hơn.", 0, 4096)}
        {num("tr-timeout", "Thời gian chờ mỗi lần dùng AI (mili giây)", "modelTimeoutMs", "Từ 1.000 đến 90.000 mili giây.", 1000, 90000)}
      </div>

      </details>

      {err && <div role="alert" className="ds-alert ds-alert-danger">{err}</div>}
      {ok && <div role="status" className="ds-alert ds-alert-success">Đã lưu cài đặt.</div>}
      {isAdmin && (
        <div className="flex flex-col gap-3">
          <div className="border-t border-stone-200 pt-3">
            <label className="ds-label" htmlFor="tr-test">Gửi thử một thẻ lên Teams</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <select id="tr-test" className="ds-select flex-1 min-w-0" value={testItem} onChange={(e) => setTestItem(e.target.value)}>
                <option value="">Chọn trend để gửi thử</option>{items.map((i) => <option key={i.id} value={i.id}>{i.brief?.title || i.title}</option>)}</select>
              <button type="button" className="ds-btn" disabled={!testItem || testing || !cfg.webhookConfigured || !cfg.publicBaseUrl || !items.find((i) => i.id === testItem)?.drafts.some((d) => d.status === "ready")} onClick={() => setConfirmTest(true)}>
                {testing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />} Gửi thử lên Teams</button>
            </div>
            {!cfg.webhookConfigured && <p className="text-xs text-stone-500 mt-1">Cần lưu đường dẫn Teams trước.</p>}
            {!cfg.publicBaseUrl && <p className="text-xs text-stone-500 mt-1">Hãy lưu cài đặt để tạo đường dẫn mở bản nháp.</p>}
            {testItem && !items.find((i) => i.id === testItem)?.drafts.some((d) => d.status === "ready") && <p className="text-xs text-stone-500 mt-1">Trend chưa có bản nháp sẵn sàng. Hãy chọn trend khác hoặc chờ xử lý xong.</p>}
            {testMsg && <div role={testMsg.ok ? "status" : "alert"} className={`ds-alert mt-2 ${testMsg.ok ? "ds-alert-success" : "ds-alert-danger"}`}>{testMsg.text}</div>}
          </div>
          <div><button type="button" className="ds-btn ds-btn-primary" onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu cài đặt</button></div>
        </div>
      )}
      <ConfirmDialog isOpen={confirmTest} title="Gửi thử lên Teams?" message="Thẻ sẽ được đăng thật vào kênh Teams đã cấu hình và mọi người trong kênh đều thấy. Bạn chắc chắn muốn gửi?" confirmText="Gửi thử" onConfirm={send} onCancel={() => setConfirmTest(false)} />
    </div></section>
  );
}
