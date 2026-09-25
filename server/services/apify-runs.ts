// Lấy lại dữ liệu THÔ từ những lượt chạy Apify ĐÃ TRẢ TIỀN.
//
// Vì sao cần: Apify tính tiền lúc CHẠY, còn đọc lại dataset của lượt đã chạy thì
// miễn phí — dataset nằm trên tài khoản mình vài ngày. Nên khi phát hiện ánh xạ
// tên trường sai (số bình luận/chia sẻ về null), không nhất thiết phải quét lại
// và trả tiền lần nữa: dữ liệu đã mua vẫn còn đó, chỉ là ta đọc sai.
//
// Đây cũng là cách duy nhất biết actor THẬT SỰ trả về trường gì, thay vì đoán
// tên trường rồi đoán tiếp khi vẫn sai.
const API_BASE = "https://api.apify.com/v2";
const TIMEOUT_MS = 30_000;

function token(): string {
  const t = (process.env.APIFY_TOKEN || "").trim();
  if (!t) throw new Error("Chưa cấu hình APIFY_TOKEN.");
  return t;
}

async function apiGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface RecoveredItem {
  url: string;
  raw: any;
}

/**
 * Đọc lại các bài từ vài lượt chạy gần nhất của một actor.
 *
 * `limitRuns` nhỏ thôi: lượt càng cũ càng dễ bị Apify dọn dataset, và ta chỉ cần
 * đủ để phủ những bài đang thiếu số liệu.
 */
export async function recentRunItems(actorId: string, limitRuns = 5): Promise<RecoveredItem[]> {
  const runs = await apiGet(`acts/${encodeURIComponent(actorId)}/runs`, {
    desc: "1",
    limit: String(limitRuns),
    status: "SUCCEEDED",
  });

  const items: RecoveredItem[] = [];
  const seen = new Set<string>();
  for (const run of runs?.data?.items || []) {
    const datasetId = run?.defaultDatasetId;
    if (!datasetId) continue;
    let rows: any[] = [];
    try {
      rows = await apiGet(`datasets/${datasetId}/items`, { clean: "1", limit: "500" });
    } catch {
      // Dataset đã bị dọn — bỏ qua lượt này, đi tiếp.
      continue;
    }
    for (const r of Array.isArray(rows) ? rows : []) {
      const url = r?.url || r?.postUrl || r?.facebookUrl || r?.webVideoUrl || r?.topLevelUrl;
      if (typeof url !== "string" || seen.has(url)) continue;
      seen.add(url);
      items.push({ url, raw: r });
    }
  }
  return items;
}

/**
 * Bảng tên trường mà actor thật sự trả về, kèm mẫu giá trị.
 *
 * Để trả lời đúng một câu hỏi: "số bình luận nằm ở trường nào?" — bằng dữ liệu,
 * không bằng phỏng đoán.
 */
export function describeFields(raw: any): Record<string, { type: string; sample?: string }> {
  const out: Record<string, { type: string; sample?: string }> = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const type = Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v;
    const sample =
      typeof v === "number" ? String(v) : typeof v === "string" && v.length <= 60 ? v : undefined;
    out[k] = { type, sample };
  }
  return out;
}
