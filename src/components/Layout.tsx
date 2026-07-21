import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { LogOut, Radar, PenLine, Image as ImageIcon, ClipboardCheck, Send } from "lucide-react";
import { useAppContext } from "../AppContext";

const NAV_ITEMS = [
  { to: "/signals", label: "Tín hiệu", icon: Radar },
  { to: "/scripts", label: "Kịch bản", icon: PenLine },
  { to: "/image-studio", label: "Ảnh", icon: ImageIcon },
  { to: "/approval", label: "Duyệt", icon: ClipboardCheck },
  { to: "/ready", label: "Sẵn sàng đăng", icon: Send },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { username, logout } = useAppContext();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-stone-200 bg-white sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <span className="font-display font-bold text-storm-800 text-sm shrink-0">Ăn Nằm Với AI</span>
            <nav className="flex items-center gap-1" aria-label="Điều hướng chính">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
