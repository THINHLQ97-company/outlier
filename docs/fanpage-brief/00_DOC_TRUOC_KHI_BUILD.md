# BUILD BRIEF — Fanpage tên miền "đọc lệch" của Mắt Bão

> **Đọc file này đầu tiên.** Đây là bản bàn giao để tiếp tục xây dựng công cụ trên Claude Code.
> Gói này gồm: chiến lược đã chốt, đối chiếu ý CEO, kiến trúc công cụ, và 4 skill (1 đã có bản chạy được, 3 đang ở dạng spec để bạn dựng tiếp).
>
> Người phụ trách: Lâm Quang Thịnh (Acting MKT Manager, Mắt Bão). CEO: anh Duy.
> Ngày đóng gói: 18/09/2026.

---

## 0. Sản phẩm trong một câu

Fanpage **"Ăn Thịt Anh Lập Trình"** (tên chốt 22/09; khán giả lệch về dân code/dev) — persona hư cấu (nữ seller "tưng tửng", faceless), lấy **tên miền tiếng Việt không dấu đọc lệch nghĩa** làm động cơ nội dung: page chỉ đưa một chuỗi không dấu + hỏi "nếu đăng ký `X.vn` thì mấy chị đọc là gì?", **khán giả tự đọc lệch ra nghĩa vui/bậy**, page giả ngây thơ. Mỗi bài là một tên miền thật, tra trống thật, CTA "còn trống, ai lấy ib chị" nằm trong comment. Đằng sau là một **công cụ tự động hoá dây chuyền sản xuất** (bắt trend → sinh chuỗi → chấm điểm → lọc an toàn → nháp bài) nhưng **giữ con người ở khâu chơi chữ và nút đăng**.

> **Bổ sung 22/09 — khả năng "remake":** ngoài sinh câu đố từ thời sự, tool còn **quét bài hot của page/nền tảng khác → mổ cơ chế → remake** sang giọng của mình. Việc cào KHÔNG do Claude làm (cloud không cào được FB/TikTok) mà **tái dùng tool sẵn có** (Martrend, Trend Radar TikTok VN); Scheduled đóng vai đồng hồ điều phối. Chi tiết ở §4b và `skills/content-remake-radar/SPEC.md`.

---

## 1. Nguyên tắc số một khi build (đọc kỹ)

**"Bắt trend", KHÔNG PHẢI "đu trend".**
Công cụ tự động hoá phần **cơ học + bản nháp một**; con người giữ **punchline (chơi chữ) và quyết định đăng**. Đây không phải bước đệm tạm thời — với một page cạnh biên đứng sau thương hiệu B2B, để máy tự chốt câu chơi chữ hai nghĩa và tự đăng là **rủi ro brand thật**. Kể cả khi model mạnh hơn, khâu này vẫn nên có người.

Ranh giới tự động hoá **chia theo rủi ro, không chia theo công đoạn**:

| Khâu | Ai làm |
|---|---|
| Tìm tin/chuỗi, cắt dấu, sinh cách đọc, chấm điểm, lọc an toàn, xuất JSON, lên lịch | **Máy — tự động hoàn toàn** |
| Trả lời có kịch bản rõ (hỏi giá, hỏi còn trống, cảm ơn) | Máy — tự động |
| Chọn bài cuối + biên tập punchline/chơi chữ + "đọc thử bằng tai" | **Người** |
| Comment đùa qua lại, inbox tư vấn (2–3 tháng đầu) | Máy soạn — **người bấm gửi** |

---

## 2. Ba luật cứng (guardrail — viết vào mọi skill)

