// Drizzle schema — fanpage-content-create. Tables per docs/PRD.md §6.
// Pipeline: THU (signals) → LỌC (rubric_versions + signals.score_json) →
// DỊCH (scripts) → VẼ (posts.image_variants/overlay_json) → DUYỆT (posts
// status/checklist_json) → ĐĂNG (posts.fb_post_url, thủ công trong iMVP).
import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";

// ===== users — username/password (HMAC token) HOẶC đăng nhập Google (SSO) =====
// authProvider: "local" (username+password) | "google" (Google SSO, không mật khẩu).
// Google user: username = email, passwordHash = null. isActive=false = chờ admin duyệt.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash"), // scrypt "salt:hash" hex — null với user Google
  role: text("role").notNull().default("member"), // "admin" | "member"
  isActive: boolean("is_active").notNull().default(true),
  authProvider: text("auth_provider").notNull().default("local"), // "local" | "google"
  email: text("email").unique(), // email Google (duy nhất)
  googleSub: text("google_sub"), // Google user id ("sub")
  avatarUrl: text("avatar_url"), // ảnh đại diện Google
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ===== signals — bước THU + trạng thái LỌC =====
// source: "market_radar" | "group_insights" | "manual" | "claude_research"
//   ("claude_research" = tin do Claude tự web-search thêm qua MCP server).
// radar: tên radar cụ thể (vd "marketing-kd", "ke-toan") hoặc tên cluster group.
// truc: "ai" | "ke_toan" | "hosting" | null (chưa gán trục).
// status: "new" | "scored" | "queued" | "idea_bank" | "rejected"
// scoreJson: { do_nong, do_cham, do_hop_truc, tuoi_tho, do_an_toan, total,
//              dinh_nhom_cam, reasoning, scored_by, scored_at, rubric_version_id }
//   (reasoning = lý do Claude chấm điểm — chỉ có khi chấm qua MCP).
// clusterId/clusterLabel: gom tin trùng/liên quan thành 1 cụm (Claude dedup qua MCP).
// suggestionJson: góc hài Claude gợi ý { scene, characters[], dialogue[], note }.
// Dữ liệu gốc kèm theo một tín hiệu, tuỳ nguồn mà có gì.
export interface SignalSourceMeta {
  /** Google Trends: lượng tìm kiếm ước lượng, dạng chữ ("1000+"). */
  approxTraffic?: string;
  /** Tin báo chí đi kèm — chỗ biết chuyện gì đang thật sự xảy ra. */
  news?: { title: string; url: string; source?: string }[];
  pictureUrl?: string;
  /** Mã quốc gia của bảng xếp hạng, vd "VN". */
  geo?: string;
}

export const signals = pgTable("signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  radar: text("radar"),
  truc: text("truc"),
  title: text("title").notNull(),
  rawSummary: text("raw_summary").notNull(),
  sourceUrl: text("source_url"),
  publishedDate: timestamp("published_date", { withTimezone: true }).notNull().defaultNow(),
  scoreJson: jsonb("score_json").$type<Record<string, any>>().default({}),
  status: text("status").notNull().default("new"),
  clusterId: uuid("cluster_id"), // cụm dedup (Claude gom qua MCP)
  clusterLabel: text("cluster_label"), // nhãn cụm hiển thị
  suggestionJson: jsonb("suggestion_json").$type<Record<string, any>>().default({}), // góc hài gợi ý
  /**
   * Dữ liệu gốc của nguồn, giữ nguyên cấu trúc.
   *
   * Nhồi mọi thứ vào rawSummary thì hiển thị ra một khối chữ dày đặc, đọc không
   * nổi. Giữ riêng ở đây để giao diện dựng được đúng thứ nó cần: lượng tìm
   * kiếm là một con số, mỗi tin là một dòng bấm được.
   */
  sourceMetaJson: jsonb("source_meta_json").$type<SignalSourceMeta | null>(),
  createdBy: text("created_by"), // username, chỉ set khi source="manual"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("signals_status_idx").on(t.status),
  publishedIdx: index("signals_published_idx").on(t.publishedDate),
  clusterIdx: index("signals_cluster_idx").on(t.clusterId),
}));

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;

// ===== rubric_versions — FR2.4: rubric có version, ghi lịch sử thay đổi =====
// weightsJson: { do_nong, do_cham, do_hop_truc, tuoi_tho, do_an_toan } (mặc định 1 mỗi tiêu chí)
// thresholdsJson: { queue_min: 16, idea_bank_min: 12 }
export const rubricVersions = pgTable("rubric_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  weightsJson: jsonb("weights_json").$type<Record<string, number>>().notNull(),
  thresholdsJson: jsonb("thresholds_json").$type<Record<string, number>>().notNull(),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
});

export type RubricVersion = typeof rubricVersions.$inferSelect;
export type NewRubricVersion = typeof rubricVersions.$inferInsert;

// ===== scripts — bước DỊCH: 3 phương án kịch bản / tín hiệu =====
// contentJson: 3 phương án [{ formatMeme, panels: [{label}], caption, ctaSoft }]
// signalId nullable: kịch bản tự viết (freeform, source="freeform") không gắn
// với tín hiệu có sẵn. source: "signal" (từ tín hiệu) | "freeform" (tự mô tả).
export const scripts = pgTable("scripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  signalId: uuid("signal_id").references(() => signals.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("signal"), // "signal" | "freeform"
  title: text("title"), // nhãn kịch bản tự viết (freeform)
  truc: text("truc").notNull(),
  formatMeme: text("format_meme").notNull(), // format ưu tiên lúc generate (F1-F7)
  contentJson: jsonb("content_json").$type<Record<string, any>[]>().notNull().default([]),
  selectedVariant: integer("selected_variant"), // index 0-2, null = chưa chọn
  isDemo: boolean("is_demo").notNull().default(false), // true nếu sinh bằng fallback (thiếu GEMINI_API_KEY)
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  signalIdx: index("scripts_signal_idx").on(t.signalId),
}));

