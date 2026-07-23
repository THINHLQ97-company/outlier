// RAG "ảnh đã thích" — truy hồi (retrieval) + chưng cất hồ sơ sở thích.
//
// Cơ chế (theo quyết định user 2026-07-22): RAG THẬT, KHÔNG fine-tune model.
//  1. Khi người dùng ❤️ 1 ảnh → lưu prompt + thông số + mô tả cảnh + embedding
//     (bảng rag_examples). owner/isShared: riêng mình hoặc chia sẻ team.
//  2. Khi tạo ảnh mới có BẬT RAG → embed mô tả cảnh mới, tính cosine với các ví dụ
//     "nhìn thấy được" (của mình + shared), lấy top-K giống nhất, KÈM hồ sơ sở
//     thích đã chưng cất → chèn dạng TEXT vào prompt (không đính ảnh — theo quyết
//     định "chỉ prompt + thông số"). Không cạnh tranh ngân sách ảnh nhân vật.
//  3. "Thông minh hơn" = chưng cất hồ sơ: LLM đọc các ví dụ đã thích → tóm tắt gu
//     (phong cách/nền/bố cục hay chọn, mô-típ hài...) → lưu rag_profiles.
//
// Thiếu GEMINI_API_KEY / lỗi embed → bỏ qua RAG êm (không chèn gì), KHÔNG crash.
import { and, desc, eq, or } from "drizzle-orm";
import { ragExamples, ragProfiles } from "../db/schema";
import { embedTextGemini, generateTextGemini } from "./gemini-direct";

const TOP_K = 3;

function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Gom mô tả cảnh + thông số của 1 ví dụ thành 1 dòng text để embed / hiển thị.
export function ragExampleToText(ex: {
  scene?: string | null;
  paramsJson?: Record<string, any> | null;
}): string {
  const p = ex.paramsJson || {};
  const bits: string[] = [];
  if (ex.scene) bits.push(`Cảnh: ${ex.scene}`);
  if (p.styleName) bits.push(`Phong cách: ${p.styleName}`);
  if (Array.isArray(p.characters) && p.characters.length) bits.push(`Nhân vật: ${p.characters.join(", ")}`);
  if (p.background) bits.push(`Nền: ${p.background}`);
  if (p.panelLayout) bits.push(`Bố cục: ${p.panelLayout}`);
  return bits.join(" | ");
}

// Truy hồi top-K ví dụ đã thích giống mô tả cảnh mới nhất. scope "cả hai":
// của owner HOẶC isShared. Trả [] nếu không có key/không ví dụ/lỗi (bỏ qua êm).
export async function retrieveRagExamples(
  db: any,
  owner: string,
  sceneText: string,
  k: number = TOP_K
): Promise<{ scene: string | null; paramsJson: Record<string, any>; score: number }[]> {
  const query = (sceneText || "").trim();
  if (!query) return [];
  let queryVec: number[];
  try {
    queryVec = await embedTextGemini(query);
  } catch (e: any) {
    console.warn(`[rag] embed query lỗi (${e?.message || e}) — bỏ qua RAG.`);
    return [];
  }
  const rows = await db
    .select()
    .from(ragExamples)
    .where(or(eq(ragExamples.owner, owner), eq(ragExamples.isShared, true)))
    .orderBy(desc(ragExamples.createdAt))
    .limit(200);

  const scored = rows
    .filter((r: any) => Array.isArray(r.embedding) && r.embedding.length)
    .map((r: any) => ({
      scene: r.scene,
      paramsJson: (r.paramsJson as Record<string, any>) || {},
      score: cosineSim(queryVec, r.embedding),
    }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, k);
  return scored;
}

// Dựng khối text "gu đã học" để chèn vào prompt (hồ sơ + vài ví dụ giống nhất).
export function buildRagGuidance(
  examples: { scene: string | null; paramsJson: Record<string, any> }[],
  profileText: string | null
): string {
  const parts: string[] = [];
  if (profileText && profileText.trim()) parts.push(`Preference profile (the creator's taste): ${profileText.trim()}`);
  if (examples.length) {
    const lines = examples.map((ex, i) => `  ${i + 1}. ${ragExampleToText(ex)}`).join("\n");
    parts.push(`Past images the creator loved (match this taste — composition, style, humor tone; do NOT copy verbatim):\n${lines}`);
  }
  return parts.join("\n");
}

// Đọc hồ sơ sở thích đã lưu (nếu có).
export async function getRagProfile(db: any, owner: string): Promise<string | null> {
  const [row] = await db.select().from(ragProfiles).where(eq(ragProfiles.owner, owner));
  return row?.profileText || null;
}

// Chưng cất lại hồ sơ sở thích từ các ví dụ owner nhìn thấy (của mình + shared).
// Gọi khi người dùng bấm "Cập nhật hồ sơ RAG". Thiếu key/không ví dụ → xoá/không đổi.
export async function rebuildRagProfile(
  db: any,
  owner: string
): Promise<{ profileText: string | null; exampleCount: number }> {
  const rows = await db
    .select()
    .from(ragExamples)
    .where(or(eq(ragExamples.owner, owner), eq(ragExamples.isShared, true)))
    .orderBy(desc(ragExamples.createdAt))
    .limit(60);

  const exampleCount = rows.length;
  if (!exampleCount) {
    await upsertProfile(db, owner, null, 0);
    return { profileText: null, exampleCount: 0 };
  }

  const corpus = rows.map((r: any, i: number) => `${i + 1}. ${ragExampleToText(r)}`).join("\n");
  const prompt = `Bạn là trợ lý phân tích gu sáng tạo cho 1 fanpage giải trí. Dưới đây là các ảnh comic mà người sáng tạo ĐÃ THÍCH (thả tim). Hãy chưng cất thành 1 "hồ sơ sở thích" NGẮN (tối đa 5 câu, tiếng Việt) mô tả gu chung: phong cách vẽ hay chọn, kiểu nền, bố cục, tông hài, mô-típ nhân vật thường dùng. Chỉ nêu quy luật rõ ràng, KHÔNG bịa. Trả về JSON { "profile": "<hồ sơ>" }.

Danh sách ảnh đã thích:
${corpus}`;

  let profileText: string | null = null;
  try {
    const text = await generateTextGemini(prompt);
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    profileText = typeof parsed?.profile === "string" ? parsed.profile.trim() : null;
  } catch (e: any) {
    console.warn(`[rag] chưng cất hồ sơ lỗi (${e?.message || e}).`);
    // Fallback không cần LLM: liệt kê phong cách hay gặp.
    const styleCount = new Map<string, number>();
    for (const r of rows) {
      const s = (r.paramsJson as any)?.styleName;
      if (s) styleCount.set(s, (styleCount.get(s) || 0) + 1);
    }
    const top = [...styleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
    profileText = top.length ? `Hay chọn phong cách: ${top.join(", ")}.` : null;
  }

  await upsertProfile(db, owner, profileText, exampleCount);
  return { profileText, exampleCount };
}

async function upsertProfile(db: any, owner: string, profileText: string | null, exampleCount: number) {
  await db
    .insert(ragProfiles)
    .values({ owner, profileText, exampleCount })
    .onConflictDoUpdate({
      target: ragProfiles.owner,
      set: { profileText, exampleCount, updatedAt: new Date() },
    });
}
