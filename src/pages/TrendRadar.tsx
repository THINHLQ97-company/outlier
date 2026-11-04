import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Telescope, Play, Send, X, Settings as SettingsIcon } from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog";
import DateRangeFilter, { inDateRange, rangeDescription } from "../components/trend/DateRangeFilter";
import type { DateRange } from "../components/trend/DateRangeFilter";
import TrendCardView, { isTargetError, trendGroup } from "../components/trend/TrendCardView";
import type { TrendGroup } from "../components/trend/TrendCardView";
import * as I from "../components/trend/TrendIcons";
import * as api from "../services/trend-workflow";
import type { TrendItem, TrendSettings, TrendStatus, TrendTargets, TrendCard } from "../services/trend-workflow";

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) : "Chưa có");
const msg = (e: unknown, f: string) => (e instanceof Error && e.message ? e.message : f);

export default function TrendRadar({ settingsPage = false }: { settingsPage?: boolean }) {
  const [searchParams] = useSearchParams();
  const linkedId = searchParams.get("item");
  const [items, setItems] = useState<TrendItem[]>([]);
  const [trashItems, setTrashItems] = useState<TrendItem[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [trash, setTrash] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState<string[] | null>(null);
  const [undo, setUndo] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<TrendStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ preset: "7", from: "", to: "" });
  const [group, setGroup] = useState<TrendGroup | "all">("all");
  const [card, setCard] = useState<{ item: TrendItem; data?: TrendCard; err?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [resolve, setResolve] = useState<{ id: string; action: "resolved" | "resend" } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  const [targetList, setTargetList] = useState<TrendTargets | null>(null);
  useEffect(() => { api.getTargets().then(setTargetList).catch(() => {}); }, []);
  async function load() {
    try {
      const [s, t] = await Promise.all([api.getStatus(), api.getTrends()]);
      setStatus(s); setItems(t.items); setTrashCount(t.trashTotal || 0); setError(null);
      if (s.canConfigure) { const removed = await api.getTrash(); setTrashItems(removed.items); setTrashCount(removed.total); }
      return s;
    } catch (e) { setError(msg(e, "Không tải được dữ liệu.")); }
    finally { setLoading(false); }
  }
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); if (undoTimer.current) clearTimeout(undoTimer.current); }; }, []);

  useEffect(() => { setSelected(new Set()); }, [trash, group, range]);
  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  async function changeTrash(ids: string[], restore = false) {
    if (busy || !ids.length) return;
    setBusy(true); setError(null); setConfirmTrash(null);
    try {
      const count = restore ? await api.restoreTrends(ids) : await api.trashTrends(ids);
      setSelected(new Set());
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo(restore ? [] : ids);
      setNotice(restore ? `Đã khôi phục ${count} trend.` : "Đã chuyển vào Thùng rác");
      undoTimer.current = setTimeout(() => { setUndo([]); setNotice(""); }, 8000);
      // Hide changed cards before reloading (the request itself is not optimistic).
      if (restore) setTrashItems(prev => prev.filter(i => !ids.includes(i.id)));
      else setItems(prev => prev.filter(i => !ids.includes(i.id)));
      await load();
    } catch (e) { setError(msg(e, "Chưa thực hiện được. Hãy tải lại danh sách rồi thử lại.")); await load(); }
    finally { setBusy(false); }
  }
  const dated = useMemo(() => items.filter(i => i.id === linkedId || inDateRange(i.createdAt, range)), [items, range, linkedId]);
  const shown = trash ? trashItems : group === "all" ? dated : dated.filter(i => i.id === linkedId || trendGroup(i) === group);
  useEffect(() => {
    if (loading || settingsPage || !linkedId) return;
    document.getElementById(`trend-${linkedId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, items, linkedId, settingsPage]);
  const tabs: { key: TrendGroup | "all"; label: string; icon: React.ReactNode }[] = [{ key: "worth", label: "Đáng làm", icon: <I.Flame /> }, { key: "processing", label: "Đang xử lý", icon: <I.Hourglass /> }, { key: "watch", label: "Chờ đánh giá / Theo dõi", icon: <I.Eye /> }, { key: "skipped", label: "Đã bỏ qua", icon: <I.Ban /> }, { key: "all", label: "Tất cả", icon: <I.List /> }];
  const pages = useMemo(() => (targetList?.fanpages || []).map(p => ({ id: p.id, pageName: p.pageName })), [targetList]);
  const hasTargets = status?.settings?.hasTargets ?? status?.hasTargets;
  const missingTarget = hasTargets === false || (hasTargets == null && items.some(i => isTargetError(i.error) || isTargetError(i.facebookReason)));
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
      const result = await api.runDry();
      if (result.status === "refreshed") {
        setRunning(false); setRunMsg({ ok: true, text: `${result.note || `Đã lấy ${result.created ?? 0} trend về, chờ Claude nghiên cứu.`}` });
        void load(); return;
      }
      const runId = result.runId;
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
            setRunMsg({ ok: true, text: "Lượt chạy thử đang được xử lý." });
            timer.current = setTimeout(poll, 5000); return;
          }
          setRunning(false);
          const text = run.status === "done" ? "Chạy thử xong. Hãy xem kết quả trong danh sách trend." :
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
  const problem = lastRun?.status === "error";

  if (settingsPage) return <div className="max-w-5xl mx-auto flex flex-col gap-4">
    <Link to="/trend-radar" className="ds-btn self-start">← Trend chủ động</Link>
    <h1 className="text-xl font-bold font-display text-stone-800">Cài đặt Trend chủ động</h1>
    {loading ? <p>Đang tải...</p> : error ? <div role="alert" className="ds-alert ds-alert-danger">{error}</div> : !status?.canConfigure ? <div role="alert" className="ds-alert ds-alert-warning">Chỉ người quản trị tính năng này mới được cài đặt</div> : <>
      <section className="ds-card"><div className="ds-card-body"><h2 className="ds-card-title mb-3">Chạy thử</h2><div><button type="button" className="ds-btn" onClick={dryRun} disabled={running}>{running ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />} {running ? "Đang chạy thử..." : "Chạy thử ngay"}</button><p className="text-xs text-stone-500 mt-1">Chạy thử để kiểm tra việc lấy trend; kết quả hiện ở danh sách trend. Không dùng để gửi thẻ lên Teams.</p></div>
      {runMsg && <div role={runMsg.ok ? "status" : "alert"} className={`ds-alert mt-3 ${runMsg.ok ? "ds-alert-success" : "ds-alert-warning"}`}>{runMsg.text}</div>}</div></section>
      {(status.outbox.some(o => o.status === "unknown") || resolveMsg) && <section className="ds-card" aria-label="Thẻ Teams cần xử lý"><div className="ds-card-body flex flex-col gap-3"><h2 className="ds-card-title">Thẻ Teams cần xử lý</h2><p className="text-sm text-stone-600">Hãy kiểm tra kênh Teams trước khi xử lý để tránh gửi trùng.</p>{resolveMsg && <div role="status" className="ds-alert ds-alert-warning">{resolveMsg}</div>}{status.outbox.filter(o => o.status === "unknown").map(o => <div key={o.id} className="border border-stone-200 rounded-lg p-3 flex flex-wrap gap-2"><span className="text-sm break-all flex-1">Mã lượt gửi: {o.id} · Đã thử {o.attempts} lần</span><button type="button" className="ds-btn ds-btn-sm" disabled={resolving} onClick={() => setResolve({id: o.id, action: "resolved"})}>Đã kiểm, Teams đã nhận</button><button type="button" className="ds-btn ds-btn-sm" disabled={resolving} onClick={() => setResolve({id: o.id, action: "resend"})}>Gửi lại</button></div>)}</div></section>}
      <Settings isAdmin={true} onSaved={load} />
      <ConfirmDialog isOpen={!!resolve} title={resolve?.action === "resend" ? "Gửi lại thẻ?" : "Xác nhận đã kiểm tra?"} message={resolve?.action === "resend" ? "Thẻ có thể đã được Teams nhận. Gửi lại có thể tạo thông báo trùng. Bạn đã kiểm tra và vẫn muốn gửi lại?" : "Bạn đã kiểm tra và xác nhận Teams đã nhận thẻ này?"} confirmText={resolve?.action === "resend" ? "Gửi lại" : "Đã kiểm tra"} onConfirm={resolveCard} onCancel={() => setResolve(null)} />
    </>}
  </div>;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-xl font-bold font-display text-stone-800">Trend chủ động</h1><p className="text-sm text-stone-500 mt-1">Claude quét và chọn trend đáng làm; Outlier soạn bản nháp cho từng trang.</p></div>
        {status?.canConfigure && <Link to="/trend-radar/settings" className="ds-btn"><SettingsIcon className="w-4 h-4" aria-hidden="true" /> Cài đặt</Link>}
      </div>
      {error && <div role="alert" className="ds-alert ds-alert-danger">{error} <button type="button" className="underline" onClick={() => { setLoading(true); void load(); }}>Thử lại</button></div>}
      {loading ? <div role="status" aria-label="Đang tải trend" className="flex flex-col gap-3"><div className="ds-card h-24 animate-pulse bg-stone-100" />{[1, 2, 3].map(n => <div key={n} className="ds-card h-40 animate-pulse bg-stone-100" />)}</div> : status && <>
        <section className="ds-card" aria-label="Tình trạng"><div className="ds-card-body flex flex-col gap-3">
          <div className="flex items-center gap-x-5 gap-y-2 flex-wrap text-sm"><span className={`ds-badge ${s?.enabled ? 'ds-badge-success' : ''}`}>{head || 'Chưa rõ'}</span><span>Quét gần nhất: <strong>{fmt(status.lastRefreshAt || lastRun?.createdAt)}</strong>{status.lastRefreshAt && status.refreshedBy ? ` · ${status.refreshedBy}` : lastRun?.dryRun ? ' · chạy thử' : ''}</span></div>
          {problem && <div role="alert" className="ds-alert ds-alert-warning">Lần chạy gần nhất chưa thành công. Hãy kiểm tra lại trong phần cài đặt.</div>}
          {missingTarget && <div className="ds-alert ds-alert-warning">Chưa chọn trang đích để soạn bản nháp.{status.canConfigure && <> <Link className="underline" to="/trend-radar/settings">Mở cài đặt</Link></>}</div>}
          {lastOutbox?.status === 'failed' && <div className="ds-alert ds-alert-warning">Thẻ gần nhất chưa gửi được lên Teams. Hãy kiểm tra phần cài đặt.</div>}
          {lastOutbox?.status === 'unknown' && <div className="ds-alert ds-alert-warning">Chưa rõ thẻ gần nhất đã lên Teams chưa. Hãy kiểm tra kênh Teams trước khi gửi lại.</div>}
        </div></section>
        <section className="ds-card" aria-label="Bộ lọc trend"><div className="ds-card-body flex flex-col gap-4"><DateRangeFilter value={range} onChange={setRange} /><div><div className="text-sm font-semibold text-stone-700 mb-2">Trạng thái</div><div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible" aria-label="Lọc theo trạng thái">{tabs.map(tab => <button key={tab.key} type="button" className={`ds-btn ds-btn-sm shrink-0 whitespace-nowrap ${!trash && group === tab.key ? 'ds-btn-primary' : ''}`} aria-pressed={!trash && group === tab.key} onClick={() => { setTrash(false); setGroup(tab.key); }}>{tab.icon}{tab.label} <span>({tab.key === 'all' ? dated.length : dated.filter(i => trendGroup(i) === tab.key).length})</span></button>)}{status.canConfigure && <button type="button" className={`ds-btn ds-btn-sm shrink-0 whitespace-nowrap ${trash ? "ds-btn-primary" : ""}`} aria-pressed={trash} onClick={() => setTrash(true)}><I.Trash />Thùng rác ({trashCount})</button>}</div></div></div></section>
        {notice && <div role="status" className="ds-alert ds-alert-success">{notice}{undo.length > 0 && <> · <button type="button" className="underline font-semibold" disabled={busy} onClick={() => void changeTrash(undo, true)}>Hoàn tác</button></>}</div>}
        {status.canConfigure && trash && <p className="ds-alert ds-alert-info">Trend trong thùng rác không hiện ở danh sách. Bản nháp đã tạo không bị xoá.</p>}
        {status.canConfigure && <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && <><span className="text-sm">Đã chọn {selected.size}</span><button type="button" className="ds-btn ds-btn-sm" disabled={busy} onClick={() => void changeTrash([...selected], trash)}>{trash ? "Khôi phục" : "Chuyển vào thùng rác"}</button><button type="button" className="ds-btn ds-btn-sm" onClick={() => setSelected(new Set())}>Bỏ chọn</button></>}
          {!trash && group === "skipped" && shown.length > 0 && <button type="button" className="ds-btn ds-btn-sm" disabled={busy} onClick={() => setConfirmTrash(shown.map(i => i.id))}>Chuyển tất cả vào thùng rác</button>}
        </div>}
        <ConfirmDialog isOpen={!!confirmTrash} title="Chuyển vào Thùng rác?" message={`Chuyển ${confirmTrash?.length || 0} trend đã bỏ qua trong danh sách này vào Thùng rác? Bạn có thể khôi phục. Bản nháp đã tạo không bị xoá.`} confirmText="Chuyển vào Thùng rác" onConfirm={() => confirmTrash && void changeTrash(confirmTrash)} onCancel={() => setConfirmTrash(null)} />
        <section aria-label="Danh sách trend" className="flex flex-col gap-3">
          {shown.length ? shown.map(it => <div key={it.id} id={`trend-${it.id}`} tabIndex={-1} className={it.id === linkedId ? "scroll-mt-6 rounded-xl ring-2 ring-storm-500" : ""}><TrendCardView it={it} expanded={it.id === linkedId} onCard={() => openCard(it)} canConfigure={status.canConfigure} selected={selected.has(it.id)} onSelect={() => toggle(it.id)} onTrash={() => void changeTrash([it.id], trash)} busy={busy} skippedRetentionDays={status.settings.skippedRetentionDays || 7} pages={pages} /></div>) : <div className="ds-card"><div className="ds-empty"><div className="ds-empty-icon"><Telescope className="w-8 h-8" aria-hidden="true" /></div><p className="ds-empty-title">{!items.length && !status.lastRefreshAt && !lastRun ? 'Claude chưa quét lần nào' : `Không có trend nào trong ${rangeDescription(range)}`}</p><p className="ds-empty-desc">{!items.length && !status.lastRefreshAt && !lastRun ? 'Hãy kiểm tra lịch Scheduled của Claude.' : 'Hãy thử chọn khoảng thời gian hoặc trạng thái khác.'}</p></div></div>}
        </section>
      </>}

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
                    {(c?.body || []).map((b, i) => <p key={i} className={`whitespace-pre-wrap break-words ${b.weight === "Bolder" ? "font-bold" : ""} ${b.size === "Large" ? "text-lg" : b.size === "Small" ? "text-xs" : ""} ${b.color === "Attention" ? "text-amber-700" : b.isSubtle ? "text-stone-500" : ""}`}>{(b.text || "").split(/(\*\*[^*]+\*\*)/g).map((part, j) => part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : part)}</p>)}
                    <div className="flex flex-wrap gap-2 pt-1">{(c?.actions || []).map((a, i) => <a key={i} href={a.url} className="ds-btn ds-btn-sm" target="_blank" rel="noopener noreferrer">{a.title}</a>)}</div>
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
  const num = (id: string, label: string, k: "skippedRetentionDays" | "staleRetentionDays" | "maxFacebookPostsPerTrend" | "maxApifyPosts" | "maxApifyPostsDaily" | "maxTrends" | "maxModelCalls" | "maxModelCallsDaily" | "maxOutputTokens" | "modelTimeoutMs", hint: string, min: number, max: number) => (
    <div><label className="ds-label" htmlFor={id}>{label}</label>
      <input id={id} type="number" min={min} max={max} step={1} className="ds-input w-full" value={cfg[k]} disabled={!isAdmin || saving} onChange={(e) => set(k, Number(e.target.value))} />
      <p className="text-[11px] text-stone-500 mt-0.5">{hint}</p></div>
  );
  const usage = (Object.keys(usagePresets) as UsageKey[]).find((key) => Object.entries(usagePresets[key].values).every(([k, v]) => cfg[k as keyof TrendSettings] === v));
  const picked = (id: string) => cfg.targets.some((t) => t.fanpageId === id);

  async function save() {
    if (!cfg) return;
    const limits = [[cfg.skippedRetentionDays, 1, 90], [cfg.staleRetentionDays, 7, 365], [cfg.maxFacebookPostsPerTrend, 0, 1], [cfg.maxApifyPosts, 0, 10], [cfg.maxApifyPostsDaily, 0, 50], [cfg.maxTrends, 0, 10], [cfg.maxModelCalls, 0, 50], [cfg.maxModelCallsDaily, 0, 200], [cfg.maxOutputTokens, 0, 4096], [cfg.modelTimeoutMs, 1000, 90000]];
    if (limits.some(([v, min, max]) => !Number.isInteger(v) || v < min || v > max)) { setErr("Hãy nhập số nguyên trong giới hạn ghi bên dưới mỗi ô."); return; }
    setSaving(true); setErr(null); setOk(false);
    try {
      const body: Partial<TrendSettings> & { teamsWebhookUrl?: string } = {
        autoCleanup: cfg.autoCleanup, skippedRetentionDays: cfg.skippedRetentionDays, staleRetentionDays: cfg.staleRetentionDays, researchProvider: cfg.researchProvider, apifyEnabled: cfg.apifyEnabled, maxFacebookPostsPerTrend: cfg.maxFacebookPostsPerTrend, maxApifyPosts: cfg.maxApifyPosts, maxApifyPostsDaily: cfg.maxApifyPostsDaily,
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
    <div className="flex flex-col gap-4">
      <section className="ds-card"><div className="ds-card-body flex flex-col gap-3"><h2 className="ds-card-title">Trạng thái</h2>
      {cfg.researchProvider === "gemini" && !cfg.keyConfigured && <div className="ds-alert ds-alert-warning">Máy chủ chưa có khoá để nghiên cứu tin tức, nên chưa dò được. Nhờ người quản lý hệ thống bổ sung.</div>}
      <div className="flex items-center gap-3">
        <input id="tr-enabled" type="checkbox" role="switch" className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-stone-300 transition-colors checked:bg-storm-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-storm-600 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-1 before:top-1 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-5" checked={cfg.enabled} disabled={!isAdmin || saving} onChange={(e) => set("enabled", e.target.checked)} />
        <label htmlFor="tr-enabled" className="ds-label !mb-0">Bật Trend chủ động</label>
      </div>
      </div></section>
      <section className="ds-card"><div className="ds-card-body flex flex-col gap-3"><h2 className="ds-card-title">Tự dọn trend cũ</h2>
        <div className="flex gap-3 items-center"><input id="tr-auto-cleanup" type="checkbox" role="switch" className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-stone-300 transition-colors checked:bg-storm-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-storm-600 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-1 before:top-1 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-5" checked={cfg.autoCleanup} disabled={!isAdmin || saving} onChange={e => set("autoCleanup", e.target.checked)} /><label htmlFor="tr-auto-cleanup" className="ds-label !mb-0">Tự chuyển trend cũ vào Thùng rác</label></div>
        <p className="text-sm text-stone-600">Mỗi giờ, hệ thống chuyển trend đã bỏ qua quá số ngày bên dưới vào Thùng rác. Trend cũ không có bản nháp cũng được dọn khi không còn xử lý. Không xoá vĩnh viễn; bạn luôn có thể khôi phục. Trend có bản nháp không bị tự dọn.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {num("tr-skipped-days", "Dọn trend đã bỏ qua sau (ngày)", "skippedRetentionDays", "Từ 1 đến 90 ngày, mặc định 7 ngày.", 1, 90)}
          {num("tr-stale-days", "Dọn trend cũ chưa có bản nháp sau (ngày)", "staleRetentionDays", "Từ 7 đến 365 ngày, mặc định 30 ngày.", 7, 365)}
        </div>
      </div></section>
      <section className="ds-card"><div className="ds-card-body flex flex-col gap-3"><h2 className="ds-card-title">Trang nhận bản nháp</h2>
      <div>
        {!targets ? <p className="text-xs text-stone-500">Chưa tải được danh sách trang.</p> : targets.fanpages.length === 0 ? <p className="text-xs text-stone-500">Chưa có trang nào. Thêm trang ở mục Thương hiệu.</p> : (
          <div className="flex flex-col gap-1">{targets.fanpages.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <input id={`tr-page-${p.id}`} type="checkbox" checked={picked(p.id)} disabled={!isAdmin || saving} onChange={(e) => set("targets", e.target.checked ? [...cfg.targets, { brandId: p.brandId, fanpageId: p.id }] : cfg.targets.filter((t) => t.fanpageId !== p.id))} />
              <label htmlFor={`tr-page-${p.id}`}>{p.pageName} <span className="text-xs text-stone-500">({targets.brands.find((b) => b.id === p.brandId)?.name || "Thương hiệu"})</span></label></div>))}</div>
        )}
        <p className="text-xs text-stone-500 mt-1">Chưa chọn trang thì chỉ tạo tóm tắt, không soạn bản nháp.</p>
      </div>
      </div></section>
      <section className="ds-card"><div className="ds-card-body flex flex-col gap-3"><h2 className="ds-card-title">Gửi lên Teams</h2>
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

      {isAdmin &&           <div className="border-t border-stone-200 pt-3">
            <label className="ds-label" htmlFor="tr-test">Gửi thử một thẻ lên Teams</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <select id="tr-test" className="ds-select flex-1 min-w-0" value={testItem} onChange={(e) => setTestItem(e.target.value)}>
                <option value="">Chọn trend để gửi thử</option>{items.map((i) => <option key={i.id} value={i.id}>{i.brief?.title || i.title}{(i.decision || i.brief?.decision) !== "pursue" ? " (chưa được chọn đu)" : ""}</option>)}</select>
              <button type="button" className="ds-btn" disabled={!testItem || testing || !cfg.webhookConfigured || !cfg.publicBaseUrl || !items.find((i) => i.id === testItem)?.drafts.some((d) => d.status === "ready") || (items.find((i) => i.id === testItem)?.decision || items.find((i) => i.id === testItem)?.brief?.decision) !== "pursue"} onClick={() => setConfirmTest(true)}>
                {testing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />} Gửi thử lên Teams</button>
            </div>
            {!cfg.webhookConfigured && <p className="text-xs text-stone-500 mt-1">Cần lưu đường dẫn Teams trước.</p>}
            {!cfg.publicBaseUrl && <p className="text-xs text-stone-500 mt-1">Hãy lưu cài đặt để tạo đường dẫn mở bản nháp.</p>}
            {testItem && !items.find((i) => i.id === testItem)?.drafts.some((d) => d.status === "ready") && <p className="text-xs text-stone-500 mt-1">Trend chưa có bản nháp sẵn sàng. Hãy chọn trend khác hoặc chờ xử lý xong.</p>}
            {testItem && (items.find((i) => i.id === testItem)?.decision || items.find((i) => i.id === testItem)?.brief?.decision) !== "pursue" && <p className="text-xs text-stone-500 mt-1">Claude chưa chọn đu trend này; chỉ gửi thử được trend đã được chọn đu.</p>}
            {testMsg && <div role={testMsg.ok ? "status" : "alert"} className={`ds-alert mt-2 ${testMsg.ok ? "ds-alert-success" : "ds-alert-danger"}`}>{testMsg.text}</div>}
          </div>}
      </div></section>
      <section className="ds-card"><div className="ds-card-body flex flex-col gap-3"><h2 className="ds-card-title">Lấy bài Facebook</h2>
      <div>
        <div className="flex items-center gap-3">
          <input id="tr-apify" type="checkbox" role="switch" className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-stone-300 transition-colors checked:bg-storm-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-storm-600 disabled:cursor-not-allowed disabled:opacity-50 before:absolute before:left-1 before:top-1 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-5" checked={cfg.apifyEnabled} disabled={!isAdmin || saving} onChange={(e) => set("apifyEnabled", e.target.checked)} />
          <label htmlFor="tr-apify" className="ds-label !mb-0">Lấy nội dung bài Facebook khi tìm thấy</label>
        </div>
        <p className="text-xs text-stone-500 mt-1">Tốn phí Apify; chỉ lấy đúng bài Claude tìm được.</p>
      </div>
      </div></section>
      <section className="ds-card"><div className="ds-card-body flex flex-col gap-3"><h2 className="ds-card-title">Mức sử dụng</h2>
      <fieldset disabled={!isAdmin || saving}>
        <legend className="sr-only">Mức sử dụng</legend>
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
      </div></section>

      {err && <div role="alert" className="ds-alert ds-alert-danger">{err}</div>}
      {ok && <div role="status" className="ds-alert ds-alert-success">Đã lưu cài đặt.</div>}
      {isAdmin && <div className="sticky bottom-0 z-10 px-4 py-3 bg-white/95 backdrop-blur border border-stone-200 flex justify-end rounded-xl shadow-sm"><button type="button" className="ds-btn ds-btn-primary w-full sm:w-auto" onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu cài đặt</button></div>}
      <ConfirmDialog isOpen={confirmTest} title="Gửi thử lên Teams?" message="Thẻ sẽ được đăng thật vào kênh Teams đã cấu hình và mọi người trong kênh đều thấy. Bạn chắc chắn muốn gửi?" confirmText="Gửi thử" onConfirm={send} onCancel={() => setConfirmTest(false)} />
    </div>
  );
}
