# fanpage-content-create — Vite (React) client + Express/tsx API server.
# Single-stage image: npm ci pulls the correct platform-native rollup binary,
# builds the client into dist/, then Express serves dist/ + /api/* in prod.
FROM node:22-slim

WORKDIR /app

# Install ALL deps (vite + tsx are devDependencies but are needed both to build
# the client and to run the TypeScript server at runtime).
COPY package*.json ./
RUN npm ci

# Copy source and build the client bundle.
COPY . .
RUN npm run build

EXPOSE 3001

# In production server.ts serves the built dist/ and the /api/* routes.
# tsx runs the TypeScript server directly (no separate compile step).
CMD ["sh", "-c", "NODE_ENV=production node --import tsx server.ts"]
