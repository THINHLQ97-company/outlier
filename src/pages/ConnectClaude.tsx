import { useState } from "react";
import { Check, Copy, ExternalLink, Plug, Terminal, MessageSquare } from "lucide-react";

// Hướng dẫn nối công cụ này vào Claude.
//
// Vì sao là một trang trong app chứ không phải tài liệu: người cần nối đang ngồi
// trong app, và thứ họ cần là ĐƯỜNG DẪN CỦA CHÍNH BẢN NÀY — viết trong tài liệu
// thì phải sửa mỗi lần đổi tên miền, còn ở đây thì tự đúng.

function CopyBox({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Trình duyệt chặn thì người dùng bôi đen chép tay — ô vẫn chọn được.
    }
  }

  return (
    <div>
      {label && <p className="text-xs font-medium text-stone-600 mb-1">{label}</p>}
      <div className="flex items-stretch gap-2">
        <code className="flex-1 text-xs bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 font-mono break-all select-all">
          {text}
        </code>
        <button
          type="button"
          onClick={copy}
          className="ds-btn ds-btn-secondary ds-btn-sm shrink-0"
          title="Chép vào bộ nhớ tạm"
        >
          {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          {copied ? "Đã chép" : "Chép"}
        </button>
      </div>
    </div>
  );
}

export default function ConnectClaude() {
  // Lấy từ chính địa chỉ đang mở, nên luôn đúng dù đổi tên miền hay chạy bản nào.
  const mcpUrl = `${window.location.origin}/api/mcp-signals`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display flex items-center gap-2">
          <Plug className="w-5 h-5 text-storm-500" aria-hidden="true" /> Kết nối Claude
        </h1>
        <p className="text-sm text-stone-500">
          Nối xong thì Claude điều khiển được công cụ này: tìm trend, chấm bài, bóc cấu trúc, viết lại, vẽ ảnh, đăng bài.
        </p>
      </div>

      <div className="ds-card">
        <div className="ds-card-body">
          <CopyBox label="Đường dẫn máy chủ MCP" text={mcpUrl} />
          <p className="text-xs text-stone-400 mt-2">
            Claude tự đọc hướng dẫn sử dụng khi kết nối — <strong>không cần cài thêm skill nào</strong>.
          </p>
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-body">
          <h2 className="font-bold text-stone-800 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-storm-500" aria-hidden="true" />
            Cách 1 — Claude trên web (claude.ai)
          </h2>
          <ol className="text-sm text-stone-600 mt-2 flex flex-col gap-1.5 list-decimal list-inside">
            <li>
              Mở{" "}
              <a
                href="https://claude.ai/settings/connectors"
                target="_blank"
                rel="noreferrer"
                className="text-storm-600 hover:underline inline-flex items-center gap-0.5"
              >
                Settings → Connectors <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </li>
            <li>
              Bấm <strong>Add custom connector</strong>
            </li>
            <li>Dán đường dẫn ở trên vào ô Server URL</li>
            <li>Claude mở trang đăng nhập — đăng nhập bằng tài khoản Outlier của bạn rồi cấp quyền</li>
          </ol>
          <p className="text-xs text-stone-400 mt-2">
            Không cần điền mã bí mật gì — Claude tự lo phần đăng nhập.
          </p>
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-body">
          <h2 className="font-bold text-stone-800 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-storm-500" aria-hidden="true" />
            Cách 2 — Claude Code (trong VS Code hoặc terminal)
          </h2>
          <div className="mt-2">
            <CopyBox text={`claude mcp add --transport http outlier ${mcpUrl}`} />
          </div>
          <p className="text-sm text-stone-600 mt-2">
            Chạy xong gõ <code className="bg-stone-100 px-1 rounded text-xs">/mcp</code> để kiểm tra.
          </p>
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-body">
          <h2 className="font-bold text-stone-800">Thử ngay sau khi nối</h2>
          <ul className="text-sm text-stone-600 mt-2 flex flex-col gap-2">
            {[
              "Gọi daily_brief xem hôm nay có gì mới.",
              "Hồ sơ trang của tôi đang có gì, còn thiếu gì?",
              "Quét Google Trends rồi cho tôi 3 phương án bài đăng đúng giọng trang.",
              "Bài nào trong các kênh tôi theo dõi đáng remake nhất?",
            ].map((q) => (
              <li key={q} className="bg-stone-50 border border-stone-100 rounded-lg px-3 py-2 italic">
                “{q}”
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="ds-card">
        <div className="ds-card-body">
          <h2 className="font-bold text-stone-800">Để Claude tự chạy định kỳ</h2>
          <p className="text-sm text-stone-600 mt-1">
            Trong Claude Code, chạy lệnh lặp để Claude tự kiểm tra mỗi vài giờ:
          </p>
          <div className="mt-2">
            <CopyBox text="/loop 6h Gọi daily_brief của Outlier, làm theo suggestedActions nhưng dừng lại hỏi tôi trước mọi việc tốn tiền. Xong thì tóm tắt ngắn có gì mới." />
          </div>
          <p className="text-xs text-stone-400 mt-2">
            <strong>daily_brief</strong> không tự quét gì nên luôn miễn phí. Việc nào tốn tiền nó chỉ đề xuất, không tự làm.
          </p>
        </div>
      </div>
    </div>
  );
}
