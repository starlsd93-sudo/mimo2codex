# ── 构建阶段 ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# better-sqlite3 编译依赖
RUN apk add --no-cache python3 make g++

# 先复制依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/

RUN npm ci && npm --prefix web ci

# 复制源码
COPY tsconfig.json ./
COPY src/ ./src/
COPY web/ ./web/

# 构建后端 + 前端
RUN npm run build:all

# 裁剪：删除 devDeps 和编译产物
RUN npm prune --production && \
    rm -rf node_modules/better-sqlite3/deps \
           node_modules/better-sqlite3/src \
           node_modules/better-sqlite3/build/Release/obj.target \
           node_modules/prebuild-install \
           node_modules/.bin \
           node_modules/.cache && \
    find node_modules -type f -name "*.md" -delete && \
    find node_modules -type f -name "*.ts" -delete && \
    find node_modules -type f -name "*.map" -delete && \
    find node_modules -type d -name "test" -prune -exec rm -rf {} + && \
    find node_modules -type d -name "tests" -prune -exec rm -rf {} +

# ── 运行阶段 ──────────────────────────────────────────────────────────────────
# 使用 alpine 裸镜像 + nodejs，去掉 npm/yarn 等工具链
FROM alpine:3.19 AS runtime

WORKDIR /app

# nodejs 运行时 + better-sqlite3 依赖的 libstdc++
RUN apk add --no-cache nodejs libstdc++

ENV NODE_ENV=production
ENV PORT=8788
ENV MIMO2CODEX_HOST=0.0.0.0

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY .env.example ./.env.example

EXPOSE 8788

ENTRYPOINT ["node", "dist/cli.js"]