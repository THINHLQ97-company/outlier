// Object storage abstraction — ported từ share-projects/marcow-crop/server/storage.ts
// (pattern y hệt production). Phase iMVP chỉ dùng cho ảnh reference của nhân
// vật ("Nhân vật" CRUD), ghi dưới UPLOAD_DIR (env, default /data/uploads).
// StorageDriver cho phép đổi sang MinIO/S3 sau này mà không cần sửa call site.
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(): Promise<{ key: string; size: number }[]>;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/data/uploads";

// Namespace hợp lệ cho key: "characters" (ảnh reference nhân vật), "posts"
// (ảnh biến thể + ảnh cuối bài viết — thay cho việc nhét base64 vào Postgres),
// "misc" (dự phòng).
export const KEY_PREFIXES = ["characters", "posts", "assets", "styles", "videos", "remakes", "deconstruct", "misc"] as const;
export type KeyPrefix = (typeof KEY_PREFIXES)[number];

class FsDriver implements StorageDriver {
  constructor(private root: string) {}

  // Resolve a key to an absolute path, refusing path traversal.
  private resolve(key: string): string {
    const safe = path.posix.normalize(key);
    if (safe.startsWith("..") || safe.includes("../") || path.isAbsolute(safe)) {
      throw new Error("Invalid storage key");
    }
    return path.join(this.root, safe);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }
  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
  async list(): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    const walk = async (dir: string, base: string) => {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // nothing uploaded yet — UPLOAD_DIR may not exist
      }
      for (const entry of entries) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs, rel);
        } else if (entry.isFile()) {
          const stat = await fs.stat(abs);
          out.push({ key: rel, size: stat.size });
        }
      }
    };
    await walk(this.root, "");
    return out;
  }
}

// Postgres-backed driver — lưu bytes (base64) trong bảng `files`. BỀN qua
// redeploy vì Postgres là service riêng có volume (khác filesystem container bị
// xoá mỗi lần build lại). Dùng cho môi trường Coolify không có volume bền cho
// UPLOAD_DIR. Chỉ hoạt động khi DATABASE_URL đã cấu hình (mọi call site đã guard
// dbDown trước khi ghi/đọc file).
class PgDriver implements StorageDriver {
  private async db() {
    const { getDb } = await import("./db/client");
    const { files } = await import("./db/schema");
    return { db: getDb(), files };
  }
  async put(key: string, data: Buffer): Promise<void> {
    const { db, files } = await this.db();
    const row = {
      key,
      mimeType: contentTypeForKey(key),
      dataBase64: data.toString("base64"),
      size: data.length,
    };
    await db
      .insert(files)
      .values(row)
      .onConflictDoUpdate({ target: files.key, set: { dataBase64: row.dataBase64, mimeType: row.mimeType, size: row.size } });
  }
  async get(key: string): Promise<Buffer> {
    const { db, files } = await this.db();
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(files).where(eq(files.key, key));
    if (!row) throw new Error(`File not found: ${key}`);
    return Buffer.from(row.dataBase64, "base64");
  }
  async delete(key: string): Promise<void> {
    const { db, files } = await this.db();
    const { eq } = await import("drizzle-orm");
    await db.delete(files).where(eq(files.key, key));
  }
  async exists(key: string): Promise<boolean> {
    const { db, files } = await this.db();
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select({ key: files.key }).from(files).where(eq(files.key, key));
    return !!row;
  }
  async list(): Promise<{ key: string; size: number }[]> {
    const { db, files } = await this.db();
    const rows = await db.select({ key: files.key, size: files.size }).from(files);
    return rows.map((r) => ({ key: r.key, size: r.size }));
  }
}

// FsDriver giữ lại (dùng khi STORAGE_DRIVER=fs + có volume bền). Mặc định PgDriver
// để không mất ảnh trên Coolify (không có volume bền cho UPLOAD_DIR).
export const storage: StorageDriver =
  process.env.STORAGE_DRIVER === "fs" ? new FsDriver(UPLOAD_DIR) : new PgDriver();

// Build a fresh namespaced key, e.g. newKey("characters", "png").
export function newKey(prefix: KeyPrefix, ext: string): string {
  const clean = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${prefix}/${crypto.randomUUID()}.${clean}`;
}

// Map a file extension to a content-type for serving.
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() || "";
  return MIME[ext] || "application/octet-stream";
}

// Parse a data URL (data:image/png;base64,XXXX) → { ext, buffer }.
export function parseDataUrl(dataUrl: string): { ext: string; buffer: Buffer } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const subtype = m[1].split("/")[1].toLowerCase();
  const ext = subtype === "jpeg" ? "jpg" : subtype;
  return { ext, buffer: Buffer.from(m[2], "base64") };
}

// Lưu 1 data URL ảnh (base64) vào storage nội bộ, trả về "/api/files/<key>".
// null nếu không parse được (không phải data:image base64) — caller giữ
// nguyên giá trị gốc. Dùng để thôi nhét base64 ảnh vào Postgres (ảnh biến thể
// + ảnh cuối bài viết), giảm phình DB + cho phép browser cache qua /api/files.
export async function persistDataUrl(prefix: KeyPrefix, dataUrl: string): Promise<string | null> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const key = newKey(prefix, parsed.ext);
  await storage.put(key, parsed.buffer);
  return `/api/files/${key}`;
}

// "/api/files/<key>" → "<key>" nếu referenceImageUrl trỏ vào storage nội bộ,
// null nếu đó là URL ngoài (không phải file do app này quản lý) — dùng khi
// cần xoá ảnh cũ trước khi ghi ảnh mới (xem server/routes/characters.routes.ts).
export function internalKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^\/api\/files\/(.+)$/.exec(url);
  return m ? m[1] : null;
}

/**
 * Bản cài đặt này có phục vụ được ảnh ở url đó không.
 *
 * Ba kiểu "không": trỏ vào file nội bộ đã mất, trỏ ra máy chủ cũ (đường dẫn
 * kiểu cũ như /uploads/... hoặc http tới host cũ), hoặc rỗng. Cả ba đều cho ra
 * một ô ảnh vỡ như nhau, nên đối xử như nhau: coi là ảnh đã mất, và cho dọn.
 *
 * Phân biệt được điều này mới hết cảnh "ảnh hỏng mà không ai xoá được": trước
 * đây chỉ kiểm file nội bộ, nên đường dẫn kiểu cũ bị coi là vẫn tốt.
 */
export async function imageIsServable(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  if (url.startsWith("data:")) return true;
  const key = internalKeyFromUrl(url);
  if (!key) return false; // đường dẫn ngoài/kiểu cũ — deployment này không phục vụ được
  return storage.exists(key);
}

// Đọc ảnh reference (referenceImageUrl trỏ vào storage nội bộ) thành inline data
// { mimeType, data(base64) } — đúng shape @google/genai cần cho image-to-image.
// URL ngoài / thiếu / lỗi đọc → null (bỏ qua, không chặn sinh ảnh). Dùng để
// đính ảnh nhân vật khi VẼ, giữ nhất quán ngoại hình (mục 2.4 v3.md).
export async function readImageAsInlineData(
  url: string | null | undefined
): Promise<{ mimeType: string; data: string } | null> {
  const key = internalKeyFromUrl(url);
  if (!key) return null;
  try {
    const buf = await storage.get(key);
    return { mimeType: contentTypeForKey(key), data: buf.toString("base64") };
  } catch {
    return null;
  }
}
