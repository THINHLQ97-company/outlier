// THU — Group Insights MCP client (FR1.1). Reads cross-group pain-point
// clusters via HTTP JSON-RPC 2.0 (`group_list_clusters`, cross_group=true).
// Fallback to demo data when GROUP_INSIGHTS_MCP_TOKEN/URL is missing — logs a
// warning, never crashes the app.
import { callJsonRpc } from "./jsonrpc";
import type { RawSignal as MarketRawSignal } from "./market-radar.client";

export interface RawGroupSignal extends Omit<MarketRawSignal, "source" | "radar"> {
  source: "group_insights";
  radar: string; // tên cluster/group
}

function demoClusters(): RawGroupSignal[] {
  const now = Date.now();
  return [
    {
      source: "group_insights",
      radar: "[DEMO] Group Dev & Sysadmin Việt Nam",
      title: "[DEMO] Cluster than phiền SSL hết hạn gây sập web đúng giờ cao điểm",
      rawSummary:
        "Cluster demo (GROUP_INSIGHTS_MCP_TOKEN chưa cấu hình) — mô phỏng pain point hạ tầng xuyên nhóm.",
      sourceUrl: null,
      publishedDate: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

export async function fetchGroupInsightsSignals(): Promise<{ signals: RawGroupSignal[]; warning?: string }> {
  const url = process.env.GROUP_INSIGHTS_MCP_URL;
  const token = process.env.GROUP_INSIGHTS_MCP_TOKEN;

  if (!url || !token) {
    const warning =
      "[group-insights] GROUP_INSIGHTS_MCP_URL/GROUP_INSIGHTS_MCP_TOKEN chưa cấu hình — dùng demo data.";
    console.warn(warning);
    return { signals: demoClusters(), warning };
  }

  try {
    const result = await callJsonRpc<{ clusters?: any[] }>(url, token, "group_list_clusters", {
      cross_group: true,
    });
    const signals: RawGroupSignal[] = (result?.clusters || []).map((c: any) => ({
      source: "group_insights" as const,
      radar: c.groupName || c.group_name || c.cluster || "(nhóm không rõ)",
      title: c.title || c.summary?.slice(0, 80) || "(cluster không có tiêu đề)",
      rawSummary: c.summary || c.description || "",
      sourceUrl: c.url || null,
      publishedDate: c.lastSeenAt || c.date || new Date().toISOString(),
    }));
    return { signals };
  } catch (e: any) {
    const warning = `[group-insights] Gọi MCP thất bại (${e?.message || e}) — dùng demo data.`;
    console.warn(warning);
    return { signals: demoClusters(), warning };
  }
}
