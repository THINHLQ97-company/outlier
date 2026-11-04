// Shared by manual deconstruction and Trend workflow; never fetches Apify itself.
import type { FetchedPost } from "./post-fetch";
import { readImage, imageReadingToText, type ImageReading } from "./image-read";
import { deconstructFromTranscript } from "./deconstruct";
export async function structureFetchedPost(post: FetchedPost, opts: {
  read?: (url: string) => Promise<ImageReading | null>;
  generate?: (prompt: string) => Promise<string>;
  context?: string;
} = {}) {
  const imageReading = post.thumbnailUrl ? await (opts.read || readImage)(post.thumbnailUrl) : null;
  const combined = [post.text || "", imageReading ? imageReadingToText(imageReading) : ""].filter(x => x.trim()).join("\n\n");
  const out = combined.trim().length > 40 ? await deconstructFromTranscript(combined + (opts.context ? `\n\nBỐI CẢNH TIN TỨC (không phải nội dung bài):\n${opts.context}` : ""), { title: post.title, durationSec: post.durationSec }, opts.generate) : null;
  const structure = out?.structure;
  const hasContent = !!(structure && (structure.hook3s || structure.formula || (structure.retentionBeats || []).length));
  return { structure: hasContent ? structure : null, imageReading, dropped: out?.dropped || [], warning: out?.warning,
    fields: { platform: "facebook", contentKind: post.kind, title: (post.text || imageReading?.textInImage || post.title || "").slice(0, 120),
      bodyText: post.text || null, thumbnailUrl: post.thumbnailUrl || null, imageReading,
      views: post.views ?? null, likes: post.likes ?? null, comments: post.comments ?? null, shares: post.shares ?? null,
      followerCount: post.followerCount ?? null, channelName: post.channelName ?? null, durationSec: post.durationSec ?? null,
      structure: hasContent ? structure : null, analysisMode: "transcript", analyzedBy: "apify+gemini" } };
}
