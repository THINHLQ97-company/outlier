import { ExternalLink, Search, Newspaper } from "lucide-react";
import GoogleTrendsMark from "./GoogleTrendsMark";
import type { SignalSourceMeta } from "../types";

// Hiển thị một xu hướng Google Trends.
//
// Trước đây mọi thứ bị nhồi vào một chuỗi rồi in ra thành khối chữ dày đặc kèm
// đường dẫn trần — nhìn thì có dữ liệu nhưng không đọc nổi, và không bấm được.
// Giờ mỗi thứ về đúng chỗ của nó: lượng tìm kiếm là một con số nổi bật, mỗi tin
// là một dòng bấm được có tên báo.

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default function TrendNewsList({ meta }: { meta: SignalSourceMeta }) {
  const news = meta.news || [];

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-600 bg-stone-50 border border-stone-200 rounded-full pl-1.5 pr-2.5 py-1">
          <GoogleTrendsMark className="w-3.5 h-3.5" />
          Google Trends
          {meta.geo && <span className="text-stone-400">· {meta.geo}</span>}
        </span>

        {meta.approxTraffic && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-storm-700 bg-storm-50 border border-storm-200 rounded-full px-2.5 py-1">
            <Search className="w-3 h-3" aria-hidden="true" />
            {meta.approxTraffic} lượt tìm
          </span>
        )}
      </div>

      {news.length === 0 ? (
        // Nói rõ là chưa có, kèm việc cần làm — thay vì để một khoảng trống khó hiểu.
        <p className="text-xs text-stone-400 mt-2">
          Google chưa gắn tin nào cho từ khoá này. Cần tự tìm hiểu chuyện gì đang xảy ra trước khi quyết có đu hay không.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-stone-100 border border-stone-200 rounded-lg overflow-hidden">
          {news.map((n) => (
            <li key={n.url}>
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 px-2.5 py-2 hover:bg-stone-50 transition-colors group"
              >
                <Newspaper className="w-3.5 h-3.5 text-stone-400 mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-stone-700 group-hover:text-storm-700 leading-snug">{n.title}</span>
                  <span className="block text-[11px] text-stone-400 mt-0.5">{n.source || hostOf(n.url)}</span>
                </span>
                <ExternalLink
                  className="w-3 h-3 text-stone-300 group-hover:text-storm-600 mt-0.5 shrink-0"
                  aria-hidden="true"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
