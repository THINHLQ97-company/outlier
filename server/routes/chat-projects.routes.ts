// Chat Composer projects — editable conversation mockups, never real messaging.
// A project is a single versioned JSON document so the editor can autosave and
// reopen one payload without adding a table for every participant/message.
import type { Express } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, isDbConfigured } from "../db/client";
import { chatProjects, users } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { newKey, parseDataUrl, storage } from "../storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = ["messenger_like", "zalo_like", "custom"] as const;
const MESSAGE_TYPES = ["text", "emoji", "image", "system", "typing", "link_preview", "sticker", "voice"] as const;
const EXPORT_FORMATS = ["png", "jpg", "jpeg", "webp"] as const;
const MAX_TITLE_LENGTH = 200;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_PARTICIPANTS = 100;
const MAX_MESSAGES = 2000;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const DEFAULT_THEME = {
  mode: "light",
  headerColor: "#1877f2",
  backgroundColor: "#ffffff",
  incomingBubbleColor: "#e4e6eb",
  outgoingBubbleColor: "#0084ff",
  incomingTextColor: "#111827",
  outgoingTextColor: "#ffffff",
  accentColor: "#1877f2",
  borderRadius: 18,
  showAvatars: true,
  showSeen: true,
  showTimestamps: true,
};

class ChatValidationError extends Error {}

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function asTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function assertDocumentSize(value: unknown) {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new ChatValidationError("Document hội thoại không thể mã hóa JSON.");
  }
  if (encoded.length > MAX_DOCUMENT_BYTES) {
    throw new ChatValidationError("Document hội thoại quá lớn (tối đa 2 MB).");
  }
}

function normalizeDocument(input: unknown): Record<string, any> {
  const source = isObject(input) ? input : {};
  const rawParticipants = Array.isArray(source.participants) ? source.participants : [];
  if (rawParticipants.length > MAX_PARTICIPANTS) {
    throw new ChatValidationError(`Tối đa ${MAX_PARTICIPANTS} người tham gia.`);
  }

  const participants = rawParticipants.map((raw: any, index) => {
    if (!isObject(raw)) throw new ChatValidationError(`Participant ${index + 1} không hợp lệ.`);
    const name = asTrimmedString(raw.name ?? raw.displayName, 200);
    if (!name) throw new ChatValidationError(`Participant ${index + 1} cần có tên.`);
    const displayName = asTrimmedString(raw.displayName ?? raw.name, 200) || name;
    const side = raw.side === "left" || raw.side === "right" || raw.side === "auto" ? raw.side : "auto";
    return {
      id: isUuid(raw.id) ? raw.id : randomUUID(),
      characterId: isUuid(raw.characterId) ? raw.characterId : null,
      name,
      displayName,
      nickname: typeof raw.nickname === "string" ? raw.nickname.slice(0, 200) : null,
      avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl.slice(0, 2_000_000) : null,
      avatarAssetId: isUuid(raw.avatarAssetId) ? raw.avatarAssetId : null,
      role: typeof raw.role === "string" ? raw.role.slice(0, 200) : null,
      side,
      status: isObject(raw.status) ? cloneJson(raw.status) : {},
      sortOrder: Number.isInteger(raw.sortOrder) ? raw.sortOrder : index,
    };
  });

  const participantIds = new Set(participants.map((participant) => participant.id));
  const rawMessages = Array.isArray(source.messages) ? source.messages : [];
  if (rawMessages.length > MAX_MESSAGES) {
    throw new ChatValidationError(`Tối đa ${MAX_MESSAGES} tin nhắn.`);
  }
  const messages = rawMessages.map((raw: any, index) => {
    if (!isObject(raw)) throw new ChatValidationError(`Message ${index + 1} không hợp lệ.`);
    const messageType = MESSAGE_TYPES.includes(raw.messageType as any) ? raw.messageType : "text";
    const participantId = isUuid(raw.participantId) && participantIds.has(raw.participantId) ? raw.participantId : null;
    const text = typeof raw.text === "string" ? raw.text.slice(0, 20_000) : null;
    if (["text", "emoji"].includes(messageType) && !text) {
      throw new ChatValidationError(`Message ${index + 1} cần có nội dung.`);
    }
    return {
      id: isUuid(raw.id) ? raw.id : randomUUID(),
      participantId,
      messageType,
      text,
      mediaUrl: typeof raw.mediaUrl === "string" ? raw.mediaUrl.slice(0, 4_000) : null,
      metadata: isObject(raw.metadata) ? cloneJson(raw.metadata) : {},
      sentAt: typeof raw.sentAt === "string" ? raw.sentAt.slice(0, 80) : null,
      sortOrder: Number.isInteger(raw.sortOrder) ? raw.sortOrder : index,
      replyToId: isUuid(raw.replyToId) ? raw.replyToId : null,
      isPinned: raw.isPinned === true,
    };
  });

  const theme = isObject(source.theme) ? cloneJson(source.theme) : cloneJson(DEFAULT_THEME);
  const exportSettings = isObject(source.exportSettings) ? cloneJson(source.exportSettings) : {};
  const document = { participants, messages, theme, exportSettings };
  assertDocumentSize(document);
  return document;
}

