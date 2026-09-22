# Lấy cookie Douyin cho công cụ

> Cập nhật 2026-09-22. Đọc mục "Cảnh báo" trước khi làm.

## Tình hình hiện tại — đã thử và đo thật

| Nền tảng | Lấy bằng f2 (miễn phí) | Ghi chú |
|---|---|---|
| **Douyin** | ⚠️ Có thể — **cần cookie mới** | Cookie hiện có (20/08) trả `403`, đã quá cũ |
| **TikTok** | ❌ **Không** — cookie không cứu được | f2 chết ngay lúc khởi tạo, xem bên dưới |

### Vì sao cookie TikTok vô dụng với f2

f2 gọi API TikTok **ngay lúc nạp thư viện** để xin một `msToken` thật, và bước đó
dùng header cố định của nó — **không đụng tới cookie của bạn**. TikTok đang chặn
chính lời gọi đó, nên thư viện hỏng trước khi kịp dùng cookie. Tôi đã thử vá bằng
cách ép dùng token giả, vẫn không qua được vì đoạn code đó chạy lúc nạp module.

→ **TikTok vẫn phải đi qua Apify** (đã kiểm chứng chạy tốt, ~0,0035 USD/bài).

---

## Cảnh báo trước khi lấy cookie

Cookie là **chìa khoá phiên đăng nhập**. Ai có nó thì vào được tài khoản mà không
cần mật khẩu.

- **Đừng dùng tài khoản chính.** Lập một tài khoản Douyin riêng cho công cụ.
- Nếu Douyin phát hiện hành vi tự động, **tài khoản cho mượn cookie bị khoá** —
  không phải công cụ bị khoá.
- Cookie hết hạn sau vài tuần. Hỏng thì lấy lại, đừng ngạc nhiên.

---

## Cách lấy (Chrome / Edge / Cốc Cốc)

### Cách 1 — dùng tiện ích mở rộng (dễ nhất)

1. Cài tiện ích **"Get cookies.txt LOCALLY"** từ Chrome Web Store.
   *Chọn đúng bản có chữ LOCALLY — bản này xử lý ngay trên máy, không gửi cookie đi đâu.*
2. Đăng nhập `https://www.douyin.com` bằng **tài khoản riêng cho công cụ**.
3. **Mở thử một video bất kỳ** rồi để trang tải xong — bước này quan trọng, Douyin
   chỉ cấp đủ cookie sau khi bạn thật sự xem một video.
4. Bấm biểu tượng tiện ích → **Export** → lưu file `douyin-cookies.txt`.

### Cách 2 — không cài tiện ích

1. Đăng nhập Douyin, mở một video.
2. Nhấn `F12` → tab **Application** (Chrome) hoặc **Storage** (Firefox).
3. Bên trái chọn **Cookies → https://www.douyin.com**.
4. Chép toàn bộ danh sách. Cách này ra định dạng khác, gửi tôi bản chép được —
   tôi chuyển sang đúng định dạng.

---

## Gửi file cho công cụ

Đặt file vào thư mục `.secrets/` của dự án:

```
.secrets/douyin-cookies.txt
```

Thư mục này đã được chặn khỏi git (`chmod 700`), **không bao giờ bị commit**.

Rồi khai trong `.env`:

```
DOUYIN_COOKIES_FILE=".secrets/douyin-cookies.txt"
```

---

## Kiểm tra cookie còn sống không

```bash
node --import tsx -e 'import {checkDouyinCookie} from "./server/services/douyin-f2"; console.log(await checkDouyinCookie())'
```

Trả `403` nghĩa là cookie hỏng hoặc máy chủ bị chặn theo địa chỉ mạng — hai nguyên
nhân này khó tách bạch từ xa. Nếu cookie vừa lấy mà vẫn `403` thì gần như chắc là
do địa chỉ mạng của máy chủ, và lúc đó cookie mới cũng không cứu được.
