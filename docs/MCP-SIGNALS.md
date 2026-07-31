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

## 2. Bảng đầy đủ 8 tool (quyền tới dữ liệu)

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

Ghi chú chấm điểm: tổng = `do_nong + do_cham + do_hop_truc + tuoi_tho` (tối đa 20).
`≥ queue_min (16)` → **Nên làm** (queued); `12–15` → **Kho ý tưởng** (idea_bank); `<12` hoặc
`dinh_nhom_cam=true` → **Loại** (rejected). `do_an_toan` là **cổng an toàn**, không cộng tổng.

---

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
