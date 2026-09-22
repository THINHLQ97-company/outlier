import { Link } from "react-router-dom";
import { PenLine, Clapperboard } from "lucide-react";

// Hai hình thức remake dễ bị lẫn vì cùng gọi là "remake". Dải này đặt chúng
// cạnh nhau ở đầu cả hai trang để thấy ngay: khác đầu vào, khác đầu ra, khác
// chi phí — và bấm được để nhảy qua lại.
const MODES = [
  {
    to: "/remakes",
    icon: PenLine,
    title: "Remake bài viết",
    input: "một bài đã bóc cấu trúc",
    output: "bản viết (caption, post, kịch bản chữ)",
    cost: "rẻ — chỉ tốn lượt gọi Gemini",
  },
  {
    to: "/videos",
    icon: Clapperboard,
    title: "Remake video",
    input: "một bản viết đã duyệt ở bước trên",
    output: "video hoàn chỉnh có hình và tiếng",
    cost: "tốn phí — mỗi cảnh dựng bằng AI đều phải bấm xác nhận",
  },
];

export default function RemakeModeSwitch({ current }: { current: "post" | "video" }) {
  const currentTo = current === "post" ? "/remakes" : "/videos";
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {MODES.map(({ to, icon: Icon, title, input, output, cost }) => {
        const isCurrent = to === currentTo;
        const body = (
          <>
            <div className="flex items-center gap-2">
              <Icon
                className={`w-4 h-4 ${isCurrent ? "text-storm-600" : "text-stone-400"}`}
                aria-hidden="true"
              />
              <span className={`font-semibold ${isCurrent ? "text-stone-800" : "text-stone-600"}`}>{title}</span>
              {isCurrent && <span className="ds-badge ds-badge-info">đang xem</span>}
            </div>
            <dl className="mt-2 text-xs text-stone-500 space-y-0.5">
              <div className="flex gap-1.5">
                <dt className="shrink-0 text-stone-400">Vào:</dt>
                <dd>{input}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 text-stone-400">Ra:</dt>
                <dd>{output}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="shrink-0 text-stone-400">Chi phí:</dt>
                <dd>{cost}</dd>
              </div>
            </dl>
          </>
        );
        const cls = `ds-card !p-3 block ${
          isCurrent ? "ring-2 ring-storm-400" : "hover:border-stone-300 transition-colors"
        }`;
        return isCurrent ? (
          <div key={to} className={cls} aria-current="page">
            {body}
          </div>
        ) : (
          <Link key={to} to={to} className={cls}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
