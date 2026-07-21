# PRD: fanpage-content-create

**Owner**: Lâm Quang Thịnh (thinhlq@matbao.com)
**Team**: mk
**Status**: Approved
**Created**: 2026-07-21

## 1. Problem Statement

Fanpage "Ăn Nằm Với AI" hiện sản xuất nội dung thủ công, không đều tay, không có dàn nhân vật cố định → tương tác gần như bằng 0 dù art đẹp. Team marketing cần một content engine bán tự động biến trend/pain-point thật thành meme 1-2 khung theo đúng công thức đã được kiểm chứng ở fanpage Bò và Gấu, với 1 người vận hành ra 1 bài/ngày, thời gian chạm tay ≤30 phút/bài.

Nguồn spec nghiệp vụ gốc: `MATBAO_FANPAGE_ENGINE_v3.md` (dàn nhân vật cố định, 3 trục nội dung, checklist duyệt bài, prompt template).

## 2. Target Users

| Vai trò | Nhu cầu |
|---|---|
| **Người vận hành content** (marketing, team mk) | Xem hàng đợi tín hiệu đã lọc, sinh kịch bản + ảnh, duyệt/sửa/rớt, đăng bài — tất cả trong 1 màn hình, ≤30 phút/ngày |
| **Người duyệt cuối** (có thể trùng vai trên) | Chạy checklist 14 mục trước khi đăng, chịu trách nhiệm rủi ro thương hiệu |
| **Người đọc số hàng tuần** (thứ 2 hằng tuần) | Xem reach/share/comment 7 bài tuần trước, chỉnh rubric lọc |

Scale: internal, <10 người dùng (team marketing nội bộ Mắt Bão).

## 3. User Journeys (iMVP)

**J1 — Xem hàng đợi tín hiệu (THU + LỌC)**
Vào dashboard → hệ thống hiển thị tín hiệu mới từ Market Radar (radar marketing-kd + ke-toan) + Group Insights (cluster xuyên nhóm) trong 14 ngày gần nhất, đã chấm điểm theo rubric 5 tiêu chí → xếp theo điểm, lọc theo ngưỡng (≥16 vào hàng đợi sản xuất, 12-15 kho ý tưởng, <12 ẩn).

**J2 — Sinh kịch bản (DỊCH)**
Chọn 1 tín hiệu → chọn trục (AI/kế toán/hosting) + format meme (F1-F7) → hệ thống gọi Gemini (qua social backend REST) sinh 3 phương án kịch bản theo prompt template mục 4.2 của spec → chọn 1 phương án.

**J3 — Sinh ảnh + hậu kỳ (VẼ)**
Từ kịch bản đã chọn → hệ thống ghép style chung + mô tả nhân vật (character reference library) + mô tả khung → gọi social's `/generate-image` sinh 2 biến thể ảnh KHÔNG chữ → người dùng chọn 1 ảnh → mở text-overlay editor (kéo-thả text box lên ảnh, đặt watermark MATBAO/MATBAO INVOICE góc dưới phải opacity ~60%) → export ảnh cuối.

**J4 — Duyệt (DUYỆT)**
Bài vào queue "Chờ duyệt" (kanban 3 cột: Chờ duyệt / Sửa thoại / Rớt) → người duyệt chạy checklist 14 mục (mục 5 spec) → Duyệt (chuyển "Sẵn sàng đăng") / Sửa thoại (quay lại J3) / Rớt (quay lại J2, ghi lý do).

**J5 — Đăng bài (ĐĂNG) — thủ công trong iMVP**
Bài "Sẵn sàng đăng" → hệ thống hiển thị ảnh cuối + caption → người vận hành copy/tải về, tự đăng lên Facebook (Ban Page thật). Đánh dấu "Đã đăng" trong app để tính vào lịch sử.

## 4. Functional Requirements

### THU
- FR1.1: Backend job (thủ công trigger hoặc cron) gọi Market Radar MCP (`market_radar_list_articles`, 2 radar) + Group Insights MCP (`group_list_clusters` cross_group=true) qua HTTP JSON-RPC, lưu tín hiệu thô vào bảng `signals`.
- FR1.2: Chỉ giữ tín hiệu trong 14 ngày gần nhất.
- FR1.3: Nguồn "sự cố hạ tầng toàn cầu" và "lịch mùa vụ" — v1 dùng form nhập tay (người vận hành tự thêm tín hiệu P0/lịch mùa vụ thủ công vào `signals` qua UI), không tích hợp tự động (chưa có nguồn xác nhận).

