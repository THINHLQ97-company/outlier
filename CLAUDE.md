# CLAUDE.md — fanpage-content-create

Quy tắc bắt buộc cho mọi AI Agent làm việc trên project này. Áp dụng cùng với
`~/.claude/CLAUDE.md` (org-wide) và `~/workspace/CLAUDE.md` (Mắt Bão workspace).

## Project context

- **Mục đích**: content engine bán tự động cho fanpage "Ăn Nằm Với AI" (Mắt Bão) —
  pipeline THU → LỌC → DỊCH → VẼ → DUYỆT → ĐĂNG (iMVP; HỌC là Phase 2).
- **Stack**: React 19 + Vite 6 (client) + Express 4 (server, `server.ts`), Postgres +
  Drizzle ORM (`server/db/schema.ts`), Docker single-container deploy qua Coolify.
  Scaffold tái dụng cấu trúc `share-projects/marcow-crop` (không clone template).
- **Team**: mk (Marketing). Domain nội bộ dự kiến: `fanpage-content-create.mk.dev.matbao.ai`.
- **Docs**: [docs/PRD.md](docs/PRD.md), [docs/PLAN.md](docs/PLAN.md),
  [docs/ARCH.md](docs/ARCH.md), [MATBAO_FANPAGE_ENGINE_v3.md](MATBAO_FANPAGE_ENGINE_v3.md)
  (đặc tả nghiệp vụ gốc — dàn nhân vật, glossary, prompt template, checklist).

## 1. Nghiệp vụ cốt lõi — ĐỪNG tự ý đổi

- **Dàn nhân vật cố định** (Gàn, Gèn, Chị Bão, Sếp + 5 AI + Cơn Bão) — mục 2 của
  `MATBAO_FANPAGE_ENGINE_v3.md`, seed sẵn trong bảng `characters`
  (`shared/engine-data.ts` là nguồn dữ liệu tĩnh, dùng chung server+client).
  KHÔNG đổi tính cách nhân vật AI (mục 2.2) — đây là ràng buộc cứng đã duyệt.
- **Tối đa 2 khung/bài, watermark bắt buộc** (MATBAO / MATBAO INVOICE, opacity ~60%,
  góc dưới phải) — kiểm tra lại `shared/engine-data.ts` (`CHECKLIST_ITEMS`,
  `WATERMARK_BRANDS`) trước khi sửa logic liên quan.
- **KHÔNG bao giờ implement seeding comment / auto-reply** — PRD §8 loại bỏ hoàn
  toàn khỏi mọi phase (fanpage giải trí, không cần comment giả lập). Nếu thấy yêu
  cầu thêm tính năng này, hỏi lại user trước khi làm.
- **Rubric LỌC**: tổng điểm chỉ cộng 4/5 tiêu chí (`do_nong + do_cham + do_hop_truc +
  tuoi_tho`, mỗi tiêu chí 1-5 → tối đa 20, khớp ngưỡng ≥16/20 PRD §4 FR2.2).
  `do_an_toan`/`dinh_nhom_cam` là CỔNG pass/fail (dính nhóm ⛔ mục 3.3 = loại
  thẳng), KHÔNG cộng vào tổng — xem `server/services/rubric-scoring.ts`.

## 2. Kiến trúc & luồng dữ liệu

Xem [docs/ARCH.md](docs/ARCH.md) cho sơ đồ đầy đủ. Tóm tắt bảng `posts.status`
(state machine DUYỆT/ĐĂNG):

```
draft → (submit, cần finalImageUrl) → cho_duyet
cho_duyet → (approve, checklist đủ 13 mục) → san_sang_dang → (mark-posted) → da_dang
cho_duyet → (request-edit) → sua_thoai   [mở lại Image Studio bằng scriptId]
cho_duyet → (reject, bắt buộc lý do) → rot
```

`server/routes/*.routes.ts` — mỗi route module tự chịu trách nhiệm guard trạng
thái hợp lệ (server-side re-check, không tin tưởng client).

## 3. Tích hợp ngoài — server-side proxy, fallback demo bắt buộc

