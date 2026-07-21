# TASKS: fanpage-content-create

Nguồn: chuyển đổi từ `docs/PLAN.md` (iMVP, 7 step, tất cả đã hoàn thành ở lần scaffold đầu).

## iMVP — Done

- [x] Step 1 — Scaffold skeleton (React+Vite+Express+Drizzle, theo mẫu marcow-crop) — `7163053`
- [x] Step 2 — Data model (users, signals, rubric_versions, scripts, characters, posts) + seed — `06e0593`
- [x] Step 3 — Auth (HMAC token) + API client layer — `612d264`
- [x] Step 4 — THU + LỌC (Market Radar / Group Insights client, rubric scoring, SignalsQueue) — `87c334f`
- [x] Step 5 — DỊCH + VẼ (social-proxy, script/image routes, text-overlay editor) — `61fe21b`
- [x] Step 6 — DUYỆT + ĐĂNG (state machine, kanban, checklist, ReadyToPost) — `f0d84ab`
- [x] Step 7 — Docs (CLAUDE.md, ARCH.md, README.md) + verify build/typecheck/docker — `48f93fd`

## Đã làm thêm sau iMVP ban đầu (2026-07-21, ngoài 7 step gốc)

- [x] Menu "Nhân vật" (`/characters`) — CRUD đầy đủ + upload ảnh + AI generate ảnh reference
- [x] Storage layer filesystem (`server/storage.ts`) cho ảnh nhân vật/upload
- [x] DỊCH + VẼ đổi từ social-proxy sang gọi Gemini trực tiếp (`GEMINI_API_KEY`)
- [x] UX reskin theo tông marcow-crop (màu cam đất + font Comic Neue/Inter)
- [x] Deploy beta nội bộ lên Coolify (`fanpage-content-create.mk.dev.matbao.ai`) + Postgres riêng + `GEMINI_API_KEY` thật (copy từ marcow-crop)

## Vòng rà soát + tối ưu (2026-07-21, sau codex review)

- [x] **Nhất quán nhân vật**: đưa ảnh reference (tối đa 3 nhân vật chủ lực) vào Gemini khi sinh ảnh bài viết (image-to-image) — trước đây chỉ truyền mô tả text
- [x] **Tối ưu lưu trữ**: ảnh biến thể + ảnh cuối bài viết chuyển từ base64 trong Postgres sang filesystem storage (`/api/files/<key>`), giảm phình DB
- [x] **Sửa luồng "Sửa thoại"**: mở lại đúng post cũ theo `postId` (không tạo post rác mới); ImageStudio hỗ trợ cả `?scriptId` (mới) lẫn `?postId` (sửa)
- [x] **LỌC LLM-assisted**: `/suggest-score` ưu tiên Gemini chấm 5 tiêu chí, fallback rule-based khi thiếu key/lỗi
- [x] **Content calendar** (`/calendar`): lịch bài theo tuần + giám sát tỉ lệ 3 trục 50/30/20 (cảnh báo lệch >10 điểm %)
- [x] **Bảo mật (codex HIGH)**: guard trạng thái + atomic `WHERE status` cho toàn bộ pipeline VẼ/DUYỆT/ĐĂNG (select-image/overlay/submit/checklist/approve/reject/request-edit/mark-posted) — chống kéo ngược state machine bài đã duyệt/đã đăng
- [x] **Bảo mật (codex MEDIUM)**: `/overlay` update DB trước, xoá file ảnh cũ sau (tránh mất ảnh khi lỗi giữa chừng)
- [x] **Hiệu năng**: thêm index DB (`signals.status/published_date`, `scripts.signal_id`, `posts.status/script_id`) — migration `0002`

## Đợt mở rộng lớn (2026-07-21) — Studio + kho dữ liệu + quản lý user

- [x] **Studio Vẽ tự do** (`/studio`) — tạo ảnh trực tiếp không cần tín hiệu/kịch bản: mô tả tự do + chọn nhân vật + đính ảnh tham chiếu (asset) + tỉ lệ khung + chia sẻ/riêng → sinh ảnh → overlay → gửi duyệt/lưu. `POST /api/studio/generate` (origin=studio, scriptId null)
- [x] **Chọn nhân vật khi tạo ảnh** — component CharacterPicker dùng chung Studio + ImageStudio (pipeline); `characterIds` override dàn mặc định theo trục
- [x] **Tự viết kịch bản** (freeform) — tab trong màn Kịch bản; `POST /api/scripts/freeform` (signalId null, source=freeform)
- [x] **Kho template meme + ảnh tham chiếu** (bảng `assets`, kind meme_template|reference) — upload + shared/riêng; owner-only sửa/xoá; dùng làm reference trong Studio
- [x] **Thư viện ảnh** (`/library`) — 2 tab: gallery ảnh đã tạo (lọc mine/shared/all, tải, lưu-làm-tham-chiếu) + tab template/tham chiếu
- [x] **Quản lý user** (`/admin/users`, chỉ admin) — CRUD user, đổi role, khoá/mở, reset mật khẩu; chặn tự-khoá/tự-hạ-quyền; không lộ passwordHash
- [x] **Ownership model** — owner + isShared cho posts/assets (pipeline mặc định shared team; Studio chọn riêng/chung); migration `0003`

## Rủi ro đã biết (chấp nhận cho iMVP nội bộ, fix sau nếu go-live rộng)

- Token đăng nhập (7 ngày) truyền qua query string `?token=` cho `GET /api/files/*` (vì `<img>` không gửi được header Authorization) — có thể lọt vào access log/history/Referer. Chấp nhận cho công cụ nội bộ; nếu go-live rộng nên đổi sang cookie HttpOnly same-origin hoặc token ngắn hạn scope theo file.
- Chưa có ownership/phân quyền theo user (cả team dùng chung 1 pipeline 1 fanpage — không multi-tenant); `posts.createdBy` là field audit chưa gắn phân quyền.

## Chưa làm

- [ ] Verify UI qua trình duyệt thật từ IP văn phòng/VPN (chỉ mới test qua curl/API — app đang ở scope nội bộ nên tôi không tự curl full page được)
- [ ] Điền nốt `.env` thật còn thiếu: `MARKET_RADAR_MCP_TOKEN`, `GROUP_INSIGHTS_MCP_TOKEN`, `FB_PAGE_ID`/`FB_ACCESS_TOKEN` (chỉ cần cho Phase 2 đăng tự động)
- [ ] Object storage cho **ảnh bài viết cuối** (`posts.imageVariants`/`finalImageUrl`) vẫn base64 trong Postgres — chỉ ảnh nhân vật đã chuyển sang filesystem storage; ổn ở quy mô hiện tại (<10 người/~1 bài/ngày) nhưng nên dọn nếu scale lên
- [ ] Luồng "Sửa thoại" nên patch lại post cũ thay vì tạo post row mới
- [ ] LỌC: hiện vẫn rule-based heuristic — có thể nâng lên LLM-assisted vì Gemini direct đã sẵn sàng (trước đây chặn vì chưa có SOCIAL_BACKEND_URL, giờ không còn lý do đó nữa)
- [ ] Dọn 1 bản ghi `GEMINI_API_KEY` trùng lặp trong Coolify env vars (không lỗi, chỉ hơi rối)
- [ ] Phase 2 (ngoài scope iMVP): đăng tự động qua social's scheduler, bước HỌC thật (insight + feedback loop rubric), content calendar view
- [ ] Phase 3: P0 alert tự động (chưa có nguồn xác nhận), multi-fanpage nếu mở rộng
