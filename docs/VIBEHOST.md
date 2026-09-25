# Chạy Outlier trên Vibe Host

Bản trên Vibe Host là bản **MCP dùng được với Claude**. Bản Coolify
(`fanpage-content-create.mk.dev.matbao.ai`) nằm sau Traefik nội bộ nên
claude.ai không gọi tới được; Vibe Host mặc định công khai nên gọi được.

- Website: https://outlier.n1.tinhgon.xyz
- Project id: `cmucd8go900br0j5fs6h3lcot`
- Repo: `THINHLQ97-company/outlier` (public — Vibe Host chỉ nhận repo công khai)
- DB: managed PostgreSQL `outlier-db`, Vibe Host tự tạo và tự tiêm `DATABASE_URL`

## Endpoint MCP

| Đường dẫn | Dùng để |
|---|---|
| `POST /api/mcp-signals` | Chính endpoint MCP (JSON-RPC 2.0), 30 tool |
| `/.well-known/oauth-authorization-server` | Claude tự tìm nơi đăng nhập |
| `/.well-known/oauth-protected-resource` | Claude biết tài nguyên nào cần token |
| `/api/oauth/register` | Đăng ký client động (RFC 7591) |

Xác thực: OAuth 2.1 + PKCE cho Claude Chat, hoặc `Bearer $SIGNALS_MCP_TOKEN`
cho script và thử tay.

## Ba cái bẫy khi deploy (đã vấp đủ cả ba)

**1. Không có biến môi trường nào được để trống.** Vibe Host đọc
`.env.example`, đòi đủ mọi biến, và từ chối cả chuỗi rỗng lẫn khoảng trắng.
Các tích hợp tuỳ chọn (Google SSO, Market Radar, Group Insights, Social
backend, FB page, Meta app) vì vậy phải điền sentinel:

- biến thường → `off`
- biến tên `*_URL` → `https://off.invalid/` (host bắt phải là URL hợp lệ;
  `.invalid` là TLD dành riêng theo RFC 2606, không bao giờ phân giải được)

`OPTIONAL_ENV_KEYS` trong `server.ts` xoá các sentinel này ngay khi khởi động,
để mọi chỗ kiểm tra `if (!process.env.X)` vẫn hiểu đúng là "chưa cấu hình".
`VITE_GOOGLE_CLIENT_ID` phải xử lý riêng trong `Login.tsx` vì nó là biến
build-time, đã bị nhúng thẳng vào gói trình duyệt trước khi server chạy.

**2. Postgres cũng ăn CPU trong hạn mức.** Deploy đầu hỏng ở
`auto-config tạo DB: Vượt CPU của gói` — app giữ hết phần CPU còn trống nên
không còn chỗ tạo container DB. Hạ app xuống rồi deploy lại là xong; sau khi
DB đã tạo thì nâng app lên lại được.

**3. `redeploy_project` có thể trả `NO_CHANGE` ngay sau khi push.** Vibe Host
chưa thấy commit mới; đợi một lúc rồi gọi lại.

## Nhắc lại

`git push` lên GitHub **không** tự deploy. Phải gọi `redeploy_project`.
