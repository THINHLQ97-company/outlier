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

## Chưa làm (theo dõi riêng, không chặn deploy preview)

- [ ] Verify UI qua trình duyệt thật (build agent chỉ test qua curl/API, chưa có browser)
- [ ] Điền `.env` thật: MARKET_RADAR_MCP_TOKEN, GROUP_INSIGHTS_MCP_TOKEN, SOCIAL_BACKEND_URL/TOKEN, FB_PAGE_ID/FB_ACCESS_TOKEN, AUTH_SECRET random
- [ ] Object storage cho ảnh cuối (hiện lưu base64 trong Postgres — chấp nhận được ở quy mô hiện tại, xem `docs/ARCH.md`)
- [ ] Luồng "Sửa thoại" nên patch lại post cũ thay vì tạo post row mới
- [ ] LỌC: chuyển từ rule-based sang gọi LLM qua social backend khi có `SOCIAL_BACKEND_URL` thật
- [ ] Phase 2 (ngoài scope iMVP): đăng tự động qua social's scheduler, bước HỌC thật, content calendar view