export type ScriptRow = typeof scripts.$inferSelect;
export type NewScriptRow = typeof scripts.$inferInsert;

// ===== characters — dàn nhân vật cố định (mục 2.4 v3.md), reference text =====
// CRUD đầy đủ từ Step "menu Nhân vật" (xem CLAUDE.md) — vẫn seed sẵn dàn nhân
// vật cố định (server/db/seed.ts) nhưng nay cho phép thêm/sửa/xoá qua UI.
export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // Gàn, Gèn, Chị Bão, Sếp, GPT, Gemini, Grok, Claude, Copilot
  kind: text("kind").notNull().default("nguoi"), // "nguoi" | "ai" | "linh_vat"
  promptDescription: text("prompt_description").notNull(), // dán nguyên vào tool tạo ảnh (mục 2.4)
  personality: text("personality"), // tính cách / vai kể chuyện, dùng khi build prompt DỊCH
  catchphrase: text("catchphrase"),
  referenceImageUrl: text("reference_image_url"), // "/api/files/characters/<uuid>.png" (storage nội bộ) hoặc URL ngoài
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CharacterRow = typeof characters.$inferSelect;
export type NewCharacterRow = typeof characters.$inferInsert;

// ===== posts — bước VẼ (variants/overlay) + DUYỆT (kanban/checklist) + ĐĂNG =====
// status: "draft" (đang VẼ, chưa vào kanban) | "cho_duyet" | "sua_thoai" | "rot"
//         | "san_sang_dang" | "da_dang"
// imageVariants: [{ url, source: "social" | "placeholder" }] (2 biến thể không chữ)
// overlayJson: { textBoxes: [{x,y,width,fontSize,text,color,align}], watermark: {brand, opacity} }
// checklistJson: { [itemKey]: boolean } — 14 mục (mục 5 spec)
// scriptId nullable: bài từ Studio Vẽ tự do (freeform) sinh ảnh trực tiếp,
// không đi qua kịch bản. owner/isShared: quyền sở hữu ảnh cho thư viện (mặc
// định isShared=true cho pipeline team-shared; Studio có thể đặt riêng tư).
// truc/promptText: freeform lưu trực tiếp trục + mô tả (pipeline lấy từ script).
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  scriptId: uuid("script_id").references(() => scripts.id, { onDelete: "cascade" }),
  origin: text("origin").notNull().default("pipeline"), // "pipeline" | "studio"
  owner: text("owner"), // username người tạo
  isShared: boolean("is_shared").notNull().default(true), // hiện trong thư viện chung của team
  truc: text("truc"), // trục (studio freeform set trực tiếp; pipeline null → lấy từ script)
  promptText: text("prompt_text"), // mô tả tự do (studio freeform)
  imageVariants: jsonb("image_variants").$type<Record<string, any>[]>().default([]),
  selectedImageUrl: text("selected_image_url"),
  overlayJson: jsonb("overlay_json").$type<Record<string, any>>().default({}),
  finalImageUrl: text("final_image_url"),
  caption: text("caption"),
  status: text("status").notNull().default("draft"),
  checklistJson: jsonb("checklist_json").$type<Record<string, boolean>>().default({}),
  rejectReason: text("reject_reason"),
  fbPostUrl: text("fb_post_url"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
}, (t) => ({
  statusIdx: index("posts_status_idx").on(t.status),
  scriptIdx: index("posts_script_idx").on(t.scriptId),
  ownerIdx: index("posts_owner_idx").on(t.owner),
}));

export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;

// ===== assets — kho template meme + ảnh tham chiếu (shared/riêng) =====
// kind: "meme_template" (upload meme mẫu + note diễn giải lại theo meme) |
//       "reference" (ảnh tham chiếu chung: style/prop/bối cảnh).
// Dùng trong Studio Vẽ để kết hợp tham chiếu + nhân vật + chủ đề → ảnh cuối.
export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(), // username người tạo
  isShared: boolean("is_shared").notNull().default(false), // false = chỉ mình tôi
  kind: text("kind").notNull().default("reference"), // "meme_template" | "reference"
  name: text("name").notNull(),
  imageUrl: text("image_url"), // "/api/files/assets/<key>" (storage nội bộ)
  note: text("note"), // ghi chú diễn giải (meme template) / mô tả tham chiếu
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("assets_owner_idx").on(t.owner),
  kindIdx: index("assets_kind_idx").on(t.kind),
}));

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;

// ===== styles — phong cách vẽ dạng ẢNH THAM CHIẾU + mô tả JSON =====
// Mỗi phong cách = 1 ảnh minh hoạ (referenceImageUrl) + styleJson (descriptor
// cấu trúc do Gemini phân tích ảnh sinh ra, hoặc do người dùng nhập). Khi tạo
// nội dung, ảnh phong cách + styleJson được đính vào prompt để Gemini vẽ ĐỒNG
// BỘ phong cách. isDefault: phong cách hệ thống seed sẵn.
export const styles = pgTable("styles", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  isShared: boolean("is_shared").notNull().default(true), // phong cách thường dùng chung
  isDefault: boolean("is_default").notNull().default(false), // seed sẵn
  name: text("name").notNull(),
  styleJson: jsonb("style_json").$type<Record<string, any>>().default({}), // descriptor phong cách
  referenceImageUrl: text("reference_image_url"), // "/api/files/styles/<key>" (ảnh minh hoạ)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("styles_owner_idx").on(t.owner),
}));

