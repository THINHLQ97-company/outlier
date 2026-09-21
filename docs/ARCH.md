# ARCH: Outlier

**Cập nhật**: 2026-09-18 · **Thay thế**: `docs/archive/ARCH-fanpage-engine-v1.md`

---

## 1. Quyết định kiến trúc: gộp về MỘT app

Theo chốt của owner: gộp `clipchatbot` (Python/FastAPI/Celery) vào app này (Node/Express/React) thành **một codebase, một container, một deploy**.

### Gộp theo hướng nào — và vì sao
**Node làm chủ, port khối media sang Node.** Lý do: Node đang giữ phần khó thay thế nhất — UI, auth, OAuth 2.1, MCP server. Port ngược (Node→Python) sẽ phải viết lại cả 3 thứ đó.

| Thành phần clipchatbot | Cách đưa sang Node |
|---|---|
| FFmpeg | Đang gọi `subprocess` — Node gọi `child_process` y hệt. **Port thẳng**. Đã kiểm chứng: `ffmpeg 5.1` của Debian có đủ `zoompan`, `xfade`, `sidechaincompress`, `subtitles`, `atempo` → **không cần tải build 8.1 từ GitHub** như clipchatbot đang làm |
| yt-dlp | Là binary CLI standalone → Node gọi CLI. **Port thẳng** |
| Whisper STT | Gọi OpenAI REST API. **Port thẳng** |
| Imagen 4 / Veo 3.1 | Vertex AI REST. **Port thẳng** |
| Celery + Redis | Thay bằng **pg-boss** (job queue trên Postgres sẵn có) → **bỏ được Redis** |
| **f2** (Douyin) | ⚠️ Chỉ có bản Python, không có tương đương Node |

### Điểm kẹt duy nhất: f2
f2 tự ký X-Bogus/msToken cho Douyin — viết lại bằng Node là việc lớn và dễ vỡ mỗi lần Douyin đổi thuật toán.

**Giải pháp**: giữ **một sidecar Python duy nhất** — script CLI nhỏ (`media/douyin_fetch.py`) nhận JSON qua stdin, trả JSON qua stdout, Node gọi bằng `child_process`. Vẫn là 1 app / 1 repo / 1 container (image có sẵn `python3` + `f2`), không phải 1 service riêng.

> Đây là đánh đổi có ý thức: giữ ~150 dòng Python để khỏi phải bảo trì phần chống bot của Douyin.

---

## 2. Sơ đồ

```
┌──────────────────────────────────────────────────────────────┐
│  OUTLIER — 1 container                                        │
│                                                               │
│  React 19 + Vite 6  ──────────────────────┐                  │
│                                            │                  │
│  Express 4 (server.ts)                     │                  │
│  ├─ /api/auth      Google SSO + local     │                  │
│  ├─ /api/brands    Brand Profile (MỚI)    │                  │
│  ├─ /api/radar     Quét + ranking  (MỚI)  │                  │
│  ├─ /api/decon     Bóc cấu trúc    (MỚI)  │                  │
│  ├─ /api/remakes   Remake+guardrail(MỚI)  │                  │
│  ├─ /api/studio    Sinh ảnh        (có)   │                  │
│  ├─ /api/signals   Tín hiệu+rubric (có)   │                  │
│  ├─ /api/media     Tải/render video(PORT) │                  │
│  └─ /api/mcp-signals  MCP JSON-RPC (có)   │                  │
│                                            │                  │
│  pg-boss worker (cùng process hoặc tách)  │                  │
│  ├─ job: brand_ingest                      │                  │
│  ├─ job: radar_scan → radar_enrich         │                  │
│  ├─ job: deconstruct                       │                  │
│  └─ job: render_video                      │                  │
│                                            │                  │
│  Sidecar: python3 media/douyin_fetch.py (f2)                 │
│  Binary:  ffmpeg 8.1, yt-dlp                                 │
└───────────────┬──────────────────────────────────────────────┘
                │
     ┌──────────┴──────────┬──────────────┬─────────────┐
  Postgres              Gemini/Vertex   Apify      Higgsfield
  (data + pg-boss)      Imagen/Veo      (metrics)  (Phase 2)
```

---

## 3. Luồng Radar — f2 quét list, Apify lấy metrics

Theo chốt của owner (tối ưu chi phí):

```
1. radar_scan   — f2 (Douyin) / yt-dlp (TikTok, YT, IG) quét rộng
                  → danh sách ứng viên + metadata cơ bản. RẺ.
2. lọc sơ bộ    — bỏ bài quá cũ, sai ngách, trùng
3. radar_enrich — chỉ gọi Apify cho TOP N ứng viên
                  → views, likes, comments, shares, follower_count. TỐN PHÍ.
4. baseline     — tính/cập nhật median của từng kênh (channel_baselines)
5. rank         — outperform_score, đánh dấu low_confidence nếu thiếu baseline
```

Ngân sách Apify kiểm soát bằng `RADAR_ENRICH_LIMIT` (mặc định 50 item/phiên).

---

## 4. Ba engine video — phân vai

| Engine | Dùng khi | Chi phí |
|---|---|---|
| **FFmpeg 8.1** | Luôn: ghép, xfade, phụ đề, BGM ducking (`sidechaincompress`), Ken Burns (`zoompan`) | Miễn phí |
| **Gemini Imagen 4 Fast + Veo 3.1 Lite** | Mặc định: ảnh, footage, chuyển động nhẹ | ~$0.04/ảnh |
| **Higgsfield** | Phase 2: cảnh cần chất lượng điện ảnh | Kling 3.0 ~$1.12/10s; Kling 2.6 ~$0.70/10s |

