# Nền tảng hợp nhất — Rà soát 2 công cụ & kiến trúc đề xuất

> Ngày rà soát: 2026-09-18 · Người rà: Claude (theo yêu cầu thinhlq)
> Phạm vi: `projects/fanpage-content-create` + `share-projects/clipchatbot`

---

## 0. Kết luận ngắn

Ý tưởng "app tự tìm content viral → phân tích → remake cho brand" **khả thi, và đã có sẵn ~60% linh kiện**, nhưng nằm rải ở 2 app khác stack và **thiếu đúng 3 mắt xích quan trọng nhất**:

| Mắt xích | Trạng thái |
|---|---|
| Brand profile tự bóc từ website/fanpage/PDF, có trích nguồn | **CHƯA CÓ** (0%) |
| Radar tìm content outperform (cần engagement metrics) | **CHƯA CÓ** (0%) — đây là lỗ hổng lớn nhất |
| Bóc cấu trúc video (hook/giữ chân/twist/CTA) | **CÓ MỘT PHẦN** (~20%) |
| Remake theo flow gốc + guardrail brand | **CÓ MỘT PHẦN** (~40%) |
| Dựng video (ảnh, footage, render) | **CÓ, khá mạnh** (~85%) |
| MCP cho Claude điều khiển | **CÓ nền móng tốt** (~45%) |
| Đăng nhập | **CÓ ở app A, KHÔNG có ở app B** |

---

## 1. Hiện trạng thật — `fanpage-content-create` ("Ăn Nằm Với AI")

**Stack**: React 19 + Vite 6 + Express 4 + Postgres + Drizzle. Một container, deploy Coolify.

### ⚠️ Cảnh báo docs-code drift
`docs/PRD.md`, `ARCH.md`, `README.md`, `CLAUDE.md` đều mô tả pipeline 6 bước
THU→LỌC→DỊCH→VẼ→DUYỆT→ĐĂNG với kanban duyệt + checklist 14 mục.
**Code đã bị cắt gọn mạnh ngày 2026-07-22** (commit `85d73ce`, `abe6404`) — docs không cập nhật theo:

- Màn DUYỆT, ĐĂNG, Kịch bản, Lịch **đã bị xoá** khỏi frontend.
- `server/routes/posts.routes.ts` chỉ còn 2 GET; approve/reject/checklist/mark-posted đã gỡ.
- `server/routes/scripts.routes.ts` **vẫn đăng ký ở `server.ts:56` nhưng không FE nào gọi** → route mồ côi.
- Frontend chỉ còn **4 route**: `/studio`, `/library`, `/signals`, `/admin/users`.

→ Khi thiết kế lại, **coi code là nguồn sự thật, không phải PRD.md**. PRD phải viết lại.

### Cái đang chạy thật
- **Studio** (`src/pages/Studio.tsx`, 1226 dòng) — sinh ảnh từ mô tả tự do + nhân vật + phong cách. Đây là luồng chính hôm nay.
- **Tín hiệu** — thu thập + chấm điểm rubric 5 tiêu chí (rule-based + LLM).
- **Thư viện** — Ảnh / Nhân vật (10 nhân vật cố định) / Phong cách (4 preset).
- **RAG "ảnh đã thích"** — `rag_examples` + `rag_profiles`, embedding `text-embedding-004`.

### MCP "Tín hiệu" — nền móng tốt nhất của cả 2 app
`server/routes/mcp-signals.routes.ts` — JSON-RPC 2.0 viết tay, **8 tool**:
`signals_list`, `signals_get`, `rubric_get`, `characters_list` (đọc);
`signals_add`, `signals_score`, `signals_set_cluster`, `signals_suggest_angle` (ghi).

Auth 2 đường: static bearer token, **và OAuth 2.1 đầy đủ** (PKCE S256, Dynamic Client Registration RFC 7591, JWT stateless). Redirect whitelist `claude.ai`/`claude.com`/`anthropic.com`.
**Chưa public** — còn sau IP-allowlist nội bộ, cần manager approval để mở 3 path.

> Đây là tài sản quý: phần khó nhất của "Claude điều khiển công cụ" đã xong. Việc còn lại chủ yếu là **thêm tool**, không phải xây lại hạ tầng MCP.

