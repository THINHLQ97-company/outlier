import { useEffect } from "react";
import { X, ExternalLink, Download, ShieldCheck, ShieldAlert, Send, Copy } from "lucide-react";
import { Link } from "react-router-dom";
import { imageDisplayUrl } from "../services/http";
import type { RemakeRow } from "../types";

// Xem một bài viết cho ra hồn: ảnh đủ lớn để đọc được chữ trong ảnh, caption
// đầy đủ chứ không cắt hai dòng.
//
// Vì sao tách caption và ảnh thành hai cột: đây là hai thứ khác nhau, đăng lên
// cũng là hai phần khác nhau. Trộn vào một khối thì không biết chỗ nào sẽ thành
// caption, chỗ nào là ảnh.

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export default function PostPreviewModal({ row, onClose }: { row: RemakeRow; onClose: () => void }) {
  // Đóng bằng Esc: người dùng mở popup để xem nhanh rồi thoát, bắt họ đi tìm
  // nút đóng là thừa.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const images = row.imagesJson || [];
  const mainImage = row.selectedImageUrl || images[0]?.url || null;
  const guardrail = row.guardrailJson;
  const published = row.publishedJson || [];

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(row.draft || "");
    } catch {
      // Trình duyệt chặn thì người dùng bôi đen chép tay.
    }
  }

  return (
    <div
      className="ds-modal-overlay open"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Xem bài viết"
    >
      <div className="ds-modal !max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-stone-200">
          <div className="min-w-0">
            <h2 className="font-bold text-stone-800 truncate">{row.sourceTitle || "Bài viết"}</h2>
            <p className="text-[11px] text-stone-400">
              {row.format === "post" ? "Bài đăng" : "Kịch bản video"} · {formatDate(row.createdAt)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ds-btn ds-btn-ghost ds-btn-sm shrink-0" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="ds-modal-body max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Ảnh — đủ lớn để đọc được chữ nằm trong ảnh */}
            <div>
              <h3 className="text-xs font-semibold text-stone-700 mb-1.5">Hình ảnh</h3>
              {mainImage ? (
                <>
                  <a href={imageDisplayUrl(mainImage) || "#"} target="_blank" rel="noreferrer">
                    <img
                      src={imageDisplayUrl(mainImage) || undefined}
                      alt=""
                      className="w-full rounded-xl border border-stone-200 bg-stone-50"
                    />
                  </a>
                  {images.length > 1 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {images.map((img) => (
                        <img
                          key={img.url}
                          src={imageDisplayUrl(img.url) || undefined}
                          alt=""
                          title={img.prompt}
                          className={`w-14 h-14 rounded-lg object-cover border ${
                            img.url === row.selectedImageUrl ? "border-storm-500 ring-2 ring-storm-200" : "border-stone-200"
                          }`}
                          loading="lazy"
                        />
                      ))}
                    </div>
                  )}
                  <a
                    href={imageDisplayUrl(mainImage) || "#"}
                    download
                    className="ds-btn ds-btn-ghost ds-btn-sm mt-2"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> Tải ảnh về
                  </a>
                </>
              ) : (
                <div className="ds-empty !py-10">
                  <p className="ds-empty-desc">Bài này chưa có ảnh.</p>
                  <Link to={`/remakes?id=${row.id}`} className="ds-btn ds-btn-primary ds-btn-sm mt-1">
                    Vẽ ảnh cho bài
                  </Link>
                </div>
              )}
            </div>

            {/* Caption — đầy đủ, giữ nguyên xuống dòng */}
            <div className="flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <h3 className="text-xs font-semibold text-stone-700">Caption</h3>
                  <button type="button" onClick={copyCaption} className="ds-btn ds-btn-ghost ds-btn-sm">
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Chép
                  </button>
                </div>
                <pre className="text-sm text-stone-700 whitespace-pre-wrap font-sans bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 leading-relaxed">
                  {row.draft || "(chưa có nội dung)"}
                </pre>
              </div>

              {guardrail && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    guardrail.passed
                      ? "bg-green-50 border-green-200 text-green-900"
                      : "bg-red-50 border-red-200 text-red-900"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    {guardrail.passed ? (
                      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    {guardrail.passed ? "Không vi phạm giới hạn của thương hiệu" : `${guardrail.issues.length} vấn đề cần xem lại`}
                  </div>
                  {guardrail.issues.slice(0, 3).map((i, idx) => (
                    <p key={idx} className="mt-1">
                      · {i.message}
                    </p>
                  ))}
                  <p className="mt-1 opacity-70">
                    Trùng tối đa {guardrail.stats.maxOverlapWords} từ liên tiếp với bài gốc · {guardrail.stats.wordCount} từ
                  </p>
                </div>
              )}

              {published.length > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Send className="w-3.5 h-3.5" aria-hidden="true" /> Đã đăng
                  </div>
                  {published.map((p) => (
                    <a
                      key={p.postId}
                      href={p.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="block mt-1 hover:underline"
                    >
                      {p.pageName} · {formatDate(p.publishedAt)} <ExternalLink className="w-3 h-3 inline" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <Link to={`/remakes?id=${row.id}`} className="ds-btn ds-btn-primary ds-btn-sm">
                  Mở để sửa hoặc đăng
                </Link>
                {row.sourceUrl && (
                  <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ds-btn ds-btn-ghost ds-btn-sm"
                  >
                    Bài gốc <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
