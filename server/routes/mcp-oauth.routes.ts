// OAuth 2.1 Authorization Server cho MCP connector (Claude.ai) — port từ
// ReportApp/api/oauth.js, adapt sang Express + auth fanpage (scrypt verifyPassword,
// bảng users), BỎ Microsoft SSO. Stateless: code/token đều JWT. PKCE S256 bắt buộc.
//
// Endpoints:
//   GET  /.well-known/oauth-authorization-server → AS metadata (RFC 8414)
//   GET  /.well-known/oauth-protected-resource    → resource metadata (trỏ /api/mcp-signals)
//   POST /api/oauth/register                       → Dynamic Client Registration (RFC 7591)
//   GET  /api/oauth/authorize                       → form đăng nhập + consent
//   POST /api/oauth/authorize                       → xác thực (tài khoản fanpage) → cấp code
//   POST /api/oauth/token                           → đổi code/refresh lấy access_token
import type { Express } from "express";
import express from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { users } from "../db/schema";
import { verifyPassword } from "../password";
import {
  baseUrl,
  verifyPkce,
  issueCode,
  verifyCode,
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  isAllowedRedirect,
  TTL,
} from "../mcp/oauth";

const MCP_RESOURCE_PATH = "/api/mcp-signals";

// Quyền MCP gán cho user fanpage: mọi nhân sự active được đọc+ghi tín hiệu.
function permsFor(role: string): string[] {
  return role === "admin" ? ["signals", "signals-edit", "admin"] : ["signals", "signals-edit"];
}

function esc(s = ""): string {
  return String(s).replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" }[c] as string));
}

