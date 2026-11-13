import { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink, FileSpreadsheet, Loader2, RefreshCw, Upload } from "lucide-react";
import { getWeeklyReport, getWeeklyTrend, listGroupSnapshots, listWeeklyDrafts, setWeeklyReportStatus, uploadGroupInsights, type GroupSnapshot, type WeeklyReportDraft, type WeeklyTrend } from "../services/group-hub";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const posts = (snapshot: GroupSnapshot) => snapshot.summary?.topPosts || [];

export default function GroupHub() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<GroupSnapshot[]>([]);
  const [drafts, setDrafts] = useState<WeeklyReportDraft[]>([]);
  const [trend, setTrend] = useState<WeeklyTrend | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [upload, setUpload] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [selectedDraft, setSelectedDraft] = useState<(WeeklyReportDraft & { draftMarkdown?: string | null }) | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftAction, setDraftAction] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try {
      const [nextSnapshots, nextDrafts, nextTrend] = await Promise.all([listGroupSnapshots(), listWeeklyDrafts(), getWeeklyTrend()]);
      setSnapshots(nextSnapshots); setDrafts(nextDrafts); setTrend(nextTrend);
      setExpanded(current => current && nextSnapshots.some(s => s.id === current) ? current : nextSnapshots[0]?.id || null);
    } catch (e: any) { setError(e?.message || "Không thể tải dữ liệu Group Hub."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function openDraft(id: string) {
    setDraftLoading(true); setError("");
    try { setSelectedDraft(await getWeeklyReport(id)); } catch (e: any) { setError(e?.message || "Không tải được draft Weekly Review."); } finally { setDraftLoading(false); }
  }
  async function changeDraftStatus(status: "approved" | "draft") {
    if (!selectedDraft) return;
    setDraftAction(true);
    try { await setWeeklyReportStatus(selectedDraft.id, status); setSelectedDraft({ ...selectedDraft, status }); await load(); } catch (e: any) { setError(e?.message || "Không cập nhật được draft."); } finally { setDraftAction(false); }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setUploadMessage("");
    if (!file.name.toLowerCase().endsWith(".xlsx")) { setUpload("error"); setUploadMessage("Chỉ nhận file Excel định dạng .xlsx."); return; }
    if (file.size > MAX_FILE_SIZE) { setUpload("error"); setUploadMessage("File vượt quá giới hạn 10 MB."); return; }
    setUpload("loading");
    try { await uploadGroupInsights(file); setUpload("success"); setUploadMessage(`Đã nhập ${file.name}.`); await load(); }
    catch (e: any) { setUpload("error"); setUploadMessage(e?.message || "Không thể nhập file."); }
    finally { event.target.value = ""; }
  }

  return <div className="flex flex-col gap-5">
    <header className="flex items-start justify-between gap-3 flex-wrap">
      <div><p className="text-xs font-semibold tracking-widest text-storm-600">GROUP HUB</p><h1 className="font-display text-2xl font-bold text-storm-900 mt-1">Vibe Coding Weekly</h1><p className="text-sm text-stone-500 mt-1">Dòng thời gian hoạt động của nhóm, theo từng tuần.</p></div>
      <button className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Làm mới</button>
    </header>
    {error && <div className="ds-alert ds-alert-danger" role="alert"><AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> {error}</div>}
    <section className="ds-card border-storm-100 bg-storm-50/40"><div className="ds-card-body"><div className="flex items-center justify-between gap-3 flex-wrap"><div><p className="text-xs font-semibold text-storm-600">TUẦN NÀY</p><h2 className="font-semibold text-stone-800 mt-1">{trend?.title || "Chưa có tổng hợp trend"}</h2><p className="text-sm text-stone-600 mt-1">{trend?.summary || "Sau khi Claude xử lý trend và snapshot group, bản tổng hợp sẽ xuất hiện ở đây."}</p></div>{trend?.week && <span className="ds-badge ds-badge-info">{trend.week}</span>}</div>{trend?.themes?.length ? <div className="flex flex-wrap gap-2 mt-3">{trend.themes.map(t => <span className="ds-badge" key={t}>{t}</span>)}</div> : null}</div></section>
    <section className="ds-card"><div className="ds-card-body"><div className="flex items-center justify-between gap-3 flex-wrap"><div><h2 className="font-semibold text-stone-800">Weekly timeline</h2><p className="text-xs text-stone-500 mt-1">Mỗi kỳ là một snapshot riêng. Mở một tuần để xem bài, project và link gốc.</p></div><span className="ds-badge">{snapshots.length} tuần còn hạn</span></div>{loading && !snapshots.length ? <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-storm-600" aria-label="Đang tải" /></div> : snapshots.length ? <div className="relative mt-5 ml-2 border-l-2 border-stone-200">{snapshots.map((snapshot, index) => { const open = expanded === snapshot.id; const top = posts(snapshot); return <article key={snapshot.id} className="relative pl-6 pb-5 last:pb-0"><span className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-4 border-white ${index === 0 ? "bg-storm-600" : "bg-stone-300"}`} aria-hidden="true" /><button type="button" className="w-full text-left rounded-xl border border-stone-200 hover:border-storm-300 hover:bg-storm-50/30 transition-colors p-3" onClick={() => setExpanded(open ? null : snapshot.id)} aria-expanded={open}><div className="flex items-center justify-between gap-3"><div><div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-stone-800">{snapshot.periodLabel}</span>{index === 0 && <span className="ds-badge ds-badge-success">Mới nhất</span>}</div><p className="text-xs text-stone-500 mt-1">Import {date(snapshot.createdAt)} · hết hạn {date(snapshot.expiresAt)}</p></div><div className="flex items-center gap-2 shrink-0"><span className="ds-badge">{top.length} bài nổi bật</span>{open ? <ChevronUp className="w-4 h-4 text-stone-500" aria-hidden="true" /> : <ChevronDown className="w-4 h-4 text-stone-500" aria-hidden="true" />}</div></div></button>{open && <div className="mt-2 rounded-xl bg-stone-50 border border-stone-200 p-3"><div className="flex items-center justify-between gap-2 mb-2"><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Bài nổi bật trong tuần</p><span className="text-xs text-stone-400">{snapshot.sourceFilename}</span></div>{top.length ? <div className="space-y-2">{top.slice(0, 10).map((post: any, i: number) => <div className="rounded-lg bg-white border border-stone-200 p-3" key={`${snapshot.id}-${i}`}><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-stone-800 line-clamp-2">{post.title || "Bài không có tiêu đề"}</p><span className="ds-badge shrink-0">#{i + 1}</span></div><p className="text-xs text-stone-500 mt-2">{post.author || "Ẩn danh"} · {post.comments || 0} bình luận · {post.reactions || 0} reaction · {post.views || 0} lượt xem</p>{post.url && <a className="inline-flex items-center gap-1 mt-2 text-xs text-storm-700 hover:underline" href={post.url} target="_blank" rel="noreferrer">Mở bài gốc <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /></a>}</div>)}</div> : <p className="text-sm text-stone-500 py-3">Chưa có bài nổi bật trong snapshot này.</p>}</div>}</article>; })}</div> : <div className="py-10 text-center text-sm text-stone-500">Chưa có snapshot. Mở mục Nguồn dữ liệu bên dưới để nhập kỳ đầu tiên.</div>}</div></section>
    <section className="ds-card"><button type="button" className="w-full text-left ds-card-body flex items-center justify-between gap-3" onClick={() => setSourcesOpen(!sourcesOpen)} aria-expanded={sourcesOpen}><div className="flex items-center gap-3"><FileSpreadsheet className="w-5 h-5 text-stone-500" aria-hidden="true" /><div><h2 className="font-semibold text-stone-800">Nguồn dữ liệu</h2><p className="text-xs text-stone-500 mt-1">Khu vực admin · nhập XLSX khi có kỳ Facebook Insights mới</p></div></div>{sourcesOpen ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}</button>{sourcesOpen && <div className="px-4 pb-4"><p className="text-sm text-stone-500 mb-3">Snapshot được giữ 35 ngày và tự dọn khi hết hạn. File trùng sẽ không nhập lại.</p><label className="ds-btn ds-btn-secondary ds-btn-sm inline-flex cursor-pointer"><Upload className="w-4 h-4" aria-hidden="true" /> {upload === "loading" ? "Đang nhập…" : "Chọn file .xlsx"}<input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={onFile} disabled={upload === "loading"} aria-label="Chọn file Facebook Group Insights định dạng XLSX" /></label>{upload === "loading" && <span className="ml-3 text-sm text-stone-500" role="status"><Loader2 className="inline w-4 h-4 animate-spin mr-1" aria-hidden="true" /> Đang nhập file…</span>}{uploadMessage && <p className={`text-sm mt-3 ${upload === "error" ? "text-red-700" : "text-green-700"}`} role={upload === "error" ? "alert" : "status"}>{uploadMessage}</p>}</div>}</section>
    <section className="ds-card"><div className="ds-card-body"><div className="flex items-center justify-between gap-3 flex-wrap"><div><h2 className="font-semibold text-stone-800">Lịch báo cáo</h2><p className="text-sm text-stone-500 mt-1">Weekly Review được chuẩn bị để đăng cố định vào <strong>thứ 7 lúc 09:00</strong>, sau khi admin duyệt.</p></div>{draftLoading && <Loader2 className="w-4 h-4 animate-spin" aria-label="Đang tải draft" />}</div>{drafts.length ? <div className="mt-3 space-y-2">{drafts.slice(0, 6).map(d => <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 p-3" key={d.id}><div><p className="text-sm font-medium text-stone-800">Weekly Review {d.weekLabel}</p><p className="text-xs text-stone-500 mt-1">Cập nhật {dateTime(d.updatedAt)} · dự kiến thứ 7 lúc 09:00</p></div><div className="flex items-center gap-2"><span className="ds-badge">{d.status === "needs_review" ? "Chờ duyệt" : d.status === "approved" ? "Đã duyệt" : d.status === "published" ? "Đã đăng" : "Bản nháp"}</span><button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={() => void openDraft(d.id)}>Xem & duyệt</button></div></div>)}</div> : <p className="text-sm text-stone-500 mt-3">Chưa có draft nào.</p>}</div></section>{selectedDraft && <div className="ds-card border-storm-200 bg-white"><div className="ds-card-body"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-widest text-storm-600">DRAFT REVIEW</p><h2 className="font-display text-xl font-bold text-storm-900 mt-1">Weekly Review {selectedDraft.weekLabel}</h2><p className="text-xs text-stone-500 mt-1">Dự kiến đăng thứ 7 lúc 09:00 · trạng thái: {selectedDraft.status}</p></div><button type="button" className="ds-btn ds-btn-ghost ds-btn-sm" onClick={() => setSelectedDraft(null)}>Đóng</button></div><article className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4 whitespace-pre-wrap text-sm leading-7 text-stone-800">{selectedDraft.draftMarkdown || "Draft chưa có nội dung Markdown."}</article><div className="flex flex-wrap gap-2 mt-4"><button type="button" className="ds-btn ds-btn-primary" disabled={draftAction || selectedDraft.status === "approved"} onClick={() => void changeDraftStatus("approved")}>{draftAction ? "Đang lưu…" : "Duyệt draft"}</button><button type="button" className="ds-btn ds-btn-ghost" disabled={draftAction} onClick={() => void changeDraftStatus("draft")}>Trả về bản nháp</button></div></div></div>}
  </div>;
}
