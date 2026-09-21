// Sinh video bằng Veo 3.1 qua Gemini API (docs/PRD.md §4 J5).
//
// Khác clipchatbot: clipchatbot gọi Vertex AI REST (cần service account), ở đây
// dùng thẳng Gemini API key — đã kiểm chứng key hiện tại truy cập được
// veo-3.1-{generate,fast-generate,lite-generate}-preview.
//
// Veo chạy dạng "long running operation": gửi yêu cầu → nhận tên operation →
// hỏi lại tới khi xong. Video sinh ra KHÔNG giữ mãi trên máy chủ Google, nên
// phải tải về lưu ngay (giống lưu ý với Higgsfield ở docs/ARCH.md §4).
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Mặc định dùng bản "lite" — rẻ nhất, đủ cho footage minh hoạ. */
export function veoModel(): string {
  return process.env.VEO_MODEL || "veo-3.1-lite-generate-preview";
}

function apiKey(): string {
  const k = (process.env.GEMINI_API_KEY || "").trim();
  if (!k) throw new Error("Chưa cấu hình GEMINI_API_KEY nên không sinh được video.");
  return k;
}

export interface VeoRequest {
  prompt: string;
  /** Ảnh khởi đầu (base64) — có ảnh thì Veo làm ảnh đó chuyển động, bám sát bố cục hơn. */
  image?: { mimeType: string; data: string };
  aspectRatio?: "16:9" | "9:16";
  durationSeconds?: number;
  negativePrompt?: string;
}

export interface VeoResult {
  videoBase64?: string;
  mimeType?: string;
  /** Google trả link tạm — phải tải về ngay, không lưu link làm nguồn. */
  fileUri?: string;
  warning?: string;
}

/** Gửi yêu cầu sinh video. Trả về tên operation để hỏi tiến độ. */
export async function startVeoJob(req: VeoRequest): Promise<string> {
  const instance: Record<string, any> = { prompt: req.prompt };
  if (req.image) instance.image = { bytesBase64Encoded: req.image.data, mimeType: req.image.mimeType };

  const parameters: Record<string, any> = {
    aspectRatio: req.aspectRatio || "9:16", // mặc định dọc — nội dung ngắn chủ yếu xem trên điện thoại
    ...(req.durationSeconds ? { durationSeconds: req.durationSeconds } : {}),
    ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
  };

  const res = await fetch(`${API_BASE}/models/${veoModel()}:predictLongRunning?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [instance], parameters }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Không gửi được yêu cầu dựng video (${res.status}): ${body.slice(0, 220)}`);
  }
  let data: any;
  try { data = JSON.parse(body); } catch { throw new Error("Phản hồi không đọc được từ dịch vụ dựng video."); }
  const name = data?.name;
  if (!name) throw new Error("Dịch vụ dựng video không trả về mã theo dõi.");
  return name;
}

/** Hỏi tiến độ một lần. Chưa xong → trả null. */
export async function pollVeoJob(operationName: string): Promise<VeoResult | null> {
  const res = await fetch(`${API_BASE}/${operationName}?key=${apiKey()}`);
  const body = await res.text();
  if (!res.ok) throw new Error(`Không hỏi được tiến độ dựng video (${res.status}): ${body.slice(0, 200)}`);

  let data: any;
  try { data = JSON.parse(body); } catch { throw new Error("Phản hồi tiến độ không đọc được."); }
  if (!data?.done) return null;

  if (data.error) {
    throw new Error(`Dựng video thất bại: ${data.error?.message || JSON.stringify(data.error).slice(0, 200)}`);
  }

  // Đường thật (đã đối chiếu response ngày 2026-09-21):
  //   response.generateVideoResponse.generatedSamples[0].video.uri
  // Vẫn dò thêm vài biến thể vì API đang ở bản preview, tên trường có thể đổi.
  const r = data.response || {};
  const candidates =
    r.generateVideoResponse?.generatedSamples ||
    r.generate_video_response?.generatedSamples ||
    r.generatedVideos || r.videos || r.predictions || [];
  const first = Array.isArray(candidates) ? candidates[0] : candidates;
  if (!first) return { warning: "Dịch vụ báo xong nhưng không trả về video nào." };

  const video = first.video || first;
  return {
    videoBase64: video?.bytesBase64Encoded || video?.videoBytes || undefined,
    mimeType: video?.mimeType || "video/mp4",
    fileUri: video?.uri || video?.fileUri || undefined,
  };
}

/** Tải video về từ link tạm mà Google trả. */
export async function downloadVeoFile(fileUri: string): Promise<Buffer> {
  const sep = fileUri.includes("?") ? "&" : "?";
  const res = await fetch(`${fileUri}${sep}key=${apiKey()}`);
  if (!res.ok) throw new Error(`Không tải được video đã dựng (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Chạy trọn một lượt dựng video: gửi yêu cầu → chờ → lấy kết quả.
 * `onProgress` để nơi gọi cập nhật trạng thái cho người dùng thấy.
 */
export async function generateVideo(
  req: VeoRequest,
  opts: { timeoutMs?: number; intervalMs?: number; onProgress?: (elapsedSec: number) => void } = {},
): Promise<{ buffer: Buffer; mimeType: string }> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000; // Veo thường mất 1-5 phút
  const intervalMs = opts.intervalMs ?? 10_000;
  const started = Date.now();

  const op = await startVeoJob(req);

  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    opts.onProgress?.(Math.round((Date.now() - started) / 1000));

    const result = await pollVeoJob(op);
    if (!result) continue;
    if (result.warning) throw new Error(result.warning);

    if (result.videoBase64) {
      return { buffer: Buffer.from(result.videoBase64, "base64"), mimeType: result.mimeType || "video/mp4" };
    }
    if (result.fileUri) {
      return { buffer: await downloadVeoFile(result.fileUri), mimeType: result.mimeType || "video/mp4" };
    }
    throw new Error("Dịch vụ báo xong nhưng không có dữ liệu video.");
  }
  throw new Error(`Dựng video quá lâu (hơn ${Math.round(timeoutMs / 60000)} phút) — thử lại sau.`);
}
