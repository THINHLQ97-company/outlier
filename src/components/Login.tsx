import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { login as apiLogin } from "../services/auth";
import { useAppContext } from "../AppContext";

// Minimal login screen — internal tool, <10 users (PRD §5 NFR).
export default function Login() {
  const { login } = useAppContext();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-storm-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg border border-storm-100 p-8">
        <h1 className="text-lg font-bold text-storm-900 font-display mb-1">Ăn Nằm Với AI</h1>
        <p className="text-sm text-stone-500 mb-6">Content Engine — đăng nhập nội bộ</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="username" className="block text-xs font-medium text-stone-600 mb-1">
              Tên đăng nhập
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-storm-500"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-stone-600 mb-1">
              Mật khẩu
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-storm-500"
              required
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Đăng nhập
          </button>
        </form>
      </div>
    </div>
  );
}
