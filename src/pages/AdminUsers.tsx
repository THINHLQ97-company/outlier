import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, Plus, X, KeyRound, Mail, Check } from "lucide-react";
import { listUsers, createUser, updateUser, inviteUser } from "../services/users";
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
      <div className="ds-card">
        <div className="ds-empty">
          <div className="ds-empty-icon">
            <ShieldAlert className="w-8 h-8" aria-hidden="true" />
          </div>
          <p className="ds-empty-title">Không có quyền truy cập</p>
          <p className="ds-empty-desc">Chỉ quản trị viên mới xem được trang này.</p>
        </div>
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
  const [showInvite, setShowInvite] = useState(false);
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
          <p className="text-sm text-stone-500">Cấp quyền đăng nhập Google, duyệt tài khoản chờ, đổi quyền/khoá.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInvite(true)} className="ds-btn ds-btn-primary">
            <Mail className="w-4 h-4" aria-hidden="true" /> Cấp quyền email (Google)
          </button>
          <button onClick={() => setShowCreate(true)} className="ds-btn" title="Tạo tài khoản nội bộ (username/mật khẩu)">
            <Plus className="w-4 h-4" aria-hidden="true" /> Tài khoản nội bộ
          </button>
        </div>
      </div>

      {/* Nhắc admin nếu có tài khoản Google đang chờ duyệt */}
      {items.some((u) => !u.isActive && u.authProvider === "google") && (
        <div className="ds-alert ds-alert-warning">
          Có {items.filter((u) => !u.isActive && u.authProvider === "google").length} tài khoản Google đang <b>chờ duyệt</b> — bấm "Duyệt" ở cột Hành động để cho phép đăng nhập.
        </div>
      )}

      {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}

      {loading ? (
        <div className="ds-card">
          <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="ds-card">
          <div className="ds-empty">
            <div className="ds-empty-icon">
              <Mail className="w-8 h-8" aria-hidden="true" />
            </div>
            <p className="ds-empty-title">Chưa có tài khoản nào</p>
            <p className="ds-empty-desc">Cấp quyền email Google hoặc tạo tài khoản nội bộ để bắt đầu.</p>
          </div>
        </div>
      ) : (
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Đăng nhập</th>
                <th>Quyền</th>
                <th>Trạng thái</th>
                <th>Ngày tạo</th>
                <th className="text-right">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => {
                const busy = busyId === u.id;
                return (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                        ) : (
                          <span className="w-6 h-6 rounded-full bg-stone-100 text-stone-400 flex items-center justify-center text-[11px] font-medium shrink-0">
                            {(u.email || u.username).charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className="font-medium text-stone-800 truncate">{u.email || u.username}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`ds-badge ${u.authProvider === "google" ? "ds-badge-info" : ""}`}>
                        {u.authProvider === "google" ? "Google" : "Nội bộ"}
                      </span>
                    </td>
                    <td>
                      <span className={`ds-badge ${u.role === "admin" ? "ds-badge-primary" : ""}`}>{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td>
                      <span className={`ds-badge ${u.isActive ? "ds-badge-success" : "ds-badge-danger"}`}>
                        {u.isActive ? "Active" : "Khoá"}
                      </span>
                    </td>
                    <td className="text-stone-500">{new Date(u.createdAt).toLocaleDateString("vi-VN")}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button onClick={() => handleRoleToggle(u)} disabled={busy} className="ds-btn ds-btn-sm">
                          {u.role === "admin" ? "Hạ thành viên" : "Nâng quản trị"}
                        </button>
                        <button
                          onClick={() => handleActiveToggle(u)}
                          disabled={busy}
                          className={`ds-btn ds-btn-sm ${u.isActive ? "" : "ds-btn-primary"}`}
                        >
                          {u.isActive ? "Khoá" : (<><Check className="w-3.5 h-3.5" aria-hidden="true" /> Duyệt</>)}
                        </button>
                        {u.authProvider !== "google" && (
                          <button onClick={() => setResetTarget(u)} disabled={busy} className="ds-btn ds-btn-sm">
                            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> Đặt lại mật khẩu
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <InviteUserModal
          onClose={() => setShowInvite(false)}
          onDone={(row) => {
            setItems((prev) => {
              const exists = prev.some((x) => x.id === row.id);
              return exists ? prev.map((x) => (x.id === row.id ? row : x)) : [row, ...prev];
            });
            setShowInvite(false);
          }}
        />
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

function InviteUserModal({ onClose, onDone }: { onClose: () => void; onDone: (row: UserRow) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const row = await inviteUser(email.trim().toLowerCase(), role);
      onDone(row);
    } catch (e: any) {
      setError(e?.message || "Cấp quyền email thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <div className="ds-modal-header">
          <h3 id="invite-title" className="ds-modal-title font-display">
            Cấp quyền đăng nhập Google
          </h3>
          <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <p className="text-xs text-stone-500">
            Nhập email Google của người bạn muốn cho đăng nhập. Họ vào trang đăng nhập → bấm "Đăng nhập bằng Google" bằng đúng email này là vào được (không cần mật khẩu).
          </p>
          <div>
            <label className="ds-label" htmlFor="iv-email">Email Google</label>
            <input
              id="iv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ten@gmail.com"
              className="ds-input"
            />
          </div>
          <div>
            <label className="ds-label" htmlFor="iv-role">Quyền</label>
            <select id="iv-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="ds-select">
              <option value="member">Thành viên</option>
              <option value="admin">Quản trị viên</option>
            </select>
          </div>
          {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}
          <button type="submit" disabled={saving} className="ds-btn ds-btn-primary justify-center mt-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Cấp quyền
          </button>
        </form>
      </div>
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
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
        <div className="ds-modal-header">
          <h3 id="create-user-title" className="ds-modal-title font-display">
            Thêm user
          </h3>
          <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <div>
            <label className="ds-label" htmlFor="nu-username">Tên đăng nhập</label>
            <input id="nu-username" required value={username} onChange={(e) => setUsername(e.target.value)} className="ds-input" />
          </div>
          <div>
            <label className="ds-label" htmlFor="nu-password">Mật khẩu (≥ 6 ký tự)</label>
            <input
              id="nu-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="ds-input"
            />
          </div>
          <div>
            <label className="ds-label" htmlFor="nu-role">Quyền</label>
            <select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="ds-select">
              <option value="member">Thành viên</option>
              <option value="admin">Quản trị viên</option>
            </select>
          </div>
          {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}
          <button type="submit" disabled={saving} className="ds-btn ds-btn-primary justify-center mt-2">
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
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-w-sm" role="dialog" aria-modal="true" aria-labelledby="reset-pw-title">
        <div className="ds-modal-header">
          <h3 id="reset-pw-title" className="ds-modal-title font-display">
            Đặt lại mật khẩu — {user.username}
          </h3>
          <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <div>
            <label className="ds-label" htmlFor="rp-password">Mật khẩu mới (≥ 6 ký tự)</label>
            <input
              id="rp-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="ds-input"
            />
          </div>
          {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}
          <button type="submit" disabled={saving} className="ds-btn ds-btn-primary justify-center mt-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Cập nhật mật khẩu
          </button>
        </form>
      </div>
    </div>
  );
}