export type StyleRow = typeof styles.$inferSelect;
export type NewStyleRow = typeof styles.$inferInsert;

// ===== files — lưu file ảnh TRONG Postgres (bền qua redeploy) =====
// Trước đây lưu filesystem /data/uploads → mất sạch mỗi lần Coolify build lại
// container (không có volume bền). Postgres là service riêng có volume bền nên
// lưu ở đây đảm bảo KHÔNG mất dữ liệu. Bytes lưu base64 trong cột text (quy mô
// nội bộ nhỏ — vài MB, chấp nhận được). Truy cập qua lớp storage (PgDriver).
export const files = pgTable("files", {
  key: text("key").primaryKey(), // vd "characters/<uuid>.png"
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  dataBase64: text("data_base64").notNull(),
  size: integer("size").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FileRow = typeof files.$inferSelect;
export type NewFileRow = typeof files.$inferInsert;

// ===== rag_examples — kho "ảnh đã thích" cho RAG =====
// Khi người dùng ❤️ 1 ảnh → lưu prompt + thông số + mô tả cảnh + embedding để
// các lần tạo sau (bật RAG) truy hồi ví dụ giống nhất làm gợi ý. owner/isShared:
// riêng mình / chia sẻ team (giống asset). Không FK tới posts (giữ được ví dụ
// kể cả khi ảnh gốc bị xoá). embedding: vector Gemini (mảng float) để tính gần.
export const ragExamples = pgTable("rag_examples", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  isShared: boolean("is_shared").notNull().default(false),
  postId: uuid("post_id"), // tham chiếu informational (không cascade)
  scene: text("scene"), // mô tả cảnh / promptText
  promptJson: text("prompt_json"), // prompt đầy đủ đã gửi Gemini
  paramsJson: jsonb("params_json").$type<Record<string, any>>().default({}), // style/nhân vật/bố cục/nền/thoại
  imageUrl: text("image_url"), // ảnh đã thích (để xem trong Thư viện RAG)
  embedding: jsonb("embedding").$type<number[]>(), // vector để truy hồi
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("rag_examples_owner_idx").on(t.owner),
  postIdx: index("rag_examples_post_idx").on(t.postId),
}));

export type RagExampleRow = typeof ragExamples.$inferSelect;
export type NewRagExampleRow = typeof ragExamples.$inferInsert;

// ===== rag_profiles — "hồ sơ sở thích" chưng cất từ ảnh đã thích (mỗi owner 1) =====
export const ragProfiles = pgTable("rag_profiles", {
  owner: text("owner").primaryKey(),
  profileText: text("profile_text"), // mô tả gu (phong cách/nền/bố cục hay chọn...) tiếng Việt
  exampleCount: integer("example_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RagProfileRow = typeof ragProfiles.$inferSelect;
export type NewRagProfileRow = typeof ragProfiles.$inferInsert;

// ===== brand_sources — tài liệu đã nạp để bóc brand profile =====
// Mỗi nguồn giữ nguyên văn bản đã trích (extractedText) để mọi evidence sau này
// đều trỏ ngược lại được về đúng vị trí trong tài liệu gốc. Không giữ text thì
// không kiểm chứng được câu trích → vi phạm nguyên tắc P1 (docs/PRD.md §2).
export const brandSources = pgTable("brand_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").notNull(),
  kind: text("kind").notNull(), // "website" | "fanpage" | "pdf" | "text"
  sourceUrl: text("source_url"), // URL gốc (null nếu upload PDF)
  title: text("title"),
  extractedText: text("extracted_text").notNull().default(""), // văn bản thuần đã trích
  charCount: integer("char_count").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | fetching | ready | error
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  brandIdx: index("brand_sources_brand_idx").on(t.brandId),
}));

export type BrandSourceRow = typeof brandSources.$inferSelect;
export type NewBrandSourceRow = typeof brandSources.$inferInsert;

// ===== brands — hồ sơ brand, MỖI FIELD KÈM TRÍCH DẪN NGUỒN =====
// Nguyên tắc P1 (docs/PRD.md §2): không có evidence thì KHÔNG ghi field. Vì vậy
// mỗi field không lưu chuỗi trần mà lưu `BrandField` = { value, evidence[] }.
// Kiểu dữ liệu ép điều đó ngay ở tầng schema, không để phụ thuộc vào lời dặn
// trong prompt — model sẽ bịa khi bí, schema thì không.
export interface BrandEvidence {
  quote: string;       // câu nguyên văn trong tài liệu
  sourceId: string;    // brand_sources.id
  sourceUrl?: string;  // tiện hiển thị, không phải nguồn sự thật
  offset: number;      // vị trí ký tự trong extractedText
}

export interface BrandField<T = string> {
  value: T;
  evidence: BrandEvidence[]; // rỗng = field không hợp lệ, không được ghi
  source: "extracted" | "manual"; // manual = người dùng tự nhập, miễn evidence
  note?: string;
}

// Một ngữ vực = một cách nói gắn với một tình huống cụ thể. Tách riêng thay vì
// nhét hết vào toneOfVoice, vì phần lớn trang có đúng hai giọng (nói với khách
// / nói với khán giả) và model cần biết dùng giọng nào lúc nào.
export interface BrandRegister {
  name: string;       // vd "ngọt với khách"
  when: string;       // dùng khi nào — vd "trong ảnh chat với khách"
  pronouns?: string;  // xưng hô — vd "em – anh"
  example?: string;   // một câu mẫu
}

