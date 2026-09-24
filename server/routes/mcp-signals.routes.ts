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
import { signals, rubricVersions, characters as charactersTable, brands, brandSources, radarJobs, radarItems, deconstructions, remakes, watchedChannels, brandFanpages, videoProjects, videoScenes } from "../db/schema";
import { ingestUrl, ingestRawText } from "../services/brand-ingest";
import { extractBrandProfile, type SourceDoc } from "../services/brand-extract";
import { computeSignalStatus } from "../services/rubric-scoring";
import { RUBRIC_DEFAULT_THRESHOLDS } from "../../shared/engine-data";
import { verifyAccessToken, baseUrl, type McpPrincipal } from "../mcp/oauth";

const PROTOCOL_VERSION = "2024-11-05";
// Tên này là thứ người dùng thấy trong danh sách connector của Claude. Giữ
// `name` cũ để client nào đã lưu cấu hình không phải nối lại.
const SERVER_INFO = { name: "fanpage-signals", title: "Outlier — tìm viral, remake cho brand", version: "2.0.0" };
const RETENTION_DAYS = 14;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lời chào server gửi cho Claude ngay khi kết nối. Đây là thứ thay cho một
// "skill" phải cài riêng: nó tự nạp mỗi lần kết nối, nên phải nói đủ ba điều —
// công cụ này để làm gì, đi theo thứ tự nào, và chỗ nào dễ làm sai.
const SERVER_INSTRUCTIONS = `Đây là Outlier — công cụ tìm nội dung đang bật lên rồi remake cho thương hiệu của người dùng.

PHIÊN LÀM VIỆC ĐỊNH KỲ
Gọi daily_brief TRƯỚC TIÊN. Nó cho biết có gì mới và nên làm gì, trong một lần gọi, không tốn tiền. Rồi làm theo thứ tự trong suggestedActions — danh sách đó đã xếp rẻ trước, tốn tiền sau. Việc nào tốn tiền (channel_refresh, deconstruct_comments với Facebook/TikTok) thì hỏi người dùng, đừng tự quyết.

QUY TẮC XUYÊN SUỐT
- Luôn bắt đầu bằng brand_brief để biết mình đang viết cho TRANG NÀO. Không có hồ sơ trang thì mọi thứ viết ra chỉ là giọng chung chung.
- Hồ sơ nói mục nào "chưa có dữ liệu" thì ĐỪNG tự suy ra. Hỏi người dùng rồi ghi bằng brand_set.
- Nhiều thao tác quét tốn tiền thật (Apify tính theo từng kết quả). Tool nào tốn tiền đều nói rõ trong mô tả — hỏi người dùng trước khi gọi.

BỐN VIỆC CHÍNH

1. DỰNG HỒ SƠ TRANG (làm một lần, nhưng quyết định chất lượng mọi thứ sau đó)
   - brands_list → brand_brief xem đã có gì.
   - Trang của chính người dùng: fanpage_connect_meta rồi fanpage_sync_posts → brand_extract. Cách này bóc tính cách từ chính bài đã đăng, mỗi mục có câu trích kèm link, và miễn phí.
   - Thứ tài liệu không nói được (pageRole, "không bao giờ làm", nhận diện hình ảnh, bài mẫu đúng giọng) thì hỏi người dùng rồi ghi bằng brand_set.

2. TÌM NỘI DUNG ĐANG BẬT LÊN
   - Tự search tin nóng rồi signals_add (kèm truc, sourceUrl, publishedDate) — nhanh nhất, không tốn tiền.
   - channels_list / channel_items xem các kênh đang theo dõi; channel_refresh để quét lại (tốn tiền).
   - radar_results đọc kết quả radar đã chạy.
   - Điểm "vượt trội" so với baseline của CHÍNH kênh đó, không so với kênh khác — một kênh nhỏ có bài gấp 10 lần thường ngày đáng học hơn kênh lớn đăng bài bình thường.

3. BẮT TREND → RA NỘI DUNG
   - trend_draft là đường ngắn nhất: mô tả trend càng cụ thể càng tốt → ra mấy phương án đăng được luôn, đã soi guardrail.
   - kind="post" cho bài viết, kind="video" cho kịch bản video. Hai khuôn khác nhau, đừng dùng lẫn.
   - Phương án nào bị đánh dấu blocked thì ĐỪNG đưa cho người dùng như thể dùng được — chỉ ra nó sai ở đâu.
   - Nếu trend không hợp với trang, nói thẳng là không nên đu. Đó là câu trả lời hợp lệ.

4. HỌC TỪ MỘT BÀI CỤ THỂ RỒI VIẾT LẠI
   - deconstruct_start (một link) → deconstruct_get để lấy cấu trúc.
   - remake_start → remake_get. remake_check soi lại bản viết.
   - Nguồn là video thì video_frames cho xem hình từng mốc thời gian.
   - Học CÁCH TRIỂN KHAI, không bê câu chữ. Guardrail sẽ chặn nếu trùng quá 7 từ liên tiếp với bài gốc.

PHÂN BIỆT HAI THỨ HAY LẪN
- "Trang của thương hiệu" (brand_fanpage_add) = nơi người dùng tự đăng bài.
- "Kênh theo dõi" (channels_list) = kênh người khác, để học và bắt trend.

Còn một luồng cũ vẫn dùng được: signals_score chấm tin theo rubric (rubric_get để biết ngưỡng), signals_suggest_angle gợi ý góc hài với dàn nhân vật cố định (characters_list).`;

const READONLY_TOOLS = new Set(["daily_brief", "signals_list", "signals_get", "rubric_get", "characters_list", "brands_list", "brand_profile_get", "brand_brief", "radar_jobs_list", "radar_results", "deconstruct_get", "remake_get", "channels_list", "channel_items", "video_frames", "video_projects_list", "video_get"]);

