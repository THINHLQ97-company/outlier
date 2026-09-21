# PRD: Outlier — Viral Content Intelligence & Remake

**Owner**: Lâm Quang Thịnh (thinhlq@matbao.com)
**Team**: mk
**Status**: Đang triển khai (cập nhật 2026-09-18)
**Created**: 2026-09-18
**Thay thế**: `docs/archive/PRD-fanpage-engine-v1.md` (bản cũ định vị hẹp — meme engine cho 1 fanpage)

---

## 1. Problem Statement

Mỗi lần muốn làm một bài "học từ content đang nổ", người làm content phải:
1. Scroll rất lâu để tìm bài hay — và thường chọn nhầm theo lượt like tuyệt đối.
2. Xem đi xem lại để hiểu nó hook ở đâu, triển khai thế nào, vì sao người ta xem tiếp.
3. Viết lại cho ngành của mình, sửa thêm một vòng cho đúng giọng brand.

Một bài làm kỹ tốn **2–3 tiếng**. Làm hằng ngày thì không bền.

**Outlier** gom 3 việc đó vào một chỗ: tìm bài thực sự bật lên → bóc cấu trúc → viết lại cho brand, kèm dựng ảnh/video. Mục tiêu: rút đoạn "tìm bài tham khảo → bản remake đầu tiên" từ 2–3 tiếng xuống **vài phút**, với người đọc và sửa lần cuối.

### Vì sao tên "Outlier"
Trong thống kê, outlier là điểm nằm ngoài phân bố chung. Đó chính xác là thứ sản phẩm này đi tìm: **bài vượt ra ngoài quy mô kênh của nó**, không phải bài của kênh nổi tiếng.

---

## 2. Nguyên tắc sản phẩm (ràng buộc cứng, không phải mong muốn)

Bốn nguyên tắc này phải được cưỡng chế **bằng code/schema**, không bằng câu dặn trong prompt — vì model sẽ bịa khi bí:

| # | Nguyên tắc | Cách cưỡng chế |
|---|---|---|
| P1 | **Không bịa thông tin brand** | Mỗi field brand profile bắt buộc có `evidence{quote, source_url, offset}`. Không có evidence → field để trống, không ghi vào DB. |
| P2 | **Không bê nguyên câu chữ bài gốc** | Đo n-gram overlap với transcript gốc. Trùng ≥7 từ liên tiếp → chặn export, buộc viết lại đoạn đó. |
| P3 | **Không chế công dụng sản phẩm** | Mọi claim về sản phẩm phải khớp brand profile. Claim không có evidence → gắn cờ `unverified`, không cho export. |
| P4 | **Không tự đổi giọng brand** | Đối chiếu từ cấm + quy tắc xưng hô trong brand profile trước khi trả kết quả. |

Ngoài ra: **không tái sử dụng pixel/audio của bài gốc**. Remake = flow gốc + ruột mới + footage tự sinh. Đây vừa là ranh giới bản quyền, vừa là định nghĩa sản phẩm.

---

## 3. Target Users

| Vai trò | Nhu cầu |
|---|---|
| **Người làm content** (team mk, và các team khác của Mắt Bão) | Tìm bài đáng học trong ngách, hiểu vì sao nó nổ, ra bản nháp đúng giọng brand |
| **Quản lý marketing** | Xem bài nào đang outperform trong ngành, kiểm soát chất lượng trước khi đăng |
| **Claude (qua MCP)** | Điều khiển toàn bộ pipeline bằng hội thoại, không cần mở UI |

Scale: internal Mắt Bão, nhiều brand/nhiều team, <50 người dùng.

---

## 4. User Journeys

### J1 — Dạy nó hiểu brand (Brand Profile)
Người dùng đưa vào **website / fanpage / file PDF giới thiệu công ty**.
Hệ thống đọc và bóc ra:
- Brand bán gì (sản phẩm/dịch vụ, kèm công dụng được phép nói)
- Khách hàng là ai
- Cách nói chuyện (tông giọng)
- Xưng hô (gọi khách là gì, tự xưng là gì)
- Từ/cách diễn đạt **không** được dùng

**Mỗi field hiện kèm trích dẫn nguồn**: câu gốc + link + vị trí trong tài liệu.
Không tìm thấy → **để thiếu**, hiển thị "chưa có dữ liệu", không bịa cho đủ.

Người dùng có thể sửa tay từng field; field sửa tay được đánh dấu `source: manual`.

### J2 — Tìm content đang chạy tốt trong ngách (Radar)
Nhập **từ khoá ngách** hoặc **link đối thủ muốn soi**. Chọn nền tảng: Douyin / TikTok / YouTube / Instagram.

