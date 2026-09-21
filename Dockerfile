# Outlier — Vite (React) client + Express/tsx API server + bộ công cụ media.
# Single-stage image: npm ci pulls the correct platform-native rollup binary,
# builds the client into dist/, then Express serves dist/ + /api/* in prod.
FROM node:22-slim

WORKDIR /app

# ===== Bộ công cụ media (kế hoạch gộp clipchatbot — xem docs/ARCH.md §1) =====
# ffmpeg : dựng/ghép video, burn phụ đề, trộn nhạc nền.
# yt-dlp : quét danh sách + tải video từ YouTube/TikTok/Facebook/Instagram.
# python3: chạy yt-dlp và sidecar f2 (Douyin) — f2 không có bản Node nên giữ
#          đúng MỘT script Python thay vì viết lại phần chống bot của Douyin.
# Cài qua venv để không đụng Python hệ thống (PEP 668).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
 && python3 -m venv /opt/mediatools \
 && /opt/mediatools/bin/pip install --no-cache-dir --upgrade pip yt-dlp \
 && apt-get purge -y --auto-remove \
 && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/mediatools/bin:$PATH" \
    YTDLP_PATH="/opt/mediatools/bin/yt-dlp"

# Install ALL deps (vite + tsx are devDependencies but are needed both to build
# the client and to run the TypeScript server at runtime).
COPY package*.json ./
RUN npm ci

# Client ID Google cho nút "Sign in with Google" — Vite NHÚNG biến VITE_* vào
# bundle LÚC BUILD, nên phải truyền dạng build arg (Coolify: đánh dấu env
# VITE_GOOGLE_CLIENT_ID là "Build Variable"). Rỗng = trang login ẩn nút Google.
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# Copy source and build the client bundle.
COPY . .
RUN npm run build

EXPOSE 3001

# In production server.ts serves the built dist/ and the /api/* routes.
# tsx runs the TypeScript server directly (no separate compile step).
CMD ["sh", "-c", "NODE_ENV=production node --import tsx server.ts"]