### Auth (đã có, khá tốt)
- HMAC token tự chế 7 ngày (`server/auth-shared.ts`), secret `AUTH_SECRET`.
- **Google SSO đã chạy** (`server/services/google-auth.ts`): email trong `GOOGLE_ADMIN_EMAILS` → admin ngay; email mới → tạo user `isActive=false` chờ admin duyệt.
- `requireAdmin` **re-check DB mỗi request** (không tin claim trong token) — thiết kế đúng.

Thiếu: rate-limit login, giới hạn domain `@matbao.com`, refresh/revoke token, token qua `?token=` query string cho ảnh (rủi ro lọt log).

### AI
Gemini trực tiếp server-side: `gemini-3.1-pro-preview` (text), `gemini-3.1-flash-image-preview` (ảnh), `text-embedding-004` (RAG). **Không gọi Claude API** — Claude chỉ là client ngoài gọi vào qua MCP.

### Không có
Không crawl TikTok/Douyin/YouTube/IG/fanpage. Không Apify. Nguồn tín hiệu chỉ: 2 MCP nội bộ (**chưa có token thật → luôn fallback demo**), form nhập tay, và Claude tự web-search rồi `signals_add`.
**Test coverage: 0%.** Không có logo/favicon trong repo.

---

## 2. Hiện trạng thật — `clipchatbot`

**Stack**: FastAPI + Celery + Redis + Postgres 16 + Next.js 16. Deploy Coolify (`clipchatbot.mk.dev.matbao.ai`).

### Công cụ video open-source (cái anh quên tên)
**FFmpeg 8.1** — gọi thẳng qua `subprocess`, không wrapper. Kèm **yt-dlp** (TikTok/YouTube/IG/FB/Bilibili) và **f2** (Douyin, tự ký X-Bogus/msToken, cần cookie thật).

### 2 pipeline đã chạy
**A. Localize** (`backend/app/tasks/clip_pipeline.py`, 2300 dòng):
link → tải (f2/yt-dlp) → ffmpeg tách audio → Whisper STT → Gemini rewrite → Gemini TTS → Whisper lần 2 lấy timing phụ đề → ffmpeg mux (speed-ramp, ducking BGM `sidechaincompress`, burn subtitle, overlay, nối outro).

**B. Create Video** (`backend/app/tasks/video_pipeline.py`):
text → Gemini script → TTS → chia frame → **Imagen 4 Fast** sinh ảnh → **Veo 3.1 Lite** sinh chuyển động (fallback Ken Burns `zoompan`) → ffmpeg concat + xfade → mp4. Có export CapCut draft.

### Điểm hay đáng giữ
- `_align_script_to_segments()` — dùng timing từ Whisper nhưng text từ script gốc, tránh Whisper đọc sai tên riêng.
- Gemini multimodal **đã dùng để phân tích video** (auto-detect vị trí outro/CTA gốc, ~$0.03/clip). Đây chính là mầm mống của "bóc cấu trúc video".
- Asset library: outro / BGM / frame template / background, có compositing 4 lớp.

### Không có
**Không Higgsfield. Không MCP. Không đăng nhập** (internal tool chạy LAN).

### 🔴 Lỗ hổng chí mạng cho ý tưởng của anh
Bảng `channel_videos` **chỉ lưu** title, cover_url, duration_ms, remote_created_at.
**KHÔNG có view / like / comment / share / follower count.**

Mà đúng những cột đó mới tính được "outperform so với quy mô kênh" — tiêu chí ranking anh nhấn mạnh (kênh 2k follower có bài 8k like đáng giá hơn kênh 14M follower có bài 6k like). **Phải xây mới hoàn toàn.**

### 🔴 Hai vấn đề bảo mật cần xử lý ngay
1. Git remote `gitlab` **nhúng token `glpat-...` thẳng trong URL** (`git remote -v` lộ ra).
2. `_sync/` chứa `cookies.txt` (cookie Douyin đăng nhập thật), `db_dump*.sql`, `storage.tar.gz` trong repo **share-projects** (cả team đọc được).