Hệ thống quét, gom về một chỗ, và **xếp hạng theo mức outperform so với chính quy mô kênh đó** — không xếp theo like tuyệt đối.

> Kênh 2.000 follower có bài 8.000 like được xếp trên kênh 14 triệu follower có bài 6.000 like.

Công thức (trọng số chỉnh được):
```
outperform_score = w1 · log(views / median_views_của_kênh)
                 + w2 · log(likes / follower_count)
                 + w3 · hệ_số_tươi(ngày_đăng)
```
Mấu chốt: **chuẩn hoá theo baseline của chính kênh đó**. Kênh chưa đủ dữ liệu baseline → đánh dấu `low_confidence`, không đẩy lên đầu.

### J3 — Bóc cấu trúc (Deconstruct)
Chọn một bài từ Radar, **hoặc paste link** (Douyin/TikTok/Facebook/YouTube), **hoặc upload video**.

Hệ thống phân tích và trả về cấu trúc:
- **3 giây đầu** đang làm gì
- **Mở vấn đề** kiểu nào
- **Giữ chân** đoạn giữa bằng gì (các beat giữ nhịp)
- **Twist** ở đâu
- **CTA** chốt thế nào

Với bài viết (text) cũng làm tương tự, bỏ phần thị giác.

### J4 — Remake cho brand
Từ cấu trúc đã bóc + brand profile → sinh bản mới: **giữ cách triển khai, thay ruột** (sản phẩm, khách hàng, thông tin của brand mình).

Kết quả kèm **guardrail report** (P1–P4 ở mục 2). Có cảnh báo → phải xử lý mới export được.

Người dùng sửa bằng hội thoại ("ngắn hơn", "đổi hook"), mỗi lần sửa chạy lại guardrail.

### J5 — Dựng hình ảnh / video
Từ bản remake → sinh ảnh (Gemini Imagen) hoặc video:
- **Gemini Imagen 4 + Veo 3.1 Lite** — mặc định, rẻ
- **Higgsfield** — cảnh cần chất lượng điện ảnh
- **FFmpeg** — luôn dùng: ghép, xfade, phụ đề, BGM ducking, Ken Burns

### J6 — Xuất kết quả
Đẩy sang **Google Sheet** để team dùng tiếp. Kèm link bài gốc + điểm outperform để người duyệt biết nó học từ đâu.

### J7 — Điều khiển bằng Claude (MCP)
Toàn bộ J1–J6 gọi được qua MCP từ Claude Desktop / Claude Code / claude.ai. Mọi việc chạy lâu trả `job_id` ngay, Claude poll `job_status`.

---

## 5. Phạm vi iMVP (Phase 1)

**Trong phạm vi**
- J1 Brand Profile có evidence (website + PDF; fanpage nếu có token)
- J2 Radar: f2 quét danh sách + Apify lấy metrics cho top ứng viên
- J3 Deconstruct video + bài viết
- J4 Remake + guardrail P1–P4
- J5 Sinh ảnh (Imagen); video giữ pipeline hiện có
- J7 MCP mở rộng
- Đăng nhập: giữ Google SSO hiện có, siết thêm (mục 7)

**Ngoài phạm vi Phase 1**
- Higgsfield (Phase 2 — cần API key + ngân sách)
- Đăng tự động lên fanpage
- Multi-tenant thật (phân quyền theo brand)
- Feedback loop tự học từ số liệu bài đã đăng

---

## 6. Giữ lại từ bản cũ

Không bỏ, vẫn là khối sản xuất của Outlier:
- **Studio** — sinh ảnh từ mô tả + nhân vật + phong cách
- **Thư viện** — Ảnh / Nhân vật (10 nhân vật) / Phong cách
- **Tín hiệu** + rubric — trở thành một nguồn đầu vào của Radar
- **RAG "ảnh đã thích"** — hồ sơ gu cá nhân
- **MCP Tín hiệu** 8 tool — giữ nguyên, thêm tool mới

Bỏ hẳn (đã gỡ khỏi code từ 2026-07-22, nay dọn nốt): bảng `scripts` + `scripts.routes.ts` (route mồ côi, không FE nào gọi).

---

## 7. Đăng nhập & bảo mật

Đã có: local (scrypt) + **Google SSO** + admin duyệt user + `requireAdmin` re-check DB mỗi request.

