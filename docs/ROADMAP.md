# Lộ trình Outlier

Bám theo luồng đã chốt: **theo dõi kênh → chấm điểm bài hay → bóc cấu trúc (gồm
comment) → remake đúng giọng thương hiệu → đăng**. Claude điều khiển qua MCP và
đẩy ngược trend vào công cụ.

Cập nhật mỗi khi xong một phần. Ngày ghi là ngày hoàn thành.

---

## Xong

| Phần | Ghi chú |
|---|---|
| Hồ sơ thương hiệu đầy đủ | pageRole, ngữ vực, hành vi luôn/không bao giờ, câu cửa miệng, nhận diện hình ảnh, bài mẫu · 2026-09-22 |
| `brand_brief` cho MCP | Tóm tắt nhân vật thành văn xuôi, tự chỉ ra mục còn thiếu · 2026-09-22 |
| Nối Meta, quét bài trang của mình | Graph API, miễn phí; token lưu mã hoá · 2026-09-22 |
| Số liệu trang + bài vượt trội | Nhịp đăng, trung vị, định dạng, giờ đăng, bài ăn hơn hẳn (×N) · 2026-09-22 |
| Gán nhân vật cho từng trang | Ảnh mẫu nhân vật dùng làm chuẩn khi vẽ · 2026-09-22 |
| Vẽ ảnh cho bản remake | Hai bước tả rồi vẽ; bám `visualIdentity` · 2026-09-22 |
| `trend_draft` | Trend nóng → phương án đăng được, đã soi guardrail · 2026-09-22 |
| Tách rõ Remake bài viết / video | Dải so sánh đầu vào — đầu ra — chi phí · 2026-09-22 |
| Chuyển dữ liệu giữa hai bản cài | Xuất/nhập qua trình duyệt, không cần mật khẩu DB · 2026-09-23 |
| Sắp lại menu theo luồng | 5 nhóm; đổi tên Radar/Tín hiệu cho đúng việc chúng làm · 2026-09-24 |
| Google Trends | RSS công khai, miễn phí, không cần key; hiển thị có cấu trúc · 2026-09-24 |
| Trần tiền cứng mỗi lượt Apify | `maxTotalChargeUsd`, học từ share-projects/social · 2026-09-24 |
| Lọc kênh theo nền tảng | Thêm Facebook (trước đó thiếu) · 2026-09-24 |
| **Phân tích bình luận** | Cụm chủ đề (số lượng do code đếm), câu hỏi lặp lại, điều bị phản đối, góc nên làm tiếp. Tự đưa vào prompt khi remake · 2026-09-24 |
| YouTube đọc bình luận miễn phí | Data API v3, chỉ cần API key · 2026-09-24 |
| **Chấm điểm sâu hơn** | Thêm trục bình luận + chia sẻ so với lượt thích; giao diện hiện phân rã điểm · 2026-09-24 |
| **Thư viện ba thể loại** | Bài viết / Hình ảnh / Video, tách khỏi nguyên liệu · 2026-09-24 |
| **Đăng lên fanpage** | Đăng ngay hoặc hẹn giờ (Facebook giữ bài); chống đăng trùng · 2026-09-24 |
| **`daily_brief` cho phiên định kỳ** | Toàn cảnh một lần gọi, miễn phí; việc xếp rẻ trước tốn tiền sau · 2026-09-24 |

---

## Còn thiếu

### 1. ~~YouTube: quét kênh miễn phí~~ — GHI NHẦM, đã miễn phí từ đầu
YouTube quét kênh dùng yt-dlp, **không qua Apify**, không tốn tiền. Chỉ TikTok,
Instagram và Facebook mới tính tiền. `YOUTUBE_API_KEY` chỉ cần cho **đọc bình
luận** YouTube.

### 2. Remake video
Để sau, theo đúng ý bạn.

### 3. Những thứ cần bạn cấp mới chạy được
- `YOUTUBE_API_KEY` — mở khoá phần YouTube miễn phí
- Page Access Token có quyền `pages_manage_posts` — token hiện tại **chưa có
  quyền này**, nên nút đăng sẽ báo lỗi cho tới khi lấy token mới

---

## Chạy định kỳ bằng Claude

Bạn đã chọn chạy lịch bên Claude thay vì cron trong app — nghĩa là không có gì
tự tốn tiền sau lưng, nhưng cũng nghĩa là phải có phiên Claude đang mở.

**Cách làm:**

1. Nối MCP (xem `docs/MCP-SIGNALS.md`)
2. Trong Claude Code, chạy lệnh lặp:
   ```
   /loop 6h Gọi daily_brief của Outlier, làm theo suggestedActions nhưng dừng lại
   hỏi tôi trước mọi việc tốn tiền. Xong thì tóm tắt ngắn có gì mới.
   ```
3. Hoặc dùng lịch của Claude (`/schedule`) nếu muốn chạy cả khi không mở máy

**Vì sao `daily_brief` gọi trước tiên:** nó trả về toàn cảnh trong một lần gọi và
không tự quét gì, nên luôn miễn phí. Danh sách việc trong đó đã xếp **rẻ trước,
tốn tiền sau**, và mọi việc tốn tiền đều ghi rõ là tốn tiền.

---

## Những giới hạn đã xác minh, không phải chưa làm

Ghi lại để khỏi kỳ vọng nhầm:

- **Đọc bài của page mình không quản lý thì bắt buộc tốn tiền.** Graph API chỉ trả
  tên/followers/ảnh đại diện. Đã kiểm chứng qua `share-projects/social` — họ cũng
  đang trả tiền Apify, không có đường tắt nào.
- **Đọc comment của page người khác cũng qua Apify.** Bẫy: trường giới hạn tên là
  `resultsLimit`, không phải `maxComments` — gõ sai thì actor lờ đi và trả về gấp
  nhiều lần (từng tốn ~$0.95 một lượt).
- **Reach / impression của page người khác: không có cách nào lấy.** Nơi khác
  "ước lượng" bằng `followers × 0.15` — đó là con số bịa, không dùng.
- **Ảnh cũ trên bản Coolify đã mất**, do app không có volume bền. Không lấy lại
  được. Bản Vibe Host lưu ảnh trong database nên không lặp lại.
