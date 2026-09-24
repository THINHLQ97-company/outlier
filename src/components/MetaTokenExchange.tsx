import { useState } from "react";
import { Loader2, KeyRound, Check, Copy, AlertTriangle, Infinity as InfinityIcon } from "lucide-react";
import { exchangeMetaToken, type TokenExchangeResult } from "../services/brands";

// Đổi token Meta ngắn hạn sang token page không hết hạn.
//
// Vì sao đáng có một khu riêng: token từ Graph API Explorer sống khoảng một
// giờ, nên nối trang xong hôm sau mở ra là hỏng. Ai cũng tưởng phải lấy token
// mới mỗi ngày — thật ra chỉ cần đổi một lần, và token page sau khi đổi thì
// không còn ngày hết hạn.

export default function MetaTokenExchange() {
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TokenExchangeResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function handleExchange() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await exchangeMetaToken({ appId, appSecret, shortLivedToken: token }));
      // Xoá ngay sau khi dùng — không giữ chìa khoá ứng dụng trong bộ nhớ trình duyệt.
      setAppSecret("");
      setToken("");
    } catch (e: any) {
      setError(e?.message || "Không đổi được token.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Trình duyệt chặn thì người dùng bôi đen chép tay.
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ds-btn ds-btn-ghost ds-btn-sm">
        <KeyRound className="w-3.5 h-3.5" aria-hidden="true" /> Lấy token không hết hạn
      </button>
    );
  }

  return (
    <div className="border border-stone-200 rounded-xl p-3 mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-800 flex items-center gap-1.5">
          <KeyRound className="w-4 h-4 text-storm-500" aria-hidden="true" />
          Đổi sang token không hết hạn
        </h4>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-stone-400 hover:text-stone-700">
          Đóng
        </button>
      </div>

      <p className="text-xs text-stone-500 mt-1">
        Token lấy từ Graph API Explorer chỉ sống khoảng <strong>1 giờ</strong>. Đổi một lần ở đây thì token của trang{" "}
        <strong>không còn ngày hết hạn</strong> — chỉ mất hiệu lực nếu bạn đổi mật khẩu Facebook hoặc gỡ ứng dụng.
      </p>

      <div className="flex flex-col gap-2 mt-3">
        <div>
          <label htmlFor="mx-appid" className="block text-xs font-medium text-stone-600">
            App ID
          </label>
          <input
            id="mx-appid"
            className="ds-input w-full mt-1 font-mono text-xs"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="1234567890"
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="mx-secret" className="block text-xs font-medium text-stone-600">
            App Secret
          </label>
          <input
            id="mx-secret"
            type="password"
            className="ds-input w-full mt-1 font-mono text-xs"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder="••••••••"
            autoComplete="off"
          />
          <p className="text-[11px] text-stone-400 mt-1">
            Lấy ở developers.facebook.com → ứng dụng → Settings → Basic. Chỉ dùng một lần rồi bỏ, công cụ không lưu lại.
          </p>
        </div>

        <div>
          <label htmlFor="mx-token" className="block text-xs font-medium text-stone-600">
            Token hiện tại (ngắn hạn)
          </label>
          <input
            id="mx-token"
            type="password"
            className="ds-input w-full mt-1 font-mono text-xs"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAG..."
            autoComplete="off"
          />
        </div>

        <button
          type="button"
          onClick={handleExchange}
          disabled={busy || !appId.trim() || !appSecret.trim() || !token.trim()}
          className="ds-btn ds-btn-primary ds-btn-sm self-start"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
          Đổi token
        </button>
      </div>

      {error && (
        <div role="alert" className="ds-alert ds-alert-danger mt-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="text-xs">{error}</span>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              result.neverExpires
                ? "bg-green-50 border-green-200 text-green-900"
                : "bg-amber-50 border-amber-200 text-amber-900"
            }`}
          >
            <div className="flex items-center gap-1.5 font-medium">
              {result.neverExpires ? (
                <InfinityIcon className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {result.neverExpires ? "Token không có ngày hết hạn" : "Đã đổi, nhưng chưa kiểm chứng được hạn dùng"}
            </div>
            <p className="mt-1">{result.note}</p>
          </div>

          <ul className="flex flex-col gap-1.5 mt-2">
            {result.pages.map((p) => (
              <li key={p.id} className="flex items-center gap-2 border border-stone-200 rounded-lg px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-stone-800 truncate">{p.name}</p>
                  <p className="text-[11px] text-stone-400 font-mono">{p.id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copy(p.accessToken, p.id)}
                  className="ds-btn ds-btn-secondary ds-btn-sm shrink-0"
                >
                  {copied === p.id ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                  {copied === p.id ? "Đã chép" : "Chép token"}
                </button>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-stone-400 mt-2">
            Chép token của trang cần dùng, rồi dán vào ô "Page Access Token" bên trên cùng với Page ID.
          </p>
        </div>
      )}
    </div>
  );
}
