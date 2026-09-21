# MCP "Tín hiệu" — Hướng dẫn & Bảng quyền

Tài liệu này mô tả **MCP server "Tín hiệu"** của app fanpage-content-create: cách kết nối
Claude vào, và **toàn bộ quyền** mà MCP được phép làm với dữ liệu của công cụ.

> MCP (Model Context Protocol) = "cổng" cho Claude gọi thẳng vào app để đọc/ghi dữ liệu
> tín hiệu. **Trí tuệ nằm ở Claude** (Claude tự web-search, suy luận, chấm điểm) — server
> MCP chỉ **cấp và lưu dữ liệu**, KHÔNG tự gọi AI. Đây là bước THU + LỌC của pipeline nội dung.

- **Endpoint MCP**: `https://fanpage-content-create.mk.dev.matbao.ai/api/mcp-signals`
- **Trang giới thiệu (mở bằng trình duyệt)**: cùng URL trên (GET → trang hướng dẫn HTML)
- **Kết quả Claude tạo** (điểm, lý do, cụm, góc hài) hiện trong **tab Tín hiệu** của app để
  người vận hành review rồi bấm "Đưa sang Sáng tạo".

---

## 1. Cách kết nối

### A. Claude Desktop (nội bộ — đang dùng)

Máy phải **trong mạng Mắt Bão** (văn phòng hoặc VPN) và có **Node.js**. Mở file cấu hình:
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fanpage-signals": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://fanpage-content-create.mk.dev.matbao.ai/api/mcp-signals",
        "--header", "Authorization: Bearer <SIGNALS_MCP_TOKEN>"
      ]
    }
  }
}
```

Thay `<SIGNALS_MCP_TOKEN>` bằng token thật (biến `SIGNALS_MCP_TOKEN` đã set trên Coolify).
Lưu → thoát hẳn & mở lại Claude Desktop → thấy tool `fanpage-signals` là xong.

`mcp-remote` chạy **ngay trên máy bạn**, gọi thẳng endpoint (không qua server Anthropic) →
chỉ cần máy trong mạng Mắt Bão là được, không cần mở app ra public.

### B. Claude.ai web (cần mở public — chưa bật)

Muốn add connector trên **claude.ai web**, endpoint phải **reachable public** (vì server
Anthropic gọi vào, IP công cộng → hiện bị IP-allowlist chặn). Cần **mở public** cho 3 path
`/api/mcp-signals`, `/.well-known/*`, `/api/oauth/*` (`mb-deploy set-scope public`, **cần
manager approval**). Khi đó dùng **OAuth**: add connector bằng URL → đăng nhập tài khoản
fanpage → cấp quyền. (Giống hệt cách ReportApp connect claude.ai vì nó vốn public.)

---

## 2. Bảng đầy đủ 19 tool (quyền tới dữ liệu)

| Tool | Loại | Làm gì | Đầu vào | Chạm dữ liệu nào |
|---|---|---|---|---|
| `signals_list` | 🟢 Đọc | Liệt kê tín hiệu (14 ngày gần nhất) | status?, truc?, days?, limit? | ĐỌC bảng `signals` |
| `signals_get` | 🟢 Đọc | Xem chi tiết 1 tín hiệu | id | ĐỌC 1 dòng `signals` |
| `rubric_get` | 🟢 Đọc | Xem rubric chấm điểm + ngưỡng + định nghĩa | — | ĐỌC `rubric_versions` |
| `characters_list` | 🟢 Đọc | Xem dàn nhân vật (tên/tính cách/câu cửa miệng) | — | ĐỌC `characters` |
| `signals_add` | 🔴 Ghi | Thêm 1 tin web/news mới (source=claude_research) | title, rawSummary, truc?, sourceUrl?, radar?, publishedDate? | THÊM dòng vào `signals` |
| `signals_score` | 🔴 Ghi | Chấm điểm 5 tiêu chí + lý do; tự route trạng thái | id, do_nong, do_cham, do_hop_truc, tuoi_tho, do_an_toan, dinh_nhom_cam?, reasoning? | SỬA `scoreJson` + `status` của 1 tín hiệu |
| `signals_set_cluster` | 🔴 Ghi | Gom nhiều tin trùng/liên quan thành 1 cụm | ids[], label | SỬA `clusterId`+`clusterLabel` các tín hiệu |
| `signals_suggest_angle` | 🔴 Ghi | Gợi ý góc hài (cảnh + nhân vật + thoại) | id, scene, characters?[], dialogue?[], note? | SỬA `suggestionJson` của 1 tín hiệu |
| `brands_list` | 🟢 Đọc | Liệt kê hồ sơ thương hiệu + trạng thái bóc | — | ĐỌC bảng `brands` |
| `brand_profile_get` | 🟢 Đọc | Đọc hồ sơ 1 thương hiệu **kèm câu trích nguồn từng mục**; trả `missing_fields` cho mục chưa có dữ liệu | brand_id | ĐỌC `brands` + `brand_sources` |
| `brand_ingest` | 🔴 Ghi | Nạp tài liệu cho thương hiệu (link website hoặc dán nội dung) | brand_id, url? \| text? | THÊM dòng `brand_sources` |
| `brand_extract` | 🔴 Ghi | Bóc hồ sơ từ tài liệu đã nạp; mục nào không kiểm chứng được câu trích sẽ bị loại và báo trong `rejected` | brand_id | SỬA các cột hồ sơ của 1 `brands` |
| `radar_jobs_list` | 🟢 Đọc | Liệt kê các phiên quét Radar | — | ĐỌC `radar_jobs` |
| `radar_results` | 🟢 Đọc | Kết quả 1 phiên quét, **đã xếp theo mức vượt trội so với quy mô kênh**, kèm lý do chấm điểm + độ tin cậy | job_id, limit? | ĐỌC `radar_items` |
| `deconstruct_start` | 🔴 Ghi | Bóc cấu trúc 1 bài (3 giây đầu, mở vấn đề, giữ chân, twist, chốt). Chạy nền 1-3 phút | url \| radar_item_id | THÊM dòng `deconstructions` |
| `deconstruct_get` | 🟢 Đọc | Xem kết quả bóc cấu trúc; mọi mốc giây đã đối chiếu với độ dài video thật | id | ĐỌC `deconstructions` |
| `remake_start` | 🔴 Ghi | Viết bản mới cho thương hiệu theo cách triển khai đã bóc. Chạy nền 10-40 giây | brand_id, deconstruction_id, format? | THÊM dòng `remakes` |
| `remake_get` | 🟢 Đọc | Xem bản viết **kèm kết quả guardrail** | id | ĐỌC `remakes` |
| `remake_check` | 🔴 Ghi | Kiểm tra một đoạn nội dung theo quy tắc thương hiệu (bê nguyên văn / từ cấm / chế công dụng) | id, draft? | SỬA `guardrailJson` của 1 `remakes` |

Ghi chú chấm điểm: tổng = `do_nong + do_cham + do_hop_truc + tuoi_tho` (tối đa 20).
`≥ queue_min (16)` → **Nên làm** (queued); `12–15` → **Kho ý tưởng** (idea_bank); `<12` hoặc
`dinh_nhom_cam=true` → **Loại** (rejected). `do_an_toan` là **cổng an toàn**, không cộng tổng.

---

## 2b. Vì sao hồ sơ thương hiệu hay bị "thiếu" — và đó là đúng

Hồ sơ thương hiệu tuân nguyên tắc P1 (`docs/PRD.md` §2): **thông tin nào điền vào cũng phải chỉ ra được lấy từ đâu trong tài liệu; không tìm thấy thì để thiếu, không bịa cho đủ.**

Cơ chế cưỡng chế (nằm ở `server/services/brand-extract.ts`, KHÔNG phụ thuộc lời dặn trong prompt):
1. Model trả JSON kèm câu trích cho từng mục.
2. Server **đối chiếu ngược từng câu trích với văn bản gốc đã lưu**.
3. Câu nào không tìm thấy → vứt. Mục nào mất hết câu trích → để trống, và ghi lý do vào `rejected`.

Vì khớp khá chặt nên **câu model tự viết lại (paraphrase) cũng bị loại** — chỉ câu sao y nguyên văn mới được nhận. Đây là chủ ý.

Khi gọi `brand_profile_get`, các mục trong `missing_fields` là **chưa có dữ liệu thật**. Claude **không được tự suy đoán điền thay** — hãy gọi `brand_ingest` nạp thêm tài liệu rồi `brand_extract` lại.

---


### Lưu ý khi đọc kết quả Radar

Điểm trả về ở **thang 100**, xếp theo mức bài đó vượt trội so với **quy mô của chính kênh đăng nó** — không phải theo lượt thích tuyệt đối. Một kênh 2.000 người theo dõi có bài 8.000 lượt thích sẽ xếp trên kênh 14 triệu người theo dõi có bài 6.000 lượt thích.

`confidence` cho biết điểm đáng tin tới đâu:
- `low` — mới có số liệu quét sơ bộ (thiếu lượt thích / người theo dõi). Chỉ nên tham khảo.
- `medium` — có một trong hai mốc so sánh.
- `high` — đủ cả mốc kênh lẫn quy mô người theo dõi.

Trường `reasons` giải thích điểm đến từ đâu. **Đừng bỏ qua `confidence` khi tư vấn cho người dùng** — một bài `low` điểm cao có thể chỉ là ăn may do thiếu dữ liệu.


### Guardrail — vì sao bản viết bị chặn

Mọi bản remake đều kèm `guardrailJson`. **`passed: false` nghĩa là còn lỗi mức chặn — không được đem dùng khi chưa sửa.**

Bốn thứ được kiểm (cưỡng chế bằng code ở `server/services/guardrail.ts`, không bằng lời dặn trong prompt):

| Mã | Mức | Bắt cái gì |
|---|---|---|
| `copied_text` | chặn | Trùng **từ 7 từ liên tiếp trở lên** với lời thoại bài gốc — bê nguyên văn, không phải học cách triển khai |
| `unverified_claim` | chặn | Câu khẳng định mạnh ("cam kết", "100%", "tốt nhất"…) không khớp công dụng nào trong hồ sơ thương hiệu |
| `banned_term` | chặn | Dùng từ thương hiệu đã dặn tránh (bắt được cả khi viết không dấu) |
| `wrong_addressing` | nhắc | Không thấy cách xưng hô quen thuộc của thương hiệu |

Lớp phòng vệ đầu tiên nằm ở chỗ khác: prompt viết lại **chỉ nhận công thức triển khai**, không bao giờ nhận nguyên văn bài gốc — model không đọc được câu chữ gốc thì không thể chép lại. Việc đo trùng lặp là lớp thứ hai.

## 3. Ranh giới quyền — MCP LÀM ĐƯỢC gì / KHÔNG làm được gì

### ✅ MCP ĐƯỢC PHÉP (chỉ trong phạm vi Tín hiệu)
- **Đọc**: danh sách + chi tiết tín hiệu; rubric; dàn nhân vật.
- **Ghi (chỉ bảng `signals`)**: thêm tín hiệu mới; chấm điểm + đổi trạng thái; gom cụm;
  lưu góc hài gợi ý.

### ⛔ MCP KHÔNG được phép (ngoài phạm vi — không có tool nào làm được)
- **KHÔNG** đụng tới ảnh/bài đăng (`posts`), kho ảnh (`assets`), phong cách (`styles`),
  RAG (`rag_examples`/`rag_profiles`), file lưu trữ (`files`).
- **KHÔNG** tạo/sửa/xoá **tài khoản người dùng** (`users`), không đổi quyền, không đọc mật khẩu.
- **KHÔNG** vẽ ảnh, không gọi Gemini, không đăng Facebook.
- **KHÔNG** xoá tín hiệu, **KHÔNG** sửa/tạo rubric (chỉ đọc).
- **KHÔNG** đọc biến môi trường / secret / API key.
- **KHÔNG** chạy lệnh hệ thống, không truy cập DB trực tiếp — chỉ 8 tool trên, qua Drizzle.

Tức là kể cả khi lộ token, kẻ xấu **chỉ** thao tác được với **bảng tín hiệu** (thêm/chấm/
gom/gợi ý) — không chạm được ảnh, tài khoản, hay hạ tầng. Người vận hành vẫn phải review
thủ công trước khi 1 tín hiệu thành bài (bấm "Đưa sang Sáng tạo").

---

## 4. Cơ chế xác thực & phân quyền

- **2 đường vào**:
  1. **Static bearer token** (`SIGNALS_MCP_TOKEN`, env Coolify) — dùng cho Claude Desktop/Code.
     Ai có token = quyền admin (đủ 8 tool). → **giữ token bí mật**.
  2. **OAuth 2.1** (đăng nhập tài khoản fanpage) — dùng cho claude.ai web (khi mở public).
     Quyền theo tài khoản: mọi nhân sự active có `signals` + `signals-edit`.
- **Permission gate**: tool 🟢 đọc cần quyền `signals`; tool 🔴 ghi cần `signals-edit`.
  Không có token/không đủ quyền → trả 401/403 (không lộ dữ liệu).
- Server dùng `JWT_SECRET` (fallback `AUTH_SECRET`) để ký/verify OAuth token.

---

## 5. Quy trình gợi ý (prompt mẫu cho Claude)

> "Dùng fanpage-signals: tìm 5 tin AI nóng tuần này (14 ngày gần nhất), thêm vào hệ thống,
> gom các tin trùng thành cụm, chấm điểm rubric kèm lý do ngắn, và với các tin 'Nên làm' hãy
> gợi ý 1 góc hài + chọn nhân vật phù hợp."

Claude sẽ tự: web-search → `signals_add` → `signals_set_cluster` → `rubric_get` +
`signals_score` → `characters_list` + `signals_suggest_angle`. Toàn bộ hiện ở **tab Tín hiệu**.

---

## 6. Bảo mật — lưu ý

- **Token là bí mật**: bất kỳ ai có `SIGNALS_MCP_TOKEN` + truy cập được endpoint (trong
  mạng Mắt Bão) đều gọi được 8 tool. Đổi token = tạo giá trị mới trong env Coolify + redeploy;
  các máy Desktop cập nhật lại config.
- Endpoint hiện **chỉ nội bộ** (IP-allowlist) — ngoài mạng trả 403. Đây là lớp bảo vệ thêm.
- MCP **không** mở thêm bề mặt tấn công tới ảnh/tài khoản/hạ tầng (xem mục 3).

---

*File liên quan: `server/routes/mcp-signals.routes.ts` (server MCP + 8 tool),
`server/routes/mcp-oauth.routes.ts` + `server/mcp/oauth.ts` (OAuth 2.1),
`server/services/rubric-scoring.ts` (chấm điểm). Env: `SIGNALS_MCP_TOKEN`, `JWT_SECRET`.*
