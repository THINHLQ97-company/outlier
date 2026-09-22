# Tra tên miền còn trống — CHỜ CẮM API MẮT BÃO

Trạng thái: **chưa có.** Script/skill hiện trả `chua-tra` cho mọi TLD. **Không được bịa** "còn trống / đã đăng ký".

## Việc cho Claude Code
1. Định nghĩa interface chuẩn:
   ```
   tra_trong(chuoi: str, tld: list[str]) -> dict
   # ví dụ trả:
   # {"vn": {"trong": true,  "gia": 750000, "don_vi": "VND/nam"},
   #  "com":{"trong": false, "gia": null}}
   ```
2. Nguồn dữ liệu (Thịnh cung cấp): **API/công cụ nội bộ Mắt Bão.** Cần: endpoint, cách xác thực (API key), giới hạn số lần gọi, TLD hỗ trợ (.vn, .com.vn, .com, .net, .ai…).
3. Fallback khi chưa có key: giữ `chua-tra`, KHÔNG gọi whois công khai bừa (rate-limit + có thể lệch dữ liệu nhà đăng ký).
4. Cache kết quả trong ngày để tránh gọi lại chuỗi giống nhau.

## Lưu ý nghiệp vụ
- Kết quả tra chỉ để **hiển thị trong bài / trả lời khách**, KHÔNG để page tự đăng ký giữ chỗ (luật cứng #3: "đăng là nhường").
- Nếu tên đã có người đăng ký → vẫn có thể làm câu đố (chỉ là CTA đổi thành gợi ý biến thể còn trống: `.com.vn`, thêm tiền tố…).
