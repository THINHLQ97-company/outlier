# Implementation Plan: fanpage-content-create

**Phase**: iMVP (Phase 1)
**Team**: mk
**Stack**: React 19 + Vite 6 + TypeScript + Tailwind CSS v4 + Express 4 + Drizzle ORM + Postgres (tái sử dụng cấu trúc từ `share-projects/marcow-crop`, không clone template GitLab — không có template khớp stack này trong `internal/templates`)
**Est. duration**: ~4-5 ngày giờ-AI (multitask, xem `task-et` khi bóc task chi tiết)

## Scope

**IN scope (iMVP)** — theo `docs/PRD.md` mục 3-4:
- THU: đọc Market Radar MCP + Group Insights MCP (READONLY) + form nhập tay tín hiệu thủ công
- LỌC: rubric scoring bán tự động (5 tiêu chí, ngưỡng 16/12)
- DỊCH: sinh 3 phương án kịch bản qua Gemini (proxy REST sang social backend)
- VẼ: sinh 2 biến thể ảnh (Gemini image, proxy social backend) + text-overlay editor + watermark, trong app
- DUYỆT: kanban 3 cột + checklist 14 mục
- ĐĂNG: thủ công (tải ảnh/copy caption/đánh dấu đã đăng) — **không có seeding comment**

**OUT of scope** (theo PRD mục 8): seeding comment/auto-reply (loại bỏ hẳn, mọi phase), đăng tự động qua scheduler, bước HỌC thật (insight + feedback loop rubric), content calendar view, P0 alert tự động, multi-fanpage.

## Implementation Steps

### Step 1 — Scaffold skeleton (tái dụng cấu trúc marcow-crop)
- [x] `package.json`, `tsconfig.json`, `vite.config.ts`, Tailwind v4 (`@tailwindcss/vite`), `index.html`
- [x] `server.ts` (Express, serve Vite middleware dev / `dist/` prod) theo pattern marcow-crop — KHÔNG copy thư mục `api/` (Vercel serverless legacy, không áp dụng)
- [x] `drizzle.config.ts` + `server/db/` (client, migrate script)
- [x] `Dockerfile`, `.dockerignore`, `.gitignore`, `.env.example`
- [x] `src/index.css` theme tokens (font, màu — có thể giữ tông tương tự marcow-crop hoặc điều chỉnh theo brand MATBAO, xác nhận sau)
- [x] Commit: `feat: scaffold skeleton (react+vite+express+drizzle, theo mẫu marcow-crop)`

### Step 2 — Data model
- [x] `server/db/schema.ts`: bảng `users`, `signals`, `rubric_versions`, `scripts`, `characters`, `posts` (đúng PRD mục 6)
- [x] Migration đầu tiên (`server/db/migrations/`)
- [x] Seed script: 5 nhân vật cố định (mục 2.4 v3.md) + vài tín hiệu demo giả lập (phòng khi chưa có MCP token)
- [x] Commit: `feat: data model + seed demo data`

### Step 3 — Auth + API client layer
- [x] `server/auth-mw.ts`, `server/password.ts` (theo pattern marcow-crop: username/password → HMAC token)
- [x] `src/AppContext.tsx`, `src/services/*.ts` (1 file/resource: signals, scripts, posts, characters)
- [x] Login page tối giản
- [x] Commit: `feat: auth + api client layer`

### Step 4 — THU + LỌC
- [x] `server/services/market-radar.client.ts`, `group-insights.client.ts` — gọi HTTP JSON-RPC 2.0 (đọc `MARKET_RADAR_MCP_TOKEN`/`GROUP_INSIGHTS_MCP_TOKEN` từ env, không hardcode; nếu thiếu token → fallback demo data, log warning rõ ràng)
- [x] `server/routes/signals.routes.ts`: list, sync (trigger THU), score (LỌC rule-based), update rubric version
- [x] `src/pages/SignalsQueue.tsx`: bảng tín hiệu theo điểm/ngưỡng + form nhập tay
- [x] Commit: `feat: THU + LỌC — signal queue + rubric scoring`

### Step 5 — DỊCH + VẼ
- [x] `server/services/social-proxy.ts`: gọi REST sang social backend (`SOCIAL_BACKEND_URL` env, chưa có → placeholder rõ ràng, không bịa) cho generateText + generate-image
- [x] `server/routes/scripts.routes.ts`, `server/routes/images.routes.ts`
- [x] `src/pages/ScriptEditor.tsx` (chọn trục + format meme, sinh 3 phương án), `src/pages/ImageStudio.tsx` (sinh 2 biến thể + text-overlay editor canvas + watermark export)
- [x] Commit: `feat: DỊCH + VẼ — script gen, image gen, text overlay`

### Step 6 — DUYỆT + ĐĂNG
- [ ] `server/routes/posts.routes.ts` (state machine cho_duyet→sua_thoai/rot/san_sang_dang→da_dang)
- [ ] `src/pages/ApprovalQueue.tsx` — kanban 3 cột (tham khảo `PostsDashboard.tsx` marcow-crop) + checklist modal 14 mục
- [ ] `src/pages/ReadyToPost.tsx` — tải ảnh/copy caption/đánh dấu đã đăng
- [ ] Commit: `feat: DUYỆT + ĐĂNG — approval kanban, checklist, manual publish`

### Step 7 — Docs + polish + demo
- [ ] `CLAUDE.md` cho project (theo chuẩn workspace)
- [ ] `docs/ARCH.md` tối thiểu
- [ ] Empty states, error handling cơ bản
- [ ] `docker compose up` / `npm run dev` chạy sạch, verify end-to-end bằng seed data
- [ ] Commit cuối + `/vibe handoff` nếu cần chuyển giao

## Risks + Assumptions

- **MARKET_RADAR_MCP_TOKEN / GROUP_INSIGHTS_MCP_TOKEN / SOCIAL_BACKEND_URL / Facebook Page token chưa có** — code viết theo interface đúng, dùng seed/demo data khi thiếu, KHÔNG bịa giá trị thật. Cần user cung cấp trước go-live thật.
- **social backend proxy** — nếu social chưa expose sẵn REST endpoint public/nội bộ ổn định cho generateText/generate-image, cần xác nhận URL + auth trước khi go-live (giả định endpoint tồn tại theo khảo sát source code, chưa test integration thật).
- **Text overlay tiếng Việt** — cần font hỗ trợ đủ dấu, test kỹ trước demo.
- Không có template GitLab khớp stack → scaffold tay theo cấu trúc marcow-crop thay vì `git clone` template.

## Definition of Done (iMVP)

- [ ] Demo end-to-end: 1 tín hiệu (thật hoặc demo) → ảnh cuối có watermark + caption → qua duyệt → đánh dấu đã đăng
- [ ] `npm run dev` / `docker compose up` chạy sạch với seed data
- [ ] Không secret trong code (đọc từ `.env`, có `.env.example` đầy đủ placeholder)
- [ ] README + CLAUDE.md đủ để người khác chạy được
