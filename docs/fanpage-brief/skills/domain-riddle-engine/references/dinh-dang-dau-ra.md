# Định dạng đầu ra (cố định) — 3 phần

## Phần 1 — Bảng ứng viên
Cột: `# | Chuỗi | Nguồn | Đọc mặc định (của chị) | Cách đọc của khán giả | Nhãn | Loại nổ | Điểm | Trống? | Rủi ro`
- "Đọc mặc định (của chị)" = cách đọc sạch, ngây thơ mà persona sẽ dùng.
- "Cách đọc của khán giả" = các cách lệch (ghi phép trong ngoặc: dấu / lái…). **Cách bậy KHÔNG viết thẳng** — ghi "1 cách lái tục → xem khong_noi".
- Cuối bảng: liệt kê chuỗi **đã chặn** + lý do; và gợi ý **nhịp trộn** cho lượt đăng.

## Phần 2 — Nháp bài (cho mỗi chuỗi được chọn)
```
<chuoi>.vn — điểm X, nhãn Y
Cách đọc của chị: <nghĩa sạch>
Caption: <1 dòng, giọng "chị", kết :)) — KHÔNG chứa chữ tục>
Self-comment: (4–8 comment page tự đăng để giữ nhịp)
  - <comment 1: chị đọc nghĩa đen, giả ngây thơ>
  - <comment 2: "mấy chị đọc gì á">
  - <comment 3: CTA "còn trống, ai lấy ib chị, chị không giữ đâu :))">
  - <comment 4: rủ tag bạn>
Không nói: <mô tả — KHÔNG chép chữ tục nếu áp dụng quyết định mã hoá>
```
Giọng bám `persona-bible` (khi có). Trước khi có: giọng tạm = thật thà, tưng tửng, xưng "chị".

## Phần 3 — JSON (khớp nối cho tool tự động về sau)
```json
{
  "ngay": "YYYY-MM-DD",
  "nguon_dau_vao": "tin-hot | tin-dan | tu-khoa | chuoi-cho-san",
  "ung_vien": [
    {
      "chuoi": "danhphan", "tld": ["vn","com"],
      "nguon": "<mô tả nguồn, không nêu tên người>",
      "cach_ngat": ["danh phan"],
      "doc_mac_dinh": "danh phận",
      "cach_doc": [
        {"cum":"...", "phep":"dau|lai|ngat|tieng-khac", "nghia":"...", "hien_nhien":"cao|vua|thap", "tuc": false}
      ],
      "nhan": "A-chan|B-vang|C-sach",
      "loai_no": ["nguoc-doi","tin-nong"],
      "diem": {"hien_nhien":2,"da_dang":2,"hop_thoi":2,"duong_choi":2,"an_toan":1,"tong":9},
      "trong": {"vn":"chua-tra|con-trong|da-dang-ky","com":"chua-tra"},
      "rui_ro": "thap|vua|cao — <ghi chú>",
      "bai": {"caption":"...", "self_comment":["...","..."], "cta_index":2, "khong_noi": []}
    }
  ],
  "da_chan": [{"chuoi":"...","ly_do":"..."}],
  "nhip_tron": "<gợi ý thứ tự đăng>"
}
```

### Quyết định đang mở về `khong_noi`
Hiện `khong_noi` chứa chuỗi cách đọc tục (để lọc). Đề xuất đổi thành **chỉ số đếm + nhãn**, không lưu chữ:
```json
"khong_noi": [{"loai":"tuc-lai","so_cach":1}]
```
Ai cần kiểm tra cách đọc cụ thể thì chạy lại `lai_engine.py` (tái tạo được). → Chờ Thịnh/CEO chốt.
