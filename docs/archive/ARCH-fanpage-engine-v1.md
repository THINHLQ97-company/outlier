# ARCH.md — fanpage-content-create

## 1. Stack

- **Client**: React 19 + Vite 6 + TypeScript + Tailwind CSS v4 (`@tailwindcss/vite`),
  `react-router-dom` v7 cho routing (SignalsQueue → ScriptEditor → ImageStudio →
  ApprovalQueue → ReadyToPost).
- **Server**: Express 4 (`server.ts`) — serve Vite middleware ở dev, `dist/` ở
  prod. Cùng process phục vụ cả API (`/api/*`) và static assets.
- **DB**: Postgres + Drizzle ORM (`server/db/schema.ts`, migration versioned tại
  `server/db/migrations/`, chạy tự động lúc boot qua `server/db/migrate.ts`).
- **Deploy**: Docker single-container (`Dockerfile`) qua Coolify, hoặc
  `docker-compose.yml` (app + Postgres) cho local dev/demo.

Scaffold tái dụng cấu trúc `share-projects/marcow-crop` (build setup, auth
pattern HMAC token, service layer `authHeaders()+fetch+asError()`) — không
copy business logic riêng của marcow (characters/generations/meme_templates
khác domain).

## 2. Data model (`server/db/schema.ts`)

| Bảng | Vai trò |
|---|---|
| `users` | Tài khoản nội bộ (username/password → HMAC token 7 ngày) |
| `signals` | Tín hiệu THU (market_radar / group_insights / manual) + kết quả LỌC (`score_json`, `status`) |
| `rubric_versions` | Version rubric (weights/thresholds), lịch sử — không xoá, chỉ tắt `isActive` khi tạo version mới |
| `scripts` | 3 phương án kịch bản/tín hiệu (DỊCH), `selected_variant` sau khi người vận hành chọn |
| `characters` | Dàn nhân vật cố định (reference text, `reference_image_url` để trống tới khi có API key thật) |
| `posts` | Ảnh biến thể (VẼ) → overlay/ảnh cuối → trạng thái DUYỆT/ĐĂNG (`status` state machine, xem CLAUDE.md §2) |

Quan hệ: `scripts.signal_id → signals.id`, `posts.script_id → scripts.id`
(cascade delete). `characters` độc lập (không FK), dùng làm reference text khi
build prompt VẼ (`server/routes/images.routes.ts` lọc theo `AXES[truc].leadCharacters`).

## 3. Pipeline THU → LỌC → DỊCH → VẼ → DUYỆT → ĐĂNG

```
[THU]  server/services/market-radar.client.ts  ─┐
       server/services/group-insights.client.ts ┴→ POST /api/signals/sync → signals (status=new)
                                                     + form nhập tay (POST /api/signals, FR1.3)

[LỌC]  GET /api/signals/:id/suggest-score (rule-based, server/services/rubric-scoring.ts)
       → người vận hành sửa tay → POST /api/signals/:id/score
       → server tự route status: queued (≥16) | idea_bank (12-15) | rejected (<12 hoặc dính nhóm ⛔)

[DỊCH] POST /api/scripts/generate (signalId, truc, formatMeme)
       → server/services/social-proxy.ts::generateScriptVariants (Gemini qua social backend,
         fallback demo template nếu thiếu SOCIAL_BACKEND_URL)
       → 3 phương án lưu vào scripts.content_json
       → POST /api/scripts/:id/select (variantIndex) chốt 1 phương án

[VẼ]   POST /api/images/generate (scriptId)
       → server/services/social-proxy.ts::generateImageVariants (fallback SVG placeholder demo)
       → tạo posts (status=draft, 2 image_variants)
       → POST /api/posts/:id/select-image → POST /api/posts/:id/overlay
         (client Canvas export PNG kèm watermark, xem TextOverlayEditor.tsx)
       → POST /api/posts/:id/submit (status → cho_duyet, cần finalImageUrl)

[DUYỆT] Kanban 3 cột (ApprovalQueue.tsx) đọc GET /api/posts (lọc client-side theo status)
       → checklist 14 mục (server/routes/posts.routes.ts re-check server-side trước khi approve)
       → approve (→ san_sang_dang) | request-edit (→ sua_thoai) | reject (→ rot, bắt buộc lý do)

[ĐĂNG] ReadyToPost.tsx: tải ảnh (finalImageUrl là data URL PNG) + copy caption
       → thủ công đăng Facebook → POST /api/posts/:id/mark-posted (fbPostUrl) → status=da_dang
```

