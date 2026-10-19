import { useCallback, useEffect, useState } from "react";
import { Loader2, ExternalLink, Megaphone, UserCog, AlertTriangle, Plus, ChevronUp, Bot } from "lucide-react";
import {
  listAdOrders,
  patchAdOrder,
  setAdsRunner,
  listAdsRunnerCandidates,
  listConnectedFanpages,
  AD_ORDER_STATUS_LABEL,
  formatMoney,
  formatNumber,
  formatDateTime,
  type AdOrderList,
  type AdOrderListItem,
  type AdOrderStatus,
  type ConnectedFanpage,
} from "../services/fanpage-ads";
import { imageDisplayUrl } from "../services/http";
import FanpagePostsPanel from "../components/FanpagePostsPanel";

const TABS: AdOrderStatus[] = ["cho_chay", "dang_chay", "da_xong", "huy"];

const BADGE: Record<AdOrderStatus, string> = {
  cho_chay: "ds-badge-warning",
  dang_chay: "ds-badge-primary",
  da_xong: "ds-badge-success",
  huy: "",
};

// Nút đổi trạng thái hiện cho người quản lý theo trạng thái hiện tại.
const NEXT_ACTIONS: Record<AdOrderStatus, { to: AdOrderStatus; label: string; danger?: boolean }[]> = {
  cho_chay: [
    { to: "dang_chay", label: "Bắt đầu chạy" },
    { to: "huy", label: "Huỷ đơn", danger: true },
  ],
  dang_chay: [
    { to: "da_xong", label: "Đánh dấu đã xong" },
    { to: "cho_chay", label: "Đưa về chờ chạy" },
    { to: "huy", label: "Huỷ đơn", danger: true },
  ],
  da_xong: [{ to: "dang_chay", label: "Chạy lại" }],
  huy: [{ to: "cho_chay", label: "Mở lại đơn" }],
};

