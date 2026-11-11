import { useEffect, useState } from "react";
import { Activity, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { useAppContext } from "../AppContext";
import { getActivity, type ActivitySnapshot } from "../services/activity";

const eventLabel: Record<string, string> = { login: "Đăng nhập", heartbeat: "Đang dùng app" };
const fmt = (v?: string | null) => v ? new Date(v).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) : "Chưa có";

export default function AdminActivity() {
  const { isAdmin } = useAppContext();
  const [data, setData] = useState<ActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function reload() { setLoading(true); setError(null); try { setData(await getActivity()); } catch (e: any) { setError(e?.message || "Không tải được log hoạt động."); } finally { setLoading(false); } }
  useEffect(() => { if (isAdmin) void reload(); }, [isAdmin]);
  if (!isAdmin) return <div className="ds-card"><div className="ds-empty"><ShieldAlert className="w-8 h-8" aria-hidden="true" /><p className="ds-empty-title">Không có quyền truy cập</p></div></div>;
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between gap-3 flex-wrap"><div><h1 className="text-lg font-bold text-stone-800 font-display">Log hoạt động</h1><p className="text-sm text-stone-500">Theo dõi tài khoản đang hoạt động và lịch sử 30 ngày gần nhất. Online nghĩa là có thao tác trong 3 phút vừa qua.</p></div><button type="button" className="ds-btn ds-btn-sm" onClick={() => void reload()} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Làm mới</button></div>
    {error && <div className="ds-alert ds-alert-danger">{error}</div>}
    {loading && !data ? <div className="ds-card flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-storm-600" aria-label="Đang tải" /></div> : data && <>
      <div className="ds-card"><div className="ds-card-body"><h2 className="font-semibold text-stone-800 flex items-center gap-2"><Activity className="w-4 h-4" aria-hidden="true" /> Đang hoạt động ({data.online.length})</h2>{data.online.length === 0 ? <p className="text-sm text-stone-500 mt-3">Hiện chưa có tài khoản nào đang hoạt động.</p> : <div className="flex flex-wrap gap-2 mt-3">{data.online.map(u => <span key={u.username} className="ds-badge ds-badge-success">● {u.email || u.username}</span>)}</div>}</div></div>
      <div className="ds-table-wrap"><table className="ds-table"><caption className="sr-only">Tài khoản và lần hoạt động gần nhất</caption><thead><tr><th>Tài khoản</th><th>Trạng thái</th><th>Hoạt động cuối</th><th>Loại</th></tr></thead><tbody>{data.users.map(u => <tr key={u.username}><td><span className="font-medium">{u.email || u.username}</span>{u.role === "admin" && <span className="ds-badge ds-badge-primary ml-2">Admin</span>}</td><td><span className={`ds-badge ${u.online ? "ds-badge-success" : ""}`}>{u.online ? "Đang hoạt động" : u.isActive ? "Không hoạt động" : "Đã khoá"}</span></td><td className="text-stone-500">{fmt(u.lastActivityAt)}</td><td className="text-stone-500">{eventLabel[u.lastEvent || ""] || u.lastEvent || "—"}</td></tr>)}</tbody></table></div>
      <div className="ds-table-wrap"><table className="ds-table"><caption className="text-left font-semibold text-stone-800 mb-3">Lịch sử gần nhất</caption><thead><tr><th>Thời gian</th><th>Tài khoản</th><th>Sự kiện</th><th>Trang</th></tr></thead><tbody>{data.history.map(h => <tr key={h.id}><td className="text-stone-500">{fmt(h.createdAt)}</td><td>{h.username}</td><td>{eventLabel[h.event] || h.event}</td><td className="text-stone-500 truncate max-w-[280px]">{h.path || "—"}</td></tr>)}</tbody></table></div>
    </>}
  </div>;
}
