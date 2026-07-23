// Xác thực Google ID token (Google Identity Services — nút "Sign in with Google"
// trả về 1 credential = ID token JWT). Verify chữ ký + audience bằng
// google-auth-library. Không cần client secret (chỉ dùng GOOGLE_CLIENT_ID).
import { OAuth2Client } from "google-auth-library";

let client: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  if (!client) client = new OAuth2Client();
  return client;
}

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  sub: string; // Google user id ổn định
  name?: string;
  picture?: string;
}

// Danh sách email được set làm admin ngay (env GOOGLE_ADMIN_EMAILS, phân tách dấu phẩy).
export function adminEmails(): string[] {
  return (process.env.GOOGLE_ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Verify ID token → hồ sơ Google. Ném lỗi nếu token sai/hết hạn/không đúng audience.
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID chưa cấu hình trên server.");
  const ticket = await getClient().verifyIdToken({ idToken, audience: clientId });
  const p = ticket.getPayload();
  if (!p || !p.email) throw new Error("Token Google không hợp lệ.");
  return {
    email: p.email.toLowerCase(),
    emailVerified: !!p.email_verified,
    sub: p.sub,
    name: p.name,
    picture: p.picture,
  };
}
