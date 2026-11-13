import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Save, Trash2, UserPlus, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  applyPreset, createChatProject, defaultChatTheme, duplicateChatProject, fromApiDocument, getChatProject, saveChatExport, starterChatDocument,
  toApiDocument, updateChatProject, type ChatDocument, type ChatMessage, type ChatParticipant, type ChatPlatform,
} from "../services/chat-projects";
import { imageDisplayUrl } from "../services/http";

function MessengerIcon({ name, size = 18 }: { name: "back" | "phone" | "video" | "info" | "plus" | "camera" | "image" | "mic" | "gif" | "smile" | "close" | "minus" | "send"; size?: number }) {
  const paths: Record<string, string> = {
    phone: "M4.776 1.111a1.728 1.728 0 0 0-2.56-.127l-.472.472a4.516 4.516 0 0 0-.739 5.415 21.46 21.46 0 0 0 8.123 8.123 4.516 4.516 0 0 0 5.415-.738L15 13.8a1.75 1.75 0 0 0-.13-2.591l-2.131-1.745a1.75 1.75 0 0 0-2.143-.056L9.22 10.416a.052.052 0 0 1-.06.002 12.077 12.077 0 0 1-3.578-3.58.052.052 0 0 1 .002-.058l1.008-1.375a1.75 1.75 0 0 0-.056-2.143l-1.76-2.15z",
    back: "M15 4 7 12l8 8M8 12h12",
    video: "M6.304 2h-.108c-1.133 0-2.058 0-2.79.098-.763.103-1.425.325-1.954.854C.923 3.48.7 4.142.598 4.907.5 5.637.5 6.563.5 7.697v.607c0 1.133 0 2.058.098 2.79.103.763.325 1.425.854 1.954.529.529 1.19.751 1.955.854.73.098 1.656.098 2.79.098h.107c1.133 0 2.058 0 2.79-.098.763-.103 1.425-.325 1.954-.854.529-.529.751-1.19.854-1.955.038-.286.062-.602.076-.949l1.93 1.418a1 1 0 0 0 1.592-.806V5.228a1 1 0 0 0-1.57-.822l-1.956 1.357a9.984 9.984 0 0 0-.072-.856c-.103-.764-.325-1.426-.854-1.955-.529-.529-1.19-.751-1.955-.854C8.363 2 7.437 2 6.303 2z",
    info: "M10 9v7M10 5.5v.2M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
    plus: "M8 .5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM8.001 4a.75.75 0 0 1 .75.75v2.5h2.499a.75.75 0 0 1 0 1.5H8.751v2.5a.75.75 0 0 1-1.5 0v-2.5H4.75a.75.75 0 1 1 0-1.5h2.501v-2.5A.75.75 0 0 1 8.001 4z",
    camera: "m4 7 2-2h3l1-2h4l1 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7h2zm6 2.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    image: "M4 4h16v14H4zM4 15l4-4 3 3 2-2 7 6M8 8.5h.01",
    mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm-6-3a6 6 0 0 0 12 0M12 18v3M9 21h6",
    send: "M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.8429026 L21.714504,14.0454487 C22.6563168,13.5741568 23.1272231,12.6315722 22.9702544,11.6889879 C22.8132856,11.0605983 22.3423792,10.4322088 21.714504,10.118014 L4.13399899,1.16346272 C3.34915502,.9 2.40734225,1.00636533 1.77946707,1.4776575 C0.994623095,2.10604706 .8376543,3.0486314 1.15159189,3.99121575 L3.03521743,10.4322088 C3.03521743,10.5893061 3.34915502,10.7464035 3.50612381,10.7464035 L16.6915026,11.5318905 C16.6915026,11.5318905 17.1624089,11.5318905 17.1624089,12.0031827 C17.1624089,12.4744748 16.6915026,12.4744748 16.6915026,12.4744748 Z",
    close: "M13.457 3.957a1 1 0 0 0-1.414-1.414L8 6.586 3.957 2.543a1 1 0 0 0-1.414 1.414L6.586 8l-4.043 4.043a1 1 0 1 0 1.414 1.414L8 9.414l4.043 4.043a1 1 0 0 0 1.414-1.414L9.414 8l4.043-4.043z",
    minus: "M3 8a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1z",
    smile: "M8 13s1 2 4 2 4-2 4-2M9 9h.01M15 9h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  };
  if (name === "gif") return <span className="chat-gif-icon">GIF</span>;
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "phone" ? 0 : 2} strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} fill={name === "phone" ? "currentColor" : "none"} /></svg>;
}

