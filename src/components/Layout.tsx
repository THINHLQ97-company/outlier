import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LogOut, Radar, Images, Wand2, ShieldCheck, Fingerprint, Telescope, Scissors, PenLine } from "lucide-react";
import { useAppContext } from "../AppContext";

// Nav gọn theo bản tinh giản: Sáng tạo (Studio) · Thư viện (Ảnh/Nhân vật/Phong
// cách) · Thương hiệu (hồ sơ brand có trích dẫn nguồn) · Radar (content bật lên
// trong ngách) · Bóc cấu trúc (vì sao bài giữ được người xem) · Viết lại (viết
// cho thương hiệu + kiểm tra, khép kín vòng Radar→Bóc cấu trúc→Viết lại) ·
// Tín hiệu · (Quản trị, chỉ admin). Bỏ hẳn Kịch bản/Ảnh pipeline/Duyệt/Sẵn
// sàng đăng/Lịch — xem CLAUDE.md mục "tinh giản nav" + docs/PRD.md bản mới.
// Icon `Radar` đã dùng cho "Tín hiệu" nên mục Radar dùng `Telescope` để không
// trùng; Bóc cấu trúc dùng `Scissors`; Viết lại dùng `PenLine` (tránh trùng
// Wand2/Images/Radar/Fingerprint/Telescope/ShieldCheck/Scissors).
const NAV_ITEMS = [
  { to: "/studio", label: "Sáng tạo", icon: Wand2 },
  { to: "/library", label: "Thư viện", icon: Images },
  { to: "/brands", label: "Thương hiệu", icon: Fingerprint },
  { to: "/radar", label: "Radar", icon: Telescope },
  { to: "/deconstruct", label: "Bóc cấu trúc", icon: Scissors },
  { to: "/remakes", label: "Viết lại", icon: PenLine },
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
            <span className="flex items-center gap-2 shrink-0">
              <img src="/mark.svg" alt="" aria-hidden="true" className="w-7 h-7" />
              <span className="font-display font-bold text-storm-800 text-sm">Outlier</span>
            </span>
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