- **Market Radar MCP** + **Group Insights MCP** (`server/services/market-radar.client.ts`,
  `group-insights.client.ts`) — HTTP JSON-RPC 2.0 (`server/services/jsonrpc.ts`).
- **Gemini trực tiếp** (`server/services/gemini-direct.ts`) — DỊCH (kịch bản, text) và
  VẼ (ảnh) gọi thẳng `@google/genai` bằng `GEMINI_API_KEY`, pattern y hệt
  `share-projects/marcow-crop` đang chạy production (KHÔNG còn proxy qua
  `share-projects/social` — đổi ngày 2026-07-21, xem quyết định trong
  `server/services/social-proxy.ts`: endpoint `share-projects/social` chưa từng
  xác nhận tồn tại/reachable). `server/services/social-proxy.ts` GIỮ TÊN cũ (để
  không đổi import ở `scripts.routes.ts`/`images.routes.ts`) nhưng bên trong đã
  đổi sang gọi `gemini-direct.ts` làm đường chính. API key KHÔNG BAO GIỜ đi tới
  client — biến `SOCIAL_BACKEND_URL`/`SOCIAL_BACKEND_TOKEN` vẫn giữ trong
  `.env.example` phòng khi cần dùng cho tích hợp khác sau này, không dùng cho
  DỊCH/VẼ nữa.
- **Object storage** (`server/storage.ts`) — driver filesystem ghi dưới
  `UPLOAD_DIR` (default `/data/uploads`), dùng cho ảnh reference nhân vật
  (menu "Nhân vật", `server/routes/characters.routes.ts` + `files.routes.ts`).
  Port từ `share-projects/marcow-crop/server/storage.ts`, đơn giản hoá (bỏ
  multi-owner) — xem interface `StorageDriver`.
- **Nguyên tắc bắt buộc cho MỌI service tích hợp ngoài**: nếu thiếu
  URL/token/API key trong `.env` → fallback sang demo/placeholder data, `console.warn`
  rõ ràng, **KHÔNG throw crash toàn app**. Đây là pattern đã áp dụng nhất quán —
  giữ nguyên khi thêm tích hợp mới.

## 4. Quy chuẩn giao diện (UI/UX)

- **Phong cách**: đã chuyển sang dùng đúng bảng màu + font của
  `share-projects/marcow-crop` (quyết định user ngày 2026-07-21, "tái sử dụng lại
  toàn bộ UX của marcow-crop") — lý do: đồng bộ UX với hệ sinh thái nội bộ Mắt Bão.
  Primary cam đất `#D97757` (hover `#C66545`), background `#FAF9F6`, text
  `#2D2D2D`. Token CSS **giữ nguyên tên biến** `--color-storm-*` trong
  `src/index.css` (chỉ đổi giá trị hex) để không phải sửa class ở mọi file.
  Font `Comic Neue` (heading/logo, qua class `font-display`) + `Inter` (còn lại,
  `font-sans`); `Be Vietnam Pro` vẫn giữ làm fallback cho canvas text-overlay
  (không thuộc phạm vi reskin UI — xem `TextOverlayEditor.tsx`).
- **Text-overlay editor** (`src/components/TextOverlayEditor.tsx`) — HTML5 Canvas
  thuần, không thư viện ngoài. Toạ độ text box lưu dạng phân số (0-1) của canvas
  gốc 1024×1024 để export luôn đúng tỉ lệ.
- **Accessibility**: mọi icon-only button phải có `aria-label`/`title`; input
  phải có `<label htmlFor>`.

## 5. Quy tắc làm việc của AI Agent

- **Strict linting**: sau bất kỳ chỉnh sửa code nào, bắt buộc chạy `npm run lint`
  (= `tsc --noEmit`) trước khi báo hoàn thành.
- **Targeted editing**: dùng Edit khoanh vùng cụ thể, không ghi đè toàn bộ file lớn.
- **Identity**: khi cần email/owner, đọc từ `$CODER_USER_EMAIL` / `git config
  user.email` — không hardcode (quy ước org-wide `~/.claude/CLAUDE.md`).
- **Secrets**: KHÔNG commit `.env` thật hoặc bất kỳ token thật nào. Xem
  `.env.example` cho danh sách biến cần điền trước go-live.