---

## 3. Đối chiếu ý tưởng ↔ hiện trạng

### Bước 1 — Cho nó hiểu brand
| Cần | Có chưa |
|---|---|
| Nhận website / fanpage / PDF | ❌ Chưa có cơ chế ingest nào |
| Bóc: bán gì, khách là ai, giọng nói, xưng hô, từ cấm | ❌ Chưa. Gần nhất là `characters` (10 nhân vật cố định) + `styles` (phong cách **vẽ**, không phải giọng văn) |
| **Mỗi field phải chỉ ra lấy từ đâu trong tài liệu** | ❌ **Toàn app không có cơ chế citation nào** |
| Không tìm thấy thì để trống, không bịa | ❌ Chưa có ràng buộc này |

→ **Xây mới gần như 100%.** Đây là phần tôi đánh giá quan trọng nhất và cũng dễ làm ẩu nhất: yêu cầu "chỉ ra nguồn, không bịa" phải cưỡng chế bằng schema (mỗi field bắt buộc kèm `evidence: {quote, source_url, offset}`), không phải bằng câu dặn trong prompt.

### Bước 2 — Tìm content đang chạy tốt trong ngách
| Cần | Có chưa |
|---|---|
| Nhập keyword hoặc link đối thủ | ⚠️ Có sync kênh Douyin (`POST /channels/sync`), chưa có tìm theo keyword |
| Kéo từ Douyin / TikTok / YouTube / IG về một chỗ | ⚠️ Tải **video** được (yt-dlp/f2), nhưng không lấy **metrics** |
| Ranking theo outperform-so-với-quy-mô-kênh | ❌ Không có dữ liệu để tính |

→ **Cần thêm nguồn metrics.** yt-dlp/f2 không trả đủ engagement ổn định. Thực tế nên dùng **Apify** (các actor TikTok trả view/like/comment/share + follower count).

Công thức ranking tôi đề xuất:
```
outperform = log(views / median_views_của_kênh_đó)  × w1
           + log(likes / follower_count)            × w2
           + hệ_số_tươi(ngày_đăng)                  × w3
```
Điểm mấu chốt: **chuẩn hoá theo chính kênh đó**, không so tuyệt đối — đúng như anh mô tả.

### Bước 3 — Bấm remake / phân tích
| Cần | Có chưa |
|---|---|
| Paste link hoặc upload video | ✅ Có (paste link; upload thì mới có cho asset) |
| Bóc: 3s đầu, mở vấn đề, giữ chân, twist, CTA | ⚠️ Mới có Gemini detect outro. **Cần schema phân tích đầy đủ** |
| Lấy flow đó viết bản mới cho brand | ⚠️ Có rewrite theo `ClipStyle.system_prompt`, nhưng là "dịch + đổi giọng", **chưa phải "giữ flow, thay ruột"** |
| Guardrail: không bê nguyên câu, không chế công dụng, không đổi giọng brand | ❌ Chưa có kiểm tra tự động nào |
| Đẩy sang Google Sheet | ❌ Chưa có |

---

## 4. "Quét fanpage + TikTok + Douyin rồi remake" — được không?

**Về kỹ thuật: được**, hạ tầng tải video đa nền tảng đã chạy ổn định.

**Ranh giới cần giữ** (anh đã tự đặt đúng hướng, tôi chỉ làm rõ để cưỡng chế bằng code):

- ✅ **Học cấu trúc** (hook ở đâu, nhịp thế nào, twist chỗ nào) rồi viết nội dung mới — đây là học phương pháp, hợp lệ, giống việc copywriter phân tích bài hay.
- ❌ **Bê nguyên câu chữ / dùng lại footage gốc / lồng tiếng lên video người ta** — đây là chỗ dễ dính bản quyền. Lưu ý: pipeline *Localize* của clipchatbot **đang làm đúng việc này** (giữ video gốc, thay tiếng). Dùng nội bộ thì khác, nhưng đăng lên fanpage brand thì rủi ro.
- ⚠️ **Scrape**: TikTok/Douyin ToS cấm scrape tự động. Dùng Apify đẩy rủi ro sang bên thứ ba nhưng không xoá được. Cookie Douyin thật trong repo (`_sync/cookies.txt`) là tài khoản cá nhân — nếu bị phát hiện, tài khoản đó chịu.

