import { useEffect, useState } from "react";
import { Loader2, ExternalLink, Download, FileText, Image as ImageIcon, Film } from "lucide-react";
import { Link } from "react-router-dom";
import { listRemakes } from "../services/remakes";
import { listVideos } from "../services/videos";
import type { RemakeRow, VideoProject } from "../types";
import { imageDisplayUrl } from "../services/http";

// Ba thể loại nội dung đã làm ra, tách riêng vì mỗi thứ dùng vào việc khác nhau:
// bài viết đem đăng, hình ảnh đem ghép, video đem tải lên.
//
// Gom ở client từ các danh sách sẵn có thay vì thêm endpoint tổng hợp mới: số
// lượng ở đây nhỏ (vài chục bản), và làm vậy thì không phải giữ hai nguồn sự
// thật cho cùng một dữ liệu.

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("vi-VN");
}

/** Bài viết: bản remake đã xong, có chữ để đăng. */
export function PostsTab() {
  const [rows, setRows] = useState<RemakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRemakes()
      .then((r) => setRows(r.filter((x) => x.status === "ready" && !!x.draft?.trim())))
      .catch((e) => setError(e?.message || "Không tải được danh sách."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  if (rows.length === 0) {
    return (
      <Empty
        icon={<FileText className="w-8 h-8" aria-hidden="true" />}
        title="Chưa có bài viết nào"
        desc="Bài viết xuất hiện ở đây sau khi bạn remake xong một bài."
        to="/remakes"
        cta="Sang Remake bài & ảnh"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const hasImage = !!r.selectedImageUrl;
        return (
          <li key={r.id} className="ds-card">
            <div className="ds-card-body flex gap-3">
              {hasImage ? (
                <img src={imageDisplayUrl(r.selectedImageUrl) || undefined} alt="" className="w-16 h-16 rounded-lg object-cover bg-stone-100 shrink-0" loading="lazy" />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-stone-100 shrink-0 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-stone-300" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="ds-badge">{r.format === "post" ? "Bài đăng" : "Kịch bản video"}</span>
                  {/* Nói rõ bài nào đã có ảnh: bài thiếu ảnh chưa đăng được ngay. */}
                  <span className={`ds-badge ${hasImage ? "ds-badge-success" : "ds-badge-warning"}`}>
                    {hasImage ? "có ảnh" : "chưa có ảnh"}
                  </span>
                  <span className="text-[11px] text-stone-400">{formatDate(r.createdAt)}</span>
                </div>
                <p className="text-sm text-stone-700 mt-1 line-clamp-2">{r.draft}</p>
                {r.sourceUrl && (
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-storm-600 hover:underline inline-flex items-center gap-0.5 mt-1"
                  >
                    Bài gốc <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                )}
              </div>
              <Link to={`/remakes?id=${r.id}`} className="ds-btn ds-btn-ghost ds-btn-sm shrink-0 self-start">
                Mở
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Hình ảnh: mọi ảnh đã vẽ cho các bản remake. */
export function ImagesTab() {
  const [items, setItems] = useState<{ url: string; prompt: string; remakeId: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRemakes()
      .then((rows) => {
        const all = rows.flatMap((r) =>
          (r.imagesJson || []).map((img) => ({
            url: img.url,
            prompt: img.prompt,
            remakeId: r.id,
            createdAt: img.createdAt,
          })),
        );
        all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setItems(all);
      })
      .catch((e) => setError(e?.message || "Không tải được danh sách."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  if (items.length === 0) {
    return (
      <Empty
        icon={<ImageIcon className="w-8 h-8" aria-hidden="true" />}
        title="Chưa có ảnh nào"
        desc="Ảnh xuất hiện ở đây sau khi bạn vẽ ảnh cho một bản viết."
        to="/remakes"
        cta="Sang Remake bài & ảnh"
      />
    );
  }

  return (
    <ul className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((img) => (
        <li key={img.url} className="border border-stone-200 rounded-xl overflow-hidden">
          <img src={imageDisplayUrl(img.url) || undefined} alt={img.prompt.slice(0, 60)} className="w-full aspect-square object-cover bg-stone-100" loading="lazy" />
          <div className="p-2">
            <p className="text-[11px] text-stone-500 line-clamp-2">{img.prompt}</p>
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <Link to={`/remakes?id=${img.remakeId}`} className="text-[11px] text-storm-600 hover:underline">
                Mở bài
              </Link>
              <a href={imageDisplayUrl(img.url) || img.url} download className="text-stone-400 hover:text-stone-700" title="Tải ảnh về" aria-label="Tải ảnh về">
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Video: các dự án video đã dựng. */
export function VideosTab() {
  const [rows, setRows] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVideos()
      .then(setRows)
      .catch((e) => setError(e?.message || "Không tải được danh sách."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  if (rows.length === 0) {
    return (
      <Empty
        icon={<Film className="w-8 h-8" aria-hidden="true" />}
        title="Chưa có video nào"
        desc="Video xuất hiện ở đây sau khi bạn dựng xong từ một bản viết."
        to="/videos"
        cta="Sang Remake video"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((v) => (
        <li key={v.id} className="ds-card">
          <div className="ds-card-body flex items-center gap-3">
            <div className="w-16 h-16 rounded-lg bg-stone-100 shrink-0 flex items-center justify-center">
              <Film className="w-5 h-5 text-stone-300" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-800 truncate">{v.title || "Video chưa đặt tên"}</p>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                <span className="ds-badge">{v.aspectRatio}</span>
                <span className={`ds-badge ${v.finalVideoKey ? "ds-badge-success" : "ds-badge-warning"}`}>
                  {v.finalVideoKey ? "đã ghép xong" : v.status}
                </span>
                <span className="text-[11px] text-stone-400">{formatDate(v.createdAt)}</span>
              </div>
            </div>
            <Link to={`/videos?id=${v.id}`} className="ds-btn ds-btn-ghost ds-btn-sm shrink-0">
              Mở
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Loading() {
  return (
    <div className="ds-card">
      <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div role="alert" className="ds-alert ds-alert-danger">
      {msg}
    </div>
  );
}

function Empty({
  icon,
  title,
  desc,
  to,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  to: string;
  cta: string;
}) {
  return (
    <div className="ds-card">
      <div className="ds-empty">
        <div className="ds-empty-icon">{icon}</div>
        <p className="ds-empty-title">{title}</p>
        <p className="ds-empty-desc">{desc}</p>
        <Link to={to} className="ds-btn ds-btn-primary ds-btn-sm mt-1">
          {cta}
        </Link>
      </div>
    </div>
  );
}
