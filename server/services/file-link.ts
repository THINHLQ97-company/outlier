// Link xem file có CHỮ KÝ và HẠN DÙNG.
//
// Vì sao cần: /api/files đòi đăng nhập, đúng cho ảnh hiện trong app (trình duyệt
// đã có phiên). Nhưng khi Claude trả một đường dẫn ảnh vào khung chat, bấm vào
// là mở tab mới KHÔNG có phiên — người dùng nhận được câu "Cần đăng nhập" thay
// vì thấy ảnh.
//
// Mở toang /api/files thì mọi ảnh của mọi người thành công khai. Nên dùng link
// ký: ai cầm link thì xem được, link hết hạn thì thôi, và không ai đoán được
// link của file khác. Ký bằng AUTH_SECRET — cùng bí mật đã bảo vệ phiên đăng
// nhập, không thêm thứ phải quản lý.
import crypto from "crypto";

/** Hạn mặc định: 7 ngày — đủ lâu để xem lại một cuộc trò chuyện cũ. */
export const DEFAULT_TTL_SEC = 7 * 24 * 3600;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET chưa cấu hình — không ký được link file.");
  return s;
}

function sign(key: string, exp: number): string {
  return crypto.createHmac("sha256", secret()).update(`${key}:${exp}`).digest("base64url");
}

/** Phần query để dán sau /api/files/<key>. */
export function fileLinkQuery(key: string, ttlSec = DEFAULT_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `?exp=${exp}&sig=${sign(key, exp)}`;
}

/** Đường dẫn đầy đủ, dùng khi trả cho Claude hoặc gửi ra ngoài app. */
export function signedFileUrl(baseUrl: string, internalUrl: string, ttlSec = DEFAULT_TTL_SEC): string {
  const m = /^\/api\/files\/(.+)$/.exec(internalUrl || "");
  if (!m) return internalUrl; // không phải file nội bộ thì trả nguyên
  return `${baseUrl.replace(/\/$/, "")}${internalUrl}${fileLinkQuery(m[1], ttlSec)}`;
}

/**
 * Kiểm chữ ký. Trả về lý do hỏng thay vì chỉ true/false — "link hết hạn" và
 * "link sai" là hai chuyện khác nhau với người đang bấm vào.
 */
export function verifyFileLink(key: string, exp: unknown, sig: unknown): { ok: boolean; reason?: string } {
  const expNum = Number(exp);
  if (!expNum || !Number.isFinite(expNum) || typeof sig !== "string" || !sig) {
    return { ok: false, reason: "thiếu chữ ký" };
  }
  if (expNum < Math.floor(Date.now() / 1000)) return { ok: false, reason: "link đã hết hạn" };

  const expected = sign(key, expNum);
  // So sánh theo thời gian cố định: so sánh chuỗi thường để lộ dần từng ký tự.
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "chữ ký không khớp" };
  return { ok: true };
}
