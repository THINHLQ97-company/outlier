import { type ReactNode, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Plug,
  Wallet,
  LogOut,
  Radar,
  Images,
  Wand2,
  ShieldCheck,
  Fingerprint,
  Telescope,
  Scissors,
  PenLine,
  Eye,
  Clapperboard,
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useAppContext } from "../AppContext";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Wand2;
  /** Vào được nhưng chưa ổn định — làm mờ và dán tem để không ai tưởng đã xong. */
  wip?: boolean;
};
type NavGroup = { label: string; items: NavItem[] };

// Sidebar dọc, nhóm theo luồng công việc (yêu cầu chuyển đổi 2026-09-22 —
// 9 mục phẳng trước đây rối, xem thảo luận trong lịch sử chat). Icon giữ
// nguyên bộ đã chọn từ bản nav ngang để không trùng (Radar đã dùng cho "Tín
// hiệu" nên Radar/ngách dùng Telescope; Bóc cấu trúc dùng Scissors; Viết lại
// dùng PenLine; Kênh theo dõi dùng Eye).
// Sắp theo đúng luồng làm việc: chuẩn bị một lần → tìm cái đáng remake → làm ra
// nội dung → đem đi dùng.
//
// Hai cái tên cũ đặt ngược nhau nên ai cũng lẫn: trang "Radar" thật ra là quét
// bài của các kênh đang theo dõi (thuộc về Kênh theo dõi), còn trang "Tín hiệu"
// mới là trend từ báo chí. Giờ gọi đúng việc chúng làm.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Thiết lập",
    items: [{ to: "/brands", label: "Thương hiệu", icon: Fingerprint }],
  },
  {
    label: "Tìm nội dung",
    items: [
      { to: "/channels", label: "Kênh theo dõi", icon: Eye },
      { to: "/radar", label: "Bài hay đã quét", icon: Telescope },
      { to: "/signals", label: "Xu hướng", icon: Radar },
    ],
  },
  {
    label: "Sản xuất",
    items: [
      { to: "/deconstruct", label: "Bóc cấu trúc", icon: Scissors },
      { to: "/remakes", label: "Remake bài & ảnh", icon: PenLine },
      // Remake video ĐÃ ẨN khỏi menu: chưa dùng được mà vẫn bày ra thì chỉ làm
      // người dùng mất thời gian thử rồi thất vọng. Đường /videos vẫn chạy để
      // không hỏng link cũ — bật lại ở đây khi tính năng ổn định.
      { to: "/studio", label: "Sáng tạo nhanh", icon: Wand2 },
    ],
  },
  {
    label: "Kết quả",
    items: [{ to: "/library", label: "Thư viện", icon: Images }],
  },
];

// Chi phí nằm ngoài nhóm quản trị: ai tiêu tiền cũng cần thấy mình đã tiêu
// bao nhiêu, không phải chỉ quản trị viên.
const SYSTEM_GROUP: NavGroup = {
  label: "Hệ thống",
  items: [
    { to: "/connect", label: "Kết nối Claude", icon: Plug },
    { to: "/costs", label: "Chi phí", icon: Wallet },
  ],
};

const ADMIN_ITEM: NavItem = { to: "/admin/users", label: "Quản trị", icon: ShieldCheck };

const SIDEBAR_COLLAPSED_KEY = "outlier:sidebarCollapsed";

export default function Layout({ children }: { children: ReactNode }) {
  const { username, isAdmin, logout } = useAppContext();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  // Mobile luôn mở drawer đầy đủ nhãn — "collapsed" chỉ là trạng thái desktop.
  const showLabels = !collapsed || mobileOpen;
  const groups = isAdmin
    ? [...NAV_GROUPS, { ...SYSTEM_GROUP, items: [...SYSTEM_GROUP.items, ADMIN_ITEM] }]
    : [...NAV_GROUPS, SYSTEM_GROUP];
  const initials = (username || "?").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex bg-stone-50">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Đóng menu điều hướng"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      <aside
        className={`fixed md:sticky top-0 h-screen z-50 flex flex-col shrink-0 w-64 transition-transform duration-200 ease-in-out ${
          collapsed ? "md:w-[72px]" : "md:w-64"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
        style={{ background: "var(--ds-sidebar-bg)" }}
        aria-label="Điều hướng chính"
      >
        <div className="flex items-center gap-2 h-16 px-4 shrink-0 border-b border-white/10">
          {showLabels ? (
            <img src="/logo-dark.svg" alt="Outlier" className="h-9 w-auto" />
          ) : (
            <img src="/mark.svg" alt="Outlier" className="w-9 h-9 mx-auto" />
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Đóng menu"
            className="ml-auto md:hidden text-indigo-200 hover:text-white p-1 rounded-md hover:bg-white/10"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden">
          {groups.map((group) => (
            <div key={group.label} className="ds-nav">
              {showLabels && <div className="ds-nav-section">{group.label}</div>}
              {group.items.map(({ to, label, icon: Icon, wip }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  title={wip ? `${label} — đang phát triển, chưa ổn định` : showLabels ? undefined : label}
                  className={({ isActive }) =>
                    `ds-nav-item${isActive ? " active" : ""}${showLabels ? "" : " justify-center px-0"}${
                      wip ? " opacity-50" : ""
                    }`
                  }
                >
                  <Icon className="ds-nav-icon" aria-hidden="true" />
                  {showLabels && <span className="truncate">{label}</span>}
                  {showLabels && wip && (
                    <span className="ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-indigo-200">
                      đang làm
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
          className="hidden md:flex items-center gap-2 mx-2 mb-2 px-2.5 py-2 rounded-md text-xs font-medium text-indigo-200 hover:bg-white/10 hover:text-white transition-colors"
        >
          {collapsed ? (
            <ChevronsRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          ) : (
            <>
              <ChevronsLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
              Thu gọn
            </>
          )}
        </button>

        <div className="border-t border-white/10 p-3 flex items-center gap-2">
          <span
            className="ds-avatar ds-avatar-sm shrink-0"
            style={{ background: "rgba(199,210,254,.18)", color: "#ffffff" }}
            aria-hidden="true"
          >
            {initials}
          </span>
          {showLabels && <span className="flex-1 min-w-0 truncate text-sm text-indigo-100">{username}</span>}
          <button
            onClick={logout}
            aria-label="Đăng xuất"
            title="Đăng xuất"
            className="shrink-0 p-1.5 rounded-md text-indigo-200 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-4 bg-white border-b border-stone-200">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu điều hướng"
            className="p-1.5 -ml-1.5 rounded-md text-stone-500 hover:bg-stone-100"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          <img src="/mark.svg" alt="" aria-hidden="true" className="w-8 h-8" />
          <span className="font-display font-bold text-storm-800 text-base">Outlier</span>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
