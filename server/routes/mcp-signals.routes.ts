// MCP server "Tín hiệu" — JSON-RPC 2.0 viết tay (mirror pattern ReportApp), mount
// dạng Express route + Drizzle. Cho Claude (remote connector claude.ai qua OAuth,
// hoặc static bearer SIGNALS_MCP_TOKEN) làm "AI Analyst": THU thêm tin web/news,
// gom cụm/dedup, chấm điểm rubric kèm lý do, gợi ý góc hài. Trí tuệ ở Claude —
// server chỉ cấp/lưu dữ liệu (không gọi LLM server-side).
//
// Endpoint: ALL /api/mcp-signals. GET (không JSON-RPC) → landing page hướng dẫn.
import type { Express } from "express";
import crypto from "crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { signals, rubricVersions, characters as charactersTable } from "../db/schema";
import { computeSignalStatus } from "../services/rubric-scoring";
import { RUBRIC_DEFAULT_THRESHOLDS } from "../../shared/engine-data";
import { verifyAccessToken, baseUrl, type McpPrincipal } from "../mcp/oauth";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "fanpage-signals", title: "Tín hiệu Fanpage — Ăn Nằm Với AI", version: "1.0.0" };
const RETENTION_DAYS = 14;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERVER_INSTRUCTIONS = `Bạn là AI Analyst cho fanpage giải trí "Ăn Nằm Với AI" của Mắt Bão (chủ đề: AI, kế toán, hosting — hài hước, meme). Quy trình:
1. THU: web-search tin nóng liên quan (ưu tiên 14 ngày gần nhất) → signals_add mỗi tin (kèm truc: ai|ke_toan|hosting, sourceUrl, publishedDate).
2. GỘP: signals_list rồi signals_set_cluster gom các tin trùng/cùng chủ đề thành 1 cụm (giảm nhiễu).
3. CHẤM: signals_score mỗi tin theo rubric (rubric_get để biết định nghĩa + ngưỡng) — 5 tiêu chí 1-5 + reasoning ngắn. Server tự route status (queued/idea_bank/rejected). Dính nhóm cấm (chính trị/tôn giáo/thiên tai/tai nạn/người nổi tiếng bị chỉ trích) → dinh_nhom_cam=true → loại thẳng.
4. GÓC HÀI: với tin queued, signals_suggest_angle đề xuất 1 góc lên nội dung hài (scene cụ thể + chọn characters từ characters_list + dialogue ngắn). Người vận hành sẽ review rồi "Đưa sang Sáng tạo".
Luôn dùng characters_list để chọn đúng nhân vật fanpage. Tổng điểm rubric chỉ cộng 4 tiêu chí (do_nong+do_cham+do_hop_truc+tuoi_tho), do_an_toan là cổng an toàn.`;

const READONLY_TOOLS = new Set(["signals_list", "signals_get", "rubric_get", "characters_list"]);