### LỌC
- FR2.1: Mỗi tín hiệu chấm 5 tiêu chí (độ nóng, độ chạm, độ hợp trục, tuổi thọ, độ an toàn), thang 1-5, tổng ≤20.
- FR2.2: Ngưỡng: ≥16 → hàng đợi sản xuất; 12-15 → kho ý tưởng; <12 → ẩn. Dính nhóm ⛔ (mục 3.3) → loại thẳng bất kể điểm.
- FR2.3: v1: chấm điểm bán tự động — hệ thống gợi ý điểm (rule-based từ glossary mục 3.2 + LLM), người vận hành có thể sửa tay trước khi chốt.
- FR2.4: Rubric (trọng số/ngưỡng) lưu dạng version có thể chỉnh từ màn hình HỌC, ghi lịch sử thay đổi.

### DỊCH
- FR3.1: Prompt template đúng mục 4.2 spec, ghép tín hiệu + trục + glossary + dàn nhân vật + format meme đã chọn.
- FR3.2: Gọi Gemini text-gen qua social backend REST, trả về đúng 3 phương án dùng 3 format khác nhau.
- FR3.3: Lưu kịch bản đã chọn vào bảng `scripts`, liên kết `signals`.

### VẼ
- FR4.1: Character reference library: lưu prompt mô tả nhân vật (mục 2.4) + ảnh tham chiếu (nếu có) cho Gàn/Gèn/chị Bão/Sếp/5 AI, dùng làm input image-to-image.
- FR4.2: Gọi social's `/generate-image` (Gemini 2.5 flash image) sinh 2 biến thể/kịch bản, ảnh KHÔNG chữ.
- FR4.3: Text-overlay editor: kéo-thả text box (nhãn ≤8 từ) lên ảnh, chèn watermark theo brand đúng trục (MATBAO / MATBAO INVOICE), export ảnh PNG cuối.

### DUYỆT
- FR5.1: Kanban 3 cột: Chờ duyệt / Sửa thoại / Rớt, mỗi thẻ = 1 bài (ảnh cuối + caption).
- FR5.2: Checklist 14 mục (mục 5 spec) dạng form, phải tick hết mới được bấm "Duyệt".
- FR5.3: Action "Rớt" bắt buộc nhập lý do, ghi lại để tham khảo khi DỊCH lại.
- FR5.4: SLA hiển thị: cảnh báo nếu bài chờ duyệt >4h.

### ĐĂNG (iMVP = thủ công)
- FR6.1: Màn hình "Sẵn sàng đăng" hiển thị ảnh cuối, caption, nút "Tải ảnh" + "Copy caption".
- FR6.2: Nút "Đánh dấu đã đăng" (nhập link bài Facebook thật) → chuyển bài vào lịch sử, phục vụ bước HỌC ở Phase 2.

> **Không làm seeding comment/auto-reply tự động** — fanpage giải trí, tương tác thật quan trọng hơn comment giả lập. Loại bỏ hoàn toàn khỏi scope (không chỉ defer Phase 2).

### Đề xuất thêm (optional, cần user duyệt riêng trước khi vào scope — KHÔNG tự động nằm trong iMVP)
- Content calendar view (lịch tuần theo dõi tỉ lệ 3 trục 50/30/20).
- Rubric history/version log UI riêng (FR2.4 đã có phần lưu version, nhưng UI xem lịch sử là optional).
- P0 alert tự động khi có sự cố hạ tầng/chính sách thuế (phụ thuộc nguồn dữ liệu FR1.3 — chưa có).

## 5. Non-functional Requirements

- Internal tool, <10 users, không cần auth phức tạp — dùng lại pattern auth đơn giản (username/password + token) như marcow-crop.
- Ảnh sinh ra không lưu API key ở client — mọi gọi Gemini/social backend đi qua server-side proxy.
- Vietnamese text overlay phải hỗ trợ dấu tiếng Việt đầy đủ (font Unicode).
- Thời gian thao tác 1 bài từ J2→J4 ≤30 phút (mục tiêu spec).

