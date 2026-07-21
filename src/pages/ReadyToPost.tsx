import { useEffect, useState } from "react";
import { Loader2, Download, Copy, Check, ExternalLink } from "lucide-react";
import { listPosts, markPosted } from "../services/posts";
import type { PostRow } from "../types";

// ĐĂNG (J5, thủ công trong iMVP): tải ảnh cuối + copy caption → tự đăng lên
// Facebook (Page thật) → đánh dấu "Đã đăng" kèm link để tính vào lịch sử (FR6.x).
export default function ReadyToPost() {
  const [ready, setReady] = useState<PostRow[]>([]);
  const [history, setHistory] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [fbUrlDrafts, setFbUrlDrafts] = useState<Record<string, string>>({});

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [r, h] = await Promise.all([listPosts("san_sang_dang"), listPosts("da_dang")]);
      setReady(r);
      setHistory(h);
    } catch (e: any) {
      setError(e?.message || "Lỗi tải danh sách bài.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCopyCaption(post: PostRow) {
    try {
      await navigator.clipboard.writeText(post.caption || "");
      setCopiedId(post.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // clipboard API có thể bị chặn (permissions) — bỏ qua, không crash UI
    }
  }

  function handleDownload(post: PostRow) {
    if (!post.finalImageUrl) return;
    const a = document.createElement("a");
    a.href = post.finalImageUrl;
    a.download = `an-nam-voi-ai-${post.id}.png`;
    a.click();
  }

  async function handleMarkPosted(post: PostRow) {
    const fbPostUrl = (fbUrlDrafts[post.id] || "").trim();
    if (!fbPostUrl) {
      setError("Nhập link bài Facebook thật trước khi đánh dấu đã đăng (FR6.2).");
      return;
    }
    setMarkingId(post.id);
    setError(null);
    try {
      await markPosted(post.id, fbPostUrl);
      await reload();
    } catch (e: any) {
      setError(e?.message || "Đánh dấu đã đăng thất bại.");
    } finally {
      setMarkingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display">Sẵn sàng đăng</h1>
        <p className="text-sm text-stone-500">Tải ảnh + copy caption → tự đăng Facebook → đánh dấu đã đăng.</p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {ready.length === 0 ? (
        <p className="text-sm text-stone-400">Chưa có bài nào đã duyệt xong.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ready.map((p) => (
            <div key={p.id} className="bg-white border border-stone-200 rounded-xl p-4 flex gap-4">
              {p.finalImageUrl && <img src={p.finalImageUrl} alt="" className="w-28 h-28 rounded-lg object-cover bg-stone-100 shrink-0" />}
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <p className="text-sm text-stone-700 italic">"{p.caption}"</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleDownload(p)} className="flex items-center gap-1 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2.5 py-1.5 rounded-lg">
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> Tải ảnh
                  </button>
                  <button onClick={() => handleCopyCaption(p)} className="flex items-center gap-1 text-xs font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 px-2.5 py-1.5 rounded-lg">
                    {copiedId === p.id ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                    {copiedId === p.id ? "Đã copy" : "Copy caption"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    placeholder="Link bài Facebook thật sau khi đăng..."
                    value={fbUrlDrafts[p.id] || ""}
                    onChange={(e) => setFbUrlDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    className="flex-1 rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs"
                  />
                  <button
                    onClick={() => handleMarkPosted(p)}
                    disabled={markingId === p.id}
                    className="shrink-0 text-xs font-medium text-white bg-storm-700 hover:bg-storm-800 px-3 py-1.5 rounded-lg disabled:opacity-60"
                  >
                    {markingId === p.id ? "Đang lưu..." : "Đánh dấu đã đăng"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-stone-600 mb-2">Lịch sử đã đăng ({history.length})</h2>
          <div className="flex flex-col gap-2">
            {history.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-white border border-stone-200 rounded-lg p-2.5">
                {p.finalImageUrl && <img src={p.finalImageUrl} alt="" className="w-10 h-10 rounded object-cover bg-stone-100 shrink-0" />}
                <p className="text-xs text-stone-600 flex-1 truncate">{p.caption}</p>
                {p.fbPostUrl && (
                  <a href={p.fbPostUrl} target="_blank" rel="noreferrer" className="text-xs text-storm-600 hover:underline flex items-center gap-1 shrink-0">
                    Xem bài <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
