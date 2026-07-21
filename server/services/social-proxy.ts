// DỊCH (generateText) + VẼ (generate-image) — server-side proxy sang
// share-projects/social (SOCIAL_BACKEND_URL). API key/token KHÔNG BAO GIỜ đi
// tới client — mọi gọi Gemini nằm ở đây (PRD §5 NFR).
//
// Khi SOCIAL_BACKEND_URL chưa cấu hình (chưa xác nhận endpoint thật — xem
// PLAN.md "Risks + Assumptions"), fallback sang kịch bản mẫu / ảnh placeholder
// tự sinh (không phụ thuộc mạng ngoài), đánh dấu `isDemo: true`, log warning
// rõ ràng — KHÔNG throw, không crash toàn app.
import { buildScriptPrompt, FORMATS, type AxisKey } from "../../shared/engine-data";

export interface GeneratedScriptVariant {
  formatMeme: string;
  panels: string[];
  caption: string;
  ctaSoft: string;
}

export interface GenerateScriptResult {
  variants: GeneratedScriptVariant[];
  isDemo: boolean;
  warning?: string;
}

function demoVariants(signalSummary: string, formatMeme: string): GeneratedScriptVariant[] {
  const codes = [formatMeme, ...FORMATS.map((f) => f.code).filter((c) => c !== formatMeme)].slice(0, 3);
  const shortSummary = signalSummary.length > 60 ? `${signalSummary.slice(0, 57)}...` : signalSummary;
  return codes.map((code, i) => {
    const fmt = FORMATS.find((f) => f.code === code)!;
    return {
      formatMeme: code,
      panels:
        fmt.structure.includes("2 khung")
          ? [`[DEMO] ${shortSummary}`, `[DEMO] Punchline phương án ${i + 1}`]
          : [`[DEMO] ${shortSummary}`],
      caption: `[DEMO — SOCIAL_BACKEND_URL chưa cấu hình] Kịch bản mẫu ${i + 1}/3 cho format ${code}.`,
      ctaSoft: "",
    };
  });
}

export async function generateScriptVariants(input: {
  signalSummary: string;
  truc: AxisKey;
  formatMeme: string;
}): Promise<GenerateScriptResult> {
  const baseUrl = process.env.SOCIAL_BACKEND_URL;
  const token = process.env.SOCIAL_BACKEND_TOKEN;

  if (!baseUrl) {
    const warning = "[social-proxy] SOCIAL_BACKEND_URL chưa cấu hình — dùng kịch bản mẫu (demo).";
    console.warn(warning);
    return { variants: demoVariants(input.signalSummary, input.formatMeme), isDemo: true, warning };
  }

  const prompt = buildScriptPrompt(input);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const text: string = data.text || data.result || "";
    const parsed = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Phản hồi không đúng định dạng JSON array.");
    return {
      variants: parsed.map((v: any) => ({
        formatMeme: v.formatMeme || input.formatMeme,
        panels: Array.isArray(v.panels) ? v.panels : [String(v.panels || "")],
        caption: v.caption || "",
        ctaSoft: v.ctaSoft || "",
      })),
      isDemo: false,
    };
  } catch (e: any) {
    const warning = `[social-proxy] Gọi generateText thất bại (${e?.message || e}) — dùng kịch bản mẫu (demo).`;
    console.warn(warning);
    return { variants: demoVariants(input.signalSummary, input.formatMeme), isDemo: true, warning };
  }
}

export interface GenerateImageResult {
  images: { url: string; source: "social" | "placeholder" }[];
  isDemo: boolean;
  warning?: string;
}

// Placeholder tự sinh — SVG data URI, không phụ thuộc mạng ngoài. Kích thước
// vuông 1024x1024 (đủ dùng làm canvas nền cho text-overlay editor Step 5).
function placeholderImage(label: string, seedColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="100%" height="100%" fill="${seedColor}"/>
    <rect x="24" y="24" width="976" height="976" fill="none" stroke="#ffffff" stroke-width="4" stroke-dasharray="12 10"/>
    <text x="50%" y="46%" font-family="sans-serif" font-size="40" fill="#ffffff" text-anchor="middle">ẢNH DEMO</text>
    <text x="50%" y="53%" font-family="sans-serif" font-size="24" fill="#ffffff" text-anchor="middle">${label}</text>
    <text x="50%" y="60%" font-family="sans-serif" font-size="18" fill="#ffffffaa" text-anchor="middle">SOCIAL_BACKEND_URL chưa cấu hình</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function generateImageVariants(input: {
  styleSummary: string;
  panelsText: string;
  characterNames: string[];
}): Promise<GenerateImageResult> {
  const baseUrl = process.env.SOCIAL_BACKEND_URL;
  const token = process.env.SOCIAL_BACKEND_TOKEN;

  if (!baseUrl) {
    const warning = "[social-proxy] SOCIAL_BACKEND_URL chưa cấu hình — dùng ảnh placeholder (demo).";
    console.warn(warning);
    return {
      images: [
        { url: placeholderImage(input.characterNames.join(", "), "#4338ca"), source: "placeholder" },
        { url: placeholderImage(input.characterNames.join(", "), "#d94f2c"), source: "placeholder" },
      ],
      isDemo: true,
      warning,
    };
  }

  try {
    const results = await Promise.all(
      [0, 1].map(async () => {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/generate-image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            prompt: `${input.styleSummary}\n\n${input.panelsText}`,
            characters: input.characterNames,
            noText: true, // FR4.2 — ảnh KHÔNG chữ, gắn overlay ở hậu kỳ
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const url = data.url || data.imageUrl || (data.base64 ? `data:image/png;base64,${data.base64}` : null);
        if (!url) throw new Error("Phản hồi thiếu url/imageUrl/base64.");
        return { url, source: "social" as const };
      })
    );
    return { images: results, isDemo: false };
  } catch (e: any) {
    const warning = `[social-proxy] Gọi generate-image thất bại (${e?.message || e}) — dùng ảnh placeholder (demo).`;
    console.warn(warning);
    return {
      images: [
        { url: placeholderImage(input.characterNames.join(", "), "#4338ca"), source: "placeholder" },
        { url: placeholderImage(input.characterNames.join(", "), "#d94f2c"), source: "placeholder" },
      ],
      isDemo: true,
      warning,
    };
  }
}