export interface BrandBehaviorRules {
  always: string[];
  never: string[];
}

export interface BrandVisualIdentity {
  template?: string;    // khuôn ảnh cứng, vd "ảnh chat trên nền thanh địa chỉ"
  palette?: string[];   // màu chủ đạo
  mustHave?: string[];  // thứ luôn phải có trong ảnh
  doNots?: string[];    // thứ không bao giờ xuất hiện
}

export interface BrandExample {
  kind: "caption" | "comment" | "inbox" | "post" | "script";
  text: string;
  register?: string;  // khớp BrandRegister.name
  note?: string;      // vì sao mẫu này đúng giọng
}

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  isShared: boolean("is_shared").notNull().default(true),
  name: text("name").notNull(),

  // 5 nhóm thông tin theo docs/PRD.md §4 J1. Null = "chưa có dữ liệu" — cố ý
  // để trống thay vì bịa cho đủ.
  sells: jsonb("sells").$type<BrandField<string[]> | null>(),              // bán gì
  audience: jsonb("audience").$type<BrandField<string> | null>(),          // khách là ai
  toneOfVoice: jsonb("tone_of_voice").$type<BrandField<string> | null>(),  // cách nói chuyện
  addressing: jsonb("addressing").$type<BrandField<string> | null>(),      // xưng hô
  bannedTerms: jsonb("banned_terms").$type<BrandField<string[]> | null>(), // từ không nên dùng

  // Công dụng sản phẩm được phép nói — dùng cho guardrail P3 (chống chế công dụng).
  allowedClaims: jsonb("allowed_claims").$type<BrandField<string[]> | null>(),

  // --- Tính cách thương hiệu ---
  // Khác "giọng điệu": giọng điệu là CÁCH NÓI, tính cách là CON NGƯỜI đứng sau.
  // Cùng một giọng thân thiện, nhưng "người anh đi trước chỉ đường" khác hẳn
  // "đứa bạn hay đùa" — và đó là thứ quyết định trend nào hợp để đu.
  personality: jsonb("personality").$type<BrandField<string[]> | null>(),
  /** Các mảng nội dung thương hiệu theo đuổi — dùng để lọc trend nào đáng đu. */
  contentPillars: jsonb("content_pillars").$type<BrandField<string[]> | null>(),
  /** Nên làm gì / tránh làm gì khi bắt trend. */
  trendDos: jsonb("trend_dos").$type<BrandField<string[]> | null>(),
  trendDonts: jsonb("trend_donts").$type<BrandField<string[]> | null>(),

  // --- Nhân vật của trang (chi tiết hơn tính cách) ---
  // Những thứ dưới đây trả lời câu "trang này là ai, làm gì, không làm gì" —
  // đủ cụ thể để một model lạ viết đúng giọng ngay lần đầu mà không phải đoán.

  /** Trang tồn tại để làm gì, trong một câu. Ví dụ: "sân sau của Mắt Bão, bán
   *  tên miền bằng trò đố đọc lệch". Đây là thứ đầu tiên MCP đọc. */
  pageRole: jsonb("page_role").$type<BrandField<string> | null>(),

  /** Ngữ vực: cùng một tính cách nhưng đổi cách nói theo tình huống. Giữ có
   *  biên — mỗi ngữ vực nói rõ dùng KHI NÀO và xưng hô ra sao. */
  registers: jsonb("registers").$type<BrandField<BrandRegister[]> | null>(),

  /** Luôn làm / không bao giờ làm. Tách khỏi bannedTerms vì đây là HÀNH VI,
   *  không phải từ cấm: "không tự nói ra tầng nghĩa bậy" không chặn được bằng
   *  danh sách từ. */
  behaviorRules: jsonb("behavior_rules").$type<BrandField<BrandBehaviorRules> | null>(),

  /** Câu cửa miệng — thứ khiến người đọc nhận ra ngay là trang nào. */
  catchphrases: jsonb("catchphrases").$type<BrandField<string[]> | null>(),

  /** Nhận diện hình ảnh: khuôn ảnh cứng, màu, và những gì không được xuất hiện.
   *  Dùng khi sinh ảnh — thiếu phần này thì ảnh ra "đúng nội dung, sai trang". */
  visualIdentity: jsonb("visual_identity").$type<BrandField<BrandVisualIdentity> | null>(),

  /** Bài mẫu đã được chủ trang duyệt là "đúng giọng". Vài ví dụ thật có sức
   *  nặng hơn nhiều dòng mô tả tính cách. */
  fewShotExamples: jsonb("few_shot_examples").$type<BrandField<BrandExample[]> | null>(),

  ingestStatus: text("ingest_status").notNull().default("empty"), // empty | running | ready | error
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("brands_owner_idx").on(t.owner),
}));

export type BrandRow = typeof brands.$inferSelect;
export type NewBrandRow = typeof brands.$inferInsert;

// ===== radar_jobs — một phiên quét ngách =====
export const radarJobs = pgTable("radar_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  brandId: uuid("brand_id"), // quét cho brand nào (tuỳ chọn)
  watchedChannelId: uuid("watched_channel_id"), // phiên này là lần làm mới của kênh nào
  query: text("query").notNull(), // từ khoá ngách HOẶC link đối thủ
  queryKind: text("query_kind").notNull().default("keyword"), // keyword | competitor
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]), // douyin|tiktok|youtube|instagram
  status: text("status").notNull().default("pending"), // pending|scanning|enriching|ready|error
  scannedCount: integer("scanned_count").notNull().default(0),
  enrichedCount: integer("enriched_count").notNull().default(0), // số item đã tốn tiền Apify
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("radar_jobs_owner_idx").on(t.owner),
}));

