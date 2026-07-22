import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LogOut, Radar, Images, Wand2, ShieldCheck } from "lucide-react";
import { useAppContext } from "../AppContext";

// Nav gọn theo bản tinh giản: Sáng tạo (Studio) · Thư viện (Ảnh/Nhân vật/Phong
// cách) · Tín hiệu · (Quản trị, chỉ admin). Bỏ hẳn Kịch bản/Ảnh pipeline/Duyệt/
// Sẵn sàng đăng/Lịch — xem CLAUDE.md mục "tinh giản nav" + docs/PRD.md bản mới.
const NAV_ITEMS = [
  { to: "/studio", label: "Sáng tạo", icon: Wand2 },
  { to: "/library", label: "Thư viện", icon: Images },
  { to: "/signals", label: "Tín hiệu", icon: Radar },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { username, isAdmin, logout } = useAppContext();
  const navItems = isAdmin ? [...NAV_ITEMS, { to: "/admin/users", label: "Quản trị", icon: ShieldCheck }] : NAV_ITEMS;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-stone-200 bg-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="font-display font-bold text-storm-800 text-sm shrink-0">Ăn Nằm Với AI</span>
            <nav className="flex items-center gap-1" aria-label="Điều hướng chính">
              {navItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive ? "bg-storm-100 text-storm-800" : "text-stone-500 hover:bg-stone-100"
                    }`
                  }
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-stone-500">
            <span>{username}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-stone-100 text-stone-500"
              aria-label="Đăng xuất"
              title="Đăng xuất"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