Cần bổ sung ở Phase 1:
- Rate-limit `/api/login` và `/api/oauth/authorize`
- Giới hạn domain `@matbao.com` khi tạo tài khoản Google mới
- Bỏ `?token=` trên URL ảnh → signed URL ngắn hạn hoặc cookie
- Service token nội bộ cho khối media (không mở ra Internet)

---

## 8. Data Model (bổ sung)

Bảng mới:
| Bảng | Mục đích |
|---|---|
| `brands` | brand profile; mỗi field kèm evidence |
| `brand_sources` | tài liệu đã ingest (url/pdf), text đã trích |
| `radar_jobs` | phiên quét (keyword/competitor, platforms) |
| `radar_items` | bài tìm được + **metrics** (views, likes, comments, shares, follower_count) + `outperform_score` |
| `channel_baselines` | median views/likes theo kênh — để chuẩn hoá |
| `deconstructions` | cấu trúc đã bóc (hook_3s, problem_open, retention_beats[], twist, cta) |
| `remakes` | bản remake + `guardrail_report` + link nguồn |

Bảng `channel_videos` (từ clipchatbot) **phải thêm cột metrics** — hiện chỉ có title/cover/duration, không đủ để tính outperform.

---

## 9. Success Metrics

| Chỉ số | Mục tiêu |
|---|---|
| Thời gian "tìm bài → bản remake đầu tiên" | ≤ 5 phút (từ 2–3 tiếng) |
| Tỉ lệ bản remake dùng được sau 1 vòng sửa tay | ≥ 60% |
| Tỉ lệ field brand profile có evidence thật | 100% (theo P1, không có evidence thì không ghi) |
| Guardrail chặn đúng | 0 bản export lọt câu trùng ≥7 từ với bài gốc |

---

## 10. Rủi ro đã biết

| Rủi ro | Xử lý |
|---|---|
| ToS TikTok/Douyin cấm scrape tự động | Dùng Apify cho metrics; giữ nhịp quét thấp; không scrape nội dung riêng tư |
| Bản quyền khi remake | Không tái sử dụng pixel/audio gốc; guardrail P2 chặn trùng câu |
| Cookie Douyin là tài khoản cá nhân | Đã siết quyền file; nên chuyển sang tài khoản riêng cho công cụ |
| Model bịa khi thiếu dữ liệu | P1/P3 cưỡng chế bằng schema evidence |
| Chi phí Apify + Higgsfield | Apify chỉ gọi cho top ứng viên; Higgsfield tắt mặc định ở Phase 1 |

---

## 11. Trạng thái triển khai (cập nhật 2026-09-18)

Ghi lại để **docs không lệch code** — đúng vấn đề mà bản PRD cũ mắc phải.

| Phần | Trạng thái | Ghi chú |
|---|---|---|
| J1 Brand Profile | ✅ Xong | UI + MCP; evidence cưỡng chế bằng schema |
| J2 Radar | ✅ Xong | UI + MCP; quét miễn phí (yt-dlp) + bổ sung số liệu (Apify) |
| J3 Deconstruct | ✅ Xong | UI + MCP; mốc thời gian đối chiếu độ dài video thật |
| J4 Remake + guardrail | ⏳ Backend + MCP xong, UI đang dựng | 4 loại kiểm tra, 27 test riêng |
| J5 Sinh ảnh/video | ⬜ Chưa | Studio (sinh ảnh) đã có sẵn từ bản cũ |
| J6 Xuất Google Sheet | ⬜ Chưa | |
| Higgsfield | ⬜ Chưa | Phase 2, cần API key + ngân sách |
| Gộp clipchatbot | ⏳ Một phần | Dockerfile đã có ffmpeg + yt-dlp + Python; **chưa port sidecar f2 (Douyin)** |

**MCP: 19 tool** (ban đầu 8). **Test: 110** (ban đầu 0).

### Những gì còn thiếu để chạy thật
1. **`GEMINI_API_KEY`** — thiếu thì Brand Profile, Deconstruct, Remake đều trả kết quả rỗng kèm cảnh báo (không crash, nhưng cũng không dùng được).
2. **Sidecar f2 cho Douyin** — hiện Radar báo "chưa nối trong bản này" khi chọn Douyin.
3. **Instagram** — không quét miễn phí được, phải qua Apify.

### Số đo thực tế đã kiểm chứng
- Apify: **~$0,0035/kết quả**, tính theo số kết quả (không theo lượt chạy). Gói STARTER $29/tháng.
- Quét Radar: phản hồi **0,093 giây** (chạy nền), quét xong 30-90 giây.
- ffmpeg 5.1 của Debian **đủ dùng** — có `zoompan`, `xfade`, `sidechaincompress`, `subtitles`, `atempo`.
