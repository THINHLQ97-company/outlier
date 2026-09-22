// Cất Page Access Token của Meta.
//
// Token này mở được quyền đọc và đăng bài trên fanpage thật, nên không cất
// nguyên văn trong database: ai đọc được một bản sao DB (dump, backup, log lỗi)
// là cầm luôn quyền trên page. Mã hoá bằng AUTH_SECRET — cùng bí mật đã bảo vệ
// phiên đăng nhập, nên không thêm thứ phải quản lý.
//
// Ghi chú giới hạn: AUTH_SECRET nằm trong biến môi trường, nên đây không chống
// được người đã vào được server. Nó chống bản sao DB bị rò — đúng mối nguy hay
// gặp nhất.
import crypto from "crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET chưa cấu hình — không thể cất token Meta an toàn.");
  // Băm để luôn ra đúng 32 byte dù AUTH_SECRET dài ngắn thế nào.
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptToken(stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Token đã lưu không đúng định dạng.");
  const [, ivB64, tagB64, encB64] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64url")), decipher.final()]).toString("utf8");
}

/** Hiển thị cho người dùng biết token nào đang dùng mà không lộ token. */
export function maskToken(plain: string): string {
  if (plain.length <= 10) return "•".repeat(plain.length);
  return `${plain.slice(0, 6)}…${plain.slice(-4)}`;
}
