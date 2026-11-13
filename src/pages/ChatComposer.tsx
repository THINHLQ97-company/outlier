import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Save, Trash2, UserPlus, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  applyPreset, createChatProject, defaultChatTheme, getChatProject, starterChatDocument,
  updateChatProject, type ChatDocument, type ChatMessage, type ChatParticipant, type ChatPlatform,
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
                  {message.type === "image" ? <div className="chat-image-placeholder">🖼️ Ảnh</div> : message.text}
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const id = searchParams.get("id"); if (!id) return; getChatProject(id).then((row) => { setProjectId(row.id); setTitle(row.title); setPlatform(row.platform); setDocument(row.document); }).catch((e) => setMessage(e.message)); }, [searchParams]);
  const selectedMessage = useMemo(() => chatDocument.messages.find((m) => m.id === selectedMessageId), [chatDocument.messages, selectedMessageId]);
  const updateDocument = (patch: Partial<ChatDocument>) => setDocument((current) => ({ ...current, ...patch }));
  const updateMessage = (id: string, patch: Partial<ChatMessage>) => updateDocument({ messages: chatDocument.messages.map((m) => m.id === id ? { ...m, ...patch } : m) });
  const updateParticipant = (id: string, patch: Partial<ChatParticipant>) => updateDocument({ participants: chatDocument.participants.map((p) => p.id === id ? { ...p, ...patch } : p) });
  const selectedPerson = selectedMessage ? chatDocument.participants.find((p) => p.id === selectedMessage.participantId) : null;

  async function save() { setSaving(true); setMessage(null); try { const row = projectId ? await updateChatProject(projectId, { title, platform, document: chatDocument, isShared: true }) : await createChatProject({ title, platform, document: chatDocument, isShared: true }); setProjectId(row.id); setMessage("Đã lưu đoạn chat."); } catch (e: any) { setMessage(e.message); } finally { setSaving(false); } }
  async function exportPng() {
    const node = exportRef.current; if (!node) return;
    const width = chatDocument.exportSettings.width; const height = chatDocument.exportSettings.height;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;">${node.innerHTML}</div></foreignObject></svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" }); const url = URL.createObjectURL(blob); const image = new Image();
    image.onload = () => { const canvas = globalThis.document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0, width, height); URL.revokeObjectURL(url); const link = globalThis.document.createElement("a"); link.download = `${title || "chat-mockup"}.png`; link.href = canvas.toDataURL("image/png"); link.click(); setMessage("Đã xuất PNG. Hãy lưu project để có thể sửa lại."); };
    image.onerror = () => { URL.revokeObjectURL(url); setMessage("Không xuất được ảnh trên trình duyệt này."); }; image.src = url;
  }

  return <main className="p-4 md:p-6 max-w-[1600px] mx-auto">
    <div className="flex flex-wrap items-center gap-3 mb-5"><div><p className="text-xs uppercase tracking-wider text-stone-500">Sản xuất</p><h1 className="text-2xl font-bold text-stone-900">Dựng đoạn chat</h1></div><input aria-label="Tên project" className="ds-input ml-auto w-56" value={title} onChange={(e) => setTitle(e.target.value)} /><select aria-label="Preset giao diện" className="ds-select" value={platform} onChange={(e) => { const next = e.target.value as ChatPlatform; setPlatform(next); setDocument(applyPreset(chatDocument, next)); }}><option value="messenger_like">Messenger-like</option><option value="zalo_like">Zalo-like</option><option value="custom">Custom</option></select><button className="ds-btn ds-btn-secondary" onClick={save} disabled={saving}><Save className="w-4 h-4" />{saving ? "Đang lưu..." : "Lưu"}</button><button className="ds-btn ds-btn-primary" onClick={exportPng}><Download className="w-4 h-4" />Xuất PNG</button></div>
    {message && <div className="ds-alert ds-alert-info mb-4" role="status">{message}</div>}
    <div className="grid xl:grid-cols-[260px_minmax(360px,560px)_320px] gap-4 items-start">
      <section className="ds-card"><div className="flex justify-between items-center mb-3"><h2 className="font-semibold">Nhân vật</h2><button className="ds-btn ds-btn-ghost !p-1" onClick={() => updateDocument({ participants: [...chatDocument.participants, newParticipant(chatDocument.participants.length + 1)] })} aria-label="Thêm nhân vật"><UserPlus className="w-4 h-4" /></button></div>{chatDocument.participants.map((person) => <div key={person.id} className="border-b border-stone-100 py-3 last:border-0 space-y-2"><input aria-label={`Tên ${person.name}`} className="ds-input w-full" value={person.displayName} onChange={(e) => updateParticipant(person.id, { displayName: e.target.value, name: e.target.value })} /><div className="flex gap-2"><input aria-label={`Biệt danh ${person.displayName}`} placeholder="Biệt danh" className="ds-input min-w-0 flex-1" value={person.nickname} onChange={(e) => updateParticipant(person.id, { nickname: e.target.value })} /><select aria-label={`Vị trí ${person.displayName}`} className="ds-select w-24" value={person.side} onChange={(e) => updateParticipant(person.id, { side: e.target.value as ChatParticipant["side"] })}><option value="left">Trái</option><option value="right">Phải</option></select></div><input aria-label={`Avatar URL ${person.displayName}`} placeholder="URL avatar (tuỳ chọn)" className="ds-input w-full text-xs" value={person.avatarUrl} onChange={(e) => updateParticipant(person.id, { avatarUrl: e.target.value })} />{chatDocument.participants.length > 2 && <button className="text-xs text-red-600" onClick={() => updateDocument({ participants: chatDocument.participants.filter((p) => p.id !== person.id), messages: chatDocument.messages.filter((m) => m.participantId !== person.id) })}>Xóa nhân vật</button>}</div>)}</section>
      <section ref={exportRef} className="min-w-0"><ChatPreview chatDocument={chatDocument} platform={platform} title={title} /><div className="ds-card mt-4"><div className="flex justify-between items-center mb-3"><h2 className="font-semibold">Dòng tin nhắn</h2><button className="ds-btn ds-btn-secondary" onClick={() => { const id = chatDocument.participants[0]?.id; if (id) updateDocument({ messages: [...chatDocument.messages, newMessage(id)] }); }}><Plus className="w-4 h-4" />Thêm tin</button></div>{chatDocument.messages.map((item) => <div key={item.id} className={`flex gap-2 items-start mb-2 ${selectedMessageId === item.id ? "ring-2 ring-indigo-200 rounded-md" : ""}`}><select aria-label="Người gửi" className="ds-select w-28 shrink-0" value={item.participantId} onChange={(e) => updateMessage(item.id, { participantId: e.target.value })}>{chatDocument.participants.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select><input aria-label="Nội dung tin nhắn" className="ds-input min-w-0 flex-1" value={item.text} onFocus={() => setSelectedMessageId(item.id)} onChange={(e) => updateMessage(item.id, { text: e.target.value })} placeholder="Nhập tin nhắn..." /><button className="ds-btn ds-btn-ghost !p-2 text-red-500" aria-label="Xóa tin nhắn" onClick={() => updateDocument({ messages: chatDocument.messages.filter((m) => m.id !== item.id) })}><Trash2 className="w-4 h-4" /></button></div>)}</div></section>
      <section className="ds-card space-y-4"><h2 className="font-semibold">Thiết lập hiển thị</h2>{selectedPerson && selectedMessage && <div><label className="ds-label" htmlFor="selected-type">Loại tin</label><select id="selected-type" className="ds-select w-full" value={selectedMessage.type} onChange={(e) => updateMessage(selectedMessage.id, { type: e.target.value as ChatMessage["type"] })}>{["text", "emoji", "image", "system", "typing"].map((type) => <option key={type} value={type}>{type}</option>)}</select><label className="ds-label mt-3" htmlFor="selected-time">Thời gian</label><input id="selected-time" className="ds-input w-full" value={selectedMessage.time} onChange={(e) => updateMessage(selectedMessage.id, { time: e.target.value })} /></div>}<label className="ds-label" htmlFor="emoji">Emoji cuộc trò chuyện</label><input id="emoji" className="ds-input w-full" value={chatDocument.theme.conversationEmoji} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, conversationEmoji: e.target.value } })} /><label className="ds-label" htmlFor="header-color">Màu header</label><input id="header-color" type="color" className="h-10 w-full" value={chatDocument.theme.headerColor} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, headerColor: e.target.value } })} /><label className="ds-label" htmlFor="outgoing-color">Màu tin nhắn bên phải</label><input id="outgoing-color" type="color" className="h-10 w-full" value={chatDocument.theme.outgoingBubbleColor} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, outgoingBubbleColor: e.target.value } })} /><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={chatDocument.theme.showAvatars} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, showAvatars: e.target.checked } })} />Hiện avatar</label><label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={chatDocument.theme.showSeen} onChange={(e) => updateDocument({ theme: { ...chatDocument.theme, showSeen: e.target.checked } })} />Hiện đã xem</label><button className="text-sm text-stone-500 flex items-center gap-1" onClick={() => updateDocument({ theme: { ...defaultChatTheme } })}><X className="w-4 h-4" />Đặt lại theme</button></section>
    </div>
  </main>;
}
