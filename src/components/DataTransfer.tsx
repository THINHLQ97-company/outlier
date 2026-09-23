import { useState } from "react";
import { Loader2, Download, Upload, Database } from "lucide-react";
import { authHeaders } from "../services/http";

// Chuyển dữ liệu giữa hai bản cài (Coolify → Vibe Host).
//
// Vì sao phải đi qua trình duyệt của người dùng: hai database đều đóng, không
// bản nào cho lấy chuỗi kết nối, và bản Coolify nằm sau Traefik nội bộ nên chỉ
// máy trong mạng Mắt Bão gọi được. Người dùng thì vào được cả hai — nên họ tải
// file ở bản này rồi nạp vào bản kia.
//
// Ảnh nằm trong bảng `files` dưới dạng base64, nên gói xuất ra gồm luôn thư
// viện ảnh và ảnh nhân vật. Đổi lại là file khá nặng.

interface TableCounts {
  [table: string]: number;
}

const TABLE_LABEL: Record<string, string> = {
  characters: "Nhân vật",
  styles: "Phong cách",
  brands: "Thương hiệu",
  brand_sources: "Tài liệu thương hiệu",
  brand_fanpages: "Trang của thương hiệu",
  signals: "Tín hiệu",
  posts: "Bài đăng",
  assets: "Tài nguyên",
  watched_channels: "Kênh theo dõi",
  radar_jobs: "Phiên quét Radar",
  radar_items: "Kết quả Radar",
  deconstructions: "Bản bóc cấu trúc",
  remakes: "Bản viết lại",
  video_projects: "Dự án video",
  files: "Tệp (ảnh)",
};

export default function DataTransfer() {
  const [counts, setCounts] = useState<TableCounts | null>(null);
  const [busy, setBusy] = useState<"summary" | "export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function loadSummary() {
    setBusy("summary");
    setError(null);
    try {
      const res = await fetch("/api/admin/transfer/summary", { headers: authHeaders(false) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Không đếm được dữ liệu.");
      setCounts((await res.json()).tables);
    } catch (e: any) {
      setError(e?.message || "Không đếm được dữ liệu.");
    } finally {
      setBusy(null);
    }
  }

  async function handleExport(withFiles: boolean) {
    setBusy("export");
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/transfer/export?withFiles=${withFiles ? 1 : 0}`, {
        headers: authHeaders(false),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Không xuất được dữ liệu.");
      const blob = await res.blob();
      // Tải về bằng link tạm: dữ liệu đã nằm trong bộ nhớ trình duyệt, không cần
      // gọi lại server lần nữa (gói có ảnh thì khá nặng).
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outlier-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setResult(`Đã tải về ${(blob.size / 1024 / 1024).toFixed(1)} MB.`);
    } catch (e: any) {
      setError(e?.message || "Không xuất được dữ liệu.");
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(file: File) {
    setBusy("import");
    setError(null);
    setResult(null);
    try {
      const parsed = JSON.parse(await file.text());
      const tables: Record<string, any[]> = parsed?.tables || {};
      const names = Object.keys(tables);
      if (names.length === 0) throw new Error("File không có dữ liệu nào đọc được.");

      // Nạp từng bảng một, theo đúng thứ tự trong file: bảng được tham chiếu
      // nằm trước bảng tham chiếu nó, nạp ngược lại là khoá ngoại chặn.
      const lines: string[] = [];
      for (const name of names) {
        const rows = tables[name];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const res = await fetch("/api/admin/transfer/import", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ table: name, rows }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          lines.push(`${TABLE_LABEL[name] || name}: LỖI — ${out.error || res.statusText}`);
          continue;
        }
        lines.push(
          `${TABLE_LABEL[name] || name}: nhận ${out.received}, thêm mới ${out.inserted}` +
            (out.skipped ? `, đã có sẵn ${out.skipped}` : "") +
            (out.failed ? `, hỏng ${out.failed}` : ""),
        );
      }
      setResult(lines.join("\n"));
    } catch (e: any) {
      setError(e?.message || "Không nạp được dữ liệu.");
    } finally {
      setBusy(null);
    }
  }

  const nonEmpty = counts ? Object.entries(counts).filter(([, n]) => n > 0) : [];

  return (
    <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-storm-500" aria-hidden="true" />
          <h3 className="font-bold text-stone-800">Chuyển dữ liệu giữa hai bản cài</h3>
        </div>
        <p className="text-xs text-stone-400 mt-1">
          Tải dữ liệu ở bản này về máy, rồi nạp vào bản kia. Ảnh nằm trong cơ sở dữ liệu nên gói xuất ra
          gồm cả thư viện ảnh và ảnh nhân vật — đổi lại là file khá nặng. Tài khoản đăng nhập
          <strong> không </strong>được mang đi.
        </p>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button type="button" onClick={loadSummary} disabled={busy !== null} className="ds-btn ds-btn-secondary ds-btn-sm">
            {busy === "summary" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
            Xem có gì
          </button>
          <button type="button" onClick={() => handleExport(true)} disabled={busy !== null} className="ds-btn ds-btn-primary ds-btn-sm">
            {busy === "export" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Tải dữ liệu về (kèm ảnh)
          </button>
          <button type="button" onClick={() => handleExport(false)} disabled={busy !== null} className="ds-btn ds-btn-ghost ds-btn-sm">
            Tải riêng phần chữ
          </button>

          <label className="ds-btn ds-btn-secondary ds-btn-sm cursor-pointer">
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            {busy === "import" ? "Đang nạp…" : "Nạp file vào bản này"}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Xoá giá trị để chọn lại đúng file đó lần nữa vẫn kích hoạt.
                e.target.value = "";
                if (f) handleImport(f);
              }}
            />
          </label>
        </div>

        {busy === "export" && (
          <p className="text-xs text-stone-400 mt-2">Đang gom dữ liệu, gói có ảnh thì mất một lúc…</p>
        )}

        {error && (
          <div role="alert" className="ds-alert ds-alert-danger mt-3">
            {error}
          </div>
        )}

        {result && (
          <pre className="text-xs text-stone-600 mt-3 whitespace-pre-wrap bg-stone-50 rounded-lg p-3">{result}</pre>
        )}

        {counts && (
          <div className="mt-3">
            {nonEmpty.length === 0 ? (
              <p className="text-xs text-stone-400">Bản này chưa có dữ liệu nào.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {nonEmpty.map(([name, n]) => (
                  <li key={name} className="ds-badge">
                    {TABLE_LABEL[name] || name}: {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
