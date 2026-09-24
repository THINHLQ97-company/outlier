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

---

## Còn thiếu

Xếp theo thứ tự nên làm.

### 1. Chấm điểm hiệu quả nội dung
Hiện chỉ có điểm vượt trội của Radar (so với chính kênh). Cần một thang rõ ràng
theo tiêu chí bạn nêu: **like, comment, lưu lại/chia sẻ** — và nói rõ vì sao bài
này đáng remake. Có sẵn công thức tham khảo: `likes + comments×3 + shares×5`
(đang dùng trong `fanpage-stats.ts`).

*Chưa rõ*: "lưu lại" không lấy được từ bài người khác — Meta không công khai. Có
thể thay bằng chia sẻ, hoặc bỏ.

### 2. Thư viện phân loại rõ ba thể loại
Tab **Hình ảnh / Bài viết (caption + ảnh) / Video**. Hiện thư viện trộn chung.

### 3. Đăng tự động lên fanpage được chỉ định
- Đăng: `POST /{page-id}/feed` (chữ), `/photos` (ảnh), `/videos`
- Cần quyền `pages_manage_posts` — **token hiện tại chưa có quyền này**
- Lên lịch: mỗi phút kiểm tra hàng đợi, mỗi lượt đăng một bài, có giờ hoạt động
  và giãn cách chống spam

### 4. Claude tự quét theo lịch, đề xuất ngược
Để Claude chạy định kỳ: quét trend mới, chọn bài hot trong các kênh theo dõi, đẩy
đề xuất vào công cụ cho người dùng duyệt.

*Chưa rõ*: chạy lịch ở đâu — trong app (cron) hay bên Claude. Nếu trong app thì
phải cẩn thận vì quét kênh tốn tiền.

### 5. YouTube: mở rộng phần miễn phí
Đã dùng Data API v3 cho **bình luận**. Còn có thể thay Apify ở phần **quét kênh
và lấy bài** — cùng API key đó. Cần đặt `YOUTUBE_API_KEY`.

### 6. Remake video
Để sau, theo đúng ý bạn.

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
