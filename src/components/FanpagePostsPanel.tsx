import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ExternalLink, Megaphone, AlertTriangle, X, Heart, MessageCircle, Share2, Eye } from "lucide-react";
import {
  listFanpagePosts,
  syncFanpagePostsNow,
  createAdOrder,
  AD_ORDER_STATUS_LABEL,
  formatMoney,
  formatNumber,
  formatDay,
  formatDateTime,
  type FanpagePost,
  type FanpagePostsResult,
} from "../services/fanpage-ads";
import { imageDisplayUrl } from "../services/http";

// Danh mục bài của MỘT trang đã nối Meta: bài nào đang chạy quảng cáo nổi lên
// đầu, và ai cũng đặt được "bài này cần chạy quảng cáo".

function OrderModal({
  fanpageId,
  post,
  onClose,
  onDone,
}: {
  fanpageId: string;
  post: FanpagePost;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await createAdOrder(fanpageId, post.postId, note.trim());
      onDone(r.message);
    } catch (e: any) {
      setError(e?.message || "Không đặt được.");
    } finally {
      setBusy(false);
    }
  }

  const inputId = `ad-note-${post.postId}`;
  return (
    <div className="ds-modal-overlay open" onClick={onClose} role="dialog" aria-modal="true" aria-label="Đặt chạy quảng cáo">
      <div className="ds-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-stone-200">
          <h2 className="font-bold text-stone-800">Đặt chạy quảng cáo</h2>
          <button type="button" onClick={onClose} className="ds-btn ds-btn-ghost ds-btn-sm" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="ds-modal-body flex flex-col gap-3">
          <p className="text-sm text-stone-600 line-clamp-3">{post.message || "(Bài không có chữ)"}</p>
          <div>
            <label htmlFor={inputId} className="ds-label">
              Ghi chú cho người chạy quảng cáo (không bắt buộc)
            </label>
            <textarea
              id={inputId}
              className="ds-input"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: chạy 3 ngày, tệp khách hàng 25-40 tuổi…"
            />
          </div>
          {error && (
            <div className="ds-alert ds-alert-danger" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="ds-modal-footer">
          <button type="button" className="ds-btn" onClick={onClose} disabled={busy}>
            Thôi
          </button>
          <button type="button" className="ds-btn ds-btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Megaphone className="w-4 h-4" aria-hidden="true" />}
            Đặt chạy quảng cáo
          </button>
        </div>
      </div>
    </div>
  );
}

/** YYYY-MM-DD của `n` ngày trước, theo giờ Việt Nam — giá trị cho ô chọn ngày. */
function daysAgoISO(n: number): string {
  return new Date(Date.now() + 7 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);
}

/** Nhãn ngày đăng theo giờ VN, vd "Thứ Hai, 19/10/2026". */
function vnDay(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function PostRow({ post, onOrder }: { post: FanpagePost; onOrder: (p: FanpagePost) => void }) {
  const thumb = imageDisplayUrl(post.thumbnailUrl);
  const stopped = !post.adActive && !!post.adEndedAt;
  const order = post.openOrder;
  return (
    <li
      className={`flex gap-3 rounded-xl p-3 border ${
        post.adActive ? "border-storm-500 bg-storm-50 ring-1 ring-storm-200" : "border-stone-200 bg-white"
      }`}
    >
      {thumb ? (
        <img src={thumb} alt="" className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover shrink-0 bg-stone-100" loading="lazy" />
      ) : (
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-stone-100 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {post.adActive && (
            <span className="ds-badge ds-badge-primary ds-badge-dot">Đang chạy quảng cáo</span>
          )}
          {stopped && <span className="ds-badge ds-badge-warning">Đã dừng quảng cáo</span>}
          {post.createdTime && <span className="text-[11px] text-stone-400">Đăng {formatDay(post.createdTime)}</span>}
        </div>
        <p className="text-sm text-stone-700 mt-1 line-clamp-2">{post.message || "(Bài không có chữ)"}</p>

        {post.adActive && (
          <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-storm-700 font-medium flex-wrap">
            <span>Đã chi {formatMoney(post.adSpend, post.adCurrency)}</span>
            <span>{formatNumber(post.adImpressions)} lượt hiển thị</span>
            {post.adFirstSeenAt && <span>Chạy từ {formatDay(post.adFirstSeenAt)}</span>}
          </div>
        )}
        {stopped && (
          <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-amber-800 flex-wrap">
            <span>
              Đã chạy {post.adFirstSeenAt ? `${formatDay(post.adFirstSeenAt)} – ` : "đến "}
              {formatDay(post.adEndedAt!)}
            </span>
            <span>Tổng chi {formatMoney(post.adSpend, post.adCurrency)}</span>
            <span>{formatNumber(post.adImpressions)} lượt hiển thị</span>
          </div>
        )}

        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-stone-400 flex-wrap">
          <span className="inline-flex items-center gap-0.5"><Heart className="w-3 h-3" aria-hidden="true" />{formatNumber(post.likes)} thích</span>
          <span className="inline-flex items-center gap-0.5"><MessageCircle className="w-3 h-3" aria-hidden="true" />{formatNumber(post.comments)} bình luận</span>
          <span className="inline-flex items-center gap-0.5"><Share2 className="w-3 h-3" aria-hidden="true" />{formatNumber(post.shares)} chia sẻ</span>
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="text-storm-700 hover:underline inline-flex items-center gap-0.5">
              Xem bài <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          )}
        </div>

        <div className="mt-2">
          {order ? (
            <span className="ds-badge ds-badge-info">
              Đã đặt bởi {order.requestedBy} · {AD_ORDER_STATUS_LABEL[order.status]}
            </span>
          ) : (
            <button type="button" className="ds-btn ds-btn-sm" onClick={() => onOrder(post)}>
              <Megaphone className="w-3.5 h-3.5" aria-hidden="true" />
              Đặt chạy quảng cáo
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function FanpagePostsPanel({
  fanpageId,
  onChanged,
}: {
  fanpageId: string;
  /** Gọi sau khi đặt đơn / làm mới — để nơi chứa cập nhật số liệu nếu cần. */
  onChanged?: (data: FanpagePostsResult | null) => void;
}) {
  const [data, setData] = useState<FanpagePostsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adFilter, setAdFilter] = useState<"all" | "running" | "stopped">("all");
  const [syncing, setSyncing] = useState(false);
  const [ordering, setOrdering] = useState<FanpagePost | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Khoảng ngày đăng, mặc định 30 ngày gần nhất. Rỗng = không giới hạn.
  const [from, setFrom] = useState(() => daysAgoISO(30));
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await listFanpagePosts(fanpageId, { from, to });
      setData(r);
      setError(null);
      onChanged?.(r);
    } catch (e: any) {
      setError(e?.message || "Không tải được bài của trang.");
    } finally {
      setLoading(false);
    }
  }, [fanpageId, onChanged, from, to]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setAdFilter("all");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fanpageId]);

  // Đổi khoảng ngày thì tải lại, giữ nguyên bộ lọc "đang chạy quảng cáo".
  const firstRange = useRef(true);
  useEffect(() => {
    if (firstRange.current) {
      firstRange.current = false;
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function refresh() {
    setSyncing(true);
    setError(null);
    try {
      await syncFanpagePostsNow(fanpageId);
      await load();
    } catch (e: any) {
      setError(e?.message || "Không làm mới được.");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-500 py-4" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang tải bài của trang…
      </div>
    );
  }

  const items = data
    ? data.items.filter((p) =>
        adFilter === "running" ? p.adActive : adFilter === "stopped" ? !p.adActive && !!p.adEndedAt : true,
      )
    : [];
  // Chia theo ngày đăng (giờ VN) — server đã xếp mới nhất trước.
  const groups: { day: string; posts: FanpagePost[] }[] = [];
  for (const p of items) {
    const day = p.createdTime ? vnDay(p.createdTime) : "Không rõ ngày";
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.posts.push(p);
    else groups.push({ day, posts: [p] });
  }
  const activeCount = data?.activeCount ?? 0;
  const stoppedCount = data?.stoppedCount ?? 0;
  const filters = [
    { id: "all" as const, label: "Tất cả" },
    { id: "running" as const, label: `Đang chạy QC (${activeCount})` },
    { id: "stopped" as const, label: `Đã dừng QC (${stoppedCount})` },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5" role="group" aria-label="Lọc bài">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`ds-btn ds-btn-sm ${adFilter === f.id ? "ds-btn-primary" : ""}`}
              aria-pressed={adFilter === f.id}
              onClick={() => setAdFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="ds-btn ds-btn-sm" onClick={refresh} disabled={syncing}>
          {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
          Làm mới ngay
        </button>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="ds-label" htmlFor={`fp-from-${fanpageId}`}>Đăng từ ngày</label>
          <input
            id={`fp-from-${fanpageId}`}
            type="date"
            className="ds-input text-xs"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="ds-label" htmlFor={`fp-to-${fanpageId}`}>Đến ngày</label>
          <input
            id={`fp-to-${fanpageId}`}
            type="date"
            className="ds-input text-xs"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex gap-1" role="group" aria-label="Chọn nhanh khoảng ngày">
          {[
            { label: "7 ngày", f: daysAgoISO(7) },
            { label: "30 ngày", f: daysAgoISO(30) },
            { label: "Tất cả", f: "" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              className={`ds-btn ds-btn-sm ${from === o.f && !to ? "ds-btn-secondary" : "ds-btn-ghost"}`}
              onClick={() => {
                setFrom(o.f);
                setTo("");
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-stone-400">
        Xếp theo ngày đăng, mới nhất trước · cập nhật tự động mỗi giờ · lần cuối{" "}
        {data?.syncedAt ? formatDateTime(data.syncedAt) : "chưa có"}
      </p>

      {error && (
        <div className="ds-alert ds-alert-danger flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {toast && (
        <div className="ds-alert ds-alert-success" role="status">
          {toast}
        </div>
      )}

      {data && data.adsStatus && data.adsStatus !== "ok" && (
        <div className="ds-alert ds-alert-warning flex items-start gap-2" role="status">
          <Eye className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {data.adsStatus === "missing_ads_read"
              ? "Chưa xem được quảng cáo vì mã nối Meta thiếu quyền đọc quảng cáo. Cần lấy lại mã có quyền đọc quảng cáo ở phần nối Meta của trang. "
              : "Chưa xem được trạng thái quảng cáo của trang này. "}
            {data.adsNote}
          </span>
        </div>
      )}

      {data && !error && data.items.length === 0 ? (
        <div className="ds-empty">
          <div className="ds-empty-title">Không có bài nào trong khoảng ngày này</div>
          <p className="text-sm text-stone-500">
            {data.syncedAt ? "Thử chọn khoảng ngày rộng hơn." : "Chưa đồng bộ bài — bấm Làm mới ngay."}
          </p>
        </div>
      ) : data && items.length === 0 ? (
        <div className="ds-empty">
          <div className="ds-empty-title">
            {adFilter === "stopped"
              ? "Không có bài nào đã dừng quảng cáo trong khoảng ngày này"
              : "Không có bài nào đang chạy quảng cáo trong khoảng ngày này"}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <section key={g.day} aria-label={`Bài đăng ${g.day}`}>
              <h4 className="text-xs font-semibold text-stone-500 mb-1.5">
                {g.day} <span className="font-normal text-stone-400">· {g.posts.length} bài</span>
              </h4>
              <ul className="flex flex-col gap-2">
                {g.posts.map((p) => (
                  <PostRow key={p.postId} post={p} onOrder={setOrdering} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {ordering && (
        <OrderModal
          fanpageId={fanpageId}
          post={ordering}
          onClose={() => setOrdering(null)}
          onDone={(msg) => {
            setOrdering(null);
            setToast(msg);
            load();
          }}
        />
      )}
    </div>
  );
}