const TOOLS = [
  {
    name: "signals_list",
    description: "Liệt kê tín hiệu (mặc định 14 ngày gần nhất). Lọc theo status (new|queued|idea_bank|rejected), truc (ai|ke_toan|hosting), days, limit.",
    annotations: { title: "Danh sách tín hiệu", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Lọc theo trạng thái: new|queued|idea_bank|rejected" },
        truc: { type: "string", description: "Lọc theo trục: ai|ke_toan|hosting" },
        days: { type: "number", description: "Số ngày gần nhất (mặc định 14)" },
        limit: { type: "number", description: "Số bản ghi tối đa (mặc định 50, max 200)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "signals_get",
    description: "Đọc đầy đủ 1 tín hiệu theo id (điểm, cụm, góc hài đã lưu).",
    annotations: { title: "Chi tiết tín hiệu", readOnlyHint: true },
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "rubric_get",
    description: "Đọc rubric chấm điểm đang áp dụng (định nghĩa 5 tiêu chí + ngưỡng queue_min/idea_bank_min) để chấm nhất quán.",
    annotations: { title: "Rubric hiện hành", readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "characters_list",
    description: "Đọc dàn nhân vật fanpage (tên + tính cách + câu cửa miệng) để chọn cho góc hài.",
    annotations: { title: "Dàn nhân vật", readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "signals_add",
    description: "Thêm 1 tín hiệu bạn tìm được từ web/news (source=claude_research). Chỉ thêm tin ≤14 ngày, kèm sourceUrl + publishedDate nếu có.",
    annotations: { title: "Thêm tín hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Tiêu đề tin" },
        rawSummary: { type: "string", description: "Tóm tắt nội dung" },
        truc: { type: "string", description: "Trục: ai|ke_toan|hosting" },
        sourceUrl: { type: "string", description: "Link nguồn" },
        radar: { type: "string", description: "Tên nguồn/chủ đề (tuỳ chọn)" },
        publishedDate: { type: "string", description: "Ngày đăng ISO (YYYY-MM-DD)" },
      },
      required: ["title", "rawSummary"],
      additionalProperties: false,
    },
  },
  {
    name: "signals_score",
    description: "Chấm điểm rubric cho 1 tín hiệu (5 tiêu chí 1-5) + reasoning. Server tự tính status theo ngưỡng. dinh_nhom_cam=true → loại thẳng.",
    annotations: { title: "Chấm điểm tín hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        do_nong: { type: "number", description: "Độ nóng/thời sự 1-5" },
        do_cham: { type: "number", description: "Độ chạm/cảm xúc 1-5" },
        do_hop_truc: { type: "number", description: "Độ hợp trục nội dung 1-5" },
        tuoi_tho: { type: "number", description: "Tuổi thọ nội dung 1-5" },
        do_an_toan: { type: "number", description: "Độ an toàn 1-5 (cổng, không cộng tổng)" },
        dinh_nhom_cam: { type: "boolean", description: "Dính nhóm chủ đề cấm → loại thẳng" },
        reasoning: { type: "string", description: "Lý do chấm điểm (ngắn gọn)" },
      },
      required: ["id", "do_nong", "do_cham", "do_hop_truc", "tuoi_tho", "do_an_toan"],
      additionalProperties: false,
    },
  },
  {
    name: "signals_set_cluster",
    description: "Gom nhiều tín hiệu trùng/cùng chủ đề thành 1 cụm (dedup). Truyền danh sách id + nhãn cụm.",
    annotations: { title: "Gom cụm tín hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Danh sách id tín hiệu trong cụm" },
        label: { type: "string", description: "Nhãn cụm (chủ đề chung)" },
      },
      required: ["ids", "label"],
      additionalProperties: false,
    },
  },
  {
    name: "signals_suggest_angle",
    description: "Gợi ý 1 góc lên nội dung hài cho 1 tín hiệu: scene cụ thể + nhân vật (tên từ characters_list) + lời thoại ngắn. Người vận hành sẽ đưa sang Sáng tạo.",
    annotations: { title: "Gợi ý góc hài", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        scene: { type: "string", description: "Mô tả cảnh/góc hài cụ thể" },
        characters: { type: "array", items: { type: "string" }, description: "Tên nhân vật đề xuất" },
        dialogue: {
          type: "array",
          items: { type: "object", properties: { character: { type: "string" }, text: { type: "string" } } },
          description: "Lời thoại gắn nhân vật",
        },
        note: { type: "string", description: "Ghi chú thêm (tuỳ chọn)" },
      },
      required: ["id", "scene"],
      additionalProperties: false,
    },
  },
];

const rpcResult = (id: any, result: any) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: any, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const textContent = (obj: any) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

function canView(p: McpPrincipal | null): boolean {
  return !!p && (p.role === "admin" || p.perms.includes("signals") || p.perms.includes("signals-edit"));
}
function canEdit(p: McpPrincipal | null): boolean {
  return !!p && (p.role === "admin" || p.perms.includes("signals-edit"));
}

async function getActiveThresholds(db: any): Promise<{ queue_min: number; idea_bank_min: number }> {
  try {
    const [active] = await db.select().from(rubricVersions).where(eq(rubricVersions.isActive, true)).orderBy(desc(rubricVersions.createdAt));
    if (active?.thresholdsJson) return active.thresholdsJson as any;
  } catch {
    /* fallback default */
  }
  return RUBRIC_DEFAULT_THRESHOLDS as any;
}

