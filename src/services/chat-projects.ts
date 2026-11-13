import { authHeaders, asError } from "./http";

export type ChatPlatform = "messenger_like" | "zalo_like" | "custom";
export type ChatMessageType = "text" | "emoji" | "image" | "system" | "typing" | "link_preview" | "sticker" | "voice";

export interface ChatParticipant {
  id: string;
  name: string;
  displayName: string;
  nickname: string;
  avatarUrl: string;
  side: "left" | "right";
  color: string;
  status: "online" | "offline";
}

export interface ChatMessage {
  id: string;
  participantId: string;
  text: string;
  type: ChatMessageType;
  time: string;
  date?: string;
  seen: boolean;
  status?: "sent" | "delivered" | "seen";
  reaction: string;
  reactions?: string[];
  replyToId?: string;
  mediaUrl?: string;
  meta?: { url?: string; title?: string; description?: string; imageUrl?: string; sticker?: string; duration?: string; waveform?: string; imageAlt?: string };
  groupPosition?: "single" | "first" | "middle" | "last";
}

export interface ChatTheme {
  mode: "light" | "dark";
  headerColor: string;
  backgroundColor: string;
  incomingBubbleColor: string;
  outgoingBubbleColor: string;
  incomingTextColor: string;
  outgoingTextColor: string;
  conversationEmoji: string;
  showAvatars: boolean;
  showTimestamps: boolean;
  showSeen: boolean;
  chatThumbnailUrl?: string;
  chatIcon?: string;
  headerStatus?: string;
  showHeaderActions?: boolean;
  composerPlaceholder?: string;
  composerIcons?: { microphone: boolean; image: boolean; gif: boolean; emoji: boolean };
}

export interface ChatDocument {
  participants: ChatParticipant[];
  messages: ChatMessage[];
  theme: ChatTheme;
  exportSettings: { width: number; height: number; format: "png" };
}