async function persistAvatarDataUrls(document: Record<string, any>): Promise<{ document: Record<string, any>; createdKeys: string[] }> {
  const result = cloneJson(document);
  const createdKeys: string[] = [];
  try {
    for (const participant of result.participants || []) {
      if (typeof participant.avatarUrl !== "string" || !participant.avatarUrl.startsWith("data:")) continue;
      const parsed = parseDataUrl(participant.avatarUrl);
      if (!parsed || !["png", "jpg", "webp", "gif"].includes(parsed.ext) || parsed.buffer.length > MAX_AVATAR_BYTES) {
        throw new ChatValidationError("Avatar không hợp lệ (chỉ PNG/JPG/WebP/GIF, tối đa 5 MB).");
      }
      const key = newKey("misc", parsed.ext);
      await storage.put(key, parsed.buffer);
      createdKeys.push(key);
      participant.avatarUrl = `/api/files/${key}`;
    }
    assertDocumentSize(result);
    return { document: result, createdKeys };
  } catch (error) {
    await Promise.all(createdKeys.map((key) => storage.delete(key).catch(() => {})));
    throw error;
  }
}

function metadataJson(value: unknown): Record<string, any> {
  const metadata = isObject(value) ? cloneJson(value) : {};
  metadata.isMockup = true;
  return metadata;
}

function normalizedPlatform(value: unknown): string {
  if (typeof value === "string" && PLATFORMS.includes(value as any)) return value;
  return "messenger_like";
}

function projectResponse(row: any, me: string) {
  return { ...row, isMine: row.owner === me };
}

async function activeAdmin(username: string): Promise<boolean> {
  const [user] = await getDb()
    .select({ role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.username, username));
  return user?.role === "admin" && user.isActive === true;
}

async function canEdit(row: any, username: string): Promise<boolean> {
  return row.owner === username || (await activeAdmin(username));
}

function duplicateDocument(document: Record<string, any>): Record<string, any> {
  const out = cloneJson(document);
  const participantIds = new Map<string, string>();
  for (const participant of out.participants || []) {
    const nextId = randomUUID();
    participantIds.set(participant.id, nextId);
    participant.id = nextId;
  }
  const messageIds = new Map<string, string>();
  for (const message of out.messages || []) {
    const nextId = randomUUID();
    messageIds.set(message.id, nextId);
    message.id = nextId;
  }
  for (const message of out.messages || []) {
    if (message.participantId) message.participantId = participantIds.get(message.participantId) || null;
    if (message.replyToId) message.replyToId = messageIds.get(message.replyToId) || null;
  }
  return out;
}

