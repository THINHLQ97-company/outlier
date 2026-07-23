// OAuth 2.1 helpers cho MCP (stateless) — port từ ReportApp/api/lib/oauth.js.
// Không cần bảng DB: authorization code + access/refresh token đều là JWT ký bằng
// JWT_SECRET. PKCE S256 bắt buộc (Claude.ai luôn gửi). Redirect whitelist claude.*.
import jwt from "jsonwebtoken";
import crypto from "crypto";

// Fanpage đã có AUTH_SECRET cho token đăng nhập app; dùng lại làm JWT_SECRET nếu
// JWT_SECRET chưa set (1 secret cho cả app + MCP OAuth, đỡ phải cấu hình 2 biến).
const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_SECRET || "fanpage-mcp-dev-secret-change-me";

const CODE_TTL = 300; // 5 phút
const ACCESS_TTL = 60 * 60 * 24 * 30; // 30 ngày
const REFRESH_TTL = 60 * 60 * 24 * 180; // 180 ngày

export const TTL = { CODE_TTL, ACCESS_TTL, REFRESH_TTL };

export interface McpPrincipal {
  sub: string;
  username: string;
  role: string;
  perms: string[];
  scope?: string;
}

// Base URL (để discovery metadata khớp domain đang chạy sau reverse proxy).
export function baseUrl(req: any): string {
  const proto =
    (req.headers["x-forwarded-proto"] || "").split(",")[0] || (req.socket?.encrypted ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  return `${proto}://${host}`;
}

// PKCE S256.
export function verifyPkce(codeVerifier: string, codeChallenge: string, method = "S256"): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  if (method === "plain") return codeVerifier === codeChallenge;
  const hash = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return hash === codeChallenge;
}

// Authorization code (JWT ngắn hạn).
export function issueCode(p: {
  sub: string;
  username: string;
  role: string;
  permissions?: string[];
  codeChallenge: string;
  redirectUri: string;
  scope?: string;
  resource?: string;
}): string {
  return jwt.sign(
    { typ: "mcp_code", sub: p.sub, username: p.username, role: p.role, perms: p.permissions || [], cc: p.codeChallenge, ru: p.redirectUri, scope: p.scope, resource: p.resource },
    JWT_SECRET,
    { expiresIn: CODE_TTL }
  );
}
export function verifyCode(code: string): any {
  const d = jwt.verify(code, JWT_SECRET) as any;
  if (d.typ !== "mcp_code") throw new Error("invalid code type");
  return d;
}

// Access / refresh token.
export function issueAccessToken(p: { sub: string; username: string; role: string; permissions?: string[]; scope?: string }): string {
  return jwt.sign({ typ: "mcp_access", sub: p.sub, username: p.username, role: p.role, perms: p.permissions || [], scope: p.scope || "mcp" }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}
export function verifyAccessToken(token: string): McpPrincipal {
  const d = jwt.verify(token, JWT_SECRET) as any;
  if (d.typ !== "mcp_access") throw new Error("invalid access token type");
  return { sub: d.sub, username: d.username, role: d.role, perms: d.perms || [], scope: d.scope };
}
export function issueRefreshToken(p: { sub: string; username: string; role: string; permissions?: string[]; scope?: string }): string {
  return jwt.sign({ typ: "mcp_refresh", sub: p.sub, username: p.username, role: p.role, perms: p.permissions || [], scope: p.scope || "mcp" }, JWT_SECRET, { expiresIn: REFRESH_TTL });
}
export function verifyRefreshToken(token: string): any {
  const d = jwt.verify(token, JWT_SECRET) as any;
  if (d.typ !== "mcp_refresh") throw new Error("invalid refresh token type");
  return d;
}

// Redirect URI whitelist (chống open redirect): chỉ claude.* + localhost.
export function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:" && /(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/i.test(u.hostname)) return true;
    if ((u.protocol === "http:" || u.protocol === "https:") && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}
