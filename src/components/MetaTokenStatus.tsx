import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Infinity as InfinityIcon, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { listMetaTokens, checkMetaTokens, type MetaTokenStatusRow } from "../services/meta-tokens";

// Tình trạng token Meta — và lời hứa rằng người dùng không phải làm gì.
//
// Trước đây chỗ này chỉ có ô dán token và nút đổi tay. Token từ Graph API
// Explorer sống một giờ, nên "đổi tay" nghĩa là gần như mỗi ngày mở ra dán lại.
// Giờ hệ thống tự nâng token lúc nối và tự gia hạn hằng ngày; khu này để người
// dùng NHÌN THẤY điều đó đang xảy ra, thay vì phải tin.
//
// Vẫn nói thẳng khi không tự lo được: thiếu META_APP_ID/SECRET thì Meta không
// cho gia hạn, và im lặng ở đây sẽ khiến người dùng tưởng mọi thứ ổn tới lúc
// quét bài thất bại.

function StatusBadge({ row }: { row: MetaTokenStatusRow }) {
  if (row.neverExpires) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-700">
        <InfinityIcon className="w-3 h-3" aria-hidden="true" /> Không hết hạn
      </span>
    );
  }
  if (row.status === "expired" || row.status === "invalid") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-700">
        <AlertTriangle className="w-3 h-3" aria-hidden="true" /> Hết hạn — cần nối lại
      </span>
    );
  }
  if (row.status === "expiring") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
        <Clock className="w-3 h-3" aria-hidden="true" /> Còn {row.daysLeft} ngày
      </span>
    );
  }
  if (row.daysLeft != null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
        <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Còn {row.daysLeft} ngày
      </span>
    );
  }
  return (
    <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">Chưa kiểm</span>
  );
}

export default function MetaTokenStatus() {
  const [rows, setRows] = useState<MetaTokenStatusRow[]>([]);
  const [autoRenew, setAutoRenew] = useState<boolean | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSweep, setLastSweep] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const out = await listMetaTokens();
      setRows(out.pages);
      setAutoRenew(out.autoRenewEnabled);
      setReason(out.reason);
    } catch (e: any) {
      setError(e?.message || "Không đọc được tình trạng token.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCheck() {
    setChecking(true);
    setError(null);
    try {
      const out = await checkMetaTokens();
      if (!out.ran) {
        setError(out.skippedReason || "Chưa dò được.");
      } else {
        setLastSweep(
          `Đã kiểm ${out.checked} trang, gia hạn ${out.renewed}.` +
            (out.needsAttention.length ? ` ${out.needsAttention.length} trang cần nối lại.` : ""),
        );
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Dò token thất bại.");
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-stone-400 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang đọc tình trạng token...
      </div>
    );
  }

  return (
    <div className="border border-stone-200 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-stone-800">Hạn dùng token Meta</h4>
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          className="ds-btn ds-btn-ghost ds-btn-sm"
          title="Dò lại ngay. Bình thường hệ thống tự làm 12 giờ một lượt."
        >
          {checking ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          Kiểm ngay
        </button>
      </div>

      {autoRenew ? (
        <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 mt-2">
          Tự gia hạn đang bật. Hệ thống dò 12 giờ một lượt và tự đổi token trước khi hết hạn — bạn không phải dán lại
          token.
        </p>
      ) : (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
          {reason}
        </p>
      )}

      {lastSweep && <p className="text-[11px] text-stone-500 mt-1.5">{lastSweep}</p>}
      {error && (
        <div role="alert" className="ds-alert ds-alert-danger mt-2 !text-xs">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-stone-400 mt-2">Chưa có trang nào nối Meta.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 mt-2">
          {rows.map((r) => (
            <li key={r.fanpageId} className="border border-stone-200 rounded-lg px-2.5 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-stone-800 flex-1 min-w-0 truncate">
                  {r.pageName || r.fanpageId}
                </span>
                <StatusBadge row={r} />
              </div>
              {r.note && <p className="text-[11px] text-stone-500 mt-1">{r.note}</p>}
              <p className="text-[10px] text-stone-400 mt-0.5">
                {r.checkedAt ? `Kiểm lần cuối: ${new Date(r.checkedAt).toLocaleString("vi-VN")}` : "Chưa kiểm lần nào"}
                {r.renewedAt ? ` · Gia hạn lần cuối: ${new Date(r.renewedAt).toLocaleString("vi-VN")}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
