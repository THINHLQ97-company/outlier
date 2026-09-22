import { useState, useEffect, useRef, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { login as apiLogin, googleLogin } from "../services/auth";
import { useAppContext } from "../AppContext";

// Vibe Host không cho đặt biến rỗng; "off" là sentinel nghĩa là chưa cấu hình
// (xem OPTIONAL_ENV_KEYS trong server.ts).
const RAW_CLIENT_ID = ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "").trim();
const GOOGLE_CLIENT_ID =
  RAW_CLIENT_ID && RAW_CLIENT_ID.toLowerCase() !== "off" ? RAW_CLIENT_ID : undefined;

// Minimal login screen — internal tool. Đăng nhập bằng Google (SSO, khuyến nghị)
// hoặc tài khoản nội bộ (username/password, cho các tài khoản cũ).
export default function Login() {
  const { login } = useAppContext();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(false);
    setLoading(true);
    try {
      const result = await apiLogin(username, password);
      login(result.username, result.token, result.role);
    } catch (err: any) {
      setError(err?.message || "Đăng nhập thất bại.");
    } finally {
      setLoading(false);
    }
  }

  // Nạp Google Identity Services + render nút "Sign in with Google".
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const init = () => {
      const gg = (window as any).google;
      if (!gg?.accounts?.id || !googleBtnRef.current) return;
      gg.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: any) => {
          setError(null);
          setPending(false);
          setLoading(true);
          try {
            const result = await googleLogin(resp.credential);
            login(result.username, result.token, result.role);
          } catch (err: any) {
            if (err?.pending) setPending(true);
            setError(err?.message || "Đăng nhập Google thất bại.");
          } finally {
            setLoading(false);
          }
        },
      });
      gg.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline",
        size: "large",
        width: 288,
        text: "signin_with",
        locale: "vi",
      });
    };
    if ((window as any).google?.accounts?.id) {
      init();
      return;
    }
    const existing = document.getElementById("gsi-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", init);
      return () => existing.removeEventListener("load", init);
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.id = "gsi-script";
    s.onload = init;
    document.body.appendChild(s);
  }, [login]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
      <div className="ds-card w-full max-w-sm">
        <div className="ds-card-body">
          <img src="/mark.svg" alt="" aria-hidden="true" className="w-12 h-12 mb-3" />
          <h1 className="text-lg font-bold text-stone-900 font-display mb-1">Outlier</h1>
          <p className="text-sm text-stone-500 mb-6">Tìm content đang bật lên — remake cho brand của bạn</p>

          {error && (
            <div role="alert" className={`ds-alert mb-4 ${pending ? "ds-alert-warning" : "ds-alert-danger"}`}>
              {error}
            </div>
          )}

          {/* Đăng nhập Google (khuyến nghị) */}
          {GOOGLE_CLIENT_ID ? (
            <div className="flex flex-col items-center gap-2 mb-5">
              <div ref={googleBtnRef} className="min-h-[40px]" />
              {loading && (
                <span className="text-xs text-stone-400 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang đăng nhập...
                </span>
              )}
            </div>
          ) : (
            <div className="ds-alert ds-alert-info mb-5">
              Đăng nhập Google chưa cấu hình (thiếu VITE_GOOGLE_CLIENT_ID) — dùng tài khoản nội bộ bên dưới.
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-stone-400 mb-4">
            <span className="flex-1 h-px bg-stone-200" /> hoặc tài khoản nội bộ <span className="flex-1 h-px bg-stone-200" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="username" className="ds-label">
                Tên đăng nhập
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="ds-input"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="ds-label">
                Mật khẩu
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="ds-input"
                required
              />
            </div>

            <button type="submit" disabled={loading} className="ds-btn ds-btn-primary ds-btn-lg justify-center mt-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              Đăng nhập
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
