// Đọc một ảnh thành dạng gửi được cho model vẽ — từ BẤT KỲ đâu ảnh đang nằm.
//
// Lỗi đã gặp: bộ đọc cũ chỉ nhận ảnh trong kho nội bộ (/api/files/...). Ảnh
// mẫu nhân vật nào lưu dạng đường dẫn ngoài thì bị BỎ QUA IM LẶNG — model vẽ
// không thấy ảnh mẫu, chỉ còn đoạn chữ tả ngoại hình, và vẽ ra một nhân vật
// "na ná" chứ không phải nhân vật thật. Ảnh gốc của bài Facebook cũng là
// đường dẫn ngoài nên chưa từng gửi được.
//
// Giờ nhận ba dạng: kho nội bộ, data URL, và http(s). Mỗi lần đọc hỏng đều
// trả về LÝ DO, để chỗ gọi ghi log được — không còn chuyện thiếu ảnh mà không
// ai biết.
import { internalKeyFromUrl, storage, contentTypeForKey, parseDataUrl } from "../storage";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 8 * 1024 * 1024;
const OK_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

export interface LoadedImage {
  mimeType: string;
  data: string; // base64
}

export async function loadImageForModel(
  url: string | null | undefined,
): Promise<{ image: LoadedImage | null; reason?: string }> {
  if (!url?.trim()) return { image: null, reason: "không có đường dẫn ảnh" };
  const u = url.trim();

  // 1. Kho nội bộ
  const key = internalKeyFromUrl(u);
  if (key) {
    try {
      const buf = await storage.get(key);
      if (!buf?.length) return { image: null, reason: "file trong kho rỗng" };
      return { image: { mimeType: contentTypeForKey(key), data: buf.toString("base64") } };
    } catch (e: any) {
      return { image: null, reason: `không đọc được file trong kho (${e?.message || e})` };
    }
  }

  // 2. data URL
  if (u.startsWith("data:")) {
    const parsed = parseDataUrl(u);
    if (!parsed) return { image: null, reason: "data URL không hợp lệ" };
    const mimeType = `image/${parsed.ext === "jpg" ? "jpeg" : parsed.ext}`;
    return { image: { mimeType, data: parsed.buffer.toString("base64") } };
  }

  // 3. http(s) — có trần thời gian, trần dung lượng, chỉ nhận đúng kiểu ảnh.
  if (!/^https?:\/\//i.test(u)) return { image: null, reason: `đường dẫn lạ: ${u.slice(0, 60)}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(u, { signal: ctrl.signal, referrerPolicy: "no-referrer", headers: { Accept: "image/*" } });
    if (!res.ok) {
      // Ảnh Facebook có chữ ký và hạn dùng — 403/404 ở đây thường là link đã hết hạn.
      return { image: null, reason: `máy chủ ảnh trả ${res.status}${res.status === 403 ? " (link có thể đã hết hạn)" : ""}` };
    }
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!OK_TYPES.has(type)) return { image: null, reason: `không phải ảnh (${type || "không rõ kiểu"})` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { image: null, reason: "ảnh rỗng" };
    if (buf.length > MAX_BYTES) return { image: null, reason: "ảnh quá 8MB" };
    return { image: { mimeType: type === "image/jpg" ? "image/jpeg" : type, data: buf.toString("base64") } };
  } catch (e: any) {
    return { image: null, reason: e?.name === "AbortError" ? "tải ảnh quá lâu" : `không tải được (${e?.message || e})` };
  } finally {
    clearTimeout(timer);
  }
}
