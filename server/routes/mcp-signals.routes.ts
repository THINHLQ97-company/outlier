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
import { signals, rubricVersions, characters as charactersTable, brands, brandSources, radarJobs, radarItems, deconstructions, remakes, watchedChannels, brandFanpages } from "../db/schema";
import { ingestUrl, ingestRawText } from "../services/brand-ingest";
import { extractBrandProfile, type SourceDoc } from "../services/brand-extract";
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

const READONLY_TOOLS = new Set(["signals_list", "signals_get", "rubric_get", "characters_list", "brands_list", "brand_profile_get", "radar_jobs_list", "radar_results", "deconstruct_get", "remake_get", "channels_list", "channel_items", "video_frames"]);

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
    name: "brands_list",
    description: "Liệt kê các hồ sơ thương hiệu (brand) hiện có, kèm trạng thái đã bóc hồ sơ hay chưa.",
    annotations: { title: "Danh sách thương hiệu", readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "brand_profile_get",
    description: "Đọc hồ sơ 1 thương hiệu: bán gì, khách là ai, giọng nói, xưng hô, từ cấm, công dụng được phép nói — MỖI MỤC KÈM CÂU TRÍCH NGUỒN. Mục nào null nghĩa là chưa có dữ liệu (cố ý để thiếu, không bịa).",
    annotations: { title: "Đọc hồ sơ thương hiệu", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { brand_id: { type: "string", description: "Mã thương hiệu (từ brands_list)" } },
      required: ["brand_id"],
      additionalProperties: false,
    },
  },
  {
    name: "brand_ingest",
    description: "Nạp thêm tài liệu cho thương hiệu: dán link website, hoặc dán thẳng nội dung. Tài liệu nạp xong mới bóc được hồ sơ.",
    annotations: { title: "Nạp tài liệu thương hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string", description: "Mã thương hiệu" },
        url: { type: "string", description: "Link trang giới thiệu (http/https)" },
        text: { type: "string", description: "Hoặc dán thẳng nội dung tài liệu" },
      },
      required: ["brand_id"],
      additionalProperties: false,
    },
  },
  {
    name: "brand_extract",
    description: "Bóc hồ sơ thương hiệu từ các tài liệu đã nạp. Mỗi mục phải có câu trích kiểm chứng được trong tài liệu; câu nào không đối chiếu được sẽ bị loại và báo trong 'rejected'. Không tìm thấy thì để thiếu, KHÔNG bịa.",
    annotations: { title: "Bóc hồ sơ thương hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: { brand_id: { type: "string", description: "Mã thương hiệu" } },
      required: ["brand_id"],
      additionalProperties: false,
    },
  },
  {
    name: "radar_jobs_list",
    description: "Liệt kê các phiên quét Radar đã chạy (tìm content đang bật lên trong ngách).",
    annotations: { title: "Danh sách phiên quét", readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "radar_results",
    description: "Đọc kết quả một phiên quét, ĐÃ XẾP theo mức vượt trội so với quy mô kênh (không phải theo lượt thích tuyệt đối). Mỗi bài kèm lý do được chấm điểm và độ tin cậy.",
    annotations: { title: "Kết quả Radar", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Mã phiên quét (từ radar_jobs_list)" },
        limit: { type: "number", description: "Số bài muốn xem, mặc định 20" },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
  },
  {
    name: "deconstruct_start",
    description: "Bắt đầu bóc cấu trúc một bài (3 giây đầu, mở vấn đề, cách giữ chân, twist, cách chốt). Chạy nền 1-3 phút — gọi deconstruct_get để xem kết quả.",
    annotations: { title: "Bóc cấu trúc bài", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Link bài cần phân tích" },
        radar_item_id: { type: "string", description: "Hoặc mã bài lấy từ radar_results" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "deconstruct_get",
    description: "Xem kết quả bóc cấu trúc. status='ready' là xong; 'downloading'/'analyzing' là đang chạy, chờ rồi gọi lại. Mọi mốc đều kèm số giây đã được đối chiếu với độ dài video thật.",
    annotations: { title: "Kết quả bóc cấu trúc", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Mã bản phân tích (từ deconstruct_start)" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "remake_start",
    description: "Viết bản mới cho thương hiệu, đi theo cách triển khai của bài đã bóc cấu trúc. Chạy nền 10-40 giây. Bản viết LUÔN kèm kết quả kiểm tra guardrail; có lỗi mức chặn thì không được đem dùng.",
    annotations: { title: "Viết lại cho thương hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string", description: "Mã thương hiệu (từ brands_list)" },
        deconstruction_id: { type: "string", description: "Mã bản bóc cấu trúc (từ deconstruct_start)" },
        format: { type: "string", enum: ["video_script", "post"], description: "Kịch bản video hay bài đăng" },
      },
      required: ["brand_id", "deconstruction_id"],
      additionalProperties: false,
    },
  },
  {
    name: "remake_get",
    description: "Xem bản viết + kết quả guardrail. guardrailJson.passed=false nghĩa là CÒN LỖI CHẶN, tuyệt đối không đem dùng khi chưa sửa.",
    annotations: { title: "Xem bản viết", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Mã bản viết" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "remake_check",
    description: "Kiểm tra một đoạn nội dung theo quy tắc của thương hiệu: có bê nguyên câu bài gốc không, có dùng từ cấm không, có tự chế công dụng sản phẩm không. Dùng được cho cả nội dung tự viết tay.",
    annotations: { title: "Kiểm tra nội dung", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Mã bản viết cần kiểm tra lại" },
        draft: { type: "string", description: "Nội dung mới (bỏ trống thì kiểm tra bản đang lưu)" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "channels_list",
    description: "Liệt kê các kênh đang theo dõi, kèm số bài MỚI phát hiện ở lần làm mới gần nhất và thời điểm làm mới.",
    annotations: { title: "Kênh đang theo dõi", readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "channel_items",
    description: "Xem bài của một kênh theo dõi, bài MỚI xếp lên đầu. Mỗi bài kèm điểm vượt trội so với quy mô kênh và lý do chấm.",
    annotations: { title: "Bài của kênh", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Mã kênh (từ channels_list)" },
        only_new: { type: "boolean", description: "Chỉ lấy bài mới" },
        limit: { type: "number", description: "Số bài, mặc định 20" },
      },
      required: ["channel_id"],
      additionalProperties: false,
    },
  },
  {
    name: "channel_refresh",
    description: "Làm mới một kênh để xem họ vừa đăng gì. Chạy nền 30-60 giây. LƯU Ý: kênh có useApify=true sẽ tốn phí mỗi lần làm mới.",
    annotations: { title: "Làm mới kênh", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: { channel_id: { type: "string", description: "Mã kênh" } },
      required: ["channel_id"],
      additionalProperties: false,
    },
  },
  {
    name: "video_frames",
    description: "Lấy các KHUNG HÌNH của một video để BẠN TỰ NHÌN và tự phân tích (kèm lời thoại nếu có). Dùng khi cần đánh giá phần hình — cảnh quay, chữ trên màn hình, biểu cảm — rồi đối chiếu với tính cách thương hiệu. Khác deconstruct_* ở chỗ: deconstruct để model khác xem hộ rồi trả mô tả bằng chữ, còn tool này đưa ảnh thật cho bạn.",
    annotations: { title: "Xem khung hình video", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Link video" },
        radar_item_id: { type: "string", description: "Hoặc mã bài từ radar_results / channel_items" },
        count: { type: "number", description: "Số khung, mặc định 6, tối đa 12" },
        include_transcript: { type: "boolean", description: "Kèm lời thoại có mốc giây (mặc định có)" },
      },
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

/**
 * Tool thường trả dữ liệu dạng chữ. Nhưng MCP cho phép trả cả ẢNH — và đó là
 * cách duy nhất để Claude TỰ NHÌN khung hình video thay vì đọc mô tả do một
 * model khác viết hộ. Tool nào cần vậy thì đặt `__mcpContent` trong kết quả.
 */
function toolContent(payload: any) {
  if (payload && Array.isArray(payload.__mcpContent)) return { content: payload.__mcpContent };
  return textContent(payload);
}

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

  if (name === "brands_list") {
    const rows = await db
      .select({ id: brands.id, name: brands.name, owner: brands.owner, ingestStatus: brands.ingestStatus, updatedAt: brands.updatedAt })
      .from(brands)
      .orderBy(desc(brands.updatedAt))
      .limit(100);
    return { count: rows.length, brands: rows };
  }

  if (name === "brand_profile_get") {
    if (!UUID_RE.test(args.brand_id || "")) throw new Error("brand_id không hợp lệ");
    const [row] = await db.select().from(brands).where(eq(brands.id, args.brand_id));
    if (!row) throw new Error("Không tìm thấy thương hiệu");
    const srcs = await db
      .select({ id: brandSources.id, kind: brandSources.kind, sourceUrl: brandSources.sourceUrl, title: brandSources.title, charCount: brandSources.charCount })
      .from(brandSources)
      .where(eq(brandSources.brandId, args.brand_id));

    // Trang/kênh của chính thương hiệu — Claude cần biết nội dung sẽ đăng ở đâu
    // để gợi ý đu trend cho đúng chỗ, đúng định dạng.
    const pages = await db.select().from(brandFanpages).where(eq(brandFanpages.brandId, args.brand_id));

    const FIELDS = [
      "sells", "audience", "toneOfVoice", "addressing", "bannedTerms", "allowedClaims",
      "personality", "contentPillars", "trendDos", "trendDonts",
    ] as const;
    // Nói rõ mục nào còn thiếu để Claude không tự điền vào chỗ trống.
    const missing = FIELDS.filter((k) => !(row as any)[k]);

    return {
      ...row,
      sources: srcs,
      fanpages: pages.map((f: any) => ({
        platform: f.platform, pageName: f.pageName, pageUrl: f.pageUrl, handle: f.handle,
        followerCount: f.followerCount, topics: f.topics, formats: f.formats,
        postingCadence: f.postingCadence, audienceNote: f.audienceNote,
        isPrimary: f.isPrimary,
      })),
      missing_fields: missing,
      note:
        "personality = TÍNH CÁCH thương hiệu (con người đứng sau), khác toneOfVoice (cách nói). " +
        "contentPillars = mảng nội dung theo đuổi, dùng để lọc trend nào đáng đu. " +
        "trendDos/trendDonts = nguyên tắc khi bắt trend. " +
        "fanpages = nơi thương hiệu đăng bài, dùng để gợi ý đúng định dạng và đúng người đọc." +
        (missing.length
          ? " CÁC MỤC TRONG missing_fields CHƯA CÓ DỮ LIỆU — không được tự suy đoán hay điền thay."
          : ""),
    };
  }

  if (name === "brand_ingest") {
    if (!UUID_RE.test(args.brand_id || "")) throw new Error("brand_id không hợp lệ");
    const [row] = await db.select().from(brands).where(eq(brands.id, args.brand_id));
    if (!row) throw new Error("Không tìm thấy thương hiệu");
    const url = typeof args.url === "string" ? args.url.trim() : "";
    const text = typeof args.text === "string" ? args.text : "";
    if (!url && !text) throw new Error("Cần url hoặc text");
    const result = url ? await ingestUrl(url) : ingestRawText(text);
    const [src] = await db
      .insert(brandSources)
      .values({
        brandId: args.brand_id, kind: url ? "website" : "text", sourceUrl: url || null,
        title: result.title || null, extractedText: result.text, charCount: result.charCount, status: "ready",
      })
      .returning({ id: brandSources.id, kind: brandSources.kind, title: brandSources.title, charCount: brandSources.charCount });
    return { added: src, hint: "Gọi brand_extract để bóc hồ sơ từ tài liệu đã nạp." };
  }

  if (name === "brand_extract") {
    if (!UUID_RE.test(args.brand_id || "")) throw new Error("brand_id không hợp lệ");
    const [row] = await db.select().from(brands).where(eq(brands.id, args.brand_id));
    if (!row) throw new Error("Không tìm thấy thương hiệu");
    const srcs = await db.select().from(brandSources).where(eq(brandSources.brandId, args.brand_id));
    const docs: SourceDoc[] = srcs
      .filter((s: any) => s.status === "ready" && s.extractedText)
      .map((s: any) => ({ id: s.id, url: s.sourceUrl || undefined, text: s.extractedText }));
    if (docs.length === 0) throw new Error("Chưa có tài liệu nào — gọi brand_ingest trước");

    const profile = await extractBrandProfile(docs);
    const keep = (cur: any, next: any) => (cur?.source === "manual" ? cur : next);
    const [updated] = await db
      .update(brands)
      .set({
        sells: keep(row.sells, profile.sells),
        audience: keep(row.audience, profile.audience),
        toneOfVoice: keep(row.toneOfVoice, profile.toneOfVoice),
        addressing: keep(row.addressing, profile.addressing),
        bannedTerms: keep(row.bannedTerms, profile.bannedTerms),
        allowedClaims: keep(row.allowedClaims, profile.allowedClaims),
        ingestStatus: "ready",
        updatedAt: new Date(),
      })
      .where(eq(brands.id, args.brand_id))
      .returning();
    return {
      ...updated,
      rejected: profile.rejected,
      note: profile.rejected.length
        ? "Các mục trong 'rejected' đã bị LOẠI vì không đối chiếu được câu trích với tài liệu gốc. Đây là hành vi đúng, không phải lỗi."
        : undefined,
    };
  }

  if (name === "radar_jobs_list") {
    const rows = await db
      .select({ id: radarJobs.id, query: radarJobs.query, queryKind: radarJobs.queryKind, platforms: radarJobs.platforms,
                status: radarJobs.status, scannedCount: radarJobs.scannedCount, enrichedCount: radarJobs.enrichedCount,
                createdAt: radarJobs.createdAt })
      .from(radarJobs)
      .orderBy(desc(radarJobs.createdAt))
      .limit(50);
    return { count: rows.length, jobs: rows };
  }

  if (name === "radar_results") {
    if (!UUID_RE.test(args.job_id || "")) throw new Error("job_id không hợp lệ");
    const limit = Math.min(Number(args.limit) || 20, 100);
    const rows = await db
      .select()
      .from(radarItems)
      .where(eq(radarItems.jobId, args.job_id))
      .orderBy(desc(radarItems.outperformScore))
      .limit(limit);
    return {
      count: rows.length,
      // Quy về thang 100 cho dễ đọc; kèm lý do để biết điểm đến từ đâu.
      items: rows.map((r: any) => ({
        url: r.url, title: r.title, platform: r.platform,
        channelName: r.channelName, followerCount: r.followerCount,
        views: r.views, likes: r.likes, comments: r.comments, shares: r.shares,
        publishedAt: r.publishedAt,
        outperformScore: r.outperformScore == null ? null : r.outperformScore / 10,
        confidence: r.confidence,
        metricsSource: r.metricsSource,
        reasons: (r.scoreBreakdown || {}).reasons || [],
      })),
      note: "Điểm trên thang 100, xếp theo mức vượt trội so với quy mô CHÍNH KÊNH ĐÓ — không phải theo lượt thích tuyệt đối. Bài có confidence='low' là số liệu còn thiếu, chỉ nên tham khảo.",
    };
  }

  if (name === "deconstruct_start") {
    let url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url && UUID_RE.test(args.radar_item_id || "")) {
      const [item] = await db.select().from(radarItems).where(eq(radarItems.id, args.radar_item_id));
      if (!item) throw new Error("Không tìm thấy bài trong kết quả quét");
      url = item.url;
    }
    if (!url) throw new Error("Cần url hoặc radar_item_id");
    const { assertPublicUrl } = await import("../services/brand-ingest");
    assertPublicUrl(url);

    const [row] = await db.insert(deconstructions)
      .values({ owner: principal.username, sourceUrl: url, status: "downloading",
                radarItemId: UUID_RE.test(args.radar_item_id || "") ? args.radar_item_id : null })
      .returning({ id: deconstructions.id, status: deconstructions.status });

    const { runDeconstructForMcp } = await import("./deconstruct.routes");
    void runDeconstructForMcp(row.id, url);

    return { ...row, note: "Đang chạy nền, mất khoảng 1-3 phút. Gọi deconstruct_get với id này để xem kết quả." };
  }

  if (name === "deconstruct_get") {
    if (!UUID_RE.test(args.id || "")) throw new Error("id không hợp lệ");
    const [row] = await db.select().from(deconstructions).where(eq(deconstructions.id, args.id));
    if (!row) throw new Error("Không tìm thấy bản phân tích");
    return {
      ...row,
      note:
        row.status === "ready"
          ? "Mọi mốc thời gian đã được đối chiếu với độ dài video thật; mốc nằm ngoài video đã bị loại. 'formula' mô tả CÁCH TRIỂN KHAI để học theo — không được chép lại câu chữ của bài gốc."
          : row.status === "error"
          ? "Phân tích không thành công — xem errorMessage."
          : "Đang chạy, chờ khoảng 30 giây rồi gọi lại.",
    };
  }

  if (name === "remake_start") {
    if (!UUID_RE.test(args.brand_id || "")) throw new Error("brand_id không hợp lệ");
    if (!UUID_RE.test(args.deconstruction_id || "")) throw new Error("deconstruction_id không hợp lệ");
    const [brand] = await db.select().from(brands).where(eq(brands.id, args.brand_id));
    if (!brand) throw new Error("Không tìm thấy thương hiệu");
    const [decon] = await db.select().from(deconstructions).where(eq(deconstructions.id, args.deconstruction_id));
    if (!decon) throw new Error("Không tìm thấy bản bóc cấu trúc");
    if (decon.status !== "ready" || !decon.structure) throw new Error("Bài này chưa bóc xong cấu trúc");

    const format = args.format === "post" ? "post" : "video_script";
    const [row] = await db.insert(remakes).values({
      owner: principal.username, brandId: args.brand_id, deconstructionId: args.deconstruction_id,
      format, status: "pending", sourceUrl: decon.sourceUrl, sourceTitle: decon.title,
    }).returning({ id: remakes.id, status: remakes.status });

    const { runRemakeInBackground } = await import("./remakes.routes");
    void runRemakeInBackground(
      row.id,
      { name: brand.name, sells: brand.sells, audience: brand.audience, toneOfVoice: brand.toneOfVoice,
        addressing: brand.addressing, bannedTerms: brand.bannedTerms, allowedClaims: brand.allowedClaims },
      decon.structure as any, format as any, decon.transcript,
    );
    return { ...row, note: "Đang viết, mất khoảng 10-40 giây. Gọi remake_get với id này để xem kết quả kèm guardrail." };
  }

  if (name === "remake_get") {
    if (!UUID_RE.test(args.id || "")) throw new Error("id không hợp lệ");
    const [row] = await db.select().from(remakes).where(eq(remakes.id, args.id));
    if (!row) throw new Error("Không tìm thấy bản viết");
    const g: any = row.guardrailJson;
    return {
      ...row,
      note:
        row.status !== "ready"
          ? "Chưa xong — chờ rồi gọi lại."
          : g && g.passed === false
          ? "BẢN NÀY CÒN LỖI CHẶN — xem guardrailJson.issues. Không được đem dùng khi chưa sửa xong."
          : "Bản này qua được kiểm tra. Vẫn nên có người đọc lại lần cuối trước khi đăng.",
    };
  }

  if (name === "remake_check") {
    if (!UUID_RE.test(args.id || "")) throw new Error("id không hợp lệ");
    const [row] = await db.select().from(remakes).where(eq(remakes.id, args.id));
    if (!row) throw new Error("Không tìm thấy bản viết");
    const [brand] = await db.select().from(brands).where(eq(brands.id, row.brandId));
    const [decon] = row.deconstructionId
      ? await db.select().from(deconstructions).where(eq(deconstructions.id, row.deconstructionId))
      : ([null] as any);

    const text = typeof args.draft === "string" && args.draft.trim() ? args.draft : row.draft || "";
    if (!text.trim()) throw new Error("Chưa có nội dung để kiểm tra");

    const { runGuardrail } = await import("../services/guardrail");
    const report = runGuardrail(text, {
      sourceText: decon?.transcript ?? null,
      brand: brand
        ? { sells: brand.sells, addressing: brand.addressing, bannedTerms: brand.bannedTerms, allowedClaims: brand.allowedClaims }
        : null,
    });
    await db.update(remakes).set({ draft: text, guardrailJson: report as any, updatedAt: new Date() }).where(eq(remakes.id, args.id));
    return {
      ...report,
      note: report.passed
        ? "Không thấy vi phạm nào ở mức chặn."
        : "CÒN LỖI CHẶN — phải sửa các mục trong issues trước khi dùng.",
    };
  }

  if (name === "channels_list") {
    const rows = await db.select().from(watchedChannels).orderBy(desc(watchedChannels.updatedAt)).limit(100);
    return {
      count: rows.length,
      channels: rows.map((c: any) => ({
        id: c.id, platform: c.platform, channelName: c.channelName, channelUrl: c.channelUrl,
        followerCount: c.followerCount, note: c.note,
        newSinceLastCheck: c.lastNewCount, lastScanAt: c.lastScanAt,
        scanStatus: c.scanStatus, costsMoneyToRefresh: c.useApify,
      })),
      note: "newSinceLastCheck là số bài mới phát hiện ở lần làm mới GẦN NHẤT. Kênh có costsMoneyToRefresh=true sẽ tốn phí mỗi lần làm mới — đừng tự ý gọi channel_refresh cho các kênh đó.",
    };
  }

  if (name === "channel_items") {
    if (!UUID_RE.test(args.channel_id || "")) throw new Error("channel_id không hợp lệ");
    const [chan] = await db.select().from(watchedChannels).where(eq(watchedChannels.id, args.channel_id));
    if (!chan) throw new Error("Không tìm thấy kênh");
    if (!chan.lastJobId) return { count: 0, items: [], note: "Kênh này chưa quét lần nào." };

    const limit = Math.min(Number(args.limit) || 20, 100);
    const conds: any[] = [eq(radarItems.jobId, chan.lastJobId)];
    if (args.only_new === true) conds.push(eq(radarItems.isNew, true));
    const rows = await db.select().from(radarItems)
      .where(and(...conds))
      .orderBy(desc(radarItems.isNew), desc(radarItems.outperformScore))
      .limit(limit);

    return {
      channel: { name: chan.channelName, followerCount: chan.followerCount, lastScanAt: chan.lastScanAt },
      count: rows.length,
      items: rows.map((r: any) => ({
        url: r.url, title: r.title, isNew: r.isNew,
        views: r.views, likes: r.likes, publishedAt: r.publishedAt,
        outperformScore: r.outperformScore == null ? null : r.outperformScore / 10,
        confidence: r.confidence,
        reasons: (r.scoreBreakdown || {}).reasons || [],
      })),
      note: "isNew=true là bài chưa từng thấy ở các lần làm mới trước. Điểm trên thang 100, so với quy mô CHÍNH kênh đó.",
    };
  }

  if (name === "channel_refresh") {
    if (!UUID_RE.test(args.channel_id || "")) throw new Error("channel_id không hợp lệ");
    const [chan] = await db.select().from(watchedChannels).where(eq(watchedChannels.id, args.channel_id));
    if (!chan) throw new Error("Không tìm thấy kênh");
    if (chan.scanStatus === "scanning") throw new Error("Kênh này đang được quét, chờ một chút");

    const { refreshChannelInBackground } = await import("./channels.routes");
    void refreshChannelInBackground(args.channel_id);
    return {
      id: chan.id, status: "scanning",
      costsMoney: chan.useApify,
      note: chan.useApify
        ? "Đang làm mới. Kênh này dùng dịch vụ có phí nên lượt làm mới này PHÁT SINH CHI PHÍ. Chờ 30-60 giây rồi gọi channel_items."
        : "Đang làm mới, khoảng 30-60 giây. Gọi channel_items để xem kết quả.",
    };
  }

  if (name === "video_frames") {
    let url = typeof args.url === "string" ? args.url.trim() : "";
    if (!url && UUID_RE.test(args.radar_item_id || "")) {
      const [item] = await db.select().from(radarItems).where(eq(radarItems.id, args.radar_item_id));
      if (!item) throw new Error("Không tìm thấy bài trong kết quả quét");
      url = item.url;
    }
    if (!url) throw new Error("Cần url hoặc radar_item_id");

    const { assertPublicUrl } = await import("../services/brand-ingest");
    assertPublicUrl(url);

    const { extractFrames, DEFAULT_FRAME_COUNT } = await import("../services/video-frames");
    const count = Math.min(Math.max(2, Number(args.count) || DEFAULT_FRAME_COUNT), 12);
    const out = await extractFrames(url, count);

    if (out.frames.length === 0) {
      return { error: out.warning || "Không lấy được khung hình nào.", url };
    }

    let transcript: string | undefined;
    if (args.include_transcript !== false) {
      const { fetchTranscript } = await import("../services/deconstruct");
      transcript = await fetchTranscript(url).catch(() => undefined);
    }

    // Trộn chữ và ảnh: mỗi ảnh có một dòng chữ nói rõ nó ở giây thứ mấy, để
    // Claude gắn được điều nhìn thấy với mốc thời gian trong bài.
    const content: any[] = [{
      type: "text",
      text:
        `Khung hình từ video: ${url}\n` +
        `Độ dài: ${out.durationSec ? Math.round(out.durationSec) + " giây" : "không rõ"} · ${out.frames.length} khung\n` +
        `Các khung dồn về đoạn mở đầu vì đó là chỗ quyết định người xem ở lại.\n` +
        (transcript ? `\nLỜI THOẠI (kèm mốc giây):\n${transcript.slice(0, 6000)}\n` : "\n(Video này không có lời thoại lấy được.)\n"),
    }];
    for (const f of out.frames) {
      content.push({ type: "text", text: `— giây ${f.atSec} —` });
      content.push({ type: "image", data: f.base64, mimeType: f.mimeType });
    }
    content.push({
      type: "text",
      text:
        "Hãy tự xem các khung trên rồi rút ra CÁCH TRIỂN KHAI: 3 giây đầu làm gì, " +
        "mở vấn đề kiểu nào, giữ chân bằng gì, chốt ra sao. Đối chiếu với tính cách " +
        "thương hiệu (brand_profile_get) để nói rõ trend/cách làm này có hợp không và " +
        "nên chỉnh gì. Chỉ mô tả những gì THỰC SỰ thấy trong ảnh, đừng suy diễn.",
    });

    return { __mcpContent: content };
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
        return res.json(rpcResult(id, toolContent(payload)));
      } catch (e: any) {
        return res.json(rpcResult(id, { ...textContent({ error: e?.message || String(e) }), isError: true }));
      }
    }

    return res.json(rpcError(id, -32601, "Method not found"));
  });
}
