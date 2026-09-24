// Đăng bài lên fanpage bằng Page Access Token.
//
// Ba đường khác nhau tuỳ nội dung, và chọn sai đường thì Facebook nhận nhưng
// hiển thị không như ý:
//   chỉ chữ   → /feed
//   có ảnh    → /photos   (dùng /feed với link ảnh sẽ ra bài link, không phải bài ảnh)
//   có video  → /videos
//
// Ảnh của mình nằm trong database rồi trả qua /api/files — Facebook không tải
// được đường dẫn đó nếu app chạy trong mạng kín. Nên ảnh nội bộ được đọc ra
// rồi ĐẨY BYTE lên, chỉ ảnh có đường dẫn công khai mới đưa link cho Facebook tự lấy.
import { decryptToken } from "./meta-token";
import { storage, internalKeyFromUrl } from "../storage";

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 120_000;

export interface PublishInput {
  pageId: string;
  /** Token đã mã hoá lấy từ brand_fanpages.metaTokenEnc. */
  tokenEnc: string;
  message: string;
  /** "/api/files/..." (nội bộ) hoặc đường dẫn công khai. */
  imageUrl?: string | null;
  /** Đăng ngay, hay để Facebook giữ lại rồi đăng sau (dạng giây kể từ epoch). */
  scheduledAt?: Date | null;
}

export interface PublishResult {
  postId: string;
  /** Đường dẫn xem bài, dựng từ mã bài Facebook trả về. */
  permalink: string;
  scheduled: boolean;
}

function asError(body: any, fallback: string): Error {
  const e = body?.error || {};
  // Hai lỗi này gặp nhiều nhất và người dùng sửa được, nên nói rõ cách sửa.
  if (e.code === 200 || /permission/i.test(e.message || "")) {
    return new Error(
      `Token thiếu quyền đăng bài (cần pages_manage_posts). Lấy lại token với quyền này rồi nối lại trang. Meta nói: ${e.message || fallback}`,
    );
  }
  if (e.code === 190) {
    return new Error(`Token đã hết hạn hoặc bị thu hồi — nối lại trang. Meta nói: ${e.message || fallback}`);
  }
  return new Error(`Meta Graph lỗi${e.code ? ` (mã ${e.code})` : ""}: ${e.message || fallback}`);
}

async function graphPost(path: string, form: FormData): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body: form, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw asError(body, res.statusText);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Ảnh nội bộ thì đọc byte ra; ảnh công khai thì trả null để đưa link cho Facebook. */
async function loadInternalImage(imageUrl: string): Promise<Buffer | null> {
  const key = internalKeyFromUrl(imageUrl);
  if (!key) return null;
  return storage.get(key);
}

export async function publishToPage(input: PublishInput): Promise<PublishResult> {
  const message = input.message.trim();
  if (!message && !input.imageUrl) throw new Error("Không có gì để đăng.");

  const token = decryptToken(input.tokenEnc);
  const scheduled = !!input.scheduledAt;

  if (scheduled) {
    // Facebook đòi hẹn giờ ít nhất 10 phút và nhiều nhất 6 tháng; báo trước cho
    // rõ thay vì để Meta trả lỗi khó hiểu.
    const diffMin = (input.scheduledAt!.getTime() - Date.now()) / 60_000;
    if (diffMin < 10) throw new Error("Facebook yêu cầu hẹn giờ cách hiện tại ít nhất 10 phút.");
    if (diffMin > 60 * 24 * 180) throw new Error("Facebook chỉ cho hẹn trước tối đa 6 tháng.");
  }

  const form = new FormData();
  form.set("access_token", token);
  if (scheduled) {
    form.set("published", "false");
    form.set("scheduled_publish_time", String(Math.floor(input.scheduledAt!.getTime() / 1000)));
  }

  let path: string;
  if (input.imageUrl) {
    path = `${input.pageId}/photos`;
    // Bài ảnh dùng trường "caption", không phải "message" — dùng sai thì ảnh lên
    // mà không có chữ.
    form.set("caption", message);

    const bytes = await loadInternalImage(input.imageUrl);
    if (bytes) {
      form.set("source", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "image.png");
    } else {
      form.set("url", input.imageUrl);
    }
  } else {
    path = `${input.pageId}/feed`;
    form.set("message", message);
  }

  const out = await graphPost(path, form);

  // /photos trả về id của ảnh và post_id của bài; /feed chỉ trả id bài.
  const postId = String(out.post_id || out.id || "");
  if (!postId) throw new Error("Facebook không trả về mã bài — không rõ đã đăng hay chưa.");

  return {
    postId,
    permalink: `https://www.facebook.com/${postId.replace("_", "/posts/")}`,
    scheduled,
  };
}

/** Kiểm tra token có quyền đăng chưa, trước khi người dùng soạn xong bài rồi mới biết. */
export async function checkPublishPermission(tokenEnc: string): Promise<{ ok: boolean; missing: string[] }> {
  const token = decryptToken(tokenEnc);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`, {
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) return { ok: false, missing: ["không đọc được danh sách quyền"] };

    const granted = new Set(
      (body.data || []).filter((p: any) => p.status === "granted").map((p: any) => p.permission),
    );
    const need = ["pages_manage_posts"];
    const missing = need.filter((p) => !granted.has(p));
    return { ok: missing.length === 0, missing };
  } catch {
    return { ok: false, missing: ["không kiểm tra được"] };
  } finally {
    clearTimeout(timer);
  }
}
