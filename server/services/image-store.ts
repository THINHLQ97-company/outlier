// Helper dùng chung cho các route sinh ảnh (VẼ pipeline + Studio vẽ tự do):
// - Lưu ảnh Gemini thật (data URL base64) vào storage nội bộ, chỉ giữ URL
//   "/api/files/<key>" trong DB (ảnh placeholder demo giữ nguyên data URL).
// - Dọn ảnh biến thể nội bộ khỏi storage (best-effort).
// - Whitelist tỉ lệ khung.
// Tách riêng khỏi images.routes.ts để studio.routes.ts tái dùng mà KHÔNG tạo
// vòng import (images.routes ↔ studio.routes).
import { persistDataUrl, internalKeyFromUrl, storage } from "../storage";

export const ASPECT_RATIOS = ["1:1", "3:4", "9:16"] as const;
export type AspectRatioValue = (typeof ASPECT_RATIOS)[number];

export function normalizeAspectRatio(v: any): AspectRatioValue {
  return ASPECT_RATIOS.includes(v) ? v : "1:1";
}

// Ảnh Gemini thật (data URL, ~1MB/ảnh) → lưu storage, giữ URL nhẹ trong DB.
// Ảnh placeholder demo (SVG data URI) giữ nguyên.
export async function persistVariantImages(
  images: { url: string; source: "social" | "placeholder" }[]
): Promise<{ url: string; source: "social" | "placeholder" }[]> {
  return Promise.all(
    images.map(async (img) => {
      if (img.url.startsWith("data:image/") && img.source === "social") {
        const url = await persistDataUrl("posts", img.url);
        return url ? { ...img, url } : img;
      }
      return img;
    })
  );
}

// Xoá các file ảnh biến thể nội bộ khỏi storage (best-effort, không throw).
export async function deleteInternalVariants(variants: any[] | null | undefined) {
  await Promise.all(
    (variants || []).map(async (img: any) => {
      const key = internalKeyFromUrl(img?.url);
      if (key) await storage.delete(key).catch(() => {});
    })
  );
}