function loginPage(params: Record<string, string>, errorMsg = ""): string {
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kết nối Claude ↔ Tín hiệu Fanpage</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#2D2D2D;color:#2D2D2D;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
  .card{width:400px;max-width:100%;background:#FAF9F6;border-radius:18px;padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
  .logo{font-weight:800;font-size:18px;color:#D97757;margin-bottom:4px}
  .sub{font-size:13px;color:#64748b;margin-bottom:22px}
  .consent{background:#FDF0EB;border:1px solid #F3D3C7;border-radius:10px;padding:12px 14px;font-size:12.5px;color:#8a5a44;margin-bottom:18px;line-height:1.5}
  label{font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:6px}
  input{width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;margin-bottom:14px;outline:none}
  input:focus{border-color:#D97757}
  button{width:100%;padding:11px;border:none;border-radius:10px;background:#D97757;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
  .err{background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-size:12.5px;padding:9px 12px;border-radius:8px;margin-bottom:14px}
</style></head><body>
<form class="card" method="POST" action="/api/oauth/authorize">
  <div class="logo">Tín hiệu · Fanpage "Ăn Nằm Với AI"</div>
  <div class="sub">Cấp quyền cho <b>Claude</b> đọc/cập nhật tín hiệu</div>
  <div class="consent">🤖 Claude sẽ có thể đọc tín hiệu, thêm tin, chấm điểm, gom cụm và gợi ý góc nội dung theo quyền tài khoản bạn. Đăng nhập để đồng ý.</div>
  ${errorMsg ? `<div class="err">${esc(errorMsg)}</div>` : ""}
  <label>Tài khoản</label>
  <input name="username" autocomplete="username">
  <label>Mật khẩu</label>
  <input name="password" type="password" autocomplete="current-password">
  <input type="hidden" name="client_id" value="${esc(params.client_id || "")}">
  <input type="hidden" name="redirect_uri" value="${esc(params.redirect_uri || "")}">
  <input type="hidden" name="code_challenge" value="${esc(params.code_challenge || "")}">
  <input type="hidden" name="code_challenge_method" value="${esc(params.code_challenge_method || "S256")}">
  <input type="hidden" name="state" value="${esc(params.state || "")}">
  <input type="hidden" name="scope" value="${esc(params.scope || "mcp")}">
  <input type="hidden" name="resource" value="${esc(params.resource || "")}">
  <button type="submit">Đăng nhập &amp; Cấp quyền</button>
</form>
</body></html>`;
}

export function registerMcpOAuthRoutes(app: Express) {
  const form = express.urlencoded({ extended: true });

  // ── Discovery: Authorization Server Metadata ──
  const asMetadata = (req: any, res: any) => {
    const ISSUER = baseUrl(req);
    res.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/api/oauth/authorize`,
      token_endpoint: `${ISSUER}/api/oauth/token`,
      registration_endpoint: `${ISSUER}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["mcp"],
    });
  };
  app.get("/.well-known/oauth-authorization-server", asMetadata);
  app.get("/.well-known/oauth-authorization-server/*", asMetadata);

  // ── Discovery: Protected Resource Metadata ──
  const prMetadata = (req: any, res: any) => {
    const ISSUER = baseUrl(req);
    res.json({
      resource: `${ISSUER}${MCP_RESOURCE_PATH}`,
      authorization_servers: [ISSUER],
      scopes_supported: ["mcp"],
      bearer_methods_supported: ["header"],
    });
  };
  app.get("/.well-known/oauth-protected-resource", prMetadata);
  app.get("/.well-known/oauth-protected-resource/*", prMetadata);

  // ── Dynamic Client Registration ──
  app.post("/api/oauth/register", (req, res) => {
    const meta = req.body || {};
    res.status(201).json({
      client_id: `mcp-${crypto.randomUUID()}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: Array.isArray(meta.redirect_uris) ? meta.redirect_uris : [],
      client_name: meta.client_name || "MCP Client",
      scope: "mcp",
    });
  });

  // ── Authorize (GET): form đăng nhập ──
  app.get("/api/oauth/authorize", (req, res) => {
    const q = req.query as Record<string, string>;
    if (!q.redirect_uri || !isAllowedRedirect(q.redirect_uri)) {
      return res.status(400).type("html").send("<p>redirect_uri không hợp lệ.</p>");
    }
    if (!q.code_challenge) return res.status(400).type("html").send("<p>Thiếu PKCE code_challenge.</p>");
    res.status(200).type("html").send(
      loginPage({
        client_id: q.client_id,
        redirect_uri: q.redirect_uri,
        code_challenge: q.code_challenge,
        code_challenge_method: q.code_challenge_method || "S256",
        state: q.state,
        scope: q.scope || "mcp",
        resource: q.resource,
      })
    );
  });

  // ── Authorize (POST): xác thực tài khoản fanpage → cấp code ──
  app.post("/api/oauth/authorize", form, async (req, res) => {
    const b = req.body || {};
    const { username, password, redirect_uri, code_challenge, code_challenge_method, state, scope, resource, client_id } = b;
    if (!redirect_uri || !isAllowedRedirect(redirect_uri)) {
      return res.status(400).type("html").send("<p>redirect_uri không hợp lệ.</p>");
    }
    const renderErr = (msg: string) =>
      res.status(401).type("html").send(loginPage({ client_id, redirect_uri, code_challenge, code_challenge_method, state, scope, resource }, msg));

    if (!isDbConfigured()) return renderErr("Hệ thống chưa cấu hình DATABASE_URL.");
    if (!username || !password) return renderErr("Nhập tài khoản và mật khẩu.");
    try {
      const [user] = await getDb().select().from(users).where(eq(users.username, String(username)));
      if (!user || !user.isActive || !verifyPassword(String(password), user.passwordHash)) {
        return renderErr("Tài khoản hoặc mật khẩu không đúng (hoặc tài khoản đã khoá).");
      }
      const code = issueCode({
        sub: user.id,
        username: user.username,
        role: user.role,
        permissions: permsFor(user.role),
        codeChallenge: code_challenge,
        redirectUri: redirect_uri,
        scope: scope || "mcp",
        resource,
      });
      const sep = redirect_uri.includes("?") ? "&" : "?";
      const loc = `${redirect_uri}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ""}`;
      res.redirect(302, loc);
    } catch (e: any) {
      console.error("oauth authorize:", e?.message || e);
      return renderErr("Lỗi máy chủ: " + (e?.message || e));
    }
  });

  // ── Token endpoint ──
  app.post("/api/oauth/token", form, (req, res) => {
    const b = req.body || {};
    const grant = b.grant_type;
    try {
      if (grant === "authorization_code") {
        const { code, code_verifier, redirect_uri } = b;
        if (!code) return res.status(400).json({ error: "invalid_request", error_description: "missing code" });
        let payload: any;
        try {
          payload = verifyCode(code);
        } catch {
          return res.status(400).json({ error: "invalid_grant", error_description: "code hết hạn hoặc không hợp lệ" });
        }
        if (redirect_uri && payload.ru !== redirect_uri) {
          return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
        }
        if (!verifyPkce(code_verifier, payload.cc)) {
          return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verify thất bại" });
        }
        const claims = { sub: payload.sub, username: payload.username, role: payload.role, permissions: payload.perms || [], scope: payload.scope };
        return res.json({
          access_token: issueAccessToken(claims),
          token_type: "Bearer",
          expires_in: TTL.ACCESS_TTL,
          refresh_token: issueRefreshToken(claims),
          scope: payload.scope || "mcp",
        });
      }

      if (grant === "refresh_token") {
        let payload: any;
        try {
          payload = verifyRefreshToken(b.refresh_token);
        } catch {
          return res.status(400).json({ error: "invalid_grant", error_description: "refresh_token không hợp lệ" });
        }
        const claims = { sub: payload.sub, username: payload.username, role: payload.role, permissions: payload.perms || [], scope: payload.scope };
        return res.json({
          access_token: issueAccessToken(claims),
          token_type: "Bearer",
          expires_in: TTL.ACCESS_TTL,
          refresh_token: issueRefreshToken(claims),
          scope: payload.scope || "mcp",
        });
      }

      return res.status(400).json({ error: "unsupported_grant_type" });
    } catch (e: any) {
      return res.status(500).json({ error: "server_error", error_description: e?.message || String(e) });
    }
  });
}