function ChatPreview({ chatDocument, platform, title, selectedId, onSelect }: { chatDocument: ChatDocument; platform: ChatPlatform; title: string; selectedId?: string | null; onSelect?: (id: string) => void }) {
  const { theme, participants, messages } = chatDocument;
  const first = participants[0];
  const thumbnail = theme.chatThumbnailUrl || first?.avatarUrl;
  return (
    <div className={`chat-preview ${theme.mode === "dark" ? "chat-preview-dark" : ""}`} style={{ background: theme.backgroundColor }}>
      <div className="chat-preview-windowbar"><span className="chat-window-dot" /><span className="chat-window-dot" /><span className="chat-window-dot" /></div>
      <div className="chat-preview-header" style={{ background: theme.headerColor }}>
        <span className="chat-header-action"><MessengerIcon name="back" size={24} /></span>
        <div className="chat-avatar chat-avatar-header">{thumbnail ? <img src={imageDisplayUrl(thumbnail) || thumbnail} alt="" /> : (theme.chatIcon || first?.displayName || "?").slice(0, 1)}</div>
        <div className="min-w-0"><p className="font-semibold truncate">{title || participants.map((p) => p.displayName).join(", ") || "Đoạn chat"}</p><p className="text-xs opacity-80">{theme.headerStatus || (participants.length > 2 ? `${participants.length} người tham gia` : "Active now")}</p></div>
        {theme.showHeaderActions !== false && <div className="chat-header-actions"><span><MessengerIcon name="phone" /></span><span><MessengerIcon name="video" /></span><span><MessengerIcon name="info" /></span></div>}
      </div>
      <div className="chat-preview-body">
        <div className="chat-preview-note">Đây là mockup hội thoại</div>
        {messages.map((message) => {
          const person = participants.find((p) => p.id === message.participantId) || participants[0];
          const right = person?.side === "right";
          if (message.type === "system" || message.type === "typing") return <div key={message.id} className="chat-system-message">{message.text || (message.type === "typing" ? "Đang nhập..." : "Thông báo")}</div>;
          const reply = message.replyToId ? messages.find((m) => m.id === message.replyToId) : null;
          const previous = messages[messages.indexOf(message) - 1]; const showDate = message.date && message.date !== previous?.date; return <div key={message.id}>{showDate && <div className="chat-date-separator">{message.date}</div>}<div className={`chat-message-row ${right ? "chat-message-right" : ""} chat-group-${message.groupPosition || "single"}`}>
            {theme.showAvatars && !right && <div className="chat-avatar chat-avatar-small">{person?.avatarUrl ? <img src={imageDisplayUrl(person.avatarUrl) || person.avatarUrl} alt="" /> : (person?.displayName || "?").slice(0, 1)}</div>}
            <div className="chat-message-stack">
              {participants.length > 2 && !right && <span className="chat-sender-name">{person?.displayName}</span>}
              <div className={`chat-bubble ${selectedId === message.id ? "chat-bubble-selected" : ""}`} role="button" tabIndex={0} title="Bấm để sửa tin nhắn này" onClick={() => onSelect?.(message.id)} style={{ background: right ? theme.outgoingBubbleColor : theme.incomingBubbleColor, color: right ? theme.outgoingTextColor : theme.incomingTextColor }}>
                {reply && <div className="chat-reply-preview">↩ {reply.text.slice(0, 48)}</div>}
                {message.type === "image" ? (message.mediaUrl ? <img className="chat-message-image" src={imageDisplayUrl(message.mediaUrl) || message.mediaUrl} alt={message.meta?.imageAlt || "Ảnh trong tin nhắn"} /> : <div className="chat-image-placeholder">🖼️ Ảnh</div>) : message.type === "sticker" ? (message.mediaUrl ? <img className="chat-sticker-image" src={imageDisplayUrl(message.mediaUrl) || message.mediaUrl} alt="Sticker" /> : <div className="chat-sticker">{message.meta?.sticker || message.text || "😊"}</div>) : message.type === "link_preview" ? <div className="chat-link-preview">{message.meta?.imageUrl && <img src={imageDisplayUrl(message.meta.imageUrl) || message.meta.imageUrl} alt="" />}<strong>{message.meta?.title || message.text}</strong><small>{message.meta?.description || message.meta?.url || "link preview"}</small></div> : message.type === "voice" ? <div className="chat-voice">🎙️ {message.meta?.duration || "0:12"} ▰▰▰▰▰</div> : message.text}
                {(message.reactions?.length ? message.reactions : message.reaction ? [message.reaction] : []).length > 0 && <span className="chat-reaction">{(message.reactions?.length ? message.reactions : [message.reaction]).join(" ")}</span>}
              </div>
              {theme.showTimestamps && <span className="chat-time">{message.time}{right ? ` · ${message.status === "sent" ? "Đã gửi" : message.status === "delivered" ? "Đã nhận" : "Đã xem"}` : ""}</span>}
            </div>
          </div></div>;
        })}
      </div>
      <div className="chat-preview-composer"><div className="chat-composer-icons">{theme.composerIcons?.microphone !== false && <span><MessengerIcon name="mic" size={17} /></span>}{theme.composerIcons?.image !== false && <span><MessengerIcon name="image" size={17} /></span>}{theme.composerIcons?.gif !== false && <span><MessengerIcon name="gif" size={21} /></span>}</div><span className="chat-composer-placeholder">{theme.composerPlaceholder || "Aa"}</span>{theme.composerIcons?.emoji !== false && <span><MessengerIcon name="smile" size={19} /></span>}</div>
    </div>
  );
}
function newMessage(participantId: string): ChatMessage { return { id: crypto.randomUUID(), participantId, text: "", type: "text", time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }), seen: true, reaction: "" }; }
function newParticipant(index: number): ChatParticipant { return { id: crypto.randomUUID(), name: `Nhân vật ${index}`, displayName: `Nhân vật ${index}`, nickname: "", avatarUrl: "", side: index % 2 ? "right" : "left", color: index % 2 ? "#4f46e5" : "#64748b", status: "online" }; }

