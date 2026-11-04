import { assertPublicUrl } from "./brand-ingest";
import { inspectUrl } from "../../shared/url-kind";

/** Chỉ link MỘT bài; không biến đường này thành công cụ tìm bài/quét trang. */
export function facebookPostUrl(raw: string): string | null {
  try {
    const u = assertPublicUrl(raw);
    if (u.username || u.password || !/(^|\.)facebook\.com$|(^|\.)fb\.watch$/.test(u.hostname)) return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/.test(k)) u.searchParams.delete(k);
    const p = u.pathname.split("/").filter(Boolean);
    const watch = /(^|\.)fb\.watch$/.test(u.hostname) && p.length === 1;
    const concrete = p.some((x, i) => ["posts", "photos", "videos", "reel", "reels"].includes(x) && !!p[i + 1]) ||
      ["permalink.php", "story.php"].includes(p[0]) && !!u.searchParams.get("story_fbid") ||
      ["photo", "photo.php"].includes(p[0]) && !!u.searchParams.get("fbid") ||
      p[0] === "share" && ["p", "v", "r"].includes(p[1]) && !!p[2] ||
      p[0] === "watch" && !!u.searchParams.get("v");
    if (!watch && !(concrete && (inspectUrl(u.toString()).kind === "post" || ["photo", "photo.php"].includes(p[0])))) return null;
    return u.toString();
  } catch { return null; }
}