export type RadarJobRow = typeof radarJobs.$inferSelect;

// ===== channel_baselines — mốc so sánh của TỪNG kênh =====
// Đây là bảng làm cho ranking "outperform" có nghĩa: một bài chỉ được coi là bật
// lên khi nó vượt xa mức BÌNH THƯỜNG CỦA CHÍNH KÊNH ĐÓ, không phải vượt kênh khác.
// Dùng median (không dùng trung bình) để 1 bài viral cũ không kéo lệch mốc.
export const channelBaselines = pgTable("channel_baselines", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull(),
  channelKey: text("channel_key").notNull(), // id kênh trên nền tảng đó
  channelName: text("channel_name"),
  followerCount: integer("follower_count"),
  medianViews: integer("median_views"),
  medianLikes: integer("median_likes"),
  sampleSize: integer("sample_size").notNull().default(0), // số bài dùng để tính mốc
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chanIdx: index("channel_baselines_chan_idx").on(t.platform, t.channelKey),
}));

export type ChannelBaselineRow = typeof channelBaselines.$inferSelect;

// ===== radar_items — bài tìm được =====
// `metricsSource` ghi rõ số liệu lấy từ đâu: "scan" (miễn phí, thiếu/không chuẩn)
// hay "apify" (tốn tiền, đầy đủ). Quan trọng cho việc kiểm soát chi phí VÀ cho
// người dùng biết điểm số đáng tin tới đâu.
export const radarItems = pgTable("radar_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  platform: text("platform").notNull(),
  itemKey: text("item_key").notNull(), // id bài trên nền tảng
  url: text("url").notNull(),
  title: text("title"),
  coverUrl: text("cover_url"),
  durationSec: integer("duration_sec"),
  publishedAt: timestamp("published_at", { withTimezone: true }),

  channelKey: text("channel_key"),
  channelName: text("channel_name"),
  followerCount: integer("follower_count"),

  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),

  /**
   * Loại nội dung — quyết định chỉ số nào có nghĩa và phân tích bằng cách nào.
   *   video → có lượt xem, thời lượng; phân tích được bằng khung hình
   *   post  → bài chữ/ảnh, KHÔNG có lượt xem; chỉ phân tích được phần chữ
   * Suy ra từ dữ liệu quét (có thời lượng → video), không bắt người dùng chọn.
   */
  contentKind: text("content_kind").notNull().default("unknown"), // video | post | image | unknown
  metricsSource: text("metrics_source").notNull().default("scan"), // scan | apify
  /** true = bài chưa từng thấy ở các lần quét trước của cùng kênh theo dõi. */
  isNew: boolean("is_new").notNull().default(false),
  outperformScore: integer("outperform_score"), // nhân 1000 để lưu số nguyên
  confidence: text("confidence").notNull().default("low"), // low | medium | high
  scoreBreakdown: jsonb("score_breakdown").$type<Record<string, any>>(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  jobIdx: index("radar_items_job_idx").on(t.jobId),
  scoreIdx: index("radar_items_score_idx").on(t.outperformScore),
}));

export type RadarItemRow = typeof radarItems.$inferSelect;

