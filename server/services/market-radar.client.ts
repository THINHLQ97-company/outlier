// THU — Market Radar MCP client (FR1.1). Reads radar "marketing-kd" +
// "ke-toan" via HTTP JSON-RPC 2.0 (`market_radar_list_articles`). When
// MARKET_RADAR_MCP_TOKEN/URL is missing, falls back to demo articles and logs
// a warning — never throws/crashes the app (PRD §7, PLAN.md risks).
import { callJsonRpc } from "./jsonrpc";

export interface RawSignal {
  source: "market_radar";
  radar: string;
  title: string;
  rawSummary: string;
  sourceUrl: string | null;
  publishedDate: string; // ISO
}

const RADARS = ["marketing-kd", "ke-toan"] as const;

function demoArticles(): RawSignal[] {
  const now = Date.now();
  return [
    {
      source: "market_radar",
      radar: "marketing-kd",
      title: "[DEMO] Dân văn phòng than AI viết email hay lạc đề giữa chừng",
      rawSummary:
        "Bài đăng demo (MARKET_RADAR_MCP_TOKEN chưa cấu hình) — mô phỏng trend than phiền công cụ AI quên context.",
      sourceUrl: null,
      publishedDate: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      source: "market_radar",
      radar: "ke-toan",
      title: "[DEMO] Kế toán chia sẻ mẹo tránh sai mã số thuế khi xuất hóa đơn ĐT",
      rawSummary:
        "Bài đăng demo (MARKET_RADAR_MCP_TOKEN chưa cấu hình) — mô phỏng trend nỗi đau hóa đơn điện tử.",
      sourceUrl: null,
      publishedDate: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

export async function fetchMarketRadarSignals(): Promise<{ signals: RawSignal[]; warning?: string }> {
  const url = process.env.MARKET_RADAR_MCP_URL;
  const token = process.env.MARKET_RADAR_MCP_TOKEN;

  if (!url || !token) {
    const warning =
      "[market-radar] MARKET_RADAR_MCP_URL/MARKET_RADAR_MCP_TOKEN chưa cấu hình — dùng demo data.";
    console.warn(warning);
    // KHÔNG trả dữ liệu giả khi chưa cấu hình.
    //
    // Trước đây chỗ này trả về mấy bài demo cho "có gì đó mà xem". Nhưng chúng
    // lẫn vào danh sách thật, người dùng xoá đi rồi bấm quét lại là chúng quay
    // lại — và tệ hơn, chúng khiến công cụ trông như đang quét được thứ gì đó
    // trong khi không. Trả rỗng kèm lời giải thích thì trung thực hơn.
    return { signals: [], warning };
  }

  try {
    const results = await Promise.all(
      RADARS.map((radar) =>
        callJsonRpc<{ articles?: any[] }>(url, token, "market_radar_list_articles", { radar }).then(
          (r) => ({ radar, articles: r?.articles || [] })
        )
      )
    );
    const signals: RawSignal[] = results.flatMap(({ radar, articles }) =>
      articles.map((a: any) => ({
        source: "market_radar" as const,
        radar,
        title: a.title || a.headline || "(không có tiêu đề)",
        rawSummary: a.summary || a.excerpt || a.title || "",
        sourceUrl: a.url || a.link || null,
        publishedDate: a.publishedAt || a.date || new Date().toISOString(),
      }))
    );
    return { signals };
  } catch (e: any) {
    const warning = `[market-radar] Gọi MCP thất bại (${e?.message || e}) — dùng demo data.`;
    console.warn(warning);
    return { signals: demoArticles(), warning };
  }
}
