# SPEC — skill `channel-teardown`

> Mục tiêu GỐC của CEO: (1) tìm kênh hay của một brand, (2) phân tích cách họ xây kênh → đóng gói thành phương thức.
> Bản teardown AVOCA (Công chúa hạt điều) là **mẫu output đầu tiên** — xem tóm tắt cuối file.
> **Vai trò kép:** đây cũng là **nhịp 4 của `content-remake-radar`** — mổ cơ chế một bài hot (vì sao nó nổ) trước khi remake. Khung A–G + nhãn "quan sát được / suy đoán" chính là thứ ép tách CƠ CHẾ khỏi NỘI DUNG, để remake ra bản nguyên bản chứ không clone.

## Mục tiêu
Cho một kênh (fanpage/group/TikTok/YouTube), sinh một bản "mổ xẻ" theo **schema cố định**, đọc **theo thời gian**, có **nhãn nhận thức** (quan sát được / suy đoán / không biết).

## Nguyên tắc (rút từ brainstorm)
- **Điểm vào đúng = ngành hàng + mục tiêu, KHÔNG phải một brand.** "Snack VN ai đang thắng TikTok?" → 3–5 brand → mới soi. Học 3–5 brand cùng ngành để tách **pattern chung** khỏi **đặc thù ngẫu nhiên** của 1 brand.
- **"Cách xây kênh" = 4 tầng**, không phải tầng nào cũng nhìn từ ngoài:
  1. **Nội dung** (format/hook/cadence/viral) — nhìn thấy hoàn toàn.
  2. **Kiến trúc kênh** (TikTok→fanpage→group→Zalo?) — thấy nếu đọc bio/link/CTA.
  3. **Quỹ đạo tăng trưởng** (0→10k mất bao lâu, bước ngoặt) — chỉ thấy nếu đọc **theo thứ tự thời gian** (20 bài đầu vs 20 bài mới), không phải snapshot.
  4. **Đòn bẩy trả tiền** (ads/seeding/booking) — gần như vô hình, thường mới là thứ tạo kết quả.
- **Trap:** teardown chỉ nhìn tầng 1 rồi kết luận "thắng nhờ content" trong khi thắng nhờ tầng 4. → mỗi kết luận phải gắn nhãn **quan sát được / suy đoán / không biết**.

## Dữ liệu lấy từ đâu (rào cản thực tế)
- YouTube: WebFetch đọc được.
- **TikTok & Facebook (nhất là group): gần như không fetch từ ngoài** → cần **Claude in Chrome** (đăng nhập, chậm) hoặc Thịnh dán data.
- ⇒ Skill nên tách 2 chế độ: (a) tự đọc qua trình duyệt nếu có; (b) nhận data dán vào theo khung A–G.

## Schema output cố định (khung A–G — dùng lại prompt teardown đã chạy)
- **A. Thông tin nền** (tên, follower, danh mục, bio nguyên văn, link; Page Transparency: ngày tạo, đổi tên, quốc gia admin, có chạy ads không + mẫu Ad Library).
- **B. 30 bài gần nhất** (bảng: ngày | định dạng | câu đầu | độ dài | react | comment | share | có bán không & kiểu | ghi chú) + tần suất/tuần + khung giờ.
- **C. Đọc ngược thời gian** (10–15 bài sớm nhất; bài đầu khác bài giờ ở đâu).
- **D. 5 bài tương tác cao** (nội dung, vì sao ăn, đọc 10–15 comment: thật hay seeding, page trả lời giọng gì).
- **E. Persona & giọng** (ai nói, xưng hô, nhân vật cố định, câu thương hiệu, % nhóm chủ đề, phong cách ảnh).
- **F. Cơ chế bán** (chốt kiểu gì, tần suất bài bán, kênh kéo ra ngoài).
- **G. Kết luận 3 câu** (cái gì làm cuốn / cái gì nhờ trả tiền-seeding / cái gì không thấy được từ ngoài).

## Bước cuối: BẢNG CHUYỂN GIAO
Với mỗi cơ chế quan sát được ở kênh mẫu → cột "Chuyển được?" (có/không) → "Phiên bản cho kênh của mình". (Xem mẫu AVOCA→tên miền trong `02_...` / dưới đây.)

---

## MẪU OUTPUT — tóm tắt teardown AVOCA (Công chúa hạt điều)
> ⚠️ Đây là **tóm tắt phát hiện** từ bản teardown gốc. Bản A–G đầy đủ ("nội dung fetching") Thịnh cần bổ sung cho hồ sơ.

**Đúng (khớp giả thuyết):**
- Persona **faceless, giọng cố định** là chìa khoá (avatar chó hề; khán giả còn nghi "Công chúa" là đàn ông; để lửng danh tính là một phần trò chơi).
- Đúng mô hình **"tính cách cố định, 2 register"**: ngọt "em–anh" với khách trong ảnh chat; xéo xắt "t/mẹ/má" với khán giả ngoài caption. Không đổi giọng theo từng người.

**Sai (lật giả thuyết):**
- Phần vô hình **KHÔNG phải tiền ads** (Ad Library trống, comment organic). Phần vô hình thật = **cộng đồng thừa kế**: 0→53K/12 tuần là **relaunch**, không phải cold start (comment ngày mở đã "hóng chừng nào page bị khoá tiếp"). ⇒ teardown này dạy **giữ lửa**, không dạy **nhóm lửa**.

**Phát hiện lớn cho mảng tên miền:**
- 2 bài viral nhất đều là **joke đọc lệch chữ** ("Điều béo → m ốm"; "Em ơi cu / Cu đâu anh / Cũ như ỹ"). Cỗ máy tăng trưởng của họ = đúng cái mỏ tên miền không dấu, chỉ khác họ đào ngẫu nhiên từ chat khách còn tên miền là **mỏ lộ thiên**.
- Khán giả **biết chat có thể là dựng**, page không phủ nhận, họ vẫn chơi ⇒ **format hội thoại hư cấu được chấp nhận miễn hay** → giấy phép cho automation (máy sinh kịch bản chat → render ảnh → đăng; không cần khách thật, không cần video).

**Bảng chuyển giao (rút gọn):** template ảnh cứng ✓ | hội thoại punchline cuối ✓ | joke đọc lệch ✓ (mạnh hơn) | khách "mua vé" bằng inbox ✓ → "gửi tên để chị đọc" | page tự đăng 4–8 comment đầu ✓ (tự động được) | 0 bài bán trực tiếp, giá lộ trong ảnh ✓ | persona "sân sau" gánh rủi ro ✓ | 65% thả thính trai cởi trần ✗ (cần động cơ khác: "soi cái tên" thay vì soi cơ thể) | cộng đồng thừa kế ✗ (cold start còn bỏ ngỏ) | tên/avatar khách thật ✗ (Mắt Bão không được) | chơi với "vi phạm tiêu chuẩn cộng đồng" ✗ (page gốc đã bị hạn chế vì cái này).