export interface ChatProject {
  id: string;
  owner: string;
  isShared: boolean;
  title: string;
  platform: ChatPlatform;
  presetVersion: string;
  document: ChatDocument;
  exportJson: Record<string, unknown>;
  metadataJson: Record<string, unknown>;
  isMine?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatProjectInput {
  title: string;
  platform: ChatPlatform;
  isShared: boolean;
  document: ChatDocument;
}

/** Convert the editor document to the server's normalized field names. */
export function toApiDocument(input: ChatDocument): Record<string, unknown> {
  return {
    ...input,
    participants: input.participants.map((p, index) => ({ ...p, sortOrder: index })),
    messages: input.messages.map((m, index) => ({
      id: m.id,
      participantId: m.participantId,
      messageType: m.type,
      text: m.text,
      sentAt: m.time,
      metadata: { seen: m.seen, status: m.status, reaction: m.reaction, reactions: m.reactions, ...(m.meta || {}) },
      mediaUrl: m.mediaUrl || null,
      replyToId: m.replyToId || null,
      groupPosition: m.groupPosition || null,
      sortOrder: index,
    })),
  };
}

/** Convert the persisted server document back to the editor shape. */
export function fromApiDocument(input: Record<string, any>): ChatDocument {
  return {
    participants: Array.isArray(input.participants) ? input.participants.map((p: any) => ({
      ...p, nickname: p.nickname || "", avatarUrl: p.avatarUrl || "", color: p.color || "#64748b",
      side: p.side === "right" ? "right" : "left", status: p.status?.online === false ? "offline" : "online",
    })) : [],
    messages: Array.isArray(input.messages) ? input.messages.map((m: any) => ({
      id: m.id, participantId: m.participantId, text: m.text || "", type: m.messageType || "text",
      time: m.sentAt || "", date: m.date || undefined, seen: m.metadata?.seen !== false, status: m.metadata?.status || (m.metadata?.seen ? "seen" : "sent"), reaction: m.metadata?.reaction || "", reactions: Array.isArray(m.metadata?.reactions) ? m.metadata.reactions : (m.metadata?.reaction ? [m.metadata.reaction] : []),
      mediaUrl: m.mediaUrl || undefined, replyToId: m.replyToId || undefined, groupPosition: m.groupPosition || undefined, meta: m.metadata || {},
    })) : [],
    theme: { ...defaultChatTheme, ...(input.theme || {}) },
    exportSettings: { width: 1080, height: 1080, format: "png", ...(input.exportSettings || {}) },
  };
}

export async function listChatProjects(): Promise<ChatProject[]> {
  const res = await fetch("/api/chat-projects", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được các đoạn chat.");
  return res.json();
}

export async function getChatProject(id: string): Promise<ChatProject> {
  const res = await fetch(`/api/chat-projects/${id}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được đoạn chat.");
  return res.json();
}

export async function createChatProject(input: ChatProjectInput): Promise<ChatProject> {
  const res = await fetch("/api/chat-projects", {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ ...input, document: toApiDocument(input.document) }),
  });
  if (!res.ok) return asError(res, "Không tạo được đoạn chat.");
  return res.json();
}

export async function updateChatProject(id: string, input: Partial<ChatProjectInput>): Promise<ChatProject> {
  const res = await fetch(`/api/chat-projects/${id}`, {
    method: "PATCH", headers: authHeaders(), body: JSON.stringify({ ...input, ...(input.document ? { document: toApiDocument(input.document) } : {}) }),
  });
  if (!res.ok) return asError(res, "Không lưu được đoạn chat.");
  return res.json();
}

export async function saveChatExport(id: string, input: { imageDataUrl: string; width: number; height: number; format?: "png" }): Promise<ChatProject> {
  const res = await fetch(`/api/chat-projects/${id}/export`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify({ ...input, format: input.format || "png", rendererVersion: "canvas-v1" }),
  });
  if (!res.ok) return asError(res, "Không lưu được ảnh export.");
  const body = await res.json();
  return body.project;
}

export async function duplicateChatProject(id: string): Promise<ChatProject> {
  const res = await fetch(`/api/chat-projects/${id}/duplicate`, { method: "POST", headers: authHeaders() });
  if (!res.ok) return asError(res, "Không nhân bản được đoạn chat.");
  return res.json();
}

export async function deleteChatProject(id: string): Promise<void> {
  const res = await fetch(`/api/chat-projects/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không xoá được đoạn chat.");
}

export const defaultChatTheme: ChatTheme = {
  mode: "light", headerColor: "#4f46e5", backgroundColor: "#f1f5f9",
  incomingBubbleColor: "#ffffff", outgoingBubbleColor: "#4f46e5",
  incomingTextColor: "#0f172a", outgoingTextColor: "#ffffff",
  conversationEmoji: "💬", showAvatars: true, showTimestamps: true, showSeen: true,
  headerStatus: "Active now", showHeaderActions: true, composerPlaceholder: "Aa",
  composerIcons: { microphone: true, image: true, gif: true, emoji: true },
};

export function starterChatDocument(): ChatDocument {
  const participants: ChatParticipant[] = [
    { id: crypto.randomUUID(), name: "Gàn", displayName: "Gàn", nickname: "", avatarUrl: "", side: "left", color: "#64748b", status: "online" },
    { id: crypto.randomUUID(), name: "Gèn", displayName: "Gèn", nickname: "", avatarUrl: "", side: "right", color: "#4f46e5", status: "online" },
  ];
  return {
    participants,
    messages: [
      { id: crypto.randomUUID(), participantId: participants[0].id, text: "Ê, cái này làm nhanh được không?", type: "text", time: "09:41", seen: true, reaction: "" },
      { id: crypto.randomUUID(), participantId: participants[1].id, text: "Được chứ. Để tôi xử lý cho.", type: "text", time: "09:42", seen: true, reaction: "👍" },
    ],
    theme: { ...defaultChatTheme },
    exportSettings: { width: 1080, height: 1080, format: "png" },
  };
}

export function applyPreset(document: ChatDocument, platform: ChatPlatform): ChatDocument {
  const theme = platform === "zalo_like"
    ? { ...document.theme, headerColor: "#0068ff", outgoingBubbleColor: "#e5efff", outgoingTextColor: "#0f172a", backgroundColor: "#f4f7fb" }
    : platform === "custom"
      ? document.theme
      : { ...document.theme, headerColor: "#4f46e5", outgoingBubbleColor: "#4f46e5", outgoingTextColor: "#ffffff", backgroundColor: "#f1f5f9" };
  return { ...document, theme };
}