1. **Lấy từ khoá từ thời sự, KHÔNG lấy người từ thời sự.** Câu đố chỉ có chuỗi không dấu; không nêu tên người thật trong caption. Ai theo tin tự nhận ra, ai không vẫn chơi được.
2. **Hai loại tục:**
   - Tục khi **đọc thẳng** (không cần lái, ai nhìn cũng thấy) → **CHẶN**. Đăng lên tức là page nói.
   - Chỉ tục **sau khi lái/đặt dấu khác** → **CHỌN**. Cách đọc sạch là mặc định của page; cách đọc bậy là công của khán giả. Đây là "vàng".
   - **Tục là tiêu chí CHỌN bài, không bao giờ là NỘI DUNG bài.** Trộn nhiều "loại nổ" để pattern không biến thành "page đố tục của Mắt Bão".
3. **Page không bao giờ giữ tên miền mình đã đưa lên. Đăng là nhường.** (Tránh front-running — từng thành scandal với nhà đăng ký nước ngoài; lộ một lần là kênh chết.)

Bổ sung (ảnh gợi): được phép nhưng **mờ để xoá danh tính** (không mặt/hình xăm/bối cảnh nhận ra được), **nguồn sinh/stock** không phải người thật, **không boost ads**, **< 20% số bài**, và **"chị" không bao giờ bình phẩm cơ thể** — chị đọc theo nghĩa đen, khán giả mới nói ảnh có gì.

Bổ sung (đang cân nhắc — 1 trong 3 quyết định mở): **không lấy cụm từ từ tin có người chết/bị thương/đang là nạn nhân**, kể cả khi cụm đó tự nó vô hại.

---

## 3. Bản đồ 4 skill + thứ tự build

| # | Skill | Vai trò | Trạng thái |
|---|---|---|---|
| 1 | **domain-riddle-engine** | Lõi: nhận chuỗi không dấu → sinh cách đọc (4 phép) → chấm điểm → gắn nhãn an toàn → tra trống → xuất bảng + nháp + JSON | ✅ **Có bản chạy được** (SKILL.md + script + references + evals) — cần hardening |
| 2 | **persona-bible** | Nhân vật "chị": tuổi, xưng hô, 2 register có biên, câu cửa miệng, "không bao giờ hiểu", điều không bao giờ làm, mẫu self-comment. *Đây chính là "skill ngôn ngữ đọc giọng khách" CEO muốn — nhưng dạng "tính cách cố định, ngữ vực linh hoạt có biên".* | 📝 Spec (SPEC.md) |
| 3 | **fanpage-ops** | Vận hành: template ảnh, lịch đăng, comment dạo, luật ads, chỉ số, vòng duyệt người | 📝 Spec |
| 4 | **channel-teardown** | Mục tiêu gốc của CEO: tìm kênh hay của một brand → soi theo khung A–G (4 tầng) → bảng chuyển giao. Bản teardown AVOCA là mẫu output. *Cũng là nhịp 4 của remake-radar.* | 📝 Spec |
| 5 | **content-remake-radar** | Tầng MỚI: cào bài hot page khác (tái dùng Martrend/Trend Radar) → chấm → mổ cơ chế → remake. Điều phối bằng Scheduled. **Phần duy nhất phải xây mới.** | 📝 Spec |

**Thứ tự đề nghị:** 1 (lõi) → 2 (cần cho bài đầu) → 4 (làm lúc nào cũng được, có mẫu sẵn) → 3 (sau khi test thủ công có dữ liệu) → 5 (khi muốn tự động hoá nguồn bài từ remake).

---

## 4. Kiến trúc công cụ (pipeline "bắt trend")