function RunnerLine({ runner, canChange, onChanged }: { runner: string | null; canChange: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [cands, setCands] = useState<{ username: string; email: string | null }[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setEditing(true);
    setError(null);
    try {
      const list = await listAdsRunnerCandidates();
      setCands(list);
      setPick(runner || list[0]?.username || "");
    } catch (e: any) {
      setError(e?.message || "Không tải được danh sách người dùng.");
    }
  }

  async function save() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      await setAdsRunner(pick);
      setEditing(false);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không đổi được người chạy quảng cáo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <UserCog className="w-4 h-4 text-storm-600" aria-hidden="true" />
        <span className="text-stone-600">Người chạy quảng cáo:</span>
        {runner ? <strong className="text-stone-800">{runner}</strong> : <span className="text-amber-700 font-medium">Chưa có</span>}
        {canChange && !editing && (
          <button type="button" className="ds-btn ds-btn-sm" onClick={open}>
            {runner ? "Đổi người" : "Chọn người"}
          </button>
        )}
      </div>
      {editing && (
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label htmlFor="ads-runner-select" className="ds-label">
              Chọn người nhận đơn
            </label>
            <select id="ads-runner-select" className="ds-select" value={pick} onChange={(e) => setPick(e.target.value)}>
              {cands.map((c) => (
                <option key={c.username} value={c.username}>
                  {c.username}
                  {c.email ? ` (${c.email})` : ""}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="ds-btn ds-btn-primary" onClick={save} disabled={busy || !pick}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu
          </button>
          <button type="button" className="ds-btn" onClick={() => setEditing(false)} disabled={busy}>
            Thôi
          </button>
        </div>
      )}
      {error && (
        <div className="ds-alert ds-alert-danger" role="alert">
          {error}
        </div>
      )}
      {!runner && (
        <div className="ds-alert ds-alert-warning flex items-start gap-2" role="status">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Chưa có người chạy quảng cáo nên đơn đặt ra chưa ai nhận.
            {canChange ? " Hãy chọn một người ở trên." : " Nhờ quản trị viên chọn người nhận đơn."}
          </span>
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  me,
  canManage,
  busy,
  onAction,
}: {
  order: AdOrderListItem;
  me: string;
  canManage: boolean;
  busy: boolean;
  onAction: (o: AdOrderListItem, to: AdOrderStatus) => void;
}) {
  const thumb = imageDisplayUrl(order.postThumbnailUrl);
  const actions: { to: AdOrderStatus; label: string; danger?: boolean }[] = canManage
    ? NEXT_ACTIONS[order.status]
    : me === order.requestedBy && order.status === "cho_chay"
      ? [{ to: "huy", label: "Huỷ đơn", danger: true }]
      : [];
  const ad = order.ad;
  return (
    <li className="ds-card">
      <div className="p-3 flex gap-3">
        {thumb ? (
          <img src={thumb} alt="" className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover shrink-0 bg-stone-100" loading="lazy" />
        ) : (
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-stone-100 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`ds-badge ${BADGE[order.status]}`}>{AD_ORDER_STATUS_LABEL[order.status]}</span>
            {order.statusBy === "system" && (
              <span className="ds-badge ds-badge-info inline-flex items-center gap-1">
                <Bot className="w-3 h-3" aria-hidden="true" /> Hệ thống tự cập nhật
              </span>
            )}
            <span className="text-[11px] text-stone-400">
              {order.pageName || "Trang"}
              {order.brandName ? ` · ${order.brandName}` : ""}
            </span>
          </div>
          <p className="text-sm text-stone-700 mt-1 line-clamp-2">{order.postMessage || "(Bài không có chữ)"}</p>
          <div className="text-[11px] text-stone-400 mt-1 flex gap-x-3 gap-y-0.5 flex-wrap">
            <span>
              Đặt bởi {order.requestedBy} · {formatDateTime(order.createdAt)}
            </span>
            {order.assignee && <span>Người chạy: {order.assignee}</span>}
            {order.startedAt && <span>Bắt đầu {formatDateTime(order.startedAt)}</span>}
            {order.endedAt && <span>Kết thúc {formatDateTime(order.endedAt)}</span>}
          </div>
          {order.note && <p className="text-xs text-stone-600 mt-1.5 bg-stone-50 border border-stone-200 rounded-md px-2 py-1">Ghi chú: {order.note}</p>}
          {ad && (ad.active || ad.spend != null || ad.impressions != null) && (
            <div className="flex gap-x-4 gap-y-1 mt-1.5 text-xs text-storm-700 font-medium flex-wrap">
              <span>Đã chi {formatMoney(ad.spend, ad.currency)}</span>
              <span>{formatNumber(ad.impressions)} lượt hiển thị</span>
              <span>{formatNumber(ad.reach)} người tiếp cận</span>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {order.postPermalink && (
              <a href={order.postPermalink} target="_blank" rel="noreferrer" className="ds-btn ds-btn-sm ds-btn-ghost">
                Mở bài <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
            {actions.map((a) => (
              <button
                key={a.to}
                type="button"
                className={`ds-btn ds-btn-sm ${a.danger ? "ds-btn-danger" : a.to === "dang_chay" || a.to === "da_xong" ? "ds-btn-primary" : ""}`}
                disabled={busy}
                onClick={() => onAction(order, a.to)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function AdOrders() {
  const [data, setData] = useState<AdOrderList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AdOrderStatus>("cho_chay");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [placing, setPlacing] = useState(false);
  const [pages, setPages] = useState<ConnectedFanpage[] | null>(null);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pageId, setPageId] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await listAdOrders());
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Không tải được đơn đặt quảng cáo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openPlacing() {
    setPlacing(true);
    if (pages) return;
    try {
      const list = await listConnectedFanpages();
      setPages(list);
      if (list[0]) setPageId(list[0].id);
    } catch (e: any) {
      setPagesError(e?.message || "Không tải được danh sách trang.");
    }
  }

  async function act(o: AdOrderListItem, to: AdOrderStatus) {
    setBusyId(o.id);
    setError(null);
    try {
      await patchAdOrder(o.id, { status: to });
      await load();
    } catch (e: any) {
      setError(e?.message || "Không lưu được.");
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items ?? [];
  const count = (s: AdOrderStatus) => items.filter((i) => i.status === s).length;
  const shown = items.filter((i) => i.status === tab);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Đặt quảng cáo</h1>
          <p className="text-sm text-stone-500">
            Chọn bài trên trang nhà cần chạy quảng cáo, người chạy quảng cáo sẽ nhận đơn. Đơn tự chuyển sang "Đang chạy" khi hệ thống
            thấy quảng cáo thật đang chạy, và tự sang "Đã xong" khi quảng cáo tắt. Số liệu cập nhật mỗi giờ.
          </p>
        </div>
        <button type="button" className="ds-btn ds-btn-primary" onClick={() => (placing ? setPlacing(false) : openPlacing())} aria-expanded={placing}>
          {placing ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
          {placing ? "Đóng" : "Đặt đơn mới"}
        </button>
      </div>

      {data && <RunnerLine runner={data.runner} canChange={data.canManage && !!data} onChanged={load} />}

      {placing && (
        <div className="ds-card">
          <div className="ds-card-body flex flex-col gap-3">
            <h2 className="font-semibold text-stone-800 inline-flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-storm-600" aria-hidden="true" /> Chọn trang rồi chọn bài
            </h2>
            {pagesError && (
              <div className="ds-alert ds-alert-danger" role="alert">
                {pagesError}
              </div>
            )}
            {pages && pages.length === 0 && (
              <div className="ds-empty">
                <div className="ds-empty-title">Chưa có trang nào nối Meta</div>
                <p className="text-sm text-stone-500">Vào menu Thương hiệu, nối Meta cho trang rồi quay lại đây.</p>
              </div>
            )}
            {pages && pages.length > 0 && (
              <>
                <div className="max-w-sm">
                  <label htmlFor="ad-page-select" className="ds-label">
                    Trang
                  </label>
                  <select id="ad-page-select" className="ds-select" value={pageId} onChange={(e) => setPageId(e.target.value)}>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.pageName || "Trang chưa đặt tên"} — {p.brandName}
                      </option>
                    ))}
                  </select>
                </div>
                {pageId && <FanpagePostsPanel key={pageId} fanpageId={pageId} onChanged={() => load()} />}
              </>
            )}
            {!pages && !pagesError && (
              <div className="flex items-center gap-2 text-sm text-stone-500" role="status">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang tải danh sách trang…
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Trạng thái đơn">
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            className={`ds-btn ds-btn-sm whitespace-nowrap ${tab === s ? "ds-btn-primary" : ""}`}
            onClick={() => setTab(s)}
          >
            {AD_ORDER_STATUS_LABEL[s]} ({count(s)})
          </button>
        ))}
      </div>

      {error && (
        <div className="ds-alert ds-alert-danger" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-stone-500" role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang tải đơn…
        </div>
      ) : shown.length === 0 ? (
        <div className="ds-empty">
          <div className="ds-empty-title">Chưa có đơn nào ở mục "{AD_ORDER_STATUS_LABEL[tab]}"</div>
          {tab === "cho_chay" && <p className="text-sm text-stone-500">Bấm "Đặt đơn mới" để chọn bài cần chạy quảng cáo.</p>}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((o) => (
            <OrderCard key={o.id} order={o} me={data!.me} canManage={data!.canManage} busy={busyId === o.id} onAction={act} />
          ))}
        </ul>
      )}
    </div>
  );
}
