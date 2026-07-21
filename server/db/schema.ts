// Drizzle schema — fanpage-content-create. Tables per docs/PRD.md §6.
// Pipeline: THU (signals) → LỌC (rubric_versions + signals.score_json) →
// DỊCH (scripts) → VẼ (posts.image_variants/overlay_json) → DUYỆT (posts
// status/checklist_json) → ĐĂNG (posts.fb_post_url, thủ công trong iMVP).
import { pgTable, uuid, text, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

// ===== users — theo pattern marcow-crop (username/password → HMAC token) =====
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(), // scrypt: "salt:hash" hex
  role: text("role").notNull().default("member"), // "admin" | "member"
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ===== signals — bước THU + trạng thái LỌC =====
// source: "market_radar" | "group_insights" | "manual"
// radar: tên radar cụ thể (vd "marketing-kd", "ke-toan") hoặc tên cluster group.
// truc: "ai" | "ke_toan" | "hosting" | null (chưa gán trục).
// status: "new" | "scored" | "queued" | "idea_bank" | "rejected"
// scoreJson: { do_nong, do_cham, do_hop_truc, tuoi_tho, do_an_toan, total,
//              dinh_nhom_cam, scored_by, scored_at, rubric_version_id }
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
  createdBy: text("created_by"), // username, chỉ set khi source="manual"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
export const scripts = pgTable("scripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  signalId: uuid("signal_id").notNull().references(() => signals.id, { onDelete: "cascade" }),
  truc: text("truc").notNull(),
  formatMeme: text("format_meme").notNull(), // format ưu tiên lúc generate (F1-F7)
  contentJson: jsonb("content_json").$type<Record<string, any>[]>().notNull().default([]),
  selectedVariant: integer("selected_variant"), // index 0-2, null = chưa chọn
  isDemo: boolean("is_demo").notNull().default(false), // true nếu sinh bằng fallback (thiếu SOCIAL_BACKEND_URL)
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  scriptId: uuid("script_id").notNull().references(() => scripts.id, { onDelete: "cascade" }),
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
});

export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;