```
[0] NGUỒN ĐẦU VÀO (chọn 1 hoặc nhiều)
    • Tự tìm tin hot trong ngày (WebSearch / news-radar / group-insights)
    • Dán đoạn tin / link bài báo
    • Danh sách từ khoá cho sẵn
    • Chuỗi không dấu cho sẵn (để chấm điểm)
        │
        ▼
[1] TÁCH CỤM → cắt dấu → chuỗi không dấu  ── (bỏ tên người: luật cứng #1)
        │
        ▼
[2] SINH CÁCH ĐỌC (4 phép — phần cơ học, script chạy):
    a. Đặt lại dấu     (cu → cũ / cụ / cú)
    b. Ngắt lại từ     (dichvutumat → dịch vụ tu mát / tù mặt…)
    c. Nói lái         (tráo vần±thanh, tráo thanh, tráo phụ âm đầu, đảo âm tiết)
    d. Đọc tiếng khác  (chuỗi ↔ tiếng Anh)
        │
        ▼
[3] GẮN NHÃN AN TOÀN mỗi cách đọc:  A-chan / B-vang / C-sach   (luật cứng #2)
        │
        ▼
[4] CHẤM ĐIỂM 0–10 (hiển nhiên • đa dạng • hợp thời • đường chơi • an toàn)
        │
        ▼
[5] TRA TÊN MIỀN CÒN TRỐNG   ← cần API/công cụ nội bộ Mắt Bão (CHƯA CÓ, xem §5)
        │
        ▼
[6] ĐẦU RA: (1) Bảng ứng viên  (2) Nháp caption + self-comment  (3) JSON cho tool
        │
        ▼
[7] ★ CON NGƯỜI: chọn bài + biên tập chơi chữ + "đọc thử bằng tai" → mới đăng ★
```

Bước [2]–[5] là "tool tự động" CEO muốn. Bước [7] là chỗ giữ người. JSON ở [6] là khớp nối để sau này gắn tool đăng bài / lên lịch.

---

## 4b. Nhánh REMAKE — quét bài hot page khác → mổ cơ chế → remake

Song song với nhánh "câu đố từ thời sự", tool có nhánh **remake** (chi tiết: `skills/content-remake-radar/SPEC.md`).

**Nguyên tắc nền:** Claude chạy cloud **không cào được Facebook/TikTok**. Nên **KHÔNG để Claude làm bot cào** — việc cào do **tool sẵn có / dịch vụ nền** lo, Claude đọc kho ra để phân tích + remake.

```
[1] CÀO (Martrend / Trend Radar TikTok VN / API — chạy nền)  → bài hot + tương tác + ảnh
[2] LƯU KHO (dedupe, gắn thẻ)
[3] CHẤM "đáng remake" (tương tác cao × hợp persona × an toàn)
[4] MỔ CƠ CHẾ  → skill channel-teardown (khung A–G, nhãn quan sát/suy đoán)
[5] REMAKE     → persona-bible + domain-riddle-engine (dựng bài MỚI, không clone)
[6] ★ NGƯỜI: biên tập chơi chữ + duyệt ★
[7] ĐĂNG / HẸN LỊCH → fanpage-ops
```

**Vai trò Scheduled (hẹn giờ):** là **đồng hồ + điều phối**, không phải bot cào. Mỗi sáng mở phiên → gọi nguồn cào → chấm → mổ → nháp remake → lưu hàng đợi → **nhắc người**. Không tự đăng. (Nếu buộc cào bằng Claude in Chrome thì phiên cloud không có máy anh → mong manh; ưu tiên nguồn cào chạy nền.)

**Luật cứng thêm: REMAKE = CƠ CHẾ, KHÔNG CLONE.** Lấy công thức vì sao bài nổ, không lấy nội dung/ảnh/tên/logo của page nguồn. Bê nguyên về đổi chữ = dính bản quyền + bị nhận ra "page đi chép".

**Phần mới duy nhất phải xây:** *bộ nối đọc nguồn cào* + *cái kho lưu bài đã cào*. Mọi thứ khác tái dùng skill có sẵn.

---

## 5. Phụ thuộc kỹ thuật cần chốt với Mắt Bão