## 6. Data Model (high-level)

- `signals` (id, source [market_radar|group_insights|manual], radar/trục, raw_summary, published_date, score_json, status [new|scored|queued|idea_bank|rejected], created_at)
- `rubric_versions` (id, weights_json, thresholds_json, note, created_at, created_by)
- `scripts` (id, signal_id, truc, format_meme, content_json [3 phương án], selected_variant, created_at)
- `characters` (id, name, prompt_description, reference_image_url)
- `posts` (id, script_id, image_variants[], selected_image_url, overlay_json, final_image_url, caption, status [cho_duyet|sua_thoai|rot|san_sang_dang|da_dang], checklist_json, reject_reason, fb_post_url, created_at, decided_at, posted_at)
- `users` (id, username, password_hash, role) — theo pattern marcow-crop

## 7. Integrations

| Hệ thống | Vai trò | Giao thức | Trạng thái credential |
|---|---|---|---|
| Market Radar MCP (`marcommatbao.net/api/mcp-market-radar`) | Đọc tín hiệu marketing-kd + ke-toan | HTTP JSON-RPC 2.0, token `MARKET_RADAR_MCP_TOKEN` | **Chưa có — cần user cung cấp** |
| Group Insights MCP (`marcommatbao.net/api/mcp-group-insights`) | Đọc cluster group Facebook | HTTP JSON-RPC 2.0, token `GROUP_INSIGHTS_MCP_TOKEN` | **Chưa có — cần user cung cấp** |
| social backend (`share-projects/social`) | Gemini text/image gen (DỊCH/VẼ) | REST (Swagger có sẵn) | **Cần base URL nội bộ — user cung cấp** |
| Facebook Graph API (page "Ăn Nằm Với AI") | Đăng bài (Phase 2 tự động; iMVP: chỉ tham chiếu, đăng thủ công) | — | **Cần Page ID + access token — user cung cấp** |

## 8. Out of Scope

- **Seeding comment tự động + auto-reply — loại bỏ hoàn toàn khỏi mọi phase**, không phải defer. Fanpage giải trí, không cần comment giả lập; social's `auto-reply.service.js`/`auto-reply-executor.js` sẽ KHÔNG được tích hợp.
- Đăng bài tự động + lịch đăng qua social's scheduler (Phase 2)
- Bước HỌC: đọc insight thật + feedback loop chỉnh rubric tự động (Phase 2, cần ≥1 tuần dữ liệu)
- P0 alert tự động (chưa có nguồn dữ liệu xác nhận)
- Content calendar view, rubric history UI (optional — chờ user duyệt riêng)
- Multi-fanpage / multi-tenant (hiện chỉ 1 fanpage "Ăn Nằm Với AI")

## 9. Success Criteria (iMVP)

- Demo end-to-end: từ 1 tín hiệu thật (Market Radar hoặc Group Insights) → ra 1 ảnh cuối có watermark + caption, đã qua duyệt, sẵn sàng đăng thủ công.
- Thao tác J2→J4 đo được ≤30 phút cho 1 bài trong demo.
- `docker compose up` chạy sạch, seed data đủ demo (kể cả khi chưa có MCP token thật — dùng seed tín hiệu giả lập).

## 10. Phase Plan

| Phase | Scope | Ghi chú |
|---|---|---|
| **iMVP (Phase 1)** | THU (đọc MCP, ≥form nhập tay) → LỌC (scoring bán tự động) → DỊCH (Gemini text) → VẼ (Gemini image + text-overlay editor) → DUYỆT (kanban + checklist) → ĐĂNG thủ công | Scope PRD này |
| **Phase 2** | ĐĂNG tự động qua social's scheduler/queue, HỌC (insight thật + feedback loop rubric), content calendar view | Cần ≥1 tuần vận hành iMVP để có dữ liệu |
| **Phase 3** | P0 alert tự động (khi có nguồn xác nhận), multi-fanpage nếu mở rộng | Tùy nhu cầu thực tế |
