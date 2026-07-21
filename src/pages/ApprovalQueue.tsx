import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Clock, X, AlertTriangle } from "lucide-react";
import { listPosts, saveChecklist, approvePost, requestEdit, rejectPost } from "../services/posts";
import type { PostRow, PostStatus } from "../types";
import { CHECKLIST_ITEMS } from "../../shared/engine-data";

const SLA_HOURS = 4; // FR5.4

const COLUMNS: { status: PostStatus; label: string }[] = [
  { status: "cho_duyet", label: "Chờ duyệt" },
  { status: "sua_thoai", label: "Sửa thoại" },
  { status: "rot", label: "Rớt" },
];

function isOverSla(createdAt: string): boolean {
  const hours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  return hours > SLA_HOURS;
}

// DUYỆT (J4): kanban 3 cột. "cho_duyet" mở checklist 14 mục — phải tick hết
// mới Duyệt được (FR5.2). SLA cảnh báo nếu chờ duyệt > 4h (FR5.4).
export default function ApprovalQueue() {
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checklistPost, setChecklistPost] = useState<PostRow | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setPosts(await listPosts());
    } catch (e: any) {
      setError(e?.message || "Lỗi tải danh sách bài.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display">Duyệt bài</h1>
        <p className="text-sm text-stone-500">Checklist 14 mục (mục 5 spec) — phải tick hết mới bấm "Duyệt" được.</p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {COLUMNS.map((col) => {
            const items = posts.filter((p) => p.status === col.status);
            return (
              <div key={col.status} className="bg-stone-50 rounded-xl p-3 flex flex-col gap-2 min-h-[200px]">
                <h2 className="text-sm font-semibold text-stone-600 flex items-center justify-between">
                  {col.label} <span className="text-stone-400 font-normal">{items.length}</span>
                </h2>
                {items.length === 0 ? (
                  <p className="text-xs text-stone-400 py-4 text-center">Trống</p>
                ) : (
                  items.map((p) => {
                    const overSla = col.status === "cho_duyet" && isOverSla(p.createdAt);
                    return (
                      <button
                        key={p.id}
                        onClick={() => col.status === "cho_duyet" && setChecklistPost(p)}
                        className={`text-left bg-white border rounded-lg p-2.5 flex gap-2.5 transition-colors ${
                          col.status === "cho_duyet" ? "border-stone-200 hover:border-storm-300 cursor-pointer" : "border-stone-200"
                        }`}
                      >
                        {p.finalImageUrl && (
                          <img src={p.finalImageUrl} alt="" className="w-14 h-14 rounded-md object-cover bg-stone-100 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-stone-700 line-clamp-2">{p.caption || "(không có caption)"}</p>
                          {overSla && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                              <Clock className="w-3 h-3" aria-hidden="true" /> Quá SLA {SLA_HOURS}h
                            </span>
                          )}
                          {col.status === "rot" && p.rejectReason && (
                            <p className="text-[11px] text-red-500 mt-1 line-clamp-2">Lý do: {p.rejectReason}</p>
                          )}
                          {col.status === "sua_thoai" && (
                            <Link
                              to={`/image-studio?scriptId=${p.scriptId}`}
                              className="text-[11px] text-storm-600 hover:underline mt-1 inline-block"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Mở lại VẼ để sửa →
                            </Link>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}

      {checklistPost && (
        <ChecklistModal
          post={checklistPost}
          onClose={() => setChecklistPost(null)}
          onDone={() => {
            setChecklistPost(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ChecklistModal({ post, onClose, onDone }: { post: PostRow; onClose: () => void; onDone: () => void }) {
  const [checklist, setChecklist] = useState<Record<string, boolean>>(post.checklistJson || {});
  const [reason, setReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = CHECKLIST_ITEMS.every((item) => checklist[item.key]);

  async function persistChecklist(next: Record<string, boolean>) {
    setChecklist(next);
    try {
      await saveChecklist(post.id, next);
    } catch {
      // best-effort autosave — lỗi hiển thị khi submit hành động chính
    }
  }

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await approvePost(post.id);
      onDone();
    } catch (e: any) {
      setError(e?.message || "Duyệt bài thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestEdit() {
    setBusy(true);
    setError(null);
    try {
      await requestEdit(post.id);
      onDone();
    } catch (e: any) {
      setError(e?.message || "Chuyển sửa thoại thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!reason.trim()) {
      setError("Bắt buộc nhập lý do khi đánh dấu Rớt (FR5.3).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rejectPost(post.id, reason.trim());
      onDone();
    } catch (e: any) {
      setError(e?.message || "Đánh dấu rớt thất bại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="font-semibold text-stone-800">Checklist trước khi đăng (14 mục)</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
          <div>
            {post.finalImageUrl && <img src={post.finalImageUrl} alt="Ảnh cuối" className="w-full rounded-lg border border-stone-200" />}
            <p className="text-sm text-stone-600 italic mt-2">"{post.caption}"</p>
          </div>
          <div className="flex flex-col gap-2">
            {CHECKLIST_ITEMS.map((item) => (
              <label key={item.key} className="flex items-start gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={!!checklist[item.key]}
                  onChange={(e) => persistChecklist({ ...checklist, [item.key]: e.target.checked })}
                  className="mt-0.5 accent-storm-600"
                />
                {item.label}
              </label>
            ))}

            {!allChecked && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Phải tick hết mới bấm "Duyệt" được.
              </p>
            )}

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

            {showRejectForm ? (
              <div className="flex flex-col gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <label className="text-xs font-medium text-red-700" htmlFor="reject-reason">Lý do rớt (bắt buộc)</label>
                <textarea
                  id="reject-reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-lg border border-red-300 px-2.5 py-1.5 text-sm"
                />
                <div className="flex gap-2">
                  <button onClick={handleReject} disabled={busy} className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg py-2 disabled:opacity-60">
                    Xác nhận Rớt
                  </button>
                  <button onClick={() => setShowRejectForm(false)} className="text-xs text-stone-500 px-2">Huỷ</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleApprove}
                  disabled={busy || !allChecked}
                  className="flex-1 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
                >
                  Duyệt
                </button>
                <button
                  onClick={handleRequestEdit}
                  disabled={busy}
                  className="flex-1 bg-amber-100 hover:bg-amber-200 text-amber-800 text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
                >
                  Sửa thoại
                </button>
                <button
                  onClick={() => setShowRejectForm(true)}
                  disabled={busy}
                  className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
                >
                  Rớt
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