const TOOLS = [
  {
    name: "daily_brief",
    description: "TOÀN CẢNH trong một lần gọi — nên gọi ĐẦU TIÊN mỗi phiên làm việc, nhất là phiên chạy định kỳ. Trả về: xu hướng mới chưa xử lý, bài hay điểm cao chưa đem đi bóc, bản bóc chưa đọc bình luận, bản viết xong chưa đăng, kênh lâu chưa quét, và danh sách việc nên làm tiếp đã xếp theo thứ tự rẻ trước tốn tiền sau. Tool này KHÔNG tự quét gì nên luôn miễn phí.",
    annotations: { title: "Toàn cảnh hôm nay", readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
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
    name: "brand_brief",
    description: "Bản tóm tắt NGẮN về nhân vật của trang, viết sẵn thành văn xuôi để đọc là viết đúng giọng ngay — dùng cái này trước khi soạn caption, comment, kịch bản hay prompt ảnh. Gọn hơn brand_profile_get (không kèm trích dẫn, không kèm dữ liệu thô). Nói rõ mục nào còn thiếu thay vì lấp bằng phỏng đoán.",
    annotations: { title: "Tóm tắt nhân vật của trang", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string", description: "Mã thương hiệu (từ brands_list)" },
        for: { type: "string", enum: ["writing", "image"], description: "writing = soạn chữ (mặc định); image = sinh ảnh, nhấn phần nhận diện hình ảnh" },
      },
      required: ["brand_id"],
      additionalProperties: false,
    },
  },
  {
    name: "brand_profile_get",
    description: "Đọc hồ sơ ĐẦY ĐỦ 1 thương hiệu, dạng dữ liệu thô: pageRole (trang tồn tại để làm gì), personality, registers (ngữ vực), behaviorRules (luôn làm/không bao giờ làm), catchphrases, visualIdentity (nhận diện hình ảnh — cần khi sinh ảnh), fewShotExamples (bài mẫu đúng giọng), cùng bán gì, khách là ai, giọng nói, xưng hô, từ cấm, công dụng được phép nói — MỖI MỤC KÈM CÂU TRÍCH NGUỒN. Mục nào null nghĩa là chưa có dữ liệu (cố ý để thiếu, không bịa). Chỉ cần viết đúng giọng thì dùng brand_brief cho gọn hơn.",
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
    name: "brand_set",
    description: "Ghi TAY một hoặc nhiều mục của hồ sơ thương hiệu. Dùng cho những thứ do người chủ quyết định chứ không bóc ra từ tài liệu: pageRole (trang tồn tại để làm gì), personality (tính cách), registers (ngữ vực), behaviorRules (luôn làm / không bao giờ làm), catchphrases (câu cửa miệng), visualIdentity (nhận diện hình ảnh, cần cho việc sinh ảnh), fewShotExamples (bài mẫu đúng giọng), contentPillars, trendDos/trendDonts. Mục ghi tay được đánh dấu source='manual' và sẽ KHÔNG bị lần bóc tài liệu sau ghi đè.",
    annotations: { title: "Ghi hồ sơ thương hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string", description: "Mã thương hiệu (từ brands_list)" },
        personality: { type: "array", items: { type: "string" }, description: "Tính cách: con người đứng sau thương hiệu, vd 'người anh đi trước chỉ đường', 'hay đùa nhưng không cợt nhả'" },
        content_pillars: { type: "array", items: { type: "string" }, description: "Mảng nội dung theo đuổi" },
        trend_dos: { type: "array", items: { type: "string" }, description: "Nên làm gì khi bắt trend" },
        trend_donts: { type: "array", items: { type: "string" }, description: "Tránh gì khi bắt trend" },
        tone_of_voice: { type: "string", description: "Cách nói chuyện (khác tính cách)" },
        addressing: { type: "string", description: "Xưng hô" },
        audience: { type: "string", description: "Khách hàng là ai" },
        sells: { type: "array", items: { type: "string" }, description: "Bán gì" },
        banned_terms: { type: "array", items: { type: "string" }, description: "Từ không được dùng" },
        allowed_claims: { type: "array", items: { type: "string" }, description: "Công dụng được phép nói" },
        page_role: { type: "string", description: "Trang tồn tại để làm gì, trong MỘT câu. Vd 'sân sau của Mắt Bão, bán tên miền bằng trò đố đọc lệch'. Đây là mục quan trọng nhất — đọc nó là hiểu ngay trang này là gì." },
        catchphrases: { type: "array", items: { type: "string" }, description: "Câu cửa miệng — thứ khiến người đọc nhận ra ngay là trang nào" },
        registers: {
          type: "array",
          description: "Ngữ vực: cùng tính cách nhưng đổi cách nói theo tình huống. Phần lớn trang có đúng hai (nói với khách / nói với khán giả).",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Tên ngữ vực, vd 'ngọt với khách'" },
              when: { type: "string", description: "Dùng khi nào, vd 'trong ảnh chat với khách'" },
              pronouns: { type: "string", description: "Xưng hô, vd 'em – anh'" },
              example: { type: "string", description: "Một câu mẫu" },
            },
            required: ["name", "when"],
          },
        },
        behavior_rules: {
          type: "object",
          description: "HÀNH VI luôn làm / không bao giờ làm. Khác banned_terms: 'không tự nói ra tầng nghĩa bậy' không chặn được bằng danh sách từ.",
          properties: {
            always: { type: "array", items: { type: "string" } },
            never: { type: "array", items: { type: "string" } },
          },
        },
        visual_identity: {
          type: "object",
          description: "Nhận diện hình ảnh — thiếu phần này thì ảnh sinh ra 'đúng nội dung, sai trang'.",
          properties: {
            template: { type: "string", description: "Khuôn ảnh cứng, vd 'ảnh chat trên nền thanh địa chỉ trình duyệt'" },
            palette: { type: "array", items: { type: "string" }, description: "Màu chủ đạo" },
            mustHave: { type: "array", items: { type: "string" }, description: "Thứ luôn phải có trong ảnh" },
            doNots: { type: "array", items: { type: "string" }, description: "Thứ không bao giờ được xuất hiện" },
          },
        },
        few_shot_examples: {
          type: "array",
          description: "Bài mẫu đã được chủ trang duyệt là đúng giọng. Vài ví dụ thật nặng ký hơn nhiều dòng mô tả tính cách.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["caption", "comment", "inbox", "post", "script"] },
              text: { type: "string" },
              register: { type: "string", description: "Khớp tên một ngữ vực ở trên" },
              note: { type: "string", description: "Vì sao mẫu này đúng giọng" },
            },
            required: ["kind", "text"],
          },
        },
      },
      required: ["brand_id"],
      additionalProperties: false,
    },
  },
  {
    name: "brand_create",
    description: "Tạo một thương hiệu mới (chỉ cần tên). Sau đó dùng brand_set để điền tính cách, hoặc brand_ingest + brand_extract để bóc từ tài liệu.",
    annotations: { title: "Tạo thương hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Tên thương hiệu" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "brand_fanpage_add",
    description: "Thêm trang/kênh CỦA CHÍNH thương hiệu (nơi thương hiệu đăng bài) — khác kênh theo dõi đối thủ. Giúp gợi ý đu trend đúng định dạng, đúng người đọc của từng trang.",
    annotations: { title: "Thêm trang của thương hiệu", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string" },
        page_url: { type: "string", description: "Link trang" },
        platform: { type: "string", description: "facebook|tiktok|youtube|instagram|threads|zalo (bỏ trống sẽ tự đoán từ link)" },
        page_name: { type: "string" },
        follower_count: { type: "number" },
        topics: { type: "array", items: { type: "string" }, description: "Chủ đề trang này tập trung" },
        formats: { type: "array", items: { type: "string" }, description: "Định dạng hay dùng: video ngắn, bài dài, carousel ảnh…" },
        posting_cadence: { type: "string", description: "Tần suất đăng, vd '3 bài/tuần'" },
        audience_note: { type: "string", description: "Đặc thù người theo dõi riêng của trang này" },
        is_primary: { type: "boolean", description: "Trang chính" },
      },
      required: ["brand_id", "page_url"],
      additionalProperties: false,
    },
  },
  {
    name: "fanpage_set_characters",
    description: "Gán nhân vật đại diện (từ characters_list) cho một trang của thương hiệu. Gán rồi thì khi vẽ ảnh bằng remake_image, ảnh mẫu của nhân vật được đưa vào làm chuẩn — nhân vật giữ nguyên ngoại hình qua các bài thay vì mỗi bài một kiểu. Truyền mảng rỗng để bỏ gán.",
    annotations: { title: "Gán nhân vật cho trang", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        fanpage_id: { type: "string", description: "Mã dòng fanpage (từ brand_profile_get, mục pages)" },
        character_ids: { type: "array", items: { type: "string" }, description: "Mã nhân vật, lấy từ characters_list" },
      },
      required: ["fanpage_id", "character_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "remake_image",
    description: "Vẽ ảnh minh hoạ cho một bản viết đã có. Ảnh bám nhận diện hình ảnh của thương hiệu (khuôn ảnh quen thuộc, thứ luôn phải có, và nhất là thứ không bao giờ được xuất hiện) — nên hồ sơ có visualIdentity thì ảnh mới ra đúng trang. Bỏ trống prompt thì tự đọc bản viết rồi tả; truyền prompt để tả theo ý mình. Trả về ảnh cho Claude xem luôn.",
    annotations: { title: "Vẽ ảnh cho bản viết", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        remake_id: { type: "string", description: "Mã bản viết (từ remake_get)" },
        prompt: { type: "string", description: "Tự tả ảnh cần vẽ; bỏ trống thì tool tự đọc bản viết rồi tả" },
        aspect_ratio: { type: "string", description: "Tỉ lệ khung: 1:1 (mặc định), 4:5, 16:9, 9:16" },
      },
      required: ["remake_id"],
      additionalProperties: false,
    },
  },
  {
    name: "remake_publish",
    description: "Đăng một bản viết lên fanpage đã nối Meta. Chỉ đăng được lên trang thuộc đúng thương hiệu của bản viết đó. Có ảnh đang chọn thì đăng dạng bài ảnh, không thì đăng chỉ chữ. Truyền scheduled_at để hẹn giờ — Facebook giữ bài và tự đăng, cách hiện tại ít nhất 10 phút. Đã đăng lên trang đó rồi thì bị chặn, trừ khi truyền force=true. Đây là thao tác CÔNG KHAI, không hoàn tác được — hỏi người dùng trước khi gọi.",
    annotations: { title: "Đăng lên fanpage", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        remake_id: { type: "string", description: "Mã bản viết (từ remake_get)" },
        fanpage_id: { type: "string", description: "Mã dòng fanpage đã nối Meta (từ brand_profile_get, mục pages)" },
        scheduled_at: { type: "string", description: "Thời điểm hẹn đăng, dạng ISO. Bỏ trống = đăng ngay." },
        force: { type: "boolean", description: "Đăng lại dù đã đăng lên trang này rồi" },
      },
      required: ["remake_id", "fanpage_id"],
      additionalProperties: false,
    },
  },
  {
    name: "deconstruct_comments",
    description: "Đọc bình luận dưới bài gốc rồi rút ra NGƯỜI XEM THẬT SỰ QUAN TÂM GÌ: các cụm chủ đề họ bàn (kèm số lượng và câu trích thật), câu hỏi lặp lại, điều họ phản đối, và góc nên làm tiếp. Bóc cấu trúc cho biết bài được dựng thế nào; cái này cho biết nó chạm vào đâu — hai thứ hay lệch nhau, và thứ người đọc bàn mới là thứ đáng viết tiếp. YouTube đọc MIỄN PHÍ (cần YOUTUBE_API_KEY); Facebook và TikTok qua Apify nên TỐN TIỀN theo từng bình luận — hỏi người dùng trước khi gọi. Số lượng trong kết quả do code đếm lại, không phải model tự khai.",
    annotations: { title: "Phân tích bình luận", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        deconstruction_id: { type: "string", description: "Mã bản bóc cấu trúc (từ deconstruct_get)" },
        limit: { type: "number", description: "Số bình luận đọc, 10-300, mặc định 100. Facebook/TikTok tính tiền theo số này." },
      },
      required: ["deconstruction_id"],
      additionalProperties: false,
    },
  },
  {
    name: "google_trends_scan",
    description: "Quét xu hướng tìm kiếm của Google (RSS công khai, MIỄN PHÍ, không cần key) rồi nạp vào Xu hướng. Mỗi mục kèm lượng tìm kiếm ước lượng và vài tin báo chí liên quan. Lưu ý: đây là thứ người ta đang TÌM KIẾM, chưa phải thứ đang lan trên mạng xã hội — đọc tin kèm theo mới biết chuyện gì đang xảy ra. Từ khoá trùng ngày trước sẽ bị bỏ qua, gọi lại nhiều lần không nhân bản dữ liệu.",
    annotations: { title: "Quét Google Trends", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        geo: { type: "string", description: "Mã quốc gia hai chữ, mặc định VN" },
        limit: { type: "number", description: "Số xu hướng lấy về, 1-50, mặc định 20" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "trend_draft",
    description: "Từ một trend đang nóng (drama, tin hot, meme đang lan) → mấy phương án nội dung ĐĂNG ĐƯỢC LUÔN, viết đúng giọng của trang và đã soi qua guardrail. Đây là bước nối giữa 'tìm được trend' và 'có bài để đăng'. Chọn kind='post' cho bài viết, kind='video' cho kịch bản video — hai khuôn khác nhau. Nếu trend không hợp với trang, tool sẽ nói thẳng là KHÔNG NÊN ĐU thay vì cố viết.",
    annotations: { title: "Trend → nội dung", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string", description: "Mã thương hiệu (từ brands_list)" },
        trend: { type: "string", description: "Mô tả trend càng cụ thể càng tốt: chuyện gì, ai đang bàn, vì sao nóng, người ta đang đùa kiểu gì" },
        kind: { type: "string", enum: ["post", "video"], description: "post = bài viết (mặc định), video = kịch bản video" },
        count: { type: "number", description: "Số phương án, 1-5, mặc định 3" },
        extra: { type: "string", description: "Yêu cầu thêm, vd 'nhấn vào chuyện deploy ngày cuối tuần'" },
      },
      required: ["brand_id", "trend"],
      additionalProperties: false,
    },
  },
  {
    name: "fanpage_connect_meta",
    description: "Nối một fanpage (đã thêm bằng brand_fanpage_add) với Meta bằng Page Access Token, để đọc bài của chính page đó miễn phí qua Graph API. Chỉ dùng cho page MÌNH quản lý — page người khác vẫn phải đi qua Apify và tốn tiền. Token được kiểm tra trước khi lưu, và lưu ở dạng mã hoá.",
    annotations: { title: "Nối fanpage với Meta", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        fanpage_id: { type: "string", description: "Mã dòng fanpage (từ brand_profile_get, mục pages)" },
        page_access_token: { type: "string", description: "Page Access Token lấy từ Meta (cần quyền pages_read_engagement)" },
        page_id: { type: "string", description: "Mã page của Meta, bỏ trống sẽ tự đoán từ link" },
      },
      required: ["fanpage_id", "page_access_token"],
      additionalProperties: false,
    },
  },
  {
    name: "fanpage_sync_posts",
    description: "Quét các bài đã đăng của fanpage đã nối Meta, gộp thành một tài liệu rồi nạp vào hồ sơ thương hiệu. Sau đó gọi brand_extract để bóc giọng nói, xưng hô, chủ đề TỪ CHÍNH BÀI CỦA PAGE — mỗi mục sẽ kèm câu trích có link bài. Lưu ý: bài đã đăng không nói được 'không bao giờ làm', phần đó phải hỏi chủ trang rồi ghi bằng brand_set.",
    annotations: { title: "Quét bài của fanpage", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        fanpage_id: { type: "string", description: "Mã dòng fanpage" },
        limit: { type: "number", description: "Số bài lấy về, 10-500, mặc định 100" },
      },
      required: ["fanpage_id"],
      additionalProperties: false,
    },
  },
  {
    name: "video_make",
    description: "Tạo dự án dựng video từ một bản viết rồi tách thành các cảnh. Bước tách cảnh MIỄN PHÍ — người dùng xem và sửa cảnh trước, sau đó mới bấm dựng hình (bước đó tốn tiền và PHẢI do người dùng tự bấm trên giao diện).",
    annotations: { title: "Tạo dự án video", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        remake_id: { type: "string", description: "Mã bản viết (từ remake_get)" },
        script: { type: "string", description: "Hoặc dán thẳng kịch bản" },
        title: { type: "string" },
        aspect_ratio: { type: "string", enum: ["9:16", "16:9"], description: "Mặc định dọc 9:16" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "video_projects_list",
    description: "Liệt kê các dự án dựng video.",
    annotations: { title: "Danh sách dự án video", readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "video_get",
    description: "Xem một dự án video: các cảnh, lời dẫn, mô tả hình, trạng thái từng cảnh và chi phí ước tính nếu dựng hình.",
    annotations: { title: "Xem dự án video", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "video_scene_set",
    description: "Sửa lời dẫn hoặc mô tả hình của một cảnh TRƯỚC khi dựng. Sửa mô tả hình sẽ bỏ clip cũ của cảnh đó.",
    annotations: { title: "Sửa cảnh video", readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        scene_id: { type: "string" },
        narration: { type: "string", description: "Lời dẫn (tiếng Việt)" },
        visual_prompt: { type: "string", description: "Mô tả hình (tiếng Anh, gửi cho mô hình dựng hình)" },
        duration_sec: { type: "number", description: "3-10 giây" },
      },
      required: ["scene_id"],
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

  if (name === "daily_brief") {
    const { buildDailyBrief } = await import("../services/daily-brief");
    return await buildDailyBrief(principal.username);
  }

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

  if (name === "brand_brief") {
    if (!UUID_RE.test(args.brand_id || "")) throw new Error("brand_id không hợp lệ");
    const [row] = await db.select().from(brands).where(eq(brands.id, args.brand_id));
    if (!row) throw new Error("Không tìm thấy thương hiệu");
    const pages = await db.select().from(brandFanpages).where(eq(brandFanpages.brandId, args.brand_id));
    const { buildBrandBrief } = await import("../services/brand-brief");
    const text = buildBrandBrief(row as any, pages as any, args.for === "image" ? "image" : "writing");
    return { brand_id: row.id, name: row.name, for: args.for === "image" ? "image" : "writing", brief: text };
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

  if (name === "brand_create") {
    const nm = String(args.name || "").trim();
    if (!nm) throw new Error("Cần tên thương hiệu");
    const [row] = await db.insert(brands).values({ owner: principal.username, name: nm }).returning();
    return { ...row, note: "Đã tạo. Dùng brand_set để điền tính cách, hoặc brand_ingest + brand_extract để bóc từ tài liệu." };
  }

  if (name === "brand_set") {
    if (!UUID_RE.test(args.brand_id || "")) throw new Error("brand_id không hợp lệ");
    const [row] = await db.select().from(brands).where(eq(brands.id, args.brand_id));
    if (!row) throw new Error("Không tìm thấy thương hiệu");

    // Mục ghi tay không cần câu trích (người chủ tự quyết), nhưng phải đánh dấu
    // source="manual" — vừa để phân biệt với mục bóc từ tài liệu, vừa để lần
    // bóc sau không ghi đè lên quyết định của người dùng.
    const mk = (v: any) => ({ value: v, evidence: [], source: "manual" as const });
    const arr = (v: any) => (Array.isArray(v) ? v.map((x: any) => String(x).trim()).filter(Boolean) : null);
    const str = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

    const patch: Record<string, any> = { updatedAt: new Date() };
    const mapArr: [string, string][] = [
      ["personality", "personality"], ["content_pillars", "contentPillars"],
      ["trend_dos", "trendDos"], ["trend_donts", "trendDonts"],
      ["sells", "sells"], ["banned_terms", "bannedTerms"], ["allowed_claims", "allowedClaims"],
    ];
    for (const [inKey, col] of mapArr) {
      if (!(inKey in args)) continue;
      const v = arr(args[inKey]);
      patch[col] = v && v.length ? mk(v) : null;
    }
    for (const [inKey, col] of [["tone_of_voice", "toneOfVoice"], ["addressing", "addressing"], ["audience", "audience"], ["page_role", "pageRole"]] as [string, string][]) {
      if (!(inKey in args)) continue;
      const v = str(args[inKey]);
      patch[col] = v ? mk(v) : null;
    }
    if ("catchphrases" in args) {
      const v = arr(args.catchphrases);
      patch.catchphrases = v && v.length ? mk(v) : null;
    }
    // Ba mục dưới đây có cấu trúc riêng: lọc bỏ phần tử thiếu trường bắt buộc
    // thay vì nhận bừa, để hồ sơ không chứa mục rỗng khiến model đoán mò.
    if ("registers" in args) {
      const list = Array.isArray(args.registers) ? args.registers : [];
      const clean = list
        .map((r: any) => ({
          name: str(r?.name),
          when: str(r?.when),
          pronouns: str(r?.pronouns) || undefined,
          example: str(r?.example) || undefined,
        }))
        .filter((r: any) => r.name && r.when);
      patch.registers = clean.length ? mk(clean) : null;
    }
    if ("behavior_rules" in args) {
      const br = args.behavior_rules || {};
      const always = arr(br.always) || [];
      const never = arr(br.never) || [];
      patch.behaviorRules = always.length || never.length ? mk({ always, never }) : null;
    }
    if ("visual_identity" in args) {
      const vi = args.visual_identity || {};
      const clean: Record<string, any> = {};
      if (str(vi.template)) clean.template = str(vi.template);
      for (const k of ["palette", "mustHave", "doNots"]) {
        const v = arr(vi[k]);
        if (v && v.length) clean[k] = v;
      }
      patch.visualIdentity = Object.keys(clean).length ? mk(clean) : null;
    }
    if ("few_shot_examples" in args) {
      const list = Array.isArray(args.few_shot_examples) ? args.few_shot_examples : [];
      const KINDS = ["caption", "comment", "inbox", "post", "script"];
      const clean = list
        .map((e: any) => ({
          kind: KINDS.includes(e?.kind) ? e.kind : "caption",
          text: str(e?.text),
          register: str(e?.register) || undefined,
          note: str(e?.note) || undefined,
        }))
        .filter((e: any) => e.text);
      patch.fewShotExamples = clean.length ? mk(clean) : null;
    }
    if (Object.keys(patch).length === 1) throw new Error("Chưa có mục nào để ghi");

    const [updated] = await db.update(brands).set(patch).where(eq(brands.id, args.brand_id)).returning();
    const written = Object.keys(patch).filter((k) => k !== "updatedAt");
    return { ...updated, written_fields: written, note: `Đã ghi ${written.length} mục, đánh dấu là nhập tay nên lần bóc tài liệu sau sẽ không ghi đè.` };
  }

  if (name === "fanpage_set_characters") {
    if (!UUID_RE.test(args.fanpage_id || "")) throw new Error("fanpage_id không hợp lệ");
    const ids = Array.isArray(args.character_ids)
      ? args.character_ids.map((x: any) => String(x).trim()).filter((x: string) => UUID_RE.test(x))
      : [];
    const [updated] = await db
      .update(brandFanpages)
      .set({ characterIds: ids, updatedAt: new Date() })
      .where(eq(brandFanpages.id, args.fanpage_id))
      .returning();
    if (!updated) throw new Error("Không tìm thấy trang");
    return {
      fanpage_id: updated.id,
      character_ids: ids,
      note: ids.length
        ? "Đã gán. Từ giờ remake_image sẽ dùng ảnh mẫu của các nhân vật này làm chuẩn."
        : "Đã bỏ gán nhân vật cho trang này.",
    };
  }

  if (name === "remake_image") {
    if (!UUID_RE.test(args.remake_id || "")) throw new Error("remake_id không hợp lệ");
    const { generateRemakeImage } = await import("../services/remake-image");
    const out = await generateRemakeImage({
      remakeId: args.remake_id,
      aspectRatio: args.aspect_ratio ? String(args.aspect_ratio) : undefined,
      customPrompt: args.prompt ? String(args.prompt) : undefined,
    });

    // Trả ảnh về dạng Claude xem được, không chỉ đường dẫn: người dùng hỏi "vẽ
    // giúp" thì muốn thấy ngay kết quả chứ không phải mở link.
    const { storage, internalKeyFromUrl } = await import("../storage");
    const key = internalKeyFromUrl(out.image.url);
    let __mcpContent: any[] | undefined;
    if (key) {
      const buf = await storage.get(key).catch(() => null);
      if (buf) {
        __mcpContent = [
          { type: "image", data: buf.toString("base64"), mimeType: "image/png" },
          { type: "text", text: `Đã vẽ xong. Mô tả đã dùng: ${out.description}` },
        ];
      }
    }
    return { image: out.image, description: out.description, ...(__mcpContent ? { __mcpContent } : {}) };
  }

  if (name === "remake_publish") {
    if (!UUID_RE.test(args.remake_id || "")) throw new Error("remake_id không hợp lệ");
    if (!UUID_RE.test(args.fanpage_id || "")) throw new Error("fanpage_id không hợp lệ");

    const [row] = await db.select().from(remakes).where(eq(remakes.id, args.remake_id));
    if (!row) throw new Error("Không tìm thấy bản viết");
    if (!row.draft?.trim()) throw new Error("Bản viết chưa có nội dung");

    const [page] = await db.select().from(brandFanpages).where(eq(brandFanpages.id, args.fanpage_id));
    if (!page || page.brandId !== row.brandId) throw new Error("Trang này không thuộc thương hiệu của bản viết");
    if (!page.metaTokenEnc || !page.metaPageId) throw new Error("Trang chưa nối Meta");

    const already = (row.publishedJson || []).find((p) => p.fanpageId === args.fanpage_id);
    if (already && !args.force) {
      throw new Error(
        `Bản viết này đã đăng lên "${already.pageName || "trang này"}" (${already.permalink}). Truyền force=true nếu vẫn muốn đăng lại.`,
      );
    }

    const scheduledAt = args.scheduled_at ? new Date(String(args.scheduled_at)) : null;
    if (scheduledAt && isNaN(scheduledAt.getTime())) throw new Error("scheduled_at không đọc được");

    const { publishToPage } = await import("../services/meta-publish");
    const out = await publishToPage({
      pageId: page.metaPageId,
      tokenEnc: page.metaTokenEnc,
      message: row.draft,
      imageUrl: row.selectedImageUrl,
      scheduledAt,
    });

    const record = {
      fanpageId: args.fanpage_id,
      pageName: page.pageName || page.pageUrl,
      postId: out.postId,
      permalink: out.permalink,
      publishedAt: new Date().toISOString(),
      scheduled: out.scheduled,
      scheduledFor: scheduledAt ? scheduledAt.toISOString() : undefined,
    };
    await db
      .update(remakes)
      .set({ publishedJson: [...(row.publishedJson || []), record], updatedAt: new Date() })
      .where(eq(remakes.id, args.remake_id));

    return record;
  }

  if (name === "deconstruct_comments") {
    if (!UUID_RE.test(args.deconstruction_id || "")) throw new Error("deconstruction_id không hợp lệ");
    const limit = Math.min(300, Math.max(10, Number(args.limit) || 100));

    const [row] = await db.select().from(deconstructions).where(eq(deconstructions.id, args.deconstruction_id));
    if (!row) throw new Error("Không tìm thấy bản bóc cấu trúc");

    const platform = (row.platform || "").toLowerCase();
    let comments: { text: string; likes?: number }[] = [];
    let warning: string | undefined;
    let costUsd = 0;

    if (platform === "youtube") {
      const { fetchYouTubeComments } = await import("../services/youtube-comments");
      const out = await fetchYouTubeComments(row.sourceUrl, limit);
      comments = out.comments;
      warning = out.warning;
    } else {
      const { fetchComments } = await import("../services/comment-fetch");
      const out = await fetchComments(platform, row.sourceUrl, limit);
      comments = out.comments;
      warning = out.warning;
      costUsd = out.costUsd;
    }

    if (comments.length === 0) throw new Error(warning || "Không lấy được bình luận nào.");

    const { analyzeComments } = await import("../services/audience-insight");
    const { insight } = await analyzeComments(comments);

    await db
      .update(deconstructions)
      .set({ commentsJson: comments, audienceInsight: insight, commentsFetchedAt: new Date(), updatedAt: new Date() })
      .where(eq(deconstructions.id, args.deconstruction_id));

    return {
      fetched: comments.length,
      cost_usd: costUsd,
      insight,
      warning,
      note: "Đã lưu. Lần remake tới từ bản bóc này sẽ tự bám theo mối quan tâm của người đọc.",
    };
  }

  if (name === "google_trends_scan") {
    const geo = typeof args.geo === "string" && /^[A-Za-z]{2}$/.test(args.geo) ? args.geo.toUpperCase() : "VN";
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
    const { fetchGoogleTrends, trendToSummary, trendToMeta } = await import("../services/google-trends");
    const items = await fetchGoogleTrends(geo, limit);

    let inserted = 0;
    let skipped = 0;
    let upgraded = 0;
    for (const t of items) {
      const [existing] = await db
        .select({ id: signals.id, sourceMetaJson: signals.sourceMetaJson })
        .from(signals)
        .where(and(eq(signals.title, t.title), eq(signals.radar, `google_trends_${geo}`)));
      if (existing) {
        // Nâng cấp bản ghi cũ tại chỗ thay vì bỏ qua (xem ghi chú ở signals.routes.ts).
        if (!existing.sourceMetaJson) {
          await db
            .update(signals)
            .set({ rawSummary: trendToSummary(t), sourceMetaJson: trendToMeta(t, geo) })
            .where(eq(signals.id, existing.id));
          upgraded++;
        } else {
          skipped++;
        }
        continue;
      }
      await db.insert(signals).values({
        source: "google_trends",
        radar: `google_trends_${geo}`,
        truc: null,
        title: t.title,
        rawSummary: trendToSummary(t),
        sourceUrl: t.news[0]?.url || null,
        publishedDate: t.publishedAt ? new Date(t.publishedAt) : new Date(),
        status: "new",
        scoreJson: {},
        sourceMetaJson: trendToMeta(t, geo),
      });
      inserted++;
    }
    return {
      geo,
      found: items.length,
      inserted,
      upgraded,
      skipped,
      trends: items.map((t) => ({ title: t.title, traffic: t.approxTraffic, news: t.news.slice(0, 2) })),
      note: "Google chỉ công bố 10 từ khoá đang nổi mỗi lần, kèm ước lượng thận trọng — con số nhỏ là bình thường. Đây là thứ người ta đang TÌM KIẾM, chưa phải thứ đang lan trên mạng xã hội: đọc tin kèm theo rồi dùng trend_draft.",
    };
  }

  if (name === "trend_draft") {
    if (!UUID_RE.test(args.brand_id || "")) throw new Error("brand_id không hợp lệ");
    const { draftFromTrend } = await import("../services/trend-draft");
    return await draftFromTrend({
      brandId: args.brand_id,
      trend: String(args.trend || ""),
      kind: args.kind === "video" ? "video" : "post",
      count: Number(args.count) || 3,
      extra: args.extra ? String(args.extra) : undefined,
    });
  }

  if (name === "fanpage_connect_meta") {
    if (!UUID_RE.test(args.fanpage_id || "")) throw new Error("fanpage_id không hợp lệ");
    const token = String(args.page_access_token || "").trim();
    if (!token) throw new Error("Cần page_access_token");
    const { connectFanpageMeta } = await import("../services/fanpage-sync");
    const out = await connectFanpageMeta(args.fanpage_id, token, args.page_id ? String(args.page_id).trim() : undefined);
    return {
      connected: true,
      page: out.page,
      note: "Đã nối. Gọi fanpage_sync_posts để quét bài về, rồi brand_extract để bóc tính cách từ bài thật.",
    };
  }

  if (name === "fanpage_sync_posts") {
    if (!UUID_RE.test(args.fanpage_id || "")) throw new Error("fanpage_id không hợp lệ");
    const limit = Math.min(500, Math.max(10, Number(args.limit) || 100));
    const { syncFanpagePosts } = await import("../services/fanpage-sync");
    return await syncFanpagePosts(args.fanpage_id, limit);
  }

  if (name === "brand_fanpage_add") {
    if (!UUID_RE.test(args.brand_id || "")) throw new Error("brand_id không hợp lệ");
    const [row] = await db.select().from(brands).where(eq(brands.id, args.brand_id));
    if (!row) throw new Error("Không tìm thấy thương hiệu");

    const pageUrl = String(args.page_url || "").trim();
    if (!pageUrl) throw new Error("Cần page_url");
    const { assertPublicUrl } = await import("../services/brand-ingest");
    assertPublicUrl(pageUrl);

    const u = pageUrl.toLowerCase();
    const guessed =
      u.includes("facebook.com") || u.includes("fb.com") ? "facebook" :
      u.includes("tiktok.com") ? "tiktok" :
      u.includes("youtube.com") || u.includes("youtu.be") ? "youtube" :
      u.includes("instagram.com") ? "instagram" :
      u.includes("threads.net") || u.includes("threads.com") ? "threads" :
      u.includes("zalo.me") ? "zalo" : null;
    const platform = String(args.platform || "").trim() || guessed;
    if (!platform) throw new Error("Không nhận ra nền tảng, hãy truyền platform");

    const arr = (v: any) => (Array.isArray(v) ? v.map((x: any) => String(x).trim()).filter(Boolean) : []);
    const [fp] = await db.insert(brandFanpages).values({
      brandId: args.brand_id, platform, pageUrl,
      pageName: String(args.page_name || "").trim() || null,
      followerCount: Number.isFinite(Number(args.follower_count)) ? Number(args.follower_count) : null,
      topics: arr(args.topics), formats: arr(args.formats),
      postingCadence: String(args.posting_cadence || "").trim() || null,
      audienceNote: String(args.audience_note || "").trim() || null,
      isPrimary: args.is_primary === true,
    }).returning();
    return { ...fp, note: "Đã thêm trang của thương hiệu. Xem lại bằng brand_profile_get." };
  }

  if (name === "video_make") {
    let script = typeof args.script === "string" ? args.script.trim() : "";
    let title = typeof args.title === "string" ? args.title.trim() : "";
    const remakeId = UUID_RE.test(args.remake_id || "") ? args.remake_id : null;
    if (!script && remakeId) {
      const [r] = await db.select().from(remakes).where(eq(remakes.id, remakeId));
      if (!r) throw new Error("Không tìm thấy bản viết");
      if (!r.draft) throw new Error("Bản viết này chưa có nội dung");
      script = r.draft;
      title = title || r.sourceTitle || "";
    }
    if (!script) throw new Error("Cần remake_id hoặc script");

    const [row] = await db.insert(videoProjects).values({
      owner: principal.username, remakeId, title: title || null, scriptText: script,
      aspectRatio: args.aspect_ratio === "16:9" ? "16:9" : "9:16", status: "splitting",
    }).returning();

    const { runSplitForMcp } = await import("./videos.routes");
    void runSplitForMcp(row.id, script);
    return {
      ...row,
      note: "Đang tách cảnh (miễn phí), khoảng 20-40 giây. Gọi video_get để xem. " +
            "Bước dựng hình TỐN TIỀN nên phải do người dùng tự bấm trên giao diện — bạn đừng tự chạy.",
    };
  }

  if (name === "video_projects_list") {
    const rows = await db.select().from(videoProjects).orderBy(desc(videoProjects.createdAt)).limit(50);
    return { count: rows.length, projects: rows };
  }

  if (name === "video_get") {
    if (!UUID_RE.test(args.id || "")) throw new Error("id không hợp lệ");
    const [row] = await db.select().from(videoProjects).where(eq(videoProjects.id, args.id));
    if (!row) throw new Error("Không tìm thấy dự án");
    const scenes = await db.select().from(videoScenes).where(eq(videoScenes.projectId, args.id));
    scenes.sort((a: any, b: any) => a.orderIndex - b.orderIndex);
    const { estimateSceneCostUsd } = await import("../services/video-build");
    const pending = scenes.filter((s: any) => !s.clipKey).length;
    return {
      ...row, scenes,
      pendingScenes: pending,
      estimatedCostUsd: Number(estimateSceneCostUsd(pending).toFixed(2)),
      note: "Sửa cảnh bằng video_scene_set trước khi dựng. Dựng hình tốn tiền — để người dùng tự bấm.",
    };
  }

  if (name === "video_scene_set") {
    if (!UUID_RE.test(args.scene_id || "")) throw new Error("scene_id không hợp lệ");
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (typeof args.narration === "string") patch.narration = args.narration.trim() || null;
    if (typeof args.visual_prompt === "string") {
      patch.visualPrompt = args.visual_prompt.trim() || null;
      // Đổi mô tả hình thì clip cũ không còn đúng nữa.
      patch.clipKey = null; patch.status = "pending";
    }
    const d = Number(args.duration_sec);
    if (Number.isFinite(d) && d >= 3 && d <= 10) patch.durationSec = Math.round(d);
    if (Object.keys(patch).length === 1) throw new Error("Chưa có gì để sửa");

    const [row] = await db.update(videoScenes).set(patch).where(eq(videoScenes.id, args.scene_id)).returning();
    if (!row) throw new Error("Không tìm thấy cảnh");
    return { ...row, note: patch.visualPrompt !== undefined ? "Đã đổi mô tả hình nên cảnh này cần dựng lại." : undefined };
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
<title>Outlier — MCP cho Claude</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6}
code{background:#eef2ff;padding:2px 6px;border-radius:6px;font-size:13px}h1{color:#4f46e5;margin-bottom:4px}
.lead{color:#64748b;margin-top:0}.box{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin:16px 0}
li{margin:6px 0}</style></head><body>
<h1>Outlier</h1>
<p class="lead">Tìm nội dung đang bật lên → học cách nó được dựng → viết lại cho thương hiệu của bạn.</p>
<div class="box"><b>Nối vào Claude Chat</b><ol>
<li>Settings → Connectors → Add custom connector</li>
<li>Server URL: <code>${esc(url)}</code></li>
<li>Đăng nhập bằng tài khoản Outlier (OAuth) để cấp quyền cho Claude</li>
</ol></div>
<div class="box"><b>Nối vào Claude Code</b>
<p style="margin:8px 0 0"><code>claude mcp add --transport http outlier ${esc(url)}</code></p></div>
<div class="box"><b>Thử ngay sau khi nối</b><ul>
<li>“Hồ sơ trang của tôi đang có gì, thiếu gì?”</li>
<li>“Drama X đang nóng, viết cho tôi 3 phương án bài đăng đúng giọng trang.”</li>
<li>“Kênh tôi đang theo dõi có bài nào vượt trội so với chính nó không?”</li>
</ul></div>
<p style="color:#94a3b8;font-size:13px">Claude tự đọc hướng dẫn sử dụng khi kết nối — không cần cài thêm skill nào.</p>
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