// ===== apify_cache — tránh gọi lại Apify cho cùng một thứ =====
// Apify tính tiền theo lượt chạy nên mọi kết quả đều được giữ lại; trong hạn
// APIFY_CACHE_DAYS thì đọc lại từ đây thay vì gọi mới.
export const apifyCache = pgTable("apify_cache", {
  cacheKey: text("cache_key").primaryKey(), // platform + loại + id
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

// ===== apify_usage — nhật ký chi tiêu, để cưỡng chế ngân sách =====
export const apifyUsage = pgTable("apify_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  day: text("day").notNull(), // YYYY-MM-DD
  actorId: text("actor_id").notNull(),
  itemCount: integer("item_count").notNull().default(0),
  note: text("note"),

  /**
   * Tiền của lượt chạy này, tính theo số kết quả THỰC NHẬN.
   *
   * Lưu dạng chuỗi để khỏi mất chính xác: số tiền ở đây nhỏ (hàng phần nghìn
   * đô), cộng dồn kiểu số thực sẽ lệch dần.
   */
  costUsd: text("cost_usd"),
  /** Loại việc: enrich | post | comments | channel — để biết tiền đi vào đâu. */
  kind: text("kind"),
  /** Ai gây ra khoản này. */
  owner: text("owner"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dayIdx: index("apify_usage_day_idx").on(t.day),
}));

// ===== deconstructions — cấu trúc bóc ra từ một bài =====
// Trả lời câu hỏi "vì sao bài này giữ được người xem": 3 giây đầu làm gì, mở vấn
// đề kiểu nào, giữ chân bằng gì, twist ở đâu, chốt ra sao (docs/PRD.md §4 J3).
//
// Mỗi mốc đều có `atSec` để người dùng tua thẳng tới chỗ đó mà kiểm chứng — nếu
// AI mô tả một đoạn không tồn tại thì mở ra là biết ngay.
export interface RetentionBeat {
  atSec: number;
  what: string;      // đang diễn ra cái gì
  whyItWorks: string; // vì sao giữ được người xem
}

export interface DeconstructedStructure {
  hook3s?: { atSec: number; what: string; technique: string } | null;
  problemOpen?: { atSec: number; what: string; how: string } | null;
  retentionBeats?: RetentionBeat[];
  twist?: { atSec: number; what: string } | null;
  cta?: { atSec: number; what: string; style: string } | null;
  /** Công thức rút gọn để đem đi remake — mô tả CÁCH TRIỂN KHAI, không phải nội dung. */
  formula?: string | null;
  /** Vì sao bài này hợp/không hợp để học theo. */
  notes?: string | null;
}

/**
 * Người xem thật sự quan tâm gì — rút từ phần bình luận.
 *
 * Vì sao đáng làm riêng: bài nói một đằng, người đọc bàn một nẻo là chuyện rất
 * thường. Bóc cấu trúc cho biết bài được dựng thế nào, còn phần này cho biết
 * nó CHẠM vào đâu. Remake theo mối quan tâm của người đọc trúng hơn nhiều so
 * với remake theo nội dung gốc.
 */
export interface AudienceInsight {
  /** Số bình luận đã đọc — người dùng cần biết kết luận dựa trên bao nhiêu. */
  sampleSize: number;
  /** Các cụm chủ đề người ta bàn, xếp theo mức được nhắc nhiều. */
  themes: {
    label: string;
    /** Bao nhiêu bình luận thuộc cụm này. Do CODE đếm, không lấy số model tự khai. */
    count: number;
    /** Vài câu nguyên văn làm bằng chứng. */
    quotes: string[];
    sentiment?: "tích cực" | "tiêu cực" | "trung tính" | "lẫn lộn";
  }[];
  /** Câu hỏi lặp đi lặp lại — mỏ vàng cho bài tiếp theo. */
  questions: string[];
  /** Điều người đọc phản đối hoặc nghi ngờ. */
  objections: string[];
  /** Góc remake gợi ý, bám đúng thứ người đọc quan tâm. */
  remakeAngles: string[];
  /** Nói rõ khi mẫu quá nhỏ hoặc bình luận không có gì để rút. */
  warning?: string;
}

export const deconstructions = pgTable("deconstructions", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  radarItemId: uuid("radar_item_id"), // đến từ Radar (nếu có)
  sourceUrl: text("source_url").notNull(),
  platform: text("platform"),
  title: text("title"),
  durationSec: integer("duration_sec"),

  status: text("status").notNull().default("pending"), // pending|downloading|analyzing|ready|error
  errorMessage: text("error_message"),
  /**
   * true = nội dung này chỉ lấy được bằng dịch vụ có phí. Để giao diện biết mà
   * hiện nút xác nhận, thay vì bắt nó dò chuỗi trong errorMessage.
   */
  needsPaid: boolean("needs_paid").notNull().default(false),
  estimatedCostUsd: text("estimated_cost_usd"),

  /** Loại nội dung — quyết định phân tích bằng cách nào và chỉ số nào có nghĩa. */
  contentKind: text("content_kind").notNull().default("unknown"), // video | post | image | unknown
  thumbnailUrl: text("thumbnail_url"),
  /** Chỉ số của bài gốc — người duyệt cần thấy bài này thật sự có chạy không. */
  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  followerCount: integer("follower_count"),
  channelName: text("channel_name"),
  /** Nội dung chữ của bài (bài viết Facebook thì đây là toàn bộ nội dung). */
  bodyText: text("body_text"),

  transcript: text("transcript"),                       // lời thoại (nếu lấy được)
  structure: jsonb("structure").$type<DeconstructedStructure | null>(),

  /** Bình luận đã lấy về, giữ nguyên văn để đối chiếu với kết luận. */
  commentsJson: jsonb("comments_json").$type<{ text: string; likes?: number; author?: string }[] | null>(),
  /** Người xem quan tâm gì — rút từ commentsJson. */
  audienceInsight: jsonb("audience_insight").$type<AudienceInsight | null>(),
  /** Lần lấy bình luận gần nhất, để biết dữ liệu còn mới không. */
  commentsFetchedAt: timestamp("comments_fetched_at", { withTimezone: true }),
  analyzedBy: text("analyzed_by"),                      // model đã dùng
  /** "video" = xem được hình; "transcript" = chỉ đọc lời thoại (kém chính xác hơn). */
  analysisMode: text("analysis_mode"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("deconstructions_owner_idx").on(t.owner),
  itemIdx: index("deconstructions_item_idx").on(t.radarItemId),
}));

export type DeconstructionRow = typeof deconstructions.$inferSelect;

// ===== remakes — bản viết lại cho brand =====
// Giữ CÁCH TRIỂN KHAI của bài gốc, thay ruột bằng sản phẩm/khách hàng/thông tin
// của brand mình (docs/PRD.md §4 J4). Mỗi bản đều kèm guardrailJson — kết quả
// kiểm tra 4 nguyên tắc; có lỗi mức chặn thì không cho xuất.
// Một phương án ảnh cho bản viết. Giữ luôn prompt đã dùng: vẽ lại lần sau cần
// biết lần trước đã tả thế nào, và người dùng hay muốn sửa một chi tiết nhỏ.
export interface RemakeImage {
  url: string;        // "/api/files/<key>" — dùng thẳng được trong thẻ img
  prompt: string;
  aspectRatio: string;
  createdAt: string;
  /** true = vẽ hỏng, trả về ảnh chỗ trống thay vì ảnh thật. */
  isDemo?: boolean;
}

