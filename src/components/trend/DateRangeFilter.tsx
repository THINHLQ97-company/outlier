import { useState } from "react";

export type DatePreset = "today" | "7" | "30" | "all" | "custom";
export interface DateRange { preset: DatePreset; from: string; to: string }
export const vietnamDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const displayDay = (day: string) => day ? day.split("-").reverse().join("/") : "";
export function inDateRange(iso: string, range: DateRange): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const key = vietnamDay(d);
  const today = vietnamDay(new Date());
  if (range.preset === "all") return true;
  if (range.preset === "custom") return (!range.from || key >= range.from) && (!range.to || key <= range.to);
  const days = range.preset === "today" ? 1 : Number(range.preset);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return key >= start.toISOString().slice(0, 10) && key <= today;
}
export function rangeDescription(range: DateRange): string {
  if (range.preset === "today") return "hôm nay";
  if (range.preset === "7" || range.preset === "30") return `${range.preset} ngày qua`;
  if (range.preset === "custom") return range.from && range.to ? `từ ${displayDay(range.from)} đến ${displayDay(range.to)}` : range.from ? `từ ${displayDay(range.from)}` : range.to ? `đến ${displayDay(range.to)}` : "khoảng ngày đã chọn";
  return "tất cả thời gian";
}
export default function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (value: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const invalid = !!from && !!to && from > to;
  return <div className="flex flex-col gap-2">
    <div className="text-sm font-semibold text-stone-700">Thời gian</div>
    <div className="flex flex-wrap gap-2" aria-label="Lọc theo thời gian">
      {([['today', 'Hôm nay'], ['7', '7 ngày'], ['30', '30 ngày'], ['all', 'Tất cả']] as const).map(([key, label]) => <button key={key} type="button" className={`ds-btn ds-btn-sm ${value.preset === key ? 'ds-btn-primary' : ''}`} aria-pressed={value.preset === key} onClick={() => { onChange({ ...value, preset: key }); setOpen(false); }}>{label}</button>)}
      <button type="button" className={`ds-btn ds-btn-sm ${value.preset === 'custom' ? 'ds-btn-primary' : ''}`} aria-expanded={open} aria-controls="trend-date-custom" onClick={() => setOpen(!open)}>Tuỳ chọn{value.preset === 'custom' && (value.from || value.to) ? `: ${displayDay(value.from) || '…'} – ${displayDay(value.to) || '…'}` : ''}</button>
    </div>
    {open && <div id="trend-date-custom" className="rounded-lg border border-stone-200 bg-white p-3 flex flex-col sm:flex-row sm:items-end gap-3">
      <div><label htmlFor="trend-date-from" className="ds-label">Từ ngày {from && `(${displayDay(from)})`}</label><input id="trend-date-from" className="ds-input w-full" type="date" value={from} onChange={e => setFrom(e.target.value)} aria-invalid={invalid} /></div>
      <div><label htmlFor="trend-date-to" className="ds-label">Đến ngày {to && `(${displayDay(to)})`}</label><input id="trend-date-to" className="ds-input w-full" type="date" value={to} onChange={e => setTo(e.target.value)} aria-invalid={invalid} aria-describedby={invalid ? 'trend-date-error' : undefined} /></div>
      <button type="button" className="ds-btn ds-btn-primary" disabled={invalid} onClick={() => { onChange({ preset: 'custom', from, to }); setOpen(false); }}>Áp dụng</button>
    </div>}
    {open && invalid && <p id="trend-date-error" role="alert" className="text-sm text-red-700">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
  </div>;
}
