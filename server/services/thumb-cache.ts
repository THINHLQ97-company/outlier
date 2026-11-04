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
import { storage, newKey, internalKeyFromUrl } from "../storage";
import { requestPinnedImage } from "./image-transport";

const TIMEOUT_MS = 3_000;
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
export function isInternalImageUrl(url: string): boolean {
  // Relative file paths (including display auth query) are already durable.
  return !!internalKeyFromUrl(url);
}
export async function cacheRemoteImage(url: string, prefix: "deconstruct" | "misc" = "deconstruct", onStatus?: (status: number) => void, requestImage = requestPinnedImage): Promise<string | null> {
  if (isInternalImageUrl(url)) return url;
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await requestImage(url, ctrl.signal);
    onStatus?.(res.statusCode || 0);
    // Node requests do not follow redirects. Explicitly destroy all rejected responses.
    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) { res.destroy(); return null; }
    const type = String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const ext = EXT_BY_TYPE[type];
    const declared = Number(res.headers["content-length"] || 0);
    if (!ext || declared > MAX_BYTES) { res.destroy(); return null; }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > MAX_BYTES) { res.destroy(); return null; }
      chunks.push(Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    if (!buf.length || !imageMagicMatches(buf, type)) return null;

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
  const { keepImage } = await import("./durable-images");
  let cached = 0;
  const queue = items.filter((i) => i.coverUrl && /^https?:\/\//i.test(i.coverUrl)).slice(0, 50);
  let cursor = 0;
  const deadline = Date.now() + 3000;

  async function worker() {
    while (cursor < queue.length && Date.now() < deadline) {
      const item = queue[cursor++];
      const local = await keepImage(item.coverUrl!);
      if (local && local !== item.coverUrl) {
        item.coverUrl = local;
        cached++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency) || 1), 4, queue.length) }, worker));
  return cached;
}

export function imageMagicMatches(buf: Buffer, mime: string): boolean {
  if (mime === "image/png") return buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && buf.toString("ascii", 12, 16) === "IHDR";
  if (mime === "image/jpeg" || mime === "image/jpg") return buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === "image/gif") return buf.length >= 10 && ["GIF87a", "GIF89a"].includes(buf.toString("ascii", 0, 6));
  if (mime === "image/webp") return buf.length >= 16 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(buf.toString("ascii", 12, 16));
  return false;
}
