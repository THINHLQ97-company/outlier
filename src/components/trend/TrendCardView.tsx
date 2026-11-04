import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Eye } from "lucide-react";
import type { TrendItem } from "../../services/trend-workflow";

export type TrendGroup = "worth" | "processing" | "watch" | "skipped";
const skipped = (it: TrendItem) => ["skipped", "excluded", "duplicate"].includes(it.status) || it.decision === "skip";
const decisionOf = (it: TrendItem) => it.decision || it.brief?.decision || null;
export const isTargetError = (text?: string | null) => !!text && /chưa (cấu hình|chọn) trang đích/i.test(text);
export function trendGroup(it: TrendItem): TrendGroup {
  if (skipped(it)) return "skipped";
  if (["pending", "awaiting_research", "researched", "error", "budget_exhausted"].includes(it.status) || !it.brief) return "processing";
  // Chỉ quyết định biên tập mới được xếp "Đáng làm"; thiếu decision (dữ liệu cũ) = chờ đánh giá, không suy từ confidence.
  return decisionOf(it) === "pursue" ? "worth" : "watch";
}
function safeUrl(url: string): URL | null {
  try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? parsed : null; } catch { return null; }
}
function sourceDate(date?: string): string {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);
}
function SourceList({ sources }: { sources: NonNullable<TrendItem['brief']>['sources'] }) {
  const [expanded, setExpanded] = useState(false);
  const unique = Array.from(new Map((sources || []).filter(s => safeUrl(s.url)).map(s => [s.url, s])).values());
  if (!unique.length) return null;
  return <section><h3 className="text-sm font-semibold text-stone-700">Nguồn tin</h3><ul className="mt-2 flex flex-col gap-2">{(expanded ? unique : unique.slice(0, 4)).map(source => {
    const url = safeUrl(source.url)!;
    const host = url.hostname.replace(/^www\./i, "");
    const fallback = `${host}${url.pathname !== '/' ? url.pathname.slice(0, 65) + (url.pathname.length > 65 ? '…' : '') : ''}`;
    const title = source.title && source.title.trim().toLowerCase() !== 'nguồn claude dẫn' && source.title.trim().toLowerCase() !== host.toLowerCase() ? source.title : fallback;
    return <li key={source.url} className="text-sm"><a href={url.href} target="_blank" rel="noopener noreferrer" className="text-storm-700 font-medium hover:underline break-words inline-flex items-center gap-1">{title}<ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /><span className="sr-only"> (mở tab mới)</span></a><div className="text-xs text-stone-500">{source.publisher || host}{sourceDate(source.publishedAt) && ` · ${sourceDate(source.publishedAt)}`}</div></li>;
  })}</ul>{unique.length > 4 && <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm mt-1" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? 'Thu gọn nguồn' : `Xem thêm ${unique.length - 4} nguồn`}</button>}</section>;
}
function Summary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { if (!expanded) setOverflow(el.scrollHeight > el.clientHeight + 1); };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => { window.removeEventListener("resize", measure); observer?.disconnect(); };
  }, [text, expanded]);
  return <>
    <p ref={ref} className={`text-sm text-stone-700 mt-1 whitespace-pre-wrap ${expanded ? "" : "line-clamp-4"}`}>{text}</p>
    {(overflow || expanded) && <button type="button" className="ds-btn ds-btn-ghost ds-btn-sm mt-1" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Thu gọn" : "Xem thêm"}</button>}
  </>;
}
export default function TrendCardView({ it, onCard }: { it: TrendItem; onCard: () => void }) {
  const b = it.brief;
  const group = trendGroup(it);
  const label = group === "skipped" ? "Đã bỏ qua" : b?.sensitive ? "Nhạy cảm — cần duyệt kỹ" : group === "worth" ? "Đáng làm" : group === "watch" ? (decisionOf(it) === "watch" || it.status === "watch" ? "Đang theo dõi" : "Chờ đánh giá") : "Đang xử lý";
  const evidence = b ? (b.confidence === "sourced" ? "Có nguồn xác minh" : "Nguồn chưa xác minh") : null;
  const reason = group === "skipped" ? (it.status === "duplicate" ? "Trùng với trend đã có." : it.skipReason || b?.reason || it.error?.replace(/^Claude bỏ qua:\s*/i, "") || "Trend này không được chọn.") : b?.decisionRationale || b?.reason;
  const fb = it.facebookSourceUrl && safeUrl(it.facebookSourceUrl);
  return <article className="ds-card"><div className="ds-card-body flex flex-col gap-4">
    <div className="flex items-start justify-between gap-3 flex-wrap"><div className="min-w-0"><h2 className="text-base font-semibold text-stone-800 break-words">{b?.title || it.title}</h2><p className="text-xs text-stone-500 mt-1">{new Date(it.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })}{b?.traffic ? ` · Lượng tìm kiếm: ${b.traffic}` : ''}</p></div><div className="flex gap-1.5 flex-wrap">{it.discoverySource && <span className="ds-badge">{it.discoverySource === 'claude' ? 'Claude tự tìm' : 'Google Trends'}</span>}{evidence && <span className={`ds-badge ${b?.confidence === 'sourced' ? 'ds-badge-primary' : ''}`}>{evidence}</span>}<span className={`ds-badge ${group === 'skipped' ? '' : b?.sensitive ? 'ds-badge-warning' : group === 'worth' ? 'ds-badge-success' : 'ds-badge-info'}`}>{label}</span></div></div>
    {b?.summary && <section><h3 className="text-sm font-semibold text-stone-700">Chuyện gì đang xảy ra</h3><Summary text={b.summary} /></section>}
    {reason && !isTargetError(reason) && <section><h3 className="text-sm font-semibold text-stone-700">{group === 'skipped' ? 'Vì sao bỏ qua' : 'Vì sao đáng làm'}</h3><p className="text-sm text-stone-600 mt-1">{reason}</p></section>}
    {b?.pageAngles?.length ? <section><h3 className="text-sm font-semibold text-stone-700">Góc khai thác theo trang</h3><ul className="mt-1 text-sm text-stone-600 list-disc pl-5">{b.pageAngles.map((a, i) => <li key={i}>{a.pageName ? <strong>{a.pageName}: </strong> : null}{a.angle}</li>)}</ul></section> : b?.suggestedAngle && <p className="text-sm text-stone-600"><strong>Góc gợi ý:</strong> {b.suggestedAngle}</p>}
    {b && <SourceList sources={b.sources} />}
    {(it.contentPath || fb || (it.facebookReason && !isTargetError(it.facebookReason))) && <section className="border-t border-stone-100 pt-3"><h3 className="text-sm font-semibold text-stone-700">Bài Facebook dùng để remake</h3><div className="flex flex-wrap items-center gap-2 mt-1">{it.contentPath && <span className="ds-badge">{it.contentPath === 'facebook_post' ? 'Dựng từ bài Facebook' : 'Dựng từ tóm tắt tin tức'}</span>}{fb && <a href={fb.href} target="_blank" rel="noopener noreferrer" className="text-sm text-storm-700 underline">Mở bài Facebook gốc <span className="sr-only">(mở tab mới)</span></a>}</div>{it.facebookReason && !isTargetError(it.facebookReason) && <p className="text-sm text-stone-500 mt-1">{it.facebookReason}</p>}</section>}
    {it.error && group !== 'skipped' && !isTargetError(it.error) && <div role="alert" className="ds-alert ds-alert-warning">Trend này chưa xử lý xong. Hãy kiểm tra lại sau.</div>}
    {it.drafts.length > 0 && <section><h3 className="text-sm font-semibold text-stone-700 mb-2">Bản nháp từng trang</h3><div className="flex flex-col gap-2">{it.drafts.map(d => <div key={`${d.fanpageId}-${d.remakeId}`} className="border border-stone-200 rounded-lg p-3 flex items-center justify-between gap-2 flex-wrap"><div className="min-w-0"><div className="text-sm font-medium text-stone-800">{d.pageName}</div>{d.angle && <div className="text-sm text-stone-500">{d.angle}</div>}<span className={`ds-badge mt-1 ${d.status === 'ready' ? 'ds-badge-success' : d.status === 'error' ? 'ds-badge-danger' : 'ds-badge-info'}`}>{d.status === 'ready' ? 'Sẵn sàng' : d.status === 'error' ? 'Lỗi khi soạn' : 'Đang soạn'}</span>{d.status === 'error' && <p className="text-sm text-stone-600 mt-1">Chưa soạn được bản nháp. Hãy thử lại sau.</p>}</div>{d.status === 'ready' && d.remakeId && <Link to={`/remakes?remakeId=${encodeURIComponent(d.remakeId)}`} className="ds-btn ds-btn-sm">Mở bản nháp</Link>}</div>)}</div></section>}
    {b && group !== 'skipped' && <div><button type="button" className="ds-btn ds-btn-sm" onClick={onCard}><Eye className="w-4 h-4" aria-hidden="true" /> Xem trước thẻ Teams</button></div>}
  </div></article>;
}
