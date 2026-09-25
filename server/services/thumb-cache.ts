// Giữ lại ảnh đại diện bài về máy mình.
//
// Vì sao không lưu link: ảnh Facebook nằm trên CDN với đường dẫn CÓ CHỮ KÝ và
// hạn dùng. Lưu link thì hôm nay hiện, vài hôm sau thành ô vỡ — và người dùng
// thấy một danh sách lỗ chỗ, cái hiện cái không, không hiểu vì sao. Đó đúng là
// thứ đang xảy ra với các bài dạng "ảnh chữ + ảnh minh hoạ".
//
// Tải về một lần rồi phục vụ từ /api/files: ảnh sống bằng tuổi thọ dữ liệu,
// không phụ thuộc chữ ký của bên kia, và cũng không bị chặn vì hotlink.
//
// Chỉ lấy ảnh nhỏ (ảnh đại diện bài), có trần dung lượng và thời gian — không
// biến nó thành đường tải file tuỳ ý.
import { storage, newKey } from "../storage";

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 4 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Tải ảnh về kho nội bộ, trả về đường dẫn `/api/files/...`.
 *
 * Thất bại thì trả null — gọi ở đâu cũng giữ nguyên link gốc, vì ảnh hiện được
 * nhờ link gốc vẫn hơn không có ảnh nào.
 */
export async function cacheRemoteImage(url: string, prefix: "deconstruct" | "misc" = "deconstruct"): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      // Vài CDN từ chối khi không có referrer hợp lệ; không gửi gì là an toàn nhất.
      referrerPolicy: "no-referrer",
      headers: { Accept: "image/*" },
    });
    if (!res.ok) return null;

    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    if (!ext) return null; // không phải ảnh thì không đụng vào

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared && declared > MAX_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;

    const key = newKey(prefix, ext);
    await storage.put(key, buf);
    return `/api/files/${key}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Giữ ảnh cho một loạt bài, chạy vài cái một lúc.
 *
 * Không song song hết cỡ: một lượt quét có thể có 20 ảnh, bắn cùng lúc cả 20
 * dễ bị CDN chặn tạm và hỏng nhiều hơn là nhanh hơn.
 */
export async function cacheImages<T extends { coverUrl?: string | null }>(
  items: T[],
  concurrency = 4,
): Promise<number> {
  let cached = 0;
  const queue = items.filter((i) => i.coverUrl && /^https?:\/\//i.test(i.coverUrl));
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      const local = await cacheRemoteImage(item.coverUrl!);
      if (local) {
        item.coverUrl = local;
        cached++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return cached;
}
