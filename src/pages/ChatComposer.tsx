import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Save, Trash2, UserPlus, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  applyPreset, createChatProject, defaultChatTheme, duplicateChatProject, fromApiDocument, getChatProject, saveChatExport, starterChatDocument,
  toApiDocument, updateChatProject, type ChatDocument, type ChatMessage, type ChatParticipant, type ChatPlatform,
} from "../services/chat-projects";
import { imageDisplayUrl } from "../services/http";

function ChatPreview({ chatDocument, platform, title }: { chatDocument: ChatDocument; platform: ChatPlatform; title: string }) {
  const { theme, participants, messages } = chatDocument;
  const first = participants[0];
  const conversationName = title || participants.map((p) => p.displayName).join(", ") || "Đoạn chat";
  return (
    <div id="chat-export-canvas" className={`chat-preview ${theme.mode === "dark" ? "chat-preview-dark" : ""}`} style={{ background: theme.backgroundColor }}>
      <div className="chat-preview-header" style={{ background: theme.headerColor }}>
        <div className="chat-avatar chat-avatar-header">{first?.avatarUrl ? <img src={imageDisplayUrl(first.avatarUrl) || first.avatarUrl} alt="" /> : (first?.displayName || "?").slice(0, 1)}</div>
        <div className="min-w-0"><p className="font-semibold truncate">{conversationName}</p><p className="text-xs opacity-80">{participants.length > 2 ? `${participants.length} người tham gia` : "Đang hoạt động"}</p></div>
        <span className="ml-auto text-xl" aria-label="Emoji cuộc trò chuyện">{theme.conversationEmoji}</span>
      </div>
      <div className="chat-preview-body">
        <div className="chat-preview-note">Đây là mockup hội thoại</div>
        {messages.map((message) => {
          const person = participants.find((p) => p.id === message.participantId) || participants[0];
          const right = person?.side === "right";
          if (message.type === "system" || message.type === "typing") return <div key={message.id} className="chat-system-message">{message.text || (message.type === "typing" ? "Đang nhập..." : "Thông báo")}</div>;
          return (
            <div key={message.id} className={`chat-message-row ${right ? "chat-message-right" : ""}`}>
              {theme.showAvatars && !right && <div className="chat-avatar chat-avatar-small">{person?.avatarUrl ? <img src={imageDisplayUrl(person.avatarUrl) || person.avatarUrl} alt="" /> : (person?.displayName || "?").slice(0, 1)}</div>}
              <div className="chat-message-stack">
                {participants.length > 2 && !right && <span className="chat-sender-name">{person?.displayName}</span>}
                <div className="chat-bubble" style={{ background: right ? theme.outgoingBubbleColor : theme.incomingBubbleColor, color: right ? theme.outgoingTextColor : theme.incomingTextColor }}>
                  {message.replyToId && <div className="chat-reply-preview">↩ Tin nhắn được trả lời</div>}{message.type === "image" ? <div className="chat-image-placeholder">🖼️ Ảnh</div> : message.type === "sticker" ? <div className="chat-sticker">{message.meta?.sticker || message.text || "😊"}</div> : message.type === "link_preview" ? <div className="chat-link-preview"><strong>{message.meta?.title || message.text}</strong><small>{message.meta?.url || "link preview"}</small></div> : message.type === "voice" ? <div className="chat-voice">🎙️ {message.meta?.duration || "0:12"} ▰▰▰▰▰</div> : message.text}
                  {message.reaction && <span className="chat-reaction">{message.reaction}</span>}
                </div>
                {theme.showTimestamps && <span className="chat-time">{message.time}{theme.showSeen && right && message.seen ? " · Đã xem" : ""}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="chat-preview-composer"><span>Nhập tin nhắn...</span><span>😊</span></div>
      <span className="chat-platform-label">{platform === "zalo_like" ? "Zalo-like mockup" : platform === "messenger_like" ? "Messenger-like mockup" : "Custom mockup"}</span>
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
    <div className="flex flex-wrap items-center gap-3 mb-5"><div><p className="text-xs uppercase tracking-wider text-stone-500">Sản xuất</p><h1 className="text-2xl font-bold text-stone-900">Dựng đoạn chat</h1></div><input aria-label="Tên project" className="ds-input ml-auto w-56" value={title} onChange={(e) => setTitle(e.target.value)} /><select aria-label="Preset giao diện" className="ds-select" value={platform} onChange={(e) => { const next = e.target.value as ChatPlatform; setPlatform(next); setDocument(applyPreset(chatDocument, next)); }}><option value="messenger_like">Messenger-like</option><option value="zalo_like">Zalo-like</option><option value="custom">Custom</option></select><button className="ds-btn ds-btn-secondary" onClick={save} disabled={saving}><Save className="w-4 h-4" />{saving ? "Đang lưu..." : "Lưu"}</button><button className="ds-btn ds-btn-ghost" onClick={duplicate} disabled={!projectId}>Nhân bản</button><select aria-label="Mẫu hội thoại" className="ds-select" defaultValue="" onChange={(e) => { if (e.target.value) applyTemplate(e.target.value as "customer" | "group"); e.target.value = ""; }}><option value="">Chọn mẫu</option><option value="customer">Khách hỏi – nhân viên</option><option value="group">Nhóm chat 3 người</option></select><button className="ds-btn ds-btn-primary" onClick={exportPng}><Download className="w-4 h-4" />Xuất PNG</button></div>
    {message && <div className="ds-alert ds-alert-info mb-4" role="status">{message}</div>}
    <div className="grid xl:grid-cols-[260px_minmax(360px,560px)_320px] gap-4 items-start">
      <section className="ds-card"><div className="flex justify-between items-center mb-3"><h2 className="font-semibold">Nhân vật</h2><button className="ds-btn ds-btn-ghost !p-1" onClick={() => updateDocument({ participants: [...chatDocument.participants, newParticipant(chatDocument.participants.length + 1)] })} aria-label="Thêm nhân vật"><UserPlus className="w-4 h-4" /></button></div>{chatDocument.participants.map((person) => <div key={person.id} className="border-b border-stone-100 py-3 last:border-0 space-y-2"><input aria-label={`Tên ${person.name}`} className="ds-input w-full" value={person.displayName} onChange={(e) => updateParticipant(person.id, { displayName: e.target.value, name: e.target.value })} /><div className="flex gap-2"><input aria-label={`Biệt danh ${person.displayName}`} placeholder="Biệt danh" className="ds-input min-w-0 flex-1" value={person.nickname} onChange={(e) => updateParticipant(person.id, { nickname: e.target.value })} /><select aria-label={`Vị trí ${person.displayName}`} className="ds-select w-24" value={person.side} onChange={(e) => updateParticipant(person.id, { side: e.target.value as ChatParticipant["side"] })}><option value="left">Trái</option><option value="right">Phải</option></select></div><input aria-label={`Avatar URL ${person.displayName}`} placeholder="URL avatar (tuỳ chọn)" className="ds-input w-full text-xs" value={person.avatarUrl.startsWith("data:") ? "Ảnh đã chọn" : person.avatarUrl} onChange={(e) => updateParticipant(person.id, { avatarUrl: e.target.value })} /><label className="text-xs text-storm-700 cursor-pointer">Tải avatar<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label={`Tải avatar ${person.displayName}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) handleAvatar(file, person.id); e.target.value = ""; }} /></label>{chatDocument.participants.length > 2 && <button className="text-xs text-red-600" onClick={() => updateDocument({ participants: chatDocument.participants.filter((p) => p.id !== person.id), messages: chatDocument.messages.filter((m) => m.participantId !== person.id) })}>Xóa nhân vật</button>}</div>)}</section>
      <section ref={exportRef} className="min-w-0"><ChatPreview chatDocument={chatDocument} platform={platform} title={title} /><div className="ds-card mt-4"><div className="flex justify-between items-center mb-3 gap-2"><h2 className="font-semibold">Dòng tin nhắn</h2>{selectedMessageIds.length > 0 && <select aria-label="Đổi người gửi cho tin đã chọn" className="ds-select ml-auto" defaultValue="" onChange={(e) => { const id = e.target.value; if (!id) return; updateDocument({ messages: chatDocument.messages.map((m) => selectedMessageIds.includes(m.id) ? { ...m, participantId: id } : m) }); setSelectedMessageIds([]); e.target.value = ""; }}><option value="">Đổi người gửi ({selectedMessageIds.length})</option>{chatDocument.participants.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select>}<button className="ds-btn ds-btn-secondary" onClick={() => { const id = chatDocument.participants[0]?.id; if (id) updateDocument({ messages: [...chatDocument.messages, newMessage(id)] }); }}><Plus className="w-4 h-4" />Thêm tin</button></div>{chatDocument.messages.map((item) => <div key={item.id} className={`flex gap-2 items-start mb-2 ${selectedMessageId === item.id ? "ring-2 ring-indigo-200 rounded-md" : ""}`}><input type="checkbox" className="mt-3" aria-label="Chọn tin nhắn" checked={selectedMessageIds.includes(item.id)} onChange={(e) => setSelectedMessageIds((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} /><select aria-label="Người gửi" className="ds-select w-28 shrink-0" value={item.participantId} onChange={(e) => updateMessage(item.id, { participantId: e.target.value })}>{chatDocument.participants.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select><input aria-label="Nội dung tin nhắn" className="ds-input min-w-0 flex-1" value={item.text} onFocus={() => setSelectedMessageId(item.id)} onChange={(e) => updateMessage(item.id, { text: e.target.value })} placeholder="Nhập tin nhắn..." /><button className="ds-btn ds-btn-ghost !p-2 text-red-500" aria-label="Xóa tin nhắn" onClick={() => updateDocument({ messages: chatDocument.messages.filter((m) => m.id !== item.id) })}><Trash2 className="w-4 h-4" /></button></div>)}</div></section>
      <section className="ds-card space-y-4"><h2 className="font-semibold">Thiết lập hiển thị</h2>{selectedPerson && selectedMessage && <div><label className="ds-label" htmlFor="selected-type">Loại tin</label><select id="selected-type" className="ds-select w-full" value={selectedMessage.type} onChange={(e) => updateMessage(selectedMessage.id, { type: e.target.value as ChatMessage["type"] })}>{["text", "emoji", "image", "system", "typing", "sticker", "link_preview", "voice"].map((type) => <option key={type} value={type}>{type}</option>)}</select><label className="ds-label mt-3" htmlFor="selected-reply">Trả lời tin</label><select id="selected-reply" className="ds-select w-full" value={selectedMessage.replyToId || ""} onChange={(e) => updateMessage(selectedMessage.id, { replyToId: e.target.value || undefined })}><option value="">Không trả lời</option>{chatDocument.messages.filter((m) => m.id !== selectedMessage.id).map((m) => <option key={m.id} value={m.id}>{m.text.slice(0, 40) || m.type}</option>)}</select>{selectedMessage.type === "link_preview" && <><label className="ds-label mt-3" htmlFor="link-url">URL</label><input id="link-url" className="ds-input w-full" value={selectedMessage.meta?.url || ""} onChange={(e) => updateMessage(selectedMessage.id, { meta: { ...selectedMessage.meta, url: e.target.value } })} /><label className="ds-label mt-3" htmlFor="link-title">Tiêu đề preview</label><input id="link-title" className="ds-input w-full" value={selectedMessage.meta?.title || ""} onChange={(e) => updateMessage(selectedMessage.id, { meta: { ...selectedMessage.meta, title: e.target.value } })} /></>}{selectedMessage.type === "sticker" && <><label className="ds-label mt-3" htmlFor="sticker">Sticker</label><input id="sticker" className="ds-input w-full" value={selectedMessage.meta?.sticker || ""} onChange={(e) => updateMessage(selectedMessage.id, { meta: { ...selectedMessage.meta, sticker: e.target.value } })} /></>}{selectedMessage.type === "voice" && <><label className="ds-label mt-3" htmlFor="voice-duration">Thời lượng voice</label><input id="voice-duration" className="ds-input w-full" value={selectedMessage.meta?.duration || ""} onChange={(e) => updateMessage(selectedMessage.id, { meta: { ...selectedMessage.meta, duration: e.target.value } })} /></>}<label className="ds-label mt-3" htmlFor="selected-time">Thời gian</label><input id="selected-time" className="ds-input w-full" value={selectedMessage.time} onChange={(e) => updateMessage(selectedMessage.id, { time: e.target.value })} /></div>}<label className="ds-label" htmlFor="emoji">Emoji cuộc trò chuyện</label><input id="emoji" className="ds-input w-full" value={chatDocument.theme.conversationEmoji} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, conversationEmoji: e.target.value } })} /><label className="ds-label" htmlFor="header-color">Màu header</label><input id="header-color" type="color" className="h-10 w-full" value={chatDocument.theme.headerColor} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, headerColor: e.target.value } })} /><label className="ds-label" htmlFor="outgoing-color">Màu tin nhắn bên phải</label><input id="outgoing-color" type="color" className="h-10 w-full" value={chatDocument.theme.outgoingBubbleColor} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, outgoingBubbleColor: e.target.value } })} /><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={chatDocument.theme.showAvatars} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, showAvatars: e.target.checked } })} />Hiện avatar</label><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={chatDocument.theme.showSeen} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, showSeen: e.target.checked } })} />Hiện đã xem</label><button className="text-sm text-stone-500 flex items-center gap-1" onClick={() => updateDocument({ theme: { ...defaultChatTheme } })}><X className="w-4 h-4" />Đặt lại theme</button></section>
    </div>
  </main>;
}