// Xử lý 1 tool call → trả object payload (đã unwrap khỏi content).
async function callTool(name: string, args: any, principal: McpPrincipal): Promise<any> {
  const db = getDb();

  if (name === "signals_list") {
    const days = typeof args.days === "number" && args.days >= 0 ? args.days : RETENTION_DAYS;
    const limit = Math.min(Number(args.limit) || 50, 200);
    const conditions: any[] = [];
    if (days > 0) conditions.push(gte(signals.publishedDate, new Date(Date.now() - days * 86400000)));
    if (typeof args.status === "string" && args.status) conditions.push(eq(signals.status, args.status));
    if (typeof args.truc === "string" && args.truc) conditions.push(eq(signals.truc, args.truc));
    const rows = await db
      .select()
      .from(signals)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(signals.publishedDate))
      .limit(limit);
    return { count: rows.length, signals: rows };
  }

  if (name === "signals_get") {
    if (!UUID_RE.test(args.id || "")) throw new Error("id không hợp lệ");
    const [row] = await db.select().from(signals).where(eq(signals.id, args.id));
    if (!row) throw new Error("Không tìm thấy tín hiệu");
    return row;
  }

  if (name === "rubric_get") {
    const [active] = await db.select().from(rubricVersions).where(eq(rubricVersions.isActive, true)).orderBy(desc(rubricVersions.createdAt));
    const thresholds = active?.thresholdsJson || RUBRIC_DEFAULT_THRESHOLDS;
    return {
      thresholds,
      criteria: {
        do_nong: "Độ nóng/thời sự (1-5)",
        do_cham: "Độ chạm/cảm xúc với khán giả (1-5)",
        do_hop_truc: "Độ hợp trục nội dung ai|ke_toan|hosting (1-5)",
        tuoi_tho: "Tuổi thọ nội dung — còn hài được bao lâu (1-5)",
        do_an_toan: "Độ an toàn thương hiệu (1-5) — CỔNG, không cộng tổng",
      },
      scoring_rule: "total = do_nong + do_cham + do_hop_truc + tuoi_tho (max 20). total>=queue_min → queued; >=idea_bank_min → idea_bank; else rejected. dinh_nhom_cam=true → rejected.",
      forbidden_topics: ["Chính trị", "Tôn giáo", "Thiên tai", "Tai nạn", "Người nổi tiếng đang bị chỉ trích"],
    };
  }

  if (name === "characters_list") {
    const rows = await db
      .select({ id: charactersTable.id, name: charactersTable.name, kind: charactersTable.kind, personality: charactersTable.personality, catchphrase: charactersTable.catchphrase })
      .from(charactersTable);
    return { count: rows.length, characters: rows };
  }

  if (name === "signals_add") {
    const title = String(args.title || "").trim();
    const rawSummary = String(args.rawSummary || "").trim();
    if (!title || !rawSummary) throw new Error("Thiếu title hoặc rawSummary");
    const truc = ["ai", "ke_toan", "hosting"].includes(args.truc) ? args.truc : null;
    const publishedDate = args.publishedDate ? new Date(args.publishedDate) : new Date();
    const [row] = await db
      .insert(signals)
      .values({
        source: "claude_research",
        radar: typeof args.radar === "string" ? args.radar : null,
        truc,
        title,
        rawSummary,
        sourceUrl: typeof args.sourceUrl === "string" ? args.sourceUrl : null,
        publishedDate: isNaN(publishedDate.getTime()) ? new Date() : publishedDate,
        status: "new",
        scoreJson: {},
        createdBy: principal.username,
      })
      .returning();
    return { ok: true, signal: row };
  }

  if (name === "signals_score") {
    if (!UUID_RE.test(args.id || "")) throw new Error("id không hợp lệ");
    const crit = [args.do_nong, args.do_cham, args.do_hop_truc, args.tuoi_tho, args.do_an_toan];
    if (crit.some((v) => typeof v !== "number" || v < 1 || v > 5)) throw new Error("5 tiêu chí phải là số 1-5");
    const [signal] = await db.select().from(signals).where(eq(signals.id, args.id));
    if (!signal) throw new Error("Không tìm thấy tín hiệu");
    const thresholds = await getActiveThresholds(db);
    const { status, total } = computeSignalStatus(
      { do_nong: args.do_nong, do_cham: args.do_cham, do_hop_truc: args.do_hop_truc, tuoi_tho: args.tuoi_tho, dinh_nhom_cam: !!args.dinh_nhom_cam },
      thresholds
    );
    const scoreJson = {
      do_nong: args.do_nong,
      do_cham: args.do_cham,
      do_hop_truc: args.do_hop_truc,
      tuoi_tho: args.tuoi_tho,
      do_an_toan: args.do_an_toan,
      total,
      dinh_nhom_cam: !!args.dinh_nhom_cam,
      reasoning: typeof args.reasoning === "string" ? args.reasoning : undefined,
      scored_by: `claude:${principal.username}`,
      scored_at: new Date().toISOString(),
    };
    const [row] = await db.update(signals).set({ scoreJson, status }).where(eq(signals.id, args.id)).returning();
    return { ok: true, status, total, signal: row };
  }

  if (name === "signals_set_cluster") {
    const ids = Array.isArray(args.ids) ? args.ids.filter((x: any) => UUID_RE.test(x)) : [];
    const label = String(args.label || "").trim();
    if (ids.length < 1 || !label) throw new Error("Cần ids (>=1) + label");
    const clusterId = crypto.randomUUID();
    await db.update(signals).set({ clusterId, clusterLabel: label }).where(inArray(signals.id, ids));
    return { ok: true, clusterId, clusterLabel: label, count: ids.length };
  }

  if (name === "signals_suggest_angle") {
    if (!UUID_RE.test(args.id || "")) throw new Error("id không hợp lệ");
    const scene = String(args.scene || "").trim();
    if (!scene) throw new Error("Thiếu scene");
    const suggestionJson = {
      scene,
      characters: Array.isArray(args.characters) ? args.characters.filter((x: any) => typeof x === "string") : [],
      dialogue: Array.isArray(args.dialogue)
        ? args.dialogue
            .filter((d: any) => d && typeof d.character === "string" && typeof d.text === "string")
            .map((d: any) => ({ character: d.character, text: d.text }))
        : [],
      note: typeof args.note === "string" ? args.note : undefined,
      suggested_by: `claude:${principal.username}`,
      suggested_at: new Date().toISOString(),
    };
    const [row] = await db.update(signals).set({ suggestionJson }).where(eq(signals.id, args.id)).returning();
    if (!row) throw new Error("Không tìm thấy tín hiệu");
    return { ok: true, signal: row };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function landingPage(url: string): string {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP Tín hiệu — Fanpage Ăn Nằm Với AI</title>
<style>body{font-family:system-ui,sans-serif;background:#FAF9F6;color:#2D2D2D;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6}
code{background:#F1EEE9;padding:2px 6px;border-radius:6px}h1{color:#D97757}.box{background:#fff;border:1px solid #eadfd8;border-radius:12px;padding:16px 20px;margin:16px 0}</style></head><body>
<h1>🛰️ MCP Tín hiệu — Fanpage "Ăn Nằm Với AI"</h1>
<p>Kết nối Claude làm AI Analyst cho bước THU + LỌC tín hiệu: tự tìm tin nóng, gom cụm, chấm điểm có lý do, gợi ý góc hài.</p>
<div class="box"><b>Thêm connector trên Claude.ai:</b><ol>
<li>Settings → Connectors → Add custom connector</li>
<li>Server URL: <code>${esc(url)}</code></li>
<li>Đăng nhập bằng tài khoản Fanpage (OAuth) — cấp quyền cho Claude</li>
<li>Prompt thử: <i>"Tìm 5 tin AI nóng tuần này, chấm điểm kèm lý do, gom cụm và gợi ý góc hài."</i></li>
</ol></div>
<p>Kết quả Claude tạo (điểm + lý do + cụm + góc hài) hiện trong tab <b>Tín hiệu</b> của app để người vận hành review.</p>
</body></html>`;
}
function esc(s = ""): string {
  return String(s).replace(/[<>"&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", '"': "&quot;", "&": "&amp;" }[c] as string));
}

export function registerMcpSignalsRoutes(app: Express) {
  app.all("/api/mcp-signals", async (req, res) => {
    // GET không kèm JSON-RPC → landing page.
    if (req.method === "GET") {
      return res.status(200).type("html").send(landingPage(`${baseUrl(req)}/api/mcp-signals`));
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    if (!isDbConfigured()) return res.status(503).json({ error: "Thiếu DATABASE_URL" });

    // ── Auth: static token HOẶC OAuth access token ──
    let principal: McpPrincipal | null = null;
    const authHeader = String(req.headers.authorization || "");
    const staticToken = process.env.SIGNALS_MCP_TOKEN || "";
    if (staticToken && authHeader === `Bearer ${staticToken}`) {
      principal = { sub: "static", username: "mcp-static", role: "admin", perms: ["signals", "signals-edit", "admin"] };
    } else if (authHeader.startsWith("Bearer ")) {
      try {
        principal = verifyAccessToken(authHeader.slice(7));
      } catch {
        return res.status(401).json({ error: "Invalid token" });
      }
    }
    if (!principal) {
      res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`);
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!canView(principal)) return res.status(403).json({ error: "Cần quyền 'signals' để dùng MCP này." });

    const msg = req.body || {};
    const { id, method, params } = msg;

    // Notifications (không cần trả result body).
    if (method === "notifications/initialized") return res.status(204).end();
    if (method === "ping") return res.json(rpcResult(id, {}));

    if (method === "initialize") {
      return res.json(
        rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: SERVER_INFO,
          capabilities: { tools: {} },
          instructions: SERVER_INSTRUCTIONS,
        })
      );
    }

    if (method === "tools/list") {
      return res.json(rpcResult(id, { tools: TOOLS }));
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments || {};
      if (!TOOLS.some((t) => t.name === toolName)) return res.json(rpcError(id, -32601, `Unknown tool: ${toolName}`));
      if (!READONLY_TOOLS.has(toolName) && !canEdit(principal)) {
        return res.json(rpcError(id, -32000, "Cần quyền 'signals-edit' để ghi."));
      }
      try {
        const payload = await callTool(toolName, args, principal);
        return res.json(rpcResult(id, textContent(payload)));
      } catch (e: any) {
        return res.json(rpcResult(id, { ...textContent({ error: e?.message || String(e) }), isError: true }));
      }
    }

    return res.json(rpcError(id, -32601, "Method not found"));
  });
}