→ Đề xuất: **remake = flow gốc + ruột mới + footage tự sinh (Imagen/Veo/Higgsfield)**, không tái sử dụng pixel/audio của bài gốc. Vừa an toàn, vừa đúng cái anh muốn.

---

## 5. Kiến trúc đề xuất

**Không gộp code 2 app.** Stack quá khác (Node/Express vs Python/FastAPI/Celery), gộp sẽ mất vài tuần và dễ vỡ cái đang chạy. Thay vào đó **2 service + 1 lớp MCP chung**:

```
                    ┌──────────────────────────────────┐
   Claude (MCP) ───▶│  APP A — "bộ não" + UI + Auth    │
   claude.ai        │  (fanpage-content-create, Node)  │
                    │                                  │
                    │  • Brand Profile (MỚI)           │
                    │  • Radar + outperform (MỚI)      │
                    │  • Deconstruct video (MỚI)       │
                    │  • Remake + guardrail (MỚI)      │
                    │  • Studio sinh ảnh (có)          │
                    │  • MCP + OAuth 2.1 (có)          │
                    │  • Google SSO (có)               │
                    └────────────┬─────────────────────┘
                                 │ REST nội bộ (service token)
                    ┌────────────▼─────────────────────┐
                    │  APP B — "xưởng media"           │
                    │  (clipchatbot, Python/Celery)    │
                    │  • yt-dlp / f2 tải video (có)    │
                    │  • Whisper STT (có)              │
                    │  • FFmpeg render (có)            │
                    │  • Imagen 4 / Veo 3.1 (có)       │
                    │  • Higgsfield (MỚI)              │
                    │  • +metrics columns (MỚI)        │
                    └──────────────────────────────────┘
                                 │
                    ┌────────────▼─────────────────────┐
                    │  Apify (metrics) · Google Sheets │
                    └──────────────────────────────────┘
```

**Vì sao A làm chủ**: A đã có OAuth 2.1 + SSO + UI + MCP. B chưa có auth nào — đưa B ra Internet là rủi ro. Giữ B **nội bộ, chỉ A gọi được** bằng service token.

### Phân vai 3 engine video
| Engine | Dùng khi | Chi phí |
|---|---|---|
| **Gemini Imagen 4 + Veo 3.1 Lite** | Mặc định — footage minh hoạ, ảnh nền, chuyển động nhẹ | ~$0.04/ảnh, Veo rẻ |
| **Higgsfield** | Cảnh cần chất lượng điện ảnh, chuyển động phức tạp | Kling 3.0 ~$1.12/10s; Kling 2.6 ~$0.70/10s |
| **FFmpeg** | Luôn luôn — ghép, xfade, phụ đề, BGM ducking, Ken Burns | Miễn phí |

Higgsfield API: base `https://api.higgsfield.ai`, header `Authorization: Key <id>:<secret>`, submit → poll `status_url` hoặc webhook.
⚠️ **Output chỉ giữ ~7 ngày** → phải tải về lưu ngay, không lưu URL.

### MCP mở rộng — từ 8 lên ~18 tool
Giữ 8 tool cũ, thêm:
```
brand_ingest        (url|pdf) → job bóc brand profile
brand_profile_get   → profile + evidence từng field
radar_search        (keyword|competitor_url, platforms[]) → job quét
radar_rank          (job_id, top_n) → list xếp theo outperform
content_deconstruct (video_url|id) → {hook_3s, problem_open, retention_beats[], twist, cta}
remake_draft        (source_id, brand_id, format) → bản nháp + guardrail_report
remake_revise       (draft_id, note) → bản sửa
video_render        (draft_id, engine: gemini|higgsfield) → job
job_status          (job_id) → tiến độ (dùng chung mọi job dài)
sheets_export       (draft_ids[], sheet_url) → đẩy sang Google Sheet
```
Nguyên tắc: mọi việc chạy lâu trả `job_id` ngay, Claude poll `job_status` — không để MCP call treo.

---

