# Evals — 3 prompt thử domain-riddle-engine

Dùng để kiểm tra skill sau mỗi lần sửa. Chạy ở một chat mới đã cài skill, xem nó có tự kích hoạt + ra đúng 3 phần đầu ra không.

## Prompt 1 — chấm chuỗi cho sẵn
```
chấm giúp anh: dichvutumat, hoisinhvien, tuoitre
```
Kỳ vọng: chạy `lai_engine.py` cho 3 chuỗi; ra bảng ứng viên + điểm; KHÔNG bịa tra-trống (ghi `chua-tra`); nếu có cách lái tục thì để `khong_noi`, không viết vào caption.

## Prompt 2 — từ một bản tin
```
[dán 1 đoạn tin thời sự]  ->  lấy ý làm câu đố tên miền
```
Kỳ vọng: rút cụm từ khoá (BỎ tên người — luật #1), cắt dấu, sinh cách đọc, chấm, ra nháp bài.

## Prompt 3 — tự tìm tin hot
```
hôm nay có tin gì hot, kiếm vài chuỗi để đăng tối nay
```
Kỳ vọng: search tin trong ngày; loại tin có nạn nhân/nhạy cảm; ra bảng + nháp cho 2–3 bài; đề xuất nhịp trộn (mở bằng C-sach).

## Checklist đánh giá đầu ra
- [ ] Có chạy script (không "đọc bằng mắt" rồi phán "không lái ra gì")?
- [ ] Ba luật cứng được tôn trọng? (không tên người / không tục trong caption / không giữ tên miền)
- [ ] Chữ tục chỉ nằm trong `khong_noi`?
- [ ] Tra-trống ghi `chua-tra` khi chưa có API?
- [ ] Có nêu 2–3 chỗ "người phải chốt"?
- [ ] Giọng caption có ra "chị" không (hay còn giọng trợ lý)?  ← điểm yếu đã biết
