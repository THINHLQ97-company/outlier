// Dấu nhận diện cho xu hướng lấy từ Google Trends.
//
// Vẽ lại bằng SVG thay vì gọi ảnh từ máy chủ Google: ảnh ngoài có thể bị chặn,
// đổi đường dẫn, hoặc tải chậm làm giật giao diện — mà đây chỉ là một cái nhãn
// nhỏ. Hình là mũi tên đi lên gãy khúc, đúng biểu tượng quen thuộc của Trends,
// dùng đúng bốn màu Google.
export default function GoogleTrendsMark({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path d="M3 17.5 L9 11.5 L13 15.5 L21 7.5" stroke="#4285F4" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="11.5" r="2" fill="#EA4335" />
      <circle cx="13" cy="15.5" r="2" fill="#FBBC05" />
      <circle cx="20.5" cy="7.5" r="2.2" fill="#34A853" />
    </svg>
  );
}
