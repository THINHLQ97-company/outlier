# SPEC — skill `content-remake-radar`

> Tầng MỚI phải xây (mọi skill khác đã có). Nhiệm vụ: **cào bài hot của page/nền tảng khác → chấm "đáng remake" → mổ cơ chế → chuyển sang remake**.
> Nguyên tắc chủ đạo: **KHÔNG để Claude đóng vai con bot cào.** Việc cào do dịch vụ nền / tool sẵn có lo; Claude đọc kho ra để phân tích + remake.
> Trang đích: fanpage **"Ăn Thịt Anh Lập Trình"** (persona hư cấu, khán giả lệch về dân code/dev).

## Vì sao cần tầng này
Claude chạy trên cloud **không cào được Facebook/TikTok** (chặn login, chống bot; web search chỉ lấy tin tức/chủ đề, không lấy bài cụ thể kèm số like/share). Nên phần "lấy dữ liệu" phải đến từ nguồn khác.

## Quyết định đã chốt: TÁI DÙNG tool sẵn có làm nguồn cào
- **Martrend (trong Marcow)** — đã "cào bài/ảnh viral". Dùng làm nguồn bài hot Facebook.
- **Trend Radar TikTok VN (trong Social)** — đã bắt trend TikTok. Dùng làm nguồn trend TikTok.
- **Market Radar MCP** (news-radar / group-insights) — mô hình ingest→lưu→semantic search→phân tích→save_analysis là **template kiến trúc** cho radar này; và group-insights cho pain point cộng đồng dev.
- ⇒ Việc xây mới **bé lại**: chỉ cần *bộ nối* đọc từ các nguồn trên + *một cái kho* (lưu bài đã cào để chấm điểm & chống trùng). KHÔNG xây lại phần cào từ đầu.
- Nền tảng phủ được = những gì Martrend + Trend Radar đang phủ (FB viral, TikTok VN). Muốn nền tảng khác → đó mới là phần cào phải bổ sung.

## Vai trò của Scheduled (tính năng hẹn giờ)
Scheduled = **đồng hồ + người điều phối**, KHÔNG phải con bot cào.
- Mỗi sáng: mở phiên mới → gọi nguồn cào (Martrend/Trend Radar) lấy bài hot trong ngày → chấm điểm → mổ cơ chế → sinh bản remake nháp → lưu vào hàng đợi duyệt → **nhắc người**.
- KHÔNG tự đăng. Người giữ khâu chơi chữ + nút đăng (đúng nguyên tắc "bắt trend, không đu trend").
- ⚠️ Nếu buộc phải cào bằng Claude in Chrome: phiên hẹn giờ chạy trên cloud sẽ KHÔNG có máy anh — chỉ chạy khi máy anh bật + đã đăng nhập, rất mong manh. Vì vậy ưu tiên nguồn cào chạy nền (Martrend/Trend Radar/API), không phụ thuộc trình duyệt cá nhân.

## Pipeline 7 nhịp
1. **Cào** (Martrend / Trend Radar / API — chạy nền theo giờ) → bài hot + số tương tác + ảnh.
2. **Lưu kho** → dedupe, gắn thẻ (nền tảng, chủ đề, ngày).
3. **Chấm "đáng remake"** = tương tác cao × hợp persona/chủ đề mình × an toàn (bỏ nhóm ⛔, bỏ tin có nạn nhân).
4. **Mổ cơ chế** → hook, format, cú lật, vì sao viral. → **dùng skill `channel-teardown`** (khung A–G + nhãn "quan sát được / suy đoán").
5. **Remake** → dựng bài MỚI bằng giọng "Ăn Thịt Anh Lập Trình" + góc tên miền đọc lệch. → **dùng `persona-bible` + `domain-riddle-engine`**.
6. **Người biên tập chơi chữ + duyệt** (vòng "đọc bằng tai").
7. **Đăng / hẹn lịch** → **dùng `fanpage-ops`**.

## ⚠️ Luật cứng: REMAKE = CƠ CHẾ, KHÔNG PHẢI CLONE
Lấy **công thức** (vì sao nó nổ), KHÔNG lấy nội dung/ảnh của page khác. Bê nguyên bài về đổi chữ = dính bản quyền + bị nhận ra là "page đi chép" → chết thương hiệu. `channel-teardown` đã có cột "quan sát được / suy đoán" để ép tách cơ chế khỏi nội dung. Đầu ra remake phải **nguyên bản**: không tên/logo/nhân vật/wordmark của nguồn.

## Việc cho Claude Code
- Định nghĩa *interface đọc nguồn cào* (input: nền tảng + khoảng thời gian; output: danh sách bài {text, media, like, share, comment, url, ngày}).
- Cắm Martrend / Trend Radar (hoặc một dịch vụ cào) vào interface đó; degrade khi thiếu.
- Cái *kho* (DB/vector) lưu bài đã cào + điểm + trạng thái (mới / đã remake / đã đăng).
- Nối Scheduled: 1 phiên/ngày chạy nhịp 1→5, lưu hàng đợi, nhắc người.
