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