**Higgsfield**: base `https://api.higgsfield.ai`, header `Authorization: Key <id>:<secret>`, submit → poll `status_url` / webhook.
⚠️ Output chỉ giữ **~7 ngày** → job render phải tải file về lưu ngay, tuyệt đối không lưu URL làm nguồn.

---

## 4b. Việc chạy lâu — BẮT BUỘC chạy nền

Quét Radar mất 30-90 giây, bổ sung số liệu 20-60 giây. Giữ request HTTP mở lâu như
vậy sẽ **bị Traefik/Coolify ngắt giữa chừng** trong môi trường thật, dù local chạy tốt.

Quy tắc: endpoint khởi động việc dài **trả về ngay** (`status` + `polling: true`),
việc chạy nền, client gọi lại `GET .../:id` để theo dõi. Đo thực tế sau khi sửa:
`POST /api/radar` phản hồi **0,093 giây** thay vì 30-90 giây.

Vì request đã trả về trước khi việc xong, **mọi lỗi phải được ghi vào bản ghi
trong DB** (`status="error"` + `errorMessage`) — không còn chỗ nào khác để báo.

---

## 4c. Chi phí Apify — số đo thực tế (2026-09-18)

| Hạng mục | Giá trị |
|---|---|
| Đơn giá | **~$0,0035 / kết quả** (đo: 2 kết quả = $0,00700) |
| Cách tính | PAY_PER_EVENT — theo **số kết quả**, KHÔNG theo lượt chạy |
| Gói tài khoản | STARTER, hạn mức **$29/tháng** |

Hệ quả thiết kế: phanh theo lượt chạy là **chưa đủ** — một lượt xin 1.000 kết quả
vẫn tốn $3,5. Phải chặn theo cả số kết quả (`APIFY_DAILY_RESULT_BUDGET`, mặc định
150/ngày ≈ $0,52/ngày ≈ $15,8/tháng).

Tên trường **khác nhau giữa các actor** — đã đối chiếu dataset thật:
- TikTok (clockworks): `playCount`, `diggCount`, `authorMeta.fans`, `createTimeISO`
- YouTube (streamers): `viewCount`, `likes`, `numberOfSubscribers`, `channelId`, `date`

---

## 5. MCP — mở rộng từ 8 lên ~18 tool

Giữ nguyên 8 tool hiện có (`signals_*`, `rubric_get`, `characters_list`). Thêm:

```
brand_ingest        (url|pdf)                   → job_id
brand_profile_get   (brand_id)                  → profile + evidence từng field
radar_search        (keyword|competitor, platforms[]) → job_id
radar_rank          (job_id, top_n)             → list theo outperform_score
content_deconstruct (video_url|item_id)         → hook_3s, problem_open, beats[], twist, cta
remake_draft        (source_id, brand_id)       → draft + guardrail_report
remake_revise       (draft_id, note)            → draft mới + guardrail_report
video_render        (draft_id, engine)          → job_id
sheets_export       (draft_ids[], sheet_url)    → kết quả
job_status          (job_id)                    → tiến độ (dùng chung)
```

**Nguyên tắc**: việc chạy lâu trả `job_id` ngay, không để MCP call treo. OAuth 2.1 + PKCE đã có, tái dùng nguyên.

---

## 6. Guardrail — chạy ở tầng service, không ở prompt

`server/services/guardrail.ts`, chạy sau mỗi lần sinh remake:

| Mã | Kiểm tra | Hành động khi vi phạm |
|---|---|---|
| P1 | Field brand không có evidence | Không ghi field, hiện "chưa có dữ liệu" |
| P2 | n-gram overlap ≥7 từ liên tiếp với transcript gốc | Chặn export, chỉ rõ đoạn trùng |
| P3 | Claim sản phẩm không khớp brand profile | Gắn cờ `unverified`, chặn export |
| P4 | Dùng từ cấm / sai xưng hô | Chặn export, chỉ rõ chỗ sai |

Trả `guardrail_report` kèm mọi draft — cả qua UI lẫn qua MCP.

---

## 7. Thay đổi schema

Bảng mới: `brands`, `brand_sources`, `radar_jobs`, `radar_items`, `channel_baselines`, `deconstructions`, `remakes`.
Bảng bỏ: `scripts` (+ `scripts.routes.ts`) — route mồ côi, xác nhận 0 chỗ gọi trong `src/`.
Migration: drizzle-kit forward-only, chạy tự động lúc boot (`server/db/migrate.ts`).

---

## 8. Giới hạn đã biết

- Ảnh bài viết vẫn lưu **base64 trong Postgres** (`files` table) — bền qua redeploy Coolify nhưng sẽ phình DB khi scale. Cần chuyển sang object storage khi vượt ~5GB.
- Test coverage hiện **0%** — phải có test cho guardrail và công thức outperform trước khi productize.
- 2 MCP nội bộ (Market Radar, Group Insights) **chưa có token thật** → luôn fallback demo data.
- Douyin scraping phụ thuộc cookie tài khoản thật; cookie hết hạn → f2 fail, cần cơ chế cảnh báo.