export default function ChatComposer() {
  const [searchParams] = useSearchParams();
  const [projectId, setProjectId] = useState<string | null>(searchParams.get("id"));
  const [title, setTitle] = useState("Đoạn chat mới");
  const [platform, setPlatform] = useState<ChatPlatform>("messenger_like");
  const [chatDocument, setDocument] = useState<ChatDocument>(() => starterChatDocument());
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const id = searchParams.get("id"); if (!id) return; getChatProject(id).then((row) => { setProjectId(row.id); setTitle(row.title); setPlatform(row.platform); setDocument(fromApiDocument(row.document)); }).catch((e) => setMessage(e.message)); }, [searchParams]);
  useEffect(() => {
    const dialogueRaw = searchParams.get("dialogue"); const charsRaw = searchParams.get("chars");
    if (!dialogueRaw || searchParams.get("id")) return;
    try {
      const dialogue = JSON.parse(dialogueRaw) as { character?: string; text?: string }[];
      const names = Array.from(new Set(dialogue.map((d) => d.character || "").filter(Boolean)));
      const participants = (names.length ? names : ["Nhân vật 1", "Nhân vật 2"]).map((name, index) => ({ ...newParticipant(index + 1), name, displayName: name, side: index % 2 ? "right" as const : "left" as const }));
      const current = starterChatDocument();
      setDocument({ ...current, participants, messages: dialogue.filter((d) => d.text).map((d, index) => ({ ...newMessage(participants[index % participants.length].id), text: d.text || "", participantId: participants.find((p) => p.name === d.character)?.id || participants[0].id })) });
    } catch { setMessage("Không đọc được dialogue từ tín hiệu."); }
    if (charsRaw && !dialogueRaw) setMessage("Đã mở đoạn chat từ tín hiệu; hãy thêm lời thoại.");
  }, [searchParams]);
  const selectedMessage = useMemo(() => chatDocument.messages.find((m) => m.id === selectedMessageId), [chatDocument.messages, selectedMessageId]);
  const updateDocument = (patch: Partial<ChatDocument>) => setDocument((current) => ({ ...current, ...patch }));
  const updateMessage = (id: string, patch: Partial<ChatMessage>) => updateDocument({ messages: chatDocument.messages.map((m) => m.id === id ? { ...m, ...patch } : m) });
  const updateParticipant = (id: string, patch: Partial<ChatParticipant>) => updateDocument({ participants: chatDocument.participants.map((p) => p.id === id ? { ...p, ...patch } : p) });
  const selectedPerson = selectedMessage ? chatDocument.participants.find((p) => p.id === selectedMessage.participantId) : null;

  async function save() { setSaving(true); setMessage(null); try { const row = projectId ? await updateChatProject(projectId, { title, platform, document: chatDocument, isShared: true }) : await createChatProject({ title, platform, document: chatDocument, isShared: true }); setProjectId(row.id); setMessage("Đã lưu đoạn chat."); } catch (e: any) { setMessage(e.message); } finally { setSaving(false); } }
  async function duplicate() { if (!projectId) { setMessage("Hãy lưu project trước khi nhân bản."); return; } try { const copy = await duplicateChatProject(projectId); window.location.href = `/chat-composer?id=${copy.id}`; } catch (e: any) { setMessage(e.message); } }
  function applyTemplate(kind: "customer" | "group") {
    const people = kind === "group" ? [newParticipant(1), newParticipant(2), newParticipant(3)] : [newParticipant(1), newParticipant(2)];
    people[0].displayName = kind === "group" ? "Khách hàng" : "Khách";
    people[1].displayName = kind === "group" ? "Nhân viên" : "Chị Bão";
    const messages = kind === "group"
      ? ["Mọi người ơi, web em chậm quá", "Để mình kiểm tra nha", "Có khi server đang cần thêm tài nguyên rồi"]
      : ["Chị ơi, tên miền này còn không?", "Còn em nhé, chị kiểm tra ngay đây."];
    updateDocument({ participants: people, messages: messages.map((text, index) => ({ ...newMessage(people[index % people.length].id), text })) });
  }

  async function compressImage(file: File, maxBytes: number, maxDimension = 1600): Promise<string> {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => { const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Ảnh không đọc được.")); img.src = String(r.result); }; r.onerror = () => reject(r.error); r.readAsDataURL(file); });
    const scale = Math.min(1, maxDimension / Math.max(source.width, source.height)); const canvas = globalThis.document.createElement("canvas"); canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale)); const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Trình duyệt không hỗ trợ nén ảnh."); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    let quality = .88; let output = canvas.toDataURL("image/jpeg", quality); while (output.length * .75 > maxBytes && quality > .45) { quality -= .08; output = canvas.toDataURL("image/jpeg", quality); } return output;
  }
  function handleThumbnail(file: File) {
    if (!file.type.startsWith("image/") || file.size > 1024 * 1024) { setMessage("Ảnh đại diện đoạn chat cần là file ảnh, tối đa 1 MB."); return; }
    compressImage(file, 5 * 1024 * 1024).then((data) => updateDocument({ theme: { ...chatDocument.theme, chatThumbnailUrl: data } })).catch((e) => setMessage(e.message));
  }
  const setTheme = (patch: Partial<ChatDocument["theme"]>) => updateDocument({ theme: { ...chatDocument.theme, ...patch } });
  const icons = chatDocument.theme.composerIcons || { microphone: true, image: true, gif: true, emoji: true };

  function handleMessageMedia(file: File, messageId: string) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { setMessage("Ảnh tin nhắn cần là file ảnh, tối đa 5 MB."); return; }
    compressImage(file, 5 * 1024 * 1024).then((data) => updateMessage(messageId, { mediaUrl: data })).catch((e) => setMessage(e.message));
  }

  function handleAvatar(file: File, participantId: string) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { setMessage("Avatar cần là file ảnh, tối đa 5 MB."); return; }
    const reader = new FileReader(); reader.onload = () => updateParticipant(participantId, { avatarUrl: String(reader.result) }); reader.readAsDataURL(file);
  }

  async function exportPng() {
    const width = chatDocument.exportSettings.width; const height = chatDocument.exportSettings.height;
    const canvas = globalThis.document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d"); if (!ctx) { setMessage("Trình duyệt không hỗ trợ export Canvas."); return; }
    const theme = chatDocument.theme; ctx.fillStyle = theme.backgroundColor; ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / 420, height / 720); ctx.save(); ctx.scale(scale, scale);
    const viewWidth = width / scale; const viewHeight = height / scale;
    ctx.fillStyle = theme.headerColor; ctx.fillRect(0, 0, viewWidth, 72);
    ctx.fillStyle = "#fff"; ctx.font = "600 15px Inter, sans-serif"; ctx.fillText(title || "Đoạn chat", 68, 31);
    ctx.font = "12px Inter, sans-serif"; ctx.globalAlpha = .8; ctx.fillText(chatDocument.participants.length > 2 ? `${chatDocument.participants.length} người tham gia` : "Đang hoạt động", 68, 51); ctx.globalAlpha = 1;
    ctx.font = "20px sans-serif"; ctx.fillText(theme.conversationEmoji || "💬", viewWidth - 38, 39);
    ctx.fillStyle = "rgba(15,23,42,.07)"; ctx.font = "11px Inter, sans-serif"; ctx.fillText("Đây là mockup hội thoại", 145, 96);
    let y = 122;
    for (const item of chatDocument.messages) {
      const person = chatDocument.participants.find((p) => p.id === item.participantId) || chatDocument.participants[0];
      const right = person?.side === "right"; const max = 285; const lines = (item.text || (item.type === "typing" ? "Đang nhập..." : item.type === "image" ? "🖼️ Ảnh" : "Thông báo")).match(new RegExp(`.{1,${Math.max(12, Math.floor(max / 7))}}(?:\\s|$)`, "g")) || [item.text || ""];
      const bubbleH = Math.max(38, lines.length * 19 + 18); const bubbleW = Math.min(max, Math.max(68, Math.max(...lines.map((line) => ctx.measureText(line).width)) + 24)); const x = right ? viewWidth - 14 - bubbleW : 42;
      if (!right && theme.showAvatars) { ctx.fillStyle = "#cbd5e1"; ctx.beginPath(); ctx.arc(24, y + bubbleH - 14, 14, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#334155"; ctx.font = "700 12px Inter, sans-serif"; ctx.fillText((person?.displayName || "?").slice(0, 1), 20, y + bubbleH - 10); }
      ctx.fillStyle = right ? theme.outgoingBubbleColor : theme.incomingBubbleColor; ctx.beginPath(); ctx.roundRect(x, y, bubbleW, bubbleH, 18); ctx.fill();
      ctx.fillStyle = right ? theme.outgoingTextColor : theme.incomingTextColor; ctx.font = "14px Inter, sans-serif"; lines.forEach((line, index) => ctx.fillText(line.trim(), x + 12, y + 25 + index * 19));
      if (item.reaction) { ctx.font = "12px sans-serif"; ctx.fillText(item.reaction, x + bubbleW - 8, y + bubbleH + 10); }
      if (theme.showTimestamps) { ctx.fillStyle = "#94a3b8"; ctx.font = "10px Inter, sans-serif"; ctx.fillText(`${item.time}${theme.showSeen && right && item.seen ? " · Đã xem" : ""}`, right ? x + 4 : x, y + bubbleH + 14); }
      y += bubbleH + 31; if (y > viewHeight - 80) break;
    }
    ctx.fillStyle = "rgba(255,255,255,.96)"; ctx.fillRect(0, viewHeight - 56, viewWidth, 56); ctx.fillStyle = "#94a3b8"; ctx.font = "14px Inter, sans-serif"; ctx.fillText("Nhập tin nhắn...", 18, viewHeight - 23); ctx.fillText("😊", viewWidth - 36, viewHeight - 23); ctx.restore();
    canvas.toBlob(async (blob) => {
      if (!blob) { setMessage("Không tạo được file PNG."); return; }
      const url = URL.createObjectURL(blob); const link = globalThis.document.createElement("a"); link.download = `${title || "chat-mockup"}.png`; link.href = url; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (!projectId) { setMessage("Đã tải PNG. Hãy lưu project để lưu ảnh export vào hệ thống."); return; }
      try {
        const imageDataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
        await saveChatExport(projectId, { imageDataUrl, width, height });
        setMessage("Đã tải PNG và lưu ảnh export vào hệ thống.");
      } catch (e: any) { setMessage(`Đã tải PNG nhưng chưa lưu được export: ${e.message}`); }
    }, "image/png");
  }

  return <main className="p-4 md:p-6 max-w-[1600px] mx-auto">
    <div className="chat-toolbar mb-5"><div><p className="text-xs uppercase tracking-wider text-stone-500">Sản xuất</p><h1 className="text-2xl font-bold text-stone-900">Dựng đoạn chat</h1></div><input aria-label="Tên project" className="ds-input ml-auto w-56" value={title} onChange={(e) => setTitle(e.target.value)} /><div className="chat-preview-mode"><button type="button" className={previewMode === "desktop" ? "active" : ""} onClick={() => setPreviewMode("desktop")}>Desktop</button><button type="button" className={previewMode === "mobile" ? "active" : ""} onClick={() => setPreviewMode("mobile")}>Mobile</button></div><select aria-label="Preset giao diện" className="ds-select" value={platform} onChange={(e) => { const next = e.target.value as ChatPlatform; setPlatform(next); setDocument(applyPreset(chatDocument, next)); }}><option value="messenger_like">Messenger-like</option><option value="zalo_like">Zalo-like</option><option value="custom">Custom</option></select><button className="ds-btn ds-btn-secondary" onClick={save} disabled={saving}><Save className="w-4 h-4" />{saving ? "Đang lưu..." : "Lưu"}</button><button className="ds-btn ds-btn-ghost" onClick={duplicate} disabled={!projectId}>Nhân bản</button><select aria-label="Mẫu hội thoại" className="ds-select" defaultValue="" onChange={(e) => { if (e.target.value) applyTemplate(e.target.value as "customer" | "group"); e.target.value = ""; }}><option value="">Chọn mẫu</option><option value="customer">Khách hỏi – nhân viên</option><option value="group">Nhóm chat 3 người</option></select><button className="ds-btn ds-btn-primary" onClick={exportPng}><Download className="w-4 h-4" />Xuất PNG</button></div>
    {message && <div className="ds-alert ds-alert-info mb-4" role="status">{message}</div>}
    <div className="chat-workspace grid gap-5">
      <section className="ds-card"><div className="flex justify-between items-center mb-3"><h2 className="font-semibold">Nhân vật</h2><button className="ds-btn ds-btn-ghost !p-1" onClick={() => updateDocument({ participants: [...chatDocument.participants, newParticipant(chatDocument.participants.length + 1)] })} aria-label="Thêm nhân vật"><UserPlus className="w-4 h-4" /></button></div>{chatDocument.participants.map((person) => <div key={person.id} className="border-b border-stone-100 py-3 last:border-0 space-y-2"><input aria-label={`Tên ${person.name}`} className="ds-input w-full" value={person.displayName} onChange={(e) => updateParticipant(person.id, { displayName: e.target.value, name: e.target.value })} /><div className="flex gap-2"><input aria-label={`Biệt danh ${person.displayName}`} placeholder="Biệt danh" className="ds-input min-w-0 flex-1" value={person.nickname} onChange={(e) => updateParticipant(person.id, { nickname: e.target.value })} /><select aria-label={`Vị trí ${person.displayName}`} className="ds-select w-24" value={person.side} onChange={(e) => updateParticipant(person.id, { side: e.target.value as ChatParticipant["side"] })}><option value="left">Trái</option><option value="right">Phải</option></select></div><input aria-label={`Avatar URL ${person.displayName}`} placeholder="URL avatar (tuỳ chọn)" className="ds-input w-full text-xs" value={person.avatarUrl.startsWith("data:") ? "Ảnh đã chọn" : person.avatarUrl} onChange={(e) => updateParticipant(person.id, { avatarUrl: e.target.value })} /><label className="text-xs text-storm-700 cursor-pointer">Tải avatar<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label={`Tải avatar ${person.displayName}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) handleAvatar(file, person.id); e.target.value = ""; }} /></label>{chatDocument.participants.length > 2 && <button className="text-xs text-red-600" onClick={() => updateDocument({ participants: chatDocument.participants.filter((p) => p.id !== person.id), messages: chatDocument.messages.filter((m) => m.participantId !== person.id) })}>Xóa nhân vật</button>}</div>)}</section>
      <section ref={exportRef} className="min-w-0"><div className={`chat-preview-shell ${previewMode === "mobile" ? "chat-preview-mobile" : ""}`}><ChatPreview chatDocument={chatDocument} platform={platform} title={title} selectedId={selectedMessageId} onSelect={setSelectedMessageId} /><div className="ds-card mt-4"><div className="flex justify-between items-center mb-3 gap-2"><h2 className="font-semibold">Dòng tin nhắn</h2>{selectedMessageIds.length > 0 && <select aria-label="Đổi người gửi cho tin đã chọn" className="ds-select ml-auto" defaultValue="" onChange={(e) => { const id = e.target.value; if (!id) return; updateDocument({ messages: chatDocument.messages.map((m) => selectedMessageIds.includes(m.id) ? { ...m, participantId: id } : m) }); setSelectedMessageIds([]); e.target.value = ""; }}><option value="">Đổi người gửi ({selectedMessageIds.length})</option>{chatDocument.participants.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select>}<button className="ds-btn ds-btn-secondary" onClick={() => { const id = chatDocument.participants[0]?.id; if (id) updateDocument({ messages: [...chatDocument.messages, newMessage(id)] }); }}><Plus className="w-4 h-4" />Thêm tin</button></div>{chatDocument.messages.map((item) => <div key={item.id} className={`flex gap-2 items-start mb-2 ${selectedMessageId === item.id ? "ring-2 ring-indigo-200 rounded-md" : ""}`}><input type="checkbox" className="mt-3" aria-label="Chọn tin nhắn" checked={selectedMessageIds.includes(item.id)} onChange={(e) => setSelectedMessageIds((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} /><select aria-label="Người gửi" className="ds-select w-28 shrink-0" value={item.participantId} onChange={(e) => updateMessage(item.id, { participantId: e.target.value })}>{chatDocument.participants.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select><input aria-label="Nội dung tin nhắn" className="ds-input min-w-0 flex-1" value={item.text} onFocus={() => setSelectedMessageId(item.id)} onChange={(e) => updateMessage(item.id, { text: e.target.value })} placeholder="Nhập tin nhắn..." /><button className="ds-btn ds-btn-ghost !p-2 text-red-500" aria-label="Xóa tin nhắn" onClick={() => updateDocument({ messages: chatDocument.messages.filter((m) => m.id !== item.id) })}><Trash2 className="w-4 h-4" /></button></div>)}</div></div></section>
      <section className="ds-card space-y-4 chat-inspector"><h2 className="font-semibold">Thiết lập hiển thị</h2>{!selectedMessage && <p className="text-sm text-stone-500">Bấm vào một tin nhắn trong khung xem trước để sửa nội dung, loại tin, reaction và thời gian.</p>}{selectedPerson && selectedMessage && <div><label className="ds-label" htmlFor="selected-text">Nội dung tin nhắn</label><textarea id="selected-text" rows={3} className="ds-input w-full" value={selectedMessage.text} onChange={(e) => updateMessage(selectedMessage.id, { text: e.target.value })} /><label className="ds-label mt-3" htmlFor="selected-media">Ảnh/sticker/link thumbnail</label><label className="ds-btn ds-btn-secondary ds-btn-sm cursor-pointer w-fit">Tải ảnh<input id="selected-media" type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleMessageMedia(f, selectedMessage.id); e.target.value = ""; }} /></label><label className="ds-label mt-3" htmlFor="selected-reaction">Reaction</label><input id="selected-reaction" className="ds-input w-full" placeholder="vd 👍 ❤️ 😂" value={selectedMessage.reaction} onChange={(e) => updateMessage(selectedMessage.id, { reaction: e.target.value })} /><label className="ds-label mt-3" htmlFor="selected-type">Loại tin</label><select id="selected-type" className="ds-select w-full" value={selectedMessage.type} onChange={(e) => updateMessage(selectedMessage.id, { type: e.target.value as ChatMessage["type"] })}>{["text", "emoji", "image", "system", "typing", "sticker", "link_preview", "voice"].map((type) => <option key={type} value={type}>{type}</option>)}</select><label className="ds-label mt-3" htmlFor="selected-reply">Trả lời tin</label><select id="selected-reply" className="ds-select w-full" value={selectedMessage.replyToId || ""} onChange={(e) => updateMessage(selectedMessage.id, { replyToId: e.target.value || undefined })}><option value="">Không trả lời</option>{chatDocument.messages.filter((m) => m.id !== selectedMessage.id).map((m) => <option key={m.id} value={m.id}>{m.text.slice(0, 40) || m.type}</option>)}</select>{selectedMessage.type === "link_preview" && <><label className="ds-label mt-3" htmlFor="link-url">URL</label><input id="link-url" className="ds-input w-full" value={selectedMessage.meta?.url || ""} onChange={(e) => updateMessage(selectedMessage.id, { meta: { ...selectedMessage.meta, url: e.target.value } })} /><label className="ds-label mt-3" htmlFor="link-title">Tiêu đề preview</label><input id="link-title" className="ds-input w-full" value={selectedMessage.meta?.title || ""} onChange={(e) => updateMessage(selectedMessage.id, { meta: { ...selectedMessage.meta, title: e.target.value } })} /></>}{selectedMessage.type === "sticker" && <><label className="ds-label mt-3" htmlFor="sticker">Sticker</label><input id="sticker" className="ds-input w-full" value={selectedMessage.meta?.sticker || ""} onChange={(e) => updateMessage(selectedMessage.id, { meta: { ...selectedMessage.meta, sticker: e.target.value } })} /></>}{selectedMessage.type === "voice" && <><label className="ds-label mt-3" htmlFor="voice-duration">Thời lượng voice</label><input id="voice-duration" className="ds-input w-full" value={selectedMessage.meta?.duration || ""} onChange={(e) => updateMessage(selectedMessage.id, { meta: { ...selectedMessage.meta, duration: e.target.value } })} /></>}<label className="ds-label mt-3" htmlFor="selected-time">Thời gian</label><input id="selected-time" className="ds-input w-full" value={selectedMessage.time} onChange={(e) => updateMessage(selectedMessage.id, { time: e.target.value })} /></div>}<div className="chat-inspector-group"><h3 className="text-sm font-semibold text-stone-700">Header đoạn chat</h3><label className="ds-label" htmlFor="chat-thumb">Ảnh đại diện đoạn chat</label><div className="flex gap-2"><input id="chat-thumb" className="ds-input min-w-0 flex-1 text-xs" placeholder="URL ảnh (để trống = avatar nhân vật đầu)" value={(chatDocument.theme.chatThumbnailUrl || "").startsWith("data:") ? "Ảnh đã tải lên" : chatDocument.theme.chatThumbnailUrl || ""} onChange={(e) => setTheme({ chatThumbnailUrl: e.target.value })} /><label className="ds-btn ds-btn-secondary ds-btn-sm cursor-pointer">Tải ảnh<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Tải ảnh đại diện đoạn chat" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleThumbnail(f); e.target.value = ""; }} /></label></div><label className="ds-label mt-2" htmlFor="chat-status">Dòng trạng thái</label><input id="chat-status" className="ds-input w-full" placeholder="vd Active 17 minutes ago" value={chatDocument.theme.headerStatus || ""} onChange={(e) => setTheme({ headerStatus: e.target.value })} /><label className="flex gap-2 items-center text-sm mt-2"><input type="checkbox" checked={chatDocument.theme.showHeaderActions !== false} onChange={(e) => setTheme({ showHeaderActions: e.target.checked })} />Hiện nút gọi / video / thông tin</label></div><div className="chat-inspector-group"><h3 className="text-sm font-semibold text-stone-700">Thanh nhập tin</h3><label className="ds-label" htmlFor="composer-ph">Chữ gợi ý</label><input id="composer-ph" className="ds-input w-full" value={chatDocument.theme.composerPlaceholder || ""} onChange={(e) => setTheme({ composerPlaceholder: e.target.value })} /><div className="grid grid-cols-2 gap-1 mt-2 text-sm">{(["microphone", "image", "gif", "emoji"] as const).map((k) => <label key={k} className="flex gap-2 items-center"><input type="checkbox" checked={icons[k] !== false} onChange={(e) => setTheme({ composerIcons: { ...icons, [k]: e.target.checked } })} />{{ microphone: "Micro", image: "Ảnh", gif: "GIF", emoji: "Emoji" }[k]}</label>)}</div></div><label className="ds-label" htmlFor="emoji">Icon đoạn chat (nút like)</label><input id="emoji" className="ds-input w-full" value={chatDocument.theme.conversationEmoji} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, conversationEmoji: e.target.value } })} /><label className="ds-label" htmlFor="header-color">Màu header</label><input id="header-color" type="color" className="h-10 w-full" value={chatDocument.theme.headerColor} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, headerColor: e.target.value } })} /><label className="ds-label" htmlFor="outgoing-color">Màu tin nhắn bên phải</label><input id="outgoing-color" type="color" className="h-10 w-full" value={chatDocument.theme.outgoingBubbleColor} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, outgoingBubbleColor: e.target.value } })} /><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={chatDocument.theme.showAvatars} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, showAvatars: e.target.checked } })} />Hiện avatar</label><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={chatDocument.theme.showSeen} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, showSeen: e.target.checked } })} />Hiện đã xem</label><button className="text-sm text-stone-500 flex items-center gap-1" onClick={() => updateDocument({ theme: { ...defaultChatTheme } })}><X className="w-4 h-4" />Đặt lại theme</button></section>
    </div>
  </main>;
}
