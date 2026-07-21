// Pure HMAC login-token helpers — no Express/DB imports so this stays usable
// from any route module. Pattern copied from share-projects/marcow-crop's
// api/_auth.ts, minus the Vercel serverless framing (that project's `api/`
// dir is legacy and not reused here — see docs/PLAN.md Step 1 note).
import crypto from "crypto";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Returns the HMAC secret. Fails fast if AUTH_SECRET is not configured so we
 * never silently fall back to a publicly-known default (which would let
 * anyone forge a valid token).
 */
export function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET chưa được cấu hình (hoặc quá ngắn). Hãy set biến môi trường AUTH_SECRET (>= 16 ký tự)."
    );
  }
  return secret;
}

export interface AuthResult {
  valid: boolean;
  username?: string;
}

/**
 * Verifies a login token of the form `<base64(payload)>.<hmacHex>`.
 * Uses a constant-time comparison to avoid signature timing leaks.
 */
export function verifyToken(token?: unknown): AuthResult {
  if (typeof token !== "string" || !token) return { valid: false };

  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return { valid: false };

  try {
    const payload = Buffer.from(payloadBase64, "base64").toString("utf-8");
    const expected = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false };
    }

    const data = JSON.parse(payload);
    if (typeof data?.ts !== "number" || Date.now() - data.ts > MAX_AGE_MS) {
      return { valid: false };
    }
    return { valid: true, username: data.username };
  } catch {
    return { valid: false };
  }
}

/**
 * Pulls the bearer token from common places: JSON body `{ token }`, an
 * `Authorization: Bearer <token>` header, or a `?token=` query param.
 */
export function extractToken(req: {
  body?: any;
  headers?: Record<string, any>;
  query?: Record<string, any>;
}): string | undefined {
  const fromBody = req.body?.token;
  if (typeof fromBody === "string" && fromBody) return fromBody;

  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const fromQuery = req.query?.token;
  if (typeof fromQuery === "string" && fromQuery) return fromQuery;

  return undefined;
}
