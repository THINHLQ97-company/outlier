// Gộp nhiều lần quét của CÙNG một bài thành một dòng duy nhất.
//
// Một bài xuất hiện ở nhiều phiên quét, và mỗi phiên biết một phần: phiên cũ có
// số bình luận (vá từ dataset đã trả tiền), phiên mới có ảnh đã tải về máy,
// phiên khác có điểm đã chấm.
//
// Cách cũ SAI: chọn nguyên một dòng "giàu nhất" rồi vứt dòng kia. Dòng cũ đã vá
// bình luận nhưng mang nhãn "quét chay" nên bị dòng mới (có nhãn tính tiền,
// nhưng KHÔNG có bình luận) đánh bại — và bình luận biến mất khỏi màn hình dù
// database vẫn còn nguyên.
//
// Cách đúng: gộp THEO TỪNG TRƯỜNG. Dữ liệu của cùng một bài thì bổ sung cho
// nhau, không tranh nhau. Giá trị mới hơn được ưu tiên, nhưng chỉ khi nó thật
// sự có — "chưa biết" không bao giờ được đè lên "đã biết".

export interface MergeableItem {
  id: string;
  jobId: string;
  itemKey: string | null;
  url: string;
  createdAt?: Date | string | null;
  title?: string | null;
  coverUrl?: string | null;
  publishedAt?: Date | string | null;
  durationSec?: number | null;
  channelKey?: string | null;
  channelName?: string | null;
  followerCount?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  contentKind?: string;
  metricsSource?: string;
  isNew?: boolean;
  outperformScore?: number | null;
  confidence?: string;
  scoreBreakdown?: any;
  [k: string]: any;
}

/** Ảnh trong kho của mình hơn hẳn link ngoài: link ngoài có chữ ký, sẽ hết hạn. */
function betterCover(newer: string | null | undefined, older: string | null | undefined): string | null {
  const isInternal = (u?: string | null) => !!u && u.startsWith("/api/files/");
  if (isInternal(newer)) return newer!;
  if (isInternal(older)) return older!;
  return newer ?? older ?? null;
}

/**
 * Gộp các bản ghi của cùng một bài. `rows` xếp MỚI TRƯỚC.
 *
 * Trả về một dòng mang dữ liệu đầy đủ nhất có thể.
 */
export function mergeOne(rows: MergeableItem[]): MergeableItem {
  const base: MergeableItem = { ...rows[0] };

  for (const older of rows.slice(1)) {
    // Chỉ điền vào chỗ đang TRỐNG — không đè lên thứ dòng mới đã biết.
    const fillable: string[] = [
      "title",
      "publishedAt",
      "durationSec",
      "channelKey",
      "channelName",
      "followerCount",
      "views",
      "likes",
      "comments",
      "shares",
      "outperformScore",
      "scoreBreakdown",
    ];
    for (const k of fillable) {
      if (base[k] == null && older[k] != null) base[k] = older[k];
    }

    base.coverUrl = betterCover(base.coverUrl, older.coverUrl);

    // Nhãn nguồn: có lần nào lấy bằng dịch vụ tính tiền thì ghi nhận, vì số
    // liệu đang hiện có thể đến từ chính lần đó.
    if (older.metricsSource === "apify") base.metricsSource = "apify";

    // Đã từng là bài mới thì giữ nhãn — người dùng chưa xem lần nào.
    base.isNew = !!base.isNew || !!older.isNew;

    // Loại nội dung: "unknown" là chưa biết, không phải một kết luận.
    if ((!base.contentKind || base.contentKind === "unknown") && older.contentKind && older.contentKind !== "unknown") {
      base.contentKind = older.contentKind;
    }

    // Độ tin cậy: giữ mức CAO nhất từng đạt, vì nó đi kèm bộ số liệu đầy đủ nhất.
    const rank = (c?: string) => (c === "high" ? 3 : c === "medium" ? 2 : 1);
    if (rank(older.confidence) > rank(base.confidence)) base.confidence = older.confidence;
  }

  return base;
}

/** Gộp cả danh sách theo từng bài. `rows` xếp MỚI TRƯỚC. */
export function mergeChannelItems(rows: MergeableItem[]): MergeableItem[] {
  const groups = new Map<string, MergeableItem[]>();
  for (const r of rows) {
    const key = r.itemKey || r.url;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()].map(mergeOne);
}
