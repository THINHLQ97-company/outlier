// "AI viết kịch bản hài" — biến 1 Ý TƯỞNG thô (chủ đề / tin tức) thành 3 KỊCH
// BẢN comic cụ thể dùng dàn nhân vật cố định + công thức hài của fanpage. Mỗi
// kịch bản gồm: bối cảnh trực quan (để hoạ sĩ vẽ được), nhân vật xuất hiện, lời
// thoại gắn đúng nhân vật. Kết quả điền thẳng vào form Studio (mô tả + nhân vật
// + lời thoại) → người dùng chỉnh rồi tạo ảnh.
//
// Đây là bước còn thiếu: trước đây "Đưa sang Sáng tạo" chỉ copy nguyên văn tin
// tức vào ô mô tả — model không hiểu cần vẽ gì. Nay AI dựng cảnh hài cụ thể.
import { generateTextGemini } from "./gemini-direct";

export interface ScenarioVariant {
  title: string;
  scene: string; // mô tả cảnh tiếng Việt, cụ thể (có thể gồm 2 khung)
  characters: string[]; // tên nhân vật xuất hiện (khớp dàn cố định)
  dialogue: { character: string; text: string }[];
  panelLayout: string; // "1" | "2"
}

export interface ScenarioResult {
  variants: ScenarioVariant[];
  isDemo: boolean;
  warning?: string;
}

interface CastMember {
  name: string;
  kind: string;
  personality?: string | null;
  catchphrase?: string | null;
}

function demoScenarios(idea: string): ScenarioVariant[] {
  const short = idea.length > 80 ? `${idea.slice(0, 77)}...` : idea;
  return [
    {
      title: "Phương án mẫu (demo)",
      scene: `[DEMO — chưa cấu hình GEMINI_API_KEY] Dựng 1 cảnh hài quanh ý tưởng: ${short}. Chọn nhân vật + viết lời thoại thủ công.`,
      characters: [],
      dialogue: [],
      panelLayout: "1",
    },
  ];
}

export async function writeScenarios(input: {
  idea: string;
  cast: CastMember[];
  characterHints?: string[]; // tên nhân vật ưu tiên
}): Promise<ScenarioResult> {
  const idea = (input.idea || "").trim();
  if (!idea) return { variants: [], isDemo: false };

  if (!process.env.GEMINI_API_KEY) {
    const warning = "GEMINI_API_KEY chưa cấu hình — trả về kịch bản mẫu (demo).";
    console.warn(`[scenario-writer] ${warning}`);
    return { variants: demoScenarios(idea), isDemo: true, warning };
  }

  const castLines = input.cast
    .map((c) => {
      const cp = c.catchphrase ? ` Câu cửa miệng: "${c.catchphrase}".` : "";
      return `- ${c.name} (${c.kind}): ${c.personality || "(chưa có mô tả tính cách)"}.${cp}`;
    })
    .join("\n");
  const hints = input.characterHints?.length ? `\nƯU TIÊN dùng các nhân vật: ${input.characterHints.join(", ")}.` : "";

  const prompt = `Bạn là biên kịch hài cho fanpage Facebook "Ăn Nằm Với AI" của Mắt Bão. Từ một Ý TƯỞNG thô (chủ đề hoặc tin tức), viết 3 KỊCH BẢN comic hài KHÁC NHAU. CHỈ dùng dàn nhân vật cố định dưới đây, giữ ĐÚNG tính cách từng nhân vật.

DÀN NHÂN VẬT CỐ ĐỊNH:
${castLines}

Ý TƯỞNG: ${idea}${hints}

QUY TẮC:
- Mỗi kịch bản chọn 1-3 nhân vật HỢP với ý tưởng (đúng tính cách để tạo tình huống buồn cười).
- Bối cảnh phải CỤ THỂ, TRỰC QUAN (khung cảnh ở đâu, nhân vật đang làm gì, biểu cảm ra sao, có gì trên màn hình/bàn) để hoạ sĩ vẽ được — TUYỆT ĐỐI không mô tả chung chung.
- Công thức hài: người thắng, AI thua; câu chốt bất ngờ; càng cụ thể (giờ giấc, mã lỗi, con số thật) càng buồn cười.
- Tối đa 2 khung. Lời thoại NGẮN gọn, đúng giọng từng nhân vật, gắn đúng người nói.
- 3 kịch bản phải khác nhau về góc nhìn hoặc nhân vật.

Chỉ trả về DUY NHẤT một JSON array gồm 3 phần tử, KHÔNG kèm giải thích:
[
  {
    "title": "tựa ngắn",
    "scene": "mô tả cảnh tiếng Việt, cụ thể, trực quan (nếu 2 khung thì mô tả cả 2)",
    "characters": ["tên nhân vật xuất hiện, đúng tên trong dàn"],
    "dialogue": [{"character": "tên nhân vật", "text": "lời thoại ngắn"}],
    "panelLayout": "1 hoặc 2"
  }
]`;

  try {
    const text = await generateTextGemini(prompt);
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("Phản hồi không đúng JSON array.");
    const castNames = new Set(input.cast.map((c) => c.name));
    const variants: ScenarioVariant[] = arr.slice(0, 3).map((v: any, i: number) => {
      const characters = Array.isArray(v.characters) ? v.characters.filter((n: any) => typeof n === "string" && castNames.has(n)) : [];
      const dialogue = Array.isArray(v.dialogue)
        ? v.dialogue
            .filter((d: any) => d && typeof d.text === "string" && d.text.trim())
            .map((d: any) => ({ character: castNames.has(d.character) ? d.character : characters[0] || "", text: String(d.text).trim() }))
        : [];
      const layout = v.panelLayout === "2" || v.panelLayout === 2 ? "2" : "1";
      return {
        title: typeof v.title === "string" && v.title.trim() ? v.title.trim() : `Phương án ${i + 1}`,
        scene: typeof v.scene === "string" ? v.scene.trim() : "",
        characters,
        dialogue,
        panelLayout: layout,
      };
    });
    return { variants, isDemo: false };
  } catch (e: any) {
    const warning = `Viết kịch bản thất bại (${e?.message || e}) — trả về kịch bản mẫu (demo).`;
    console.warn(`[scenario-writer] ${warning}`);
    return { variants: demoScenarios(idea), isDemo: true, warning };
  }
}
