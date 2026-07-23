# fanpage-content-create — Vite (React) client + Express/tsx API server.
# Single-stage image: npm ci pulls the correct platform-native rollup binary,
# builds the client into dist/, then Express serves dist/ + /api/* in prod.
FROM node:22-slim

WORKDIR /app

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