## 6. Guardrail remake (cưỡng chế bằng code, không bằng lời dặn)

Sau khi sinh bản remake, chạy kiểm tra tự động, trả `guardrail_report`:

1. **Chống bê nguyên văn** — n-gram overlap với transcript gốc. Trùng ≥ 7 từ liên tiếp → cảnh báo, buộc viết lại đoạn đó.
2. **Chống bịa công dụng sản phẩm** — mọi claim về sản phẩm phải khớp brand profile; claim không có evidence → đánh dấu `unverified`, không cho export.
3. **Chống lệch giọng brand** — đối chiếu từ cấm / xưng hô trong brand profile.
4. **Bắt buộc dẫn nguồn** — bản remake luôn kèm link bài gốc + điểm outperform, để người duyệt biết nó học từ đâu.

---

## 7. Tên & logo — đề xuất

Hệ ẩn dụ Mắt Bão là **thời tiết / bão / radar**, và app đã có sẵn khái niệm "Tín hiệu".

**Đề xuất chính: BẮT SÓNG**
- Nghĩa kép: bắt sóng trend + bắt tín hiệu (radar) — nối liền mạch với màn "Tín hiệu" đang có.
- Thuần Việt, dễ gọi, hợp hệ brand bão/sóng/gió của Mắt Bão.
- Slug: `batsong` → `batsong.mk.dev.matbao.ai`.

Phương án thay thế:
- **ĐỌC VỊ** — nhấn vào năng lực phân tích ("đọc vị vì sao bài đó nổ"). Sang hơn, ít vui hơn.
- **TÂM BÃO** — nơi hội tụ, hợp brand nhưng trừu tượng hơn.

> Tôi tránh đề xuất kiểu "Học Lỏm": vui nhưng gợi đúng cái ta muốn tránh (đạo nhái), dễ thành điểm yếu khi giải trình với khách/sếp.

**Logo** (chưa vẽ, chờ chốt tên): vòng sóng radar đồng tâm, một chấm sáng **lệch tâm bật ra khỏi vòng** — thị giác hoá đúng insight "bài outperform vượt khỏi quy mô kênh". Màu kế thừa hệ hiện có: cam đất `#D97757`, nền `#FAF9F6`. Xuất SVG + favicon; app hiện **chưa có logo/favicon nào**.

---

## 8. Đăng nhập — làm rõ

App A **đã có** đăng nhập khá đầy đủ (local + Google SSO + admin duyệt user + phân quyền re-check DB). Việc cần làm không phải xây mới, mà là:

1. **App B chưa có auth nào** → thêm service-token cho A gọi, và **không mở B ra Internet**.
2. Siết phần còn thiếu ở A: rate-limit `/api/login` + `/api/oauth/authorize`, giới hạn domain `@matbao.com` khi tạo tài khoản Google, bỏ `?token=` query string cho ảnh (đổi sang cookie ngắn hạn hoặc signed URL).
3. Nếu muốn mở MCP cho claude.ai web → cần manager approval + `/vibe-sec` (theo quy ước org).

---

## 9. Lộ trình đề xuất

**Giai đoạn 1 — Nền (ưu tiên cao nhất)**
- Viết lại `docs/PRD.md` + `ARCH.md` cho đúng hiện trạng; dọn route mồ côi `scripts.routes.ts`.
- Xử lý 2 lỗ bảo mật clipchatbot (token trong git remote, `_sync/` chứa cookie + dump).
- Brand Profile có evidence (ingest website/fanpage/PDF).
- Siết auth theo mục 8.

**Giai đoạn 2 — Radar**
- Thêm bảng metrics + tích hợp Apify; công thức outperform; UI xếp hạng.

**Giai đoạn 3 — Deconstruct + Remake**
- Schema phân tích video; remake giữ flow; guardrail; export Google Sheet.

**Giai đoạn 4 — Video**
- Higgsfield; MCP tool mở rộng; đổi tên + logo.

---

## 10. Nguồn tham khảo
- Higgsfield API: https://docs.higgsfield.ai/docs
- Apify TikTok actors (metrics): https://apify.com/gatherworks/tiktok-profile-scraper/api
