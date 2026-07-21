import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, Plus, X, KeyRound } from "lucide-react";
import { listUsers, createUser, updateUser } from "../services/users";
import { useAppContext } from "../AppContext";
import type { UserRow, Role } from "../types";

const ROLE_LABEL: Record<Role, string> = { admin: "Quản trị viên", member: "Thành viên" };

// Quản lý user (chỉ admin) — bảng tài khoản + thêm mới + đổi role/active/mật
// khẩu. Bảo vệ ở FE (ẩn nội dung, không gọi API) — server cũng tự guard bằng
// requireAdmin (server/routes/users.routes.ts), đây chỉ là UX-level gate.
export default function AdminUsers() {
  const { isAdmin } = useAppContext();

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center text-stone-500">
        <ShieldAlert className="w-8 h-8 text-stone-300" aria-hidden="true" />
        <p className="text-sm">Chỉ quản trị viên mới xem được trang này.</p>
      </div>
    );
  }
  return <AdminUsersInner />;
}

function AdminUsersInner() {
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listUsers());
    } catch (e: any) {
      setError(e?.message || "Lỗi tải danh sách tài khoản.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleRoleToggle(u: UserRow) {
    setBusyId(u.id);
    setError(null);
    try {
      const nextRole: Role = u.role === "admin" ? "member" : "admin";
      const row = await updateUser(u.id, { role: nextRole });
      setItems((prev) => prev.map((x) => (x.id === u.id ? row : x)));
    } catch (e: any) {
      setError(e?.message || "Đổi quyền thất bại.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleActiveToggle(u: UserRow) {
    setBusyId(u.id);
    setError(null);
    try {
      const row = await updateUser(u.id, { isActive: !u.isActive });
      setItems((prev) => prev.map((x) => (x.id === u.id ? row : x)));
    } catch (e: any) {
      setError(e?.message || "Đổi trạng thái thất bại.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Quản lý tài khoản</h1>
          <p className="text-sm text-stone-500">Thêm/sửa quyền, khoá/mở khoá, đặt lại mật khẩu.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-3 py-2 rounded-lg"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Thêm user
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-stone-50 text-left text-xs font-medium text-stone-500 border-b border-stone-200">
                <th className="px-4 py-2.5">Tên đăng nhập</th>
                <th className="px-4 py-2.5">Quyền</th>
                <th className="px-4 py-2.5">Trạng thái</th>
                <th className="px-4 py-2.5">Ngày tạo</th>
                <th className="px-4 py-2.5 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-stone-800">{u.username}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          u.role === "admin" ? "bg-storm-50 text-storm-700" : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {ROLE_LABEL[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          u.isActive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                        }`}
                      >
                        {u.isActive ? "Active" : "Khoá"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-stone-500">{new Date(u.createdAt).toLocaleDateString("vi-VN")}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          onClick={() => handleRoleToggle(u)}
                          disabled={busy}
                          className="text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1 rounded-lg disabled:opacity-50"
                        >
                          {u.role === "admin" ? "Hạ thành viên" : "Nâng quản trị"}
                        </button>
                        <button
                          onClick={() => handleActiveToggle(u)}
                          disabled={busy}
                          className={`text-xs font-medium px-2 py-1 rounded-lg disabled:opacity-50 ${
                            u.isActive ? "text-red-600 hover:bg-red-50" : "text-green-700 hover:bg-green-50"
                          }`}
                        >
                          {u.isActive ? "Khoá" : "Mở khoá"}
                        </button>
                        <button
                          onClick={() => setResetTarget(u)}
                          disabled={busy}
                          className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1 rounded-lg disabled:opacity-50"
                        >
                          <KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> Đặt lại mật khẩu
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(row) => {
            setItems((prev) => [row, ...prev]);
            setShowCreate(false);
          }}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={(row) => {
            setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)));
            setResetTarget(null);
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (row: UserRow) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Mật khẩu phải từ 6 ký tự trở lên.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const row = await createUser({ username: username.trim(), password, role });
      onCreated(row);
    } catch (e: any) {
      // 409 (trùng username) hoặc lỗi khác — thông báo rõ.
      setError(e?.message || "Tạo tài khoản thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="font-semibold text-stone-800 font-display">Thêm user</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="nu-username">Tên đăng nhập</label>
            <input
              id="nu-username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="nu-password">Mật khẩu (≥ 6 ký tự)</label>
            <input
              id="nu-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="nu-role">Quyền</label>
            <select
              id="nu-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="member">Thành viên</option>
              <option value="admin">Quản trị viên</option>
            </select>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <button
            type="submit"
            disabled={saving}
            className="mt-2 flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Tạo tài khoản
          </button>
        </form>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: UserRow;
  onClose: () => void;
  onDone: (row: UserRow) => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Mật khẩu phải từ 6 ký tự trở lên.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const row = await updateUser(user.id, { password });
      onDone(row);
    } catch (e: any) {
      setError(e?.message || "Đặt lại mật khẩu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="font-semibold text-stone-800 font-display">Đặt lại mật khẩu — {user.username}</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="rp-password">Mật khẩu mới (≥ 6 ký tự)</label>
            <input
              id="rp-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <button
            type="submit"
            disabled={saving}
            className="mt-2 flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Cập nhật mật khẩu
          </button>
        </form>
      </div>
    </div>
  );
}