/** Một lần đăng bài lên trang. */
export interface PublishedRecord {
  fanpageId: string;
  pageName?: string;
  postId: string;
  permalink: string;
  publishedAt: string;
  /** true = hẹn giờ, Facebook giữ lại đăng sau. */
  scheduled?: boolean;
  scheduledFor?: string;
}

export const remakes = pgTable("remakes", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  brandId: uuid("brand_id").notNull(),
  deconstructionId: uuid("deconstruction_id"), // học từ bản bóc cấu trúc nào
  format: text("format").notNull().default("video_script"), // video_script | post

  status: text("status").notNull().default("pending"), // pending|writing|ready|error
  errorMessage: text("error_message"),

  draft: text("draft"),                                  // bản viết hiện tại
  guardrailJson: jsonb("guardrail_json").$type<Record<string, any> | null>(),
  /** Lịch sử sửa: mỗi lần yêu cầu chỉnh lưu lại để đối chiếu. */
  revisionsJson: jsonb("revisions_json").$type<{ at: string; note: string; draft: string }[]>().default([]),

  // Luôn giữ đường dẫn về bài gốc: người duyệt cần biết bản này học từ đâu.
  sourceUrl: text("source_url"),
  sourceTitle: text("source_title"),

  /**
   * Ảnh đã vẽ cho bản viết này. Giữ nhiều phương án chứ không một ảnh: lần vẽ
   * đầu hiếm khi trúng, và người dùng cần so sánh rồi chọn.
   */
  imagesJson: jsonb("images_json").$type<RemakeImage[]>().default([]),
  /** URL ảnh đang chọn trong imagesJson. */
  selectedImageUrl: text("selected_image_url"),

  /**
   * Bài đã đăng lên đâu. Giữ để không đăng trùng và để mở lại bài thật.
   * Mảng vì một bản viết có thể đăng lên nhiều trang.
   */
  publishedJson: jsonb("published_json").$type<PublishedRecord[]>().default([]),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("remakes_owner_idx").on(t.owner),
  brandIdx: index("remakes_brand_idx").on(t.brandId),
}));

export type RemakeRow = typeof remakes.$inferSelect;

// ===== video_projects — dựng video từ bản viết (docs/PRD.md §4 J5) =====
// Dựng video TỐN TIỀN THẬT (Veo tính theo video sinh ra), nên quy trình cố ý
// chia làm nhiều bước có điểm dừng: tách cảnh (rẻ) → duyệt cảnh → sinh hình
// (tốn tiền) → ghép. Người dùng phải xác nhận trước mỗi bước tốn tiền.
export const videoProjects = pgTable("video_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  remakeId: uuid("remake_id"),          // dựng từ bản viết nào
  title: text("title"),
  aspectRatio: text("aspect_ratio").notNull().default("9:16"),

  status: text("status").notNull().default("draft"),
  // draft | splitting | scenes_ready | generating | rendering | ready | error
  errorMessage: text("error_message"),

  scriptText: text("script_text"),       // kịch bản nguồn
  finalVideoKey: text("final_video_key"), // khoá file trong bảng `files`
  generatedCount: integer("generated_count").notNull().default(0), // số cảnh đã sinh (để tính tiền)

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("video_projects_owner_idx").on(t.owner),
}));

export type VideoProjectRow = typeof videoProjects.$inferSelect;

// ===== video_scenes — từng cảnh trong video =====
// Tách riêng để người dùng sửa được lời dẫn và mô tả hình TRƯỚC khi tốn tiền sinh.
export const videoScenes = pgTable("video_scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  orderIndex: integer("order_index").notNull().default(0),

  narration: text("narration"),      // lời dẫn / phụ đề của cảnh
  visualPrompt: text("visual_prompt"), // mô tả hình để sinh
  durationSec: integer("duration_sec").notNull().default(5),

  status: text("status").notNull().default("pending"), // pending|generating|ready|error
  errorMessage: text("error_message"),
  clipKey: text("clip_key"),         // khoá file video của cảnh trong bảng `files`

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projIdx: index("video_scenes_proj_idx").on(t.projectId, t.orderIndex),
}));

export type VideoSceneRow = typeof videoScenes.$inferSelect;

// ===== watched_channels — kênh đang theo dõi =====
// Khác một phiên quét rời: kênh ở đây được giữ lại để quét lại nhiều lần, và
// mỗi lần làm mới sẽ ĐÁNH DẤU BÀI MỚI so với lần trước — đó mới là thứ có giá
// trị hằng ngày: mở lên thấy ngay đối thủ vừa đăng gì và bài nào đang bật.
//
// Mỗi lần làm mới vẫn tạo một radar_job bên dưới để tái dùng toàn bộ phần chấm
// điểm và giao diện đã có, thay vì dựng một đường song song.
export const watchedChannels = pgTable("watched_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: text("owner").notNull(),
  platform: text("platform").notNull(),
  channelUrl: text("channel_url").notNull(),
  channelKey: text("channel_key"),          // id kênh trên nền tảng (biết sau lần quét đầu)
  channelName: text("channel_name"),
  followerCount: integer("follower_count"),
  note: text("note"),                        // ghi chú của người dùng, vd "đối thủ trực tiếp"

  isActive: boolean("is_active").notNull().default(true),
  /**
   * true = mỗi lần làm mới sẽ gọi dịch vụ có phí (Apify).
   * Bắt buộc với TikTok: yt-dlp không lấy được danh sách bài từ link @user
   * (cần channel_id nội bộ, mà id đó chỉ moi ra được từ một video cụ thể).
   * Người dùng phải chủ động bật, kèm xác nhận chi phí.
   */
  useApify: boolean("use_apify").notNull().default(false),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  /**
   * Số lần đã quét. Cần để biết đã qua lần đầu chưa — nhãn "MỚI" chỉ có nghĩa
   * từ lần thứ hai. Để backend đếm thay vì đoán ở trình duyệt: người dùng đổi
   * máy hay xoá dữ liệu trình duyệt thì con số vẫn đúng.
   */
  scanCount: integer("scan_count").notNull().default(0),
  lastJobId: uuid("last_job_id"),            // phiên quét gần nhất
  lastNewCount: integer("last_new_count").notNull().default(0),
  scanStatus: text("scan_status").notNull().default("idle"), // idle|scanning|error
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("watched_channels_owner_idx").on(t.owner),
  chanIdx: index("watched_channels_chan_idx").on(t.platform, t.channelUrl),
}));