## 4. Tích hợp ngoài & chế độ demo/fallback

Tất cả service gọi hệ thống ngoài đều theo pattern: thiếu cấu hình →
`console.warn` + trả demo/placeholder data, KHÔNG throw crash app (xem
`.env.example` cho danh sách biến, và CLAUDE.md §3).

| Service | File | Khi thiếu env |
|---|---|---|
| Market Radar MCP | `server/services/market-radar.client.ts` | Trả 2 tín hiệu demo tĩnh |
| Group Insights MCP | `server/services/group-insights.client.ts` | Trả 1 cluster demo tĩnh |
| social (text-gen) | `server/services/social-proxy.ts::generateScriptVariants` | Template 3 phương án demo, `isDemo=true` |
| social (image-gen) | `server/services/social-proxy.ts::generateImageVariants` | SVG placeholder tự sinh (không phụ thuộc mạng ngoài), `isDemo=true` |

## 5. Lưu trữ ảnh — giới hạn đã biết (known limitation)

iMVP **không có object storage riêng** (khác `server/storage.ts` của
marcow-crop) — ảnh cuối (`posts.final_image_url`) lưu trực tiếp dạng base64
data URL trong cột `text`. Chấp nhận được cho quy mô nội bộ <10 người dùng,
tần suất ~1 bài/ngày (PRD §2 Scale), nhưng **sẽ phình DB nhanh nếu volume tăng**.
Nếu go-live thật với volume cao hơn, cân nhắc thêm storage layer (S3/volume,
theo pattern `server/storage.ts` của marcow-crop) trước khi mở rộng.

## 6. Giới hạn khác đã biết (chưa xử lý trong iMVP)

- **"Sửa thoại" (sua_thoai) chưa resume đúng draft cũ**: bấm "Mở lại VẼ để sửa"
  điều hướng sang Image Studio bằng `scriptId`, nhưng generate lại sẽ tạo
  **posts row MỚI** (không patch lại row `sua_thoai` cũ). Row cũ vẫn nằm ở cột
  "Sửa thoại" trong kanban như lịch sử, không tự chuyển trạng thái. Chấp nhận
  được cho demo iMVP; cần route `PATCH` resume nếu muốn vòng lặp J4→J3 mượt hơn.
- **Rule-based scoring** (`suggestScoreForSignal`) là heuristic đơn giản (đếm từ
  khóa glossary + tuổi tín hiệu), CHƯA gọi LLM thật (FR2.3 cho phép "rule-based
  + LLM" — phần LLM để Phase kế tiếp khi có `SOCIAL_BACKEND_URL` ổn định).
- **De-dupe tín hiệu THU** chỉ theo cặp `(title, radar)` — best-effort, không có
  unique constraint ở DB.

## 7. Auth

HMAC token 7 ngày (`server/auth-shared.ts`, pattern copy từ marcow-crop):
`POST /api/login` → `{token}` lưu `localStorage`, gửi qua header
`Authorization: Bearer <token>`. `requireAuth` re-verify chữ ký + hạn dùng mỗi
request; `requireAdmin` (chưa dùng route nào trong iMVP — không có phân quyền
admin/member khác biệt về nghiệp vụ, chỉ giữ sẵn cột `role` để mở rộng sau).
