// Nhìn đường dẫn là biết nền tảng nào và là BÀI hay là TRANG.
//
// Vì sao đáng làm: bắt người dùng tự tick nền tảng trong khi đường dẫn đã nói rõ
// là bắt khai lại thứ máy đọc được — và tick sai thì quét trượt, vẫn tốn tiền.
// Chuyện "bài hay trang" cũng vậy: một bài thì chỉ có một bài để lấy, hỏi "muốn
// quét bao nhiêu bài" là câu hỏi vô nghĩa.
//
// Dùng chung client + server: giao diện đoán để hiện ngay cho người dùng thấy,
// server đoán lại để không tin dữ liệu gửi lên.

export type UrlPlatform = "facebook" | "youtube" | "tiktok" | "instagram" | "douyin";
export type UrlKind = "post" | "channel";

export interface UrlInfo {
  platform: UrlPlatform | null;
  kind: UrlKind | null;
  /** Câu giải thích ngắn để hiện cho người dùng. */
  label: string;
}

const PLATFORM_LABEL: Record<UrlPlatform, string> = {
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  douyin: "Douyin",
};

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function platformOf(host: string): UrlPlatform | null {
  if (/(^|\.)facebook\.com$|(^|\.)fb\.watch$|(^|\.)fb\.com$/.test(host)) return "facebook";
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) return "youtube";
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/.test(host)) return "douyin";
  return null;
}

/** Đường dẫn này trỏ tới MỘT bài, hay tới cả trang/kênh? */
function kindOf(platform: UrlPlatform, url: string): UrlKind | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const path = u.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);

  switch (platform) {
    case "youtube": {
      if (u.hostname.replace(/^www\./, "").toLowerCase() === "youtu.be") return parts.length ? "post" : null;
      if (path === "/watch" && u.searchParams.get("v")) return "post";
      if (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") return "post";
      if (parts[0]?.startsWith("@") || ["channel", "c", "user"].includes(parts[0] || "")) return "channel";
      return null;
    }
    case "facebook": {
      // Bài: .../posts/..., /photos/, /videos/, /reel/, permalink.php, story.php, /share/p/
      if (parts.some((p) => ["posts", "photos", "videos", "reel", "reels", "permalink.php", "story.php"].includes(p))) {
        return "post";
      }
      if (parts[0] === "share" && (parts[1] === "p" || parts[1] === "v" || parts[1] === "r")) return "post";
      if (parts[0] === "watch" && u.searchParams.get("v")) return "post";
      if (parts[0] === "profile.php" && u.searchParams.get("id")) return "channel";
      // .../pages/Tên/123 hoặc .../<handle>
      if (parts[0] === "pages") return "channel";
      if (parts.length === 1) return "channel";
      return null;
    }
    case "tiktok": {
      if (parts.includes("video") || parts.includes("photo")) return "post";
      if (parts[0]?.startsWith("@")) return "channel";
      return null;
    }
    case "instagram": {
      if (["p", "reel", "reels", "tv"].includes(parts[0] || "")) return "post";
      if (parts.length === 1) return "channel";
      return null;
    }
    case "douyin": {
      if (parts[0] === "video") return "post";
      if (parts[0] === "user") return "channel";
      return null;
    }
  }
}

export function inspectUrl(url: string): UrlInfo {
  const host = hostOf(url);
  if (!host) return { platform: null, kind: null, label: "Chưa phải một đường dẫn hợp lệ." };

  const platform = platformOf(host);
  if (!platform) {
    return { platform: null, kind: null, label: `Chưa hỗ trợ ${host} — dùng link Facebook, YouTube, TikTok, Instagram hoặc Douyin.` };
  }

  const kind = kindOf(platform, url);
  const name = PLATFORM_LABEL[platform];
  if (kind === "post") return { platform, kind, label: `${name} — một bài viết` };
  if (kind === "channel") return { platform, kind, label: `${name} — cả trang/kênh` };
  return { platform, kind: null, label: `${name} — chưa rõ là bài hay trang, kiểm tra lại đường dẫn.` };
}
