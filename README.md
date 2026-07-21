# fanpage-content-create

Content engine bán tự động cho fanpage Facebook "Ăn Nằm Với AI" (Mắt Bão).
Pipeline: **THU → LỌC → DỊCH → VẼ → DUYỆT → ĐĂNG** (iMVP; ĐĂNG thủ công, HỌC là
Phase 2). Xem [docs/PRD.md](docs/PRD.md), [docs/PLAN.md](docs/PLAN.md),
[docs/ARCH.md](docs/ARCH.md) và đặc tả nghiệp vụ gốc
[MATBAO_FANPAGE_ENGINE_v3.md](MATBAO_FANPAGE_ENGINE_v3.md).

## Stack

React 19 + Vite 6 + TypeScript + Tailwind CSS v4 · Express 4 · Postgres +
Drizzle ORM · Docker (Coolify-ready).

## Chạy nhanh (Docker Compose — khuyến nghị)

```bash
cp .env.example .env
# điền AUTH_SECRET (>=16 ký tự), ADMIN_SEED_USERNAME/PASSWORD — các biến
# MCP/social/Facebook có thể để trống, app sẽ tự fallback demo data.

docker compose up -d --build
# migration chạy tự động lúc app boot (server/db/migrate.ts)

npm install   # để chạy seed script từ host (cần cùng deps)
DATABASE_URL="postgres://fanpage:fanpage@localhost:5433/fanpage_content_create" \
  AUTH_SECRET="<giống trong .env>" \
  ADMIN_SEED_USERNAME="<giống trong .env>" \
  ADMIN_SEED_PASSWORD="<giống trong .env>" \
  npm run db:seed

# mở http://localhost:3001, đăng nhập bằng ADMIN_SEED_USERNAME/PASSWORD
```

## Chạy dev (không Docker)

Cần Postgres cục bộ, set `DATABASE_URL` trong `.env` trỏ tới đó.

```bash
npm install
npm run db:generate   # (chỉ khi đổi schema) — sinh migration mới
npm run db:seed       # seed nhân vật + rubric mặc định + tín hiệu demo
npm run dev            # http://localhost:3001 (Express + Vite middleware)
```

## Scripts

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy server dev (Express + Vite middleware mode) |
| `npm run build` | Build client → `dist/` |
| `npm run start` | Chạy server production (cần `npm run build` trước, hoặc dùng Dockerfile) |
| `npm run lint` | `tsc --noEmit` — bắt buộc chạy sau mỗi thay đổi code |
| `npm run db:generate` | Sinh migration mới từ `server/db/schema.ts` |
| `npm run db:seed` | Seed nhân vật cố định + rubric mặc định + tín hiệu demo |

## Biến môi trường cần điền trước khi vận hành thật

Xem [.env.example](.env.example) — các biến sau **chưa có giá trị thật**,
app fallback sang demo data khi thiếu (log warning, không crash):

- `MARKET_RADAR_MCP_URL` / `MARKET_RADAR_MCP_TOKEN`
- `GROUP_INSIGHTS_MCP_URL` / `GROUP_INSIGHTS_MCP_TOKEN`
- `SOCIAL_BACKEND_URL` / `SOCIAL_BACKEND_TOKEN`
- `FB_PAGE_ID` / `FB_ACCESS_TOKEN` (chỉ cần cho Phase 2 — đăng tự động)

## Deploy

Dùng `mb-deploy` (xem `~/workspace/CLAUDE.md`) hoặc Coolify trực tiếp với
`Dockerfile` sẵn có. Domain dự kiến: `fanpage-content-create.mk.dev.matbao.ai`.