export type WatchedChannelRow = typeof watchedChannels.$inferSelect;

// ===== channel_seen_items — nhớ bài đã thấy, để biết bài nào MỚI =====
// Chỉ lưu khoá bài, không lưu nội dung: mục đích duy nhất là so sánh giữa hai
// lần quét. Nội dung đầy đủ nằm ở radar_items.
export const channelSeenItems = pgTable("channel_seen_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull(),
  itemKey: text("item_key").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chanIdx: index("channel_seen_chan_idx").on(t.channelId, t.itemKey),
}));

// ===== brand_fanpages — trang/kênh CỦA CHÍNH thương hiệu =====
// Khác `watched_channels` (kênh đối thủ để soi): đây là nơi thương hiệu đăng bài.
// Dùng để Claude biết nội dung sẽ đăng ở đâu, định dạng nào, cho ai — từ đó gợi
// ý đu trend cho đúng chỗ thay vì gợi ý chung chung.
// Ảnh chụp số liệu của một fanpage tại lần quét gần nhất. Giữ nguyên hình dạng
// mà server/services/fanpage-stats.ts sinh ra.
export interface FanpageTopPostSnapshot {
  id: string;
  message: string;
  permalink?: string;
  thumbnailUrl?: string;
  createdTime: string;
  likes: number;
  comments: number;
  shares: number;
  mediaType: string;
  /** Gấp mấy lần bài trung vị của CHÍNH trang này. */
  outperformRatio: number;
}

export interface FanpageStatsSnapshot {
  postCount: number;
  spanDays: number;
  postsPerWeek: number;
  medianLikes: number;
  medianComments: number;
  medianShares: number;
  medianLength: number;
  formatMix: Record<string, number>;
  topHours: { hour: number; count: number }[];
  topPosts: FanpageTopPostSnapshot[];
}

export const brandFanpages = pgTable("brand_fanpages", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").notNull(),
  platform: text("platform").notNull(),      // facebook|tiktok|youtube|instagram|threads|zalo
  pageUrl: text("page_url").notNull(),
  pageName: text("page_name"),
  handle: text("handle"),                     // @tên

  followerCount: integer("follower_count"),
  /** Chủ đề trang này tập trung — có thể khác mảng nội dung chung của thương hiệu. */
  topics: jsonb("topics").$type<string[]>().default([]),
  /** Định dạng hay dùng: video ngắn, bài dài, carousel ảnh… */
  formats: jsonb("formats").$type<string[]>().default([]),
  postingCadence: text("posting_cadence"),    // vd "3 bài/tuần"
  audienceNote: text("audience_note"),        // đặc thù người theo dõi của riêng trang này
  note: text("note"),

  isPrimary: boolean("is_primary").notNull().default(false),

  // --- Kết nối Meta (chỉ với page mình quản lý) ---
  // Có token thì đọc được bài của chính page miễn phí và đầy đủ qua Graph API,
  // khỏi phải trả tiền cho Apify để đọc page của chính mình.
  metaPageId: text("meta_page_id"),
  /** Page Access Token đã mã hoá — xem server/services/meta-token.ts. */
  metaTokenEnc: text("meta_token_enc"),
  metaConnectedAt: timestamp("meta_connected_at", { withTimezone: true }),
  metaLastSyncAt: timestamp("meta_last_sync_at", { withTimezone: true }),
  /** Số bài lấy về ở lần quét gần nhất — để biết có đáng bóc lại hồ sơ không. */
  metaLastPostCount: integer("meta_last_post_count"),

  /**
   * Nhân vật gắn với trang này (characters.id).
   *
   * Nhiều trang có một nhân vật đại diện cố định. Gắn ở đây thì lúc vẽ ảnh cho
   * bản viết, ảnh tham chiếu của nhân vật được đưa vào làm mẫu — nhân vật mới
   * nhất quán qua các bài thay vì mỗi bài một kiểu.
   */
  characterIds: jsonb("character_ids").$type<string[]>().default([]),

  /** Ảnh đại diện, hạng mục, giới thiệu — lấy từ Meta, để hiện ngay trên hồ sơ. */
  metaPictureUrl: text("meta_picture_url"),
  metaCategory: text("meta_category"),
  metaAbout: text("meta_about"),
  /**
   * Số liệu rút từ lần quét gần nhất: nhịp đăng, định dạng hay dùng, mốc trung
   * vị của chính trang, và những bài ăn hơn hẳn phần còn lại.
   * Xem server/services/fanpage-stats.ts.
   */
  metaStatsJson: jsonb("meta_stats_json").$type<FanpageStatsSnapshot | null>(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  brandIdx: index("brand_fanpages_brand_idx").on(t.brandId),
}));

export type BrandFanpageRow = typeof brandFanpages.$inferSelect;