- **Tra tên miền còn trống:** Thịnh xác nhận *Mắt Bão có API/công cụ nội bộ, sẽ cung cấp.* Hiện script trả `chua-tra`. Chỗ cần cắm vào: `skills/domain-riddle-engine/references/tra-ten-mien.md` (đang để trống phần "cách gọi") và hàm `tra_trong()` trong pipeline. **Việc cho Claude Code: định nghĩa interface (input: chuỗi + TLD; output: còn trống / đã đăng ký / giá), rồi cắm API thật khi có key.**
- **Nguồn tin hot:** WebSearch + (tuỳ chọn) các MCP radar nội bộ của team (news-radar, group-insights, Trend Radar TikTok, Martrend). Trên Claude Code có thể không có sẵn các MCP đó — thiết kế để **degrade** về WebSearch nếu thiếu.
- **Từ điển tiếng Việt** để xác thực "âm tiết có nghĩa" khi ngắt từ và khi chấm "hiển nhiên": nên nạp một wordlist tiếng Việt (âm tiết hợp lệ + từ có nghĩa). Hiện script dùng bộ luật ghép âm; **nên nâng cấp bằng wordlist thật** (đây là hardening quan trọng nhất).

---

## 6. Ba quyết định đang mở (cần Thịnh/CEO chốt, đừng tự quyết)

1. **Giọng caption:** bản nháp máy sinh còn hơi dài và "giải thích" — chưa chắc đã ra giọng "chị". Cần người chấm giọng để nắn rubric (hạt giống cho persona-bible).
2. **Luật tin có nạn nhân:** có nâng "không lấy cụm từ tin có người chết/bị thương" thành **luật cứng thứ 4** không? (Hiện mới là "rủi ro vừa".)
3. **Chữ tục trong file:** JSON hiện có trường `khong_noi` chứa cách đọc tục để lọc → chữ tục nằm trong file tool. Đề xuất: `khong_noi` chỉ lưu **số đếm + nhãn** (`{"loai":"tuc-lai","so_cach":1}`), không lưu chuỗi; ai cần kiểm tra thì chạy lại script (tái tạo được).

---

## 7. Giả định rủi ro nhất (phải test trước khi tự động hoá đăng bài)

Trò đố có đủ sức kéo người quay lại **một page lạ** hằng ngày không? AVOCA có 2 lợi thế mình **không có**: động cơ ham muốn (thả thính trai) và **cộng đồng thừa kế** (0→53K là relaunch, không phải cold start). 
**Cách test rẻ nhất:** đăng thủ công 10–15 câu đố qua comment dạo + group trong 2–3 tuần. Không ai chơi → sửa **format**, không sửa ngân sách.

---

## 8. File trong gói này

```
00_DOC_TRUOC_KHI_BUILD.md      ← file này (đọc đầu tiên)
01_CHOT_chien-luoc.md          ← toàn bộ quyết định đã chốt (persona, động cơ, format, nhóm lửa…)
02_CEO_muon_vs_ban_chot.md     ← rút ý CEO từ chat + đối chiếu với bản chốt
skills/
  domain-riddle-engine/        ← ✅ skill lõi, chạy được
    SKILL.md
    scripts/lai_engine.py      ← phần cơ học (cắt dấu, ngắt từ, nói lái)
    references/nhan-va-cham-diem.md
    references/dinh-dang-dau-ra.md
    references/tra-ten-mien.md  ← chờ API Mắt Bão
    evals/prompts.md
  persona-bible/SPEC.md        ← 📝 spec để build
  fanpage-ops/SPEC.md          ← 📝 spec để build
  channel-teardown/SPEC.md     ← 📝 spec để build (có tóm tắt mẫu AVOCA)
  content-remake-radar/SPEC.md ← 📝 tầng cào+remake (mới; tái dùng Martrend/Trend Radar)
docs/                          ← (để trống — nơi Claude Code ghi tài liệu build)
```

**Việc còn thiếu mà Thịnh nên bổ sung cho Claude Code:** bản teardown AVOCA đầy đủ (bản gốc "nội dung fetching" — hiện gói chỉ có phần tóm tắt phát hiện trong `02_...` và `channel-teardown/SPEC.md`).
