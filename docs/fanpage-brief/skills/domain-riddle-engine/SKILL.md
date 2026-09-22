---
name: domain-riddle-engine
description: Bộ máy "đọc lệch" tên miền tiếng Việt không dấu cho fanpage bán tên miền của Mắt Bão. Dùng khi cần biến tin thời sự / từ khoá / một chuỗi không dấu thành câu đố tên miền: sinh các cách đọc (đặt lại dấu, ngắt từ, nói lái, đọc tiếng khác), chấm điểm tiềm năng "nổ", gắn nhãn an toàn, tra tên miền còn trống, và xuất bảng ứng viên + nháp caption/self-comment + JSON.
---

# domain-riddle-engine

Lõi nội dung của fanpage tên miền "đọc lệch". Một cái lõi, ba việc: **chọn bài** (chấm điểm), **lọc an toàn** (gắn nhãn), và làm **công cụ "check tên của bạn"** để chốt đơn.

## BA LUẬT CỨNG — đọc trước, không được vi phạm

1. **Lấy từ khoá từ thời sự, KHÔNG lấy người từ thời sự.** Không nêu tên người thật trong caption/bài. Câu đố chỉ có chuỗi không dấu.
2. **Hai loại tục:** tục khi **đọc thẳng** → **CHẶN** (đăng là page nói); chỉ tục **sau khi lái/đặt dấu** → **CHỌN** (khán giả lái, page không lái). Tục là tiêu chí **chọn bài**, không bao giờ là **nội dung bài**. Trộn nhiều "loại nổ" để page không thành "page đố tục".
3. **Page không bao giờ giữ tên miền đã đưa lên. Đăng là nhường** (tránh front-running).

> Ảnh gợi: nếu có, **mờ xoá danh tính**, nguồn sinh/stock (không người thật), **không boost**, **<20% bài**, chị đọc nghĩa đen.

## Đầu vào (một hoặc nhiều)
- Tự tìm tin hot trong ngày (WebSearch; nếu có, thêm news-radar / group-insights).
- Dán đoạn tin / link bài báo.
- Danh sách từ khoá cho sẵn.
- Chuỗi không dấu cho sẵn (chỉ để chấm điểm).

## Quy trình 7 bước

**Bước 0 — Lấy nguồn.** Nếu đầu vào là "tìm tin hot": search tin trong ngày. Nếu là tin/link: đọc, rút cụm từ khoá. Nếu là chuỗi cho sẵn: sang bước 2.

**Bước 1 — Chọn cụm + cắt dấu.** Từ mỗi tin, rút **cụm từ khoá** (2–3 tiếng) — **bỏ tên người** (luật #1). Cắt dấu → chuỗi không dấu (ứng viên tên miền). Ghi lại `nguồn`.

**Bước 2 — Sinh cách đọc (CHẠY SCRIPT, đừng đọc bằng mắt).**
Gọi `scripts/lai_engine.py` cho mỗi chuỗi. Bốn phép:
- **a. Đặt lại dấu** — cùng chuỗi không dấu, các cách bỏ dấu thanh + dấu nguyên âm (cu → cũ/cụ/cú…).
- **b. Ngắt lại từ** — mọi cách tách chuỗi thành các âm tiết hợp lệ (dichvutumat → "dịch vụ tu mát" / "dịch vụ tù mặt"…).
- **c. Nói lái** — tráo vần±thanh / tráo thanh / tráo phụ âm đầu / đảo âm tiết. **Đây là chuyện của ÂM, không phải của chữ** — bắt buộc chạy script, người rất hay bỏ sót.
- **d. Đọc tiếng khác** — chuỗi đọc thành tiếng Anh hoặc ngược lại (phép này script chưa mạnh; bổ sung thủ công/LLM).

**Bước 3 — Gắn nhãn an toàn từng cách đọc** (xem `references/nhan-va-cham-diem.md`):
- **A-chan**: tục/nhạy cảm khi **đọc thẳng** → loại chuỗi, không đăng.
- **B-vang**: có ít nhất một cách đọc bậy **chỉ sau khi lái/đặt dấu** → tiềm năng cao; cách đọc bậy đưa vào `khong_noi` (page không nói).
- **C-sach**: nổ được mà không cần tầng tục (ngược đời, nghĩa nghề, trùng tên nổi tiếng…).

**Bước 4 — Chấm điểm 0–10** (5 trục × 0–2): *hiển nhiên • đa dạng • hợp thời • đường chơi (có chỗ để khán giả diễn tiếp) • an toàn*. Có "bài kiểm tra 3 giây": người đọc thường có bật cười trong 3 giây không.

**Bước 5 — Tra tên miền còn trống** (xem `references/tra-ten-mien.md`). **Chưa có API → ghi `chua-tra`.** Không bịa.

**Bước 6 — Xuất đầu ra** đúng `references/dinh-dang-dau-ra.md`: (1) Bảng ứng viên; (2) Nháp caption + self-comment cho bài chọn; (3) JSON.

**Bước 7 — Bàn giao cho người.** Nêu rõ 2–3 chỗ **người phải chốt** (giọng, bài B rủi ro, cách đọc trong `khong_noi`). **Không tự đăng.**

## Lỗi hay gặp (của chính trợ lý)
- **Kết luận "không lái ra gì" khi CHƯA chạy script.** Nói lái là chuyện của âm — luôn chạy `lai_engine.py` trước khi phán.
- **Đặt sai dấu khi tái tạo** (vd "chùa chiều" → "chiều chuà": dấu đặt sai chỗ ở vần "ua"). Script có bảng đặt-dấu; nếu ra chữ lạ, kiểm tra bảng main-vowel.
- **Để chữ tục lọt vào caption/self-comment.** Chữ tục chỉ được nằm trong `khong_noi` (và theo quyết định đang mở, có thể chỉ lưu số đếm + nhãn).
- **Lấy nhầm tên người từ thời sự vào bài.** Chỉ lấy từ khoá.
- **Bịa kết quả tra trống.** Chưa có API thì ghi `chua-tra`.

## Phụ thuộc
- `scripts/lai_engine.py` — phần cơ học (Python 3, không cần thư viện ngoài).
- API tra tên miền nội bộ Mắt Bão — **chưa cắm** (xem references/tra-ten-mien.md).
- (Nên có) wordlist tiếng Việt để xác thực âm tiết/nghĩa — hardening.
