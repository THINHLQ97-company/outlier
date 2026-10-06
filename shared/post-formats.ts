// Thể loại post khi remake — 5 nhóm TỔNG QUAN.
//
// Remake không chỉ ra ảnh cartoon: có trang sống bằng ảnh chụp đoạn chat (Ăn
// Thịt Anh Lập Trình), có lúc Gàn và Gèn nhắn tin qua lại thay vì đóng truyện
// tranh. Chỉ có một thể loại là ép mọi nội dung vào một khuôn.
//
// Cố ý chia THÔ (quyết định chủ dự án 2026-10-06, task #5990): "meme 2 nút",
// "kỳ vọng – thực tế" là CÁCH THỂ HIỆN bên trong nhóm Cartoon, không phải nhóm
// riêng. Chia nhỏ quá thì danh sách dài, khó chọn, và model phân loại lẫn lộn.
// Cách thể hiện cụ thể để model tự chọn trong từng phương án.
//
// `drawGuide` viết tiếng Anh vì đi thẳng vào lệnh vẽ của Gemini.

export type PostFormatId = "cartoon" | "chat" | "review" | "social" | "text_card";

export interface PostFormat {
  id: PostFormatId;
  /** Nhãn hiện cho người dùng. */
  label: string;
  /** Bao gồm những cách thể hiện nào — để model và người dùng hiểu ranh giới nhóm. */
  includes: string;
  /** Hợp với nội dung kiểu gì — gợi ý cho model khi chọn thể loại. */
  fitsWhen: string;
  /** Cách vẽ thể loại này — đưa thẳng vào lệnh vẽ. */
  drawGuide: string;
}

export const POST_FORMATS: PostFormat[] = [
  {
    id: "cartoon",
    label: "Cartoon",
    includes: "tranh đời thường, nhiều khung, meme, kỳ vọng – thực tế, hai nút bấm…",
    fitsWhen: "có tình huống, hành động, phản ứng, bẻ hướng bằng hình",
    drawGuide:
      "A comic / cartoon illustration. Follow the panels exactly. Characters act out the scene; any dialogue goes in speech bubbles.",
  },
  {
    id: "chat",
    label: "Tin nhắn",
    includes: "chat 2 người, nhóm chat, thông báo điện thoại",
    fitsWhen: "hỏi–đáp, cãi nhau, seen không rep, sếp nhắn lúc nửa đêm, nhắn nhầm",
    drawGuide:
      "A realistic smartphone screenshot of a messaging app (Messenger/Zalo style): chat header with the conversation name, message bubbles (sender on the left, 'me' on the right), small round avatars, timestamps. Use EXACTLY the given messages in order — no extra messages, no rewording.",
  },
  {
    id: "review",
    label: "Đánh giá",
    includes: "đánh giá Google Business, đánh giá sàn thương mại điện tử",
    fitsWhen: "chê/khen hài hước, review 1 sao, khách khó tính, chủ quán phản hồi",
    drawGuide:
      "A realistic screenshot of a Google Maps business review card: business name, star rating, reviewer name with a small avatar, review text, and (if given) the owner's reply below. Use EXACTLY the given business name, rating and texts.",
  },
  {
    id: "social",
    label: "Bình luận / mạng xã hội",
    includes: "luồng bình luận Facebook, bài đăng mạng xã hội",
    fitsWhen: "cả đám nhảy vào bàn một chuyện, bình luận lật kèo, bài đăng gây tranh cãi",
    drawGuide:
      "A realistic screenshot of a Facebook post with its comment thread: the post caption on top, then comments with small round avatars, names, comment text and like counts. Use EXACTLY the given caption and comments in order.",
  },
  {
    id: "text_card",
    label: "Thẻ chữ",
    includes: "trích dẫn, checklist, danh sách, mẹo",
    fitsWhen: "câu chốt đáng nhớ, mẹo ngắn, danh sách 'n điều', so sánh bằng chữ",
    drawGuide:
      "A clean typographic card in the page's colors: large readable Vietnamese text as the main element, simple supporting graphics. Use EXACTLY the given text.",
  },
];

const BY_ID = new Map(POST_FORMATS.map((f) => [f.id, f]));

export function postFormat(id: string | null | undefined): PostFormat {
  return BY_ID.get(id as PostFormatId) || BY_ID.get("cartoon")!;
}

export function isPostFormatId(id: unknown): id is PostFormatId {
  return typeof id === "string" && BY_ID.has(id as PostFormatId);
}

/**
 * Đổi tên loại ảnh mà bước đọc ảnh gốc trả về (image-read: meme, anh_chat,
 * infographic, anh_that, do_hoa, khac) sang nhóm thể loại.
 */
export function formatFromImageKind(kind: string | null | undefined): PostFormatId | null {
  switch ((kind || "").toLowerCase()) {
    case "anh_chat":
      return "chat";
    case "meme":
    case "do_hoa":
      return "cartoon";
    case "infographic":
      return "text_card";
    default:
      return null;
  }
}
