// Minimal HTTP JSON-RPC 2.0 client — shared by market-radar.client.ts and
// group-insights.client.ts (PRD §7: cả 2 MCP dùng chung giao thức).
let rpcId = 0;

export class JsonRpcError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

export async function callJsonRpc<T = any>(
  url: string,
  token: string,
  method: string,
  params: Record<string, any>,
  timeoutMs = 10_000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new JsonRpcError(`HTTP ${res.status} từ ${url}`);
    }
    const data = await res.json();
    if (data.error) {
      throw new JsonRpcError(data.error.message || "JSON-RPC error", data.error.code);
    }
    return data.result as T;
  } finally {
    clearTimeout(timer);
  }
}
