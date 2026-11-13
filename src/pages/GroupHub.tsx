import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDownRight, ArrowUpRight, FileSpreadsheet, Loader2, RefreshCw, Upload, Minus } from "lucide-react";
import { getWeeklyTrend, listGroupSnapshots, listProjectSignals, listWeeklyDrafts, uploadGroupInsights, type GroupProjectSignal, type GroupSnapshot, type WeeklyReportDraft, type WeeklyTrend } from "../services/group-hub";

type LoadState = "idle" | "loading" | "error";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const date = (value: string) => new Date(value).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

export default function GroupHub() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<GroupSnapshot[]>([]);
  const [signals, setSignals] = useState<GroupProjectSignal[]>([]);
  const [drafts, setDrafts] = useState<WeeklyReportDraft[]>([]);
  const [trend, setTrend] = useState<WeeklyTrend | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [upload, setUpload] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [uploadMessage, setUploadMessage] = useState("");

  async function load() {
    setState("loading"); setError("");
    const results = await Promise.allSettled([listGroupSnapshots(), listProjectSignals(), listWeeklyDrafts(), getWeeklyTrend()]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) { setState("error"); setError(failed.reason instanceof Error ? failed.reason.message : "Không thể tải dữ liệu Group Hub."); return; }
    setSnapshots((results[0] as PromiseFulfilledResult<GroupSnapshot[]>).value);
    setSignals((results[1] as PromiseFulfilledResult<GroupProjectSignal[]>).value);
    setDrafts((results[2] as PromiseFulfilledResult<WeeklyReportDraft[]>).value);
    setTrend((results[3] as PromiseFulfilledResult<WeeklyTrend | null>).value); setState("idle");
  }
  useEffect(() => { void load(); }, []);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    setUploadMessage("");
    if (!file.name.toLowerCase().endsWith(".xlsx")) { setUpload("error"); setUploadMessage("Chỉ nhận file Excel định dạng .xlsx."); return; }
    if (file.size > MAX_FILE_SIZE) { setUpload("error"); setUploadMessage("File vượt quá giới hạn 10 MB."); return; }
    setUpload("loading");
    try { await uploadGroupInsights(file); setUpload("success"); setUploadMessage(`Đã nhập ${file.name}.`); await load(); }
    catch (e) { setUpload("error"); setUploadMessage(e instanceof Error ? e.message : "Không thể nhập file."); }
    finally { event.target.value = ""; }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-storm-600">GROUP HUB</p><h1 className="font-display text-2xl font-bold text-storm-900 mt-1">Vibe Coding Weekly</h1><p className="text-sm text-stone-500 mt-1">Theo dõi xu hướng công nghệ và tín hiệu từ các dự án trong nhóm.</p></div><button className="ds-btn ds-btn-ghost" onClick={() => void load()} disabled={state === "loading"}><RefreshCw className={`w-4 h-4 ${state === "loading" ? "animate-spin" : ""}`} aria-hidden="true" /> Làm mới</button></div>
    {state === "error" && <div className="ds-alert ds-alert-danger" role="alert"><AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> <span>{error} Endpoint Group Hub có thể chưa được bật.</span></div>}
    <section className="ds-card"><div className="ds-card-body"><div className="flex items-start gap-3"><FileSpreadsheet className="w-5 h-5 text-storm-600 mt-0.5" aria-hidden="true" /><div className="flex-1"><h2 className="font-semibold text-stone-800">Nhập Facebook Group Insights</h2><p className="text-sm text-stone-500 mt-1">Chọn file .xlsx, tối đa 10 MB. Dữ liệu chỉ được gửi sau khi bạn chọn file.</p><label className="ds-btn ds-btn-primary ds-btn-sm inline-flex mt-4 cursor-pointer"><Upload className="w-4 h-4" aria-hidden="true" /> {upload === "loading" ? "Đang tải…" : "Chọn file .xlsx"}<input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={onFile} disabled={upload === "loading"} aria-label="Chọn file Facebook Group Insights định dạng XLSX" /></label>{upload === "loading" && <span className="ml-3 text-sm text-stone-500" role="status"><Loader2 className="inline w-4 h-4 animate-spin mr-1" aria-hidden="true" /> Đang nhập file…</span>}{uploadMessage && <p className={`text-sm mt-3 ${upload === "error" ? "text-red-700" : "text-green-700"}`} role={upload === "error" ? "alert" : "status"}>{uploadMessage}</p>}</div></div></div></section>
    <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]"><div className="ds-card"><div className="ds-card-body"><div className="flex justify-between items-center"><h2 className="font-semibold text-stone-800">Xu hướng tuần</h2>{trend && <span className="ds-badge ds-badge-info">{trend.week}</span>}</div>{trend ? <><h3 className="text-lg font-semibold text-storm-900 mt-4">{trend.title}</h3><p className="text-sm text-stone-600 mt-2">{trend.summary}</p><div className="flex flex-wrap gap-2 mt-4">{trend.themes?.map((theme) => <span className="ds-badge" key={theme}>{theme}</span>)}</div></> : <Empty text="Chưa có bản tổng hợp xu hướng tuần." />}</div></div><div className="ds-card"><div className="ds-card-body"><h2 className="font-semibold text-stone-800">Snapshot đã import</h2>{snapshots.length ? <ul className="divide-y divide-stone-100 mt-3">{snapshots.slice(0, 5).map((item) => <li className="py-3 flex justify-between gap-3 text-sm" key={item.id}><span className="truncate"><FileSpreadsheet className="w-4 h-4 inline mr-2 text-stone-400" aria-hidden="true" />{item.sourceFilename}</span><span className="text-stone-500 shrink-0">{date(item.createdAt)}</span></li>)}</ul> : <Empty text="Chưa có snapshot nào." />}</div></div></section>
    <section className="grid gap-6 lg:grid-cols-2"><ListCard title="Tín hiệu theo project nhóm">{signals.length ? signals.map((item) => <div className="py-3 border-b border-stone-100 last:border-0" key={item.id}><div className="flex justify-between gap-3"><span className="font-medium text-stone-800">{item.project}</span><TrendIcon direction={item.direction} /></div><p className="text-sm text-stone-600 mt-1">{item.signal}</p></div>) : <Empty text="Chưa có tín hiệu project." />}</ListCard><ListCard title="Bản nháp báo cáo tuần">{drafts.length ? drafts.map((item) => <div className="py-3 border-b border-stone-100 last:border-0" key={item.id}><div className="flex justify-between gap-3"><span className="font-medium text-stone-800">{item.title || `Weekly Review ${item.weekLabel}`}</span><span className="ds-badge">{item.status === "needs_review" ? "Đang duyệt" : item.status === "published" ? "Đã xuất bản" : item.status === "approved" ? "Đã duyệt" : "Bản nháp"}</span></div><p className="text-xs text-stone-500 mt-1">Tuần {item.weekLabel} · cập nhật {date(item.updatedAt)}</p></div>) : <Empty text="Chưa có bản nháp báo cáo." />}</ListCard></section>
  </div>;
}
function Empty({ text }: { text: string }) { return <p className="text-sm text-stone-500 py-6 text-center">{text}</p>; }
function ListCard({ title, children }: { title: string; children: React.ReactNode }) { return <div className="ds-card"><div className="ds-card-body"><h2 className="font-semibold text-stone-800">{title}</h2><div className="mt-2">{children}</div></div></div>; }
function TrendIcon({ direction }: { direction?: GroupProjectSignal["direction"] }) { const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus; return <Icon className={`w-4 h-4 ${direction === "up" ? "text-green-600" : direction === "down" ? "text-red-600" : "text-stone-400"}`} aria-label={direction === "up" ? "Tăng" : direction === "down" ? "Giảm" : "Ổn định"} />; }