function documentFromBody(body: any, fallback?: Record<string, any>): Record<string, any> {
  if (body && Object.prototype.hasOwnProperty.call(body, "document")) return normalizeDocument(body.document);
  const hasDocumentFields = body && ["participants", "messages", "theme", "exportSettings"].some((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (hasDocumentFields) {
    return normalizeDocument({
      ...(fallback || {}),
      participants: body.participants ?? fallback?.participants,
      messages: body.messages ?? fallback?.messages,
      theme: body.theme ?? fallback?.theme,
      exportSettings: body.exportSettings ?? fallback?.exportSettings,
    });
  }
  return normalizeDocument(fallback || {});
}

export function registerChatProjectRoutes(app: Express) {
  app.get("/api/chat-projects", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const scope = typeof req.query.scope === "string" ? req.query.scope : "all";
    try {
      const visibility = scope === "mine" ? eq(chatProjects.owner, me) : scope === "shared" ? eq(chatProjects.isShared, true) : or(eq(chatProjects.owner, me), eq(chatProjects.isShared, true));
      const rows = await getDb().select().from(chatProjects).where(visibility).orderBy(desc(chatProjects.updatedAt));
      res.json(rows.map((row) => projectResponse(row, me)));
    } catch (error: any) {
      console.error("list chat projects:", error?.message || error);
      res.status(500).json({ error: "Lỗi tải danh sách đoạn chat." });
    }
  });

  app.post("/api/chat-projects", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const body = req.body || {};
    const title = asTrimmedString(body.title, MAX_TITLE_LENGTH);
    if (!title) return res.status(400).json({ error: "Thiếu tên project (tối đa 200 ký tự)." });
    try {
      const document = documentFromBody(body);
      const persisted = await persistAvatarDataUrls(document);
      const [row] = await getDb().insert(chatProjects).values({
        owner: me,
        isShared: body.isShared === true,
        title,
        platform: normalizedPlatform(body.platform),
        presetVersion: asTrimmedString(body.presetVersion, 50) || "1",
        document: persisted.document,
        exportJson: isObject(body.exportJson) ? cloneJson(body.exportJson) : {},
        metadataJson: metadataJson(body.metadataJson ?? body.metadata),
      }).returning();
      res.status(201).json(projectResponse(row, me));
    } catch (error: any) {
      console.error("create chat project:", error?.message || error);
      if (error instanceof ChatValidationError) return res.status(400).json({ error: error.message });
      res.status(500).json({ error: "Lỗi lưu project đoạn chat." });
    }
  });

  app.get("/api/chat-projects/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const [row] = await getDb().select().from(chatProjects).where(and(eq(chatProjects.id, id), or(eq(chatProjects.owner, me), eq(chatProjects.isShared, true))));
      if (!row) return res.status(404).json({ error: "Không tìm thấy project đoạn chat." });
      res.json(projectResponse(row, me));
    } catch (error: any) {
      console.error("get chat project:", error?.message || error);
      res.status(500).json({ error: "Lỗi tải project đoạn chat." });
    }
  });

  app.patch("/api/chat-projects/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    let createdKeys: string[] = [];
    try {
      const db = getDb();
      const [existing] = await db.select().from(chatProjects).where(eq(chatProjects.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy project đoạn chat." });
      if (!(await canEdit(existing, me))) return res.status(403).json({ error: "Chỉ chủ sở hữu hoặc quản trị viên mới sửa được project này." });
      const body = req.body || {};
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (Object.prototype.hasOwnProperty.call(body, "title")) {
        const title = asTrimmedString(body.title, MAX_TITLE_LENGTH);
        if (!title) return res.status(400).json({ error: "Tên project không hợp lệ." });
        patch.title = title;
      }
      if (Object.prototype.hasOwnProperty.call(body, "platform")) {
        if (!PLATFORMS.includes(body.platform)) return res.status(400).json({ error: "Platform không hợp lệ." });
        patch.platform = body.platform;
      }
      if (Object.prototype.hasOwnProperty.call(body, "presetVersion")) {
        const presetVersion = asTrimmedString(body.presetVersion, 50);
        if (!presetVersion) return res.status(400).json({ error: "presetVersion không hợp lệ." });
        patch.presetVersion = presetVersion;
      }
      if (Object.prototype.hasOwnProperty.call(body, "isShared")) {
        if (typeof body.isShared !== "boolean") return res.status(400).json({ error: "isShared phải là boolean." });
        patch.isShared = body.isShared;
      }
      if (Object.prototype.hasOwnProperty.call(body, "metadataJson") || Object.prototype.hasOwnProperty.call(body, "metadata")) {
        patch.metadataJson = metadataJson(body.metadataJson ?? body.metadata);
      }
      const shouldPatchDocument = Object.prototype.hasOwnProperty.call(body, "document") || ["participants", "messages", "theme", "exportSettings"].some((key) => Object.prototype.hasOwnProperty.call(body, key));
      if (shouldPatchDocument) {
        const document = documentFromBody(body, existing.document as Record<string, any>);
        const persisted = await persistAvatarDataUrls(document);
        createdKeys = persisted.createdKeys;
        patch.document = persisted.document;
      }
      if (Object.prototype.hasOwnProperty.call(body, "exportJson")) {
        if (!isObject(body.exportJson)) return res.status(400).json({ error: "exportJson phải là object." });
        patch.exportJson = cloneJson(body.exportJson);
      }
      const [row] = await db.update(chatProjects).set(patch).where(eq(chatProjects.id, id)).returning();
      res.json(projectResponse(row, me));
    } catch (error: any) {
      await Promise.all(createdKeys.map((key) => storage.delete(key).catch(() => {})));
      console.error("update chat project:", error?.message || error);
      if (error instanceof ChatValidationError) return res.status(400).json({ error: error.message });
      res.status(500).json({ error: "Lỗi cập nhật project đoạn chat." });
    }
  });

  app.delete("/api/chat-projects/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(chatProjects).where(eq(chatProjects.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy project đoạn chat." });
      if (!(await canEdit(existing, me))) return res.status(403).json({ error: "Chỉ chủ sở hữu hoặc quản trị viên mới xoá được project này." });
      await db.delete(chatProjects).where(eq(chatProjects.id, id));
      res.json({ ok: true });
    } catch (error: any) {
      console.error("delete chat project:", error?.message || error);
      res.status(500).json({ error: "Lỗi xoá project đoạn chat." });
    }
  });

  app.post("/api/chat-projects/:id/duplicate", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const [source] = await getDb().select().from(chatProjects).where(and(eq(chatProjects.id, id), or(eq(chatProjects.owner, me), eq(chatProjects.isShared, true))));
      if (!source) return res.status(404).json({ error: "Không tìm thấy project đoạn chat." });
      const body = req.body || {};
      const requestedTitle = body.title === undefined ? `${source.title} (bản sao)` : asTrimmedString(body.title, MAX_TITLE_LENGTH);
      if (!requestedTitle) return res.status(400).json({ error: "Tên project bản sao không hợp lệ." });
      const document = duplicateDocument(normalizeDocument(source.document));
      const persisted = await persistAvatarDataUrls(document);
      const [row] = await getDb().insert(chatProjects).values({
        owner: me,
        isShared: body.isShared === true,
        title: requestedTitle,
        platform: source.platform,
        presetVersion: source.presetVersion,
        document: persisted.document,
        exportJson: {},
        metadataJson: { ...(isObject(source.metadataJson) ? cloneJson(source.metadataJson) : {}), isMockup: true, duplicatedFrom: source.id },
      }).returning();
      res.status(201).json(projectResponse(row, me));
    } catch (error: any) {
      console.error("duplicate chat project:", error?.message || error);
      if (error instanceof ChatValidationError) return res.status(400).json({ error: error.message });
      res.status(500).json({ error: "Lỗi nhân bản project đoạn chat." });
    }
  });

  app.get("/api/chat-projects/:id/export", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const [row] = await getDb().select({ exportJson: chatProjects.exportJson }).from(chatProjects).where(and(eq(chatProjects.id, id), or(eq(chatProjects.owner, me), eq(chatProjects.isShared, true))));
      if (!row) return res.status(404).json({ error: "Không tìm thấy project đoạn chat." });
      res.json(row.exportJson || {});
    } catch (error: any) {
      console.error("get chat export metadata:", error?.message || error);
      res.status(500).json({ error: "Lỗi tải metadata export." });
    }
  });

  app.post("/api/chat-projects/:id/export", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    let createdKey: string | null = null;
    try {
      const db = getDb();
      const [existing] = await db.select().from(chatProjects).where(eq(chatProjects.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy project đoạn chat." });
      if (!(await canEdit(existing, me))) return res.status(403).json({ error: "Chỉ chủ sở hữu hoặc quản trị viên mới lưu export được." });
      const body = req.body || {};
      const format = typeof body.format === "string" && EXPORT_FORMATS.includes(body.format as any) ? body.format : "png";
      const width = Number.isInteger(body.width) && body.width > 0 && body.width <= 10_000 ? body.width : 1080;
      const height = Number.isInteger(body.height) && body.height > 0 && body.height <= 10_000 ? body.height : 1080;
      if (width * height > 20_000_000) return res.status(400).json({ error: "Kích thước export quá lớn (tối đa 20 triệu pixel)." });
      const rendererVersion = asTrimmedString(body.rendererVersion, 100) || existing.presetVersion || "1";
      let fileUrl: string | null = null;
      if (typeof body.imageDataUrl === "string" && body.imageDataUrl) {
        const parsed = parseDataUrl(body.imageDataUrl);
        if (!parsed || !["png", "jpg", "webp"].includes(parsed.ext) || parsed.buffer.length > 20 * 1024 * 1024) {
          return res.status(400).json({ error: "Ảnh export không hợp lệ (PNG/JPG/WebP, tối đa 20 MB)." });
        }
        createdKey = newKey("misc", parsed.ext);
        await storage.put(createdKey, parsed.buffer);
        fileUrl = `/api/files/${createdKey}`;
      }
      const exportJson = { format, width, height, fileUrl, rendererVersion, createdBy: me, createdAt: new Date().toISOString(), isMockup: true };
      const [row] = await db.update(chatProjects).set({ exportJson, updatedAt: new Date() }).where(eq(chatProjects.id, id)).returning();
      res.json({ export: exportJson, project: projectResponse(row, me) });
    } catch (error: any) {
      if (createdKey) await storage.delete(createdKey).catch(() => {});
      console.error("save chat export metadata:", error?.message || error);
      if (error instanceof ChatValidationError) return res.status(400).json({ error: error.message });
      res.status(500).json({ error: "Lỗi lưu export đoạn chat." });
    }
  });
}
