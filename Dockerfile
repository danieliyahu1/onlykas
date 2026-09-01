FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/tsconfig.json ./shared/
COPY backend/package.json backend/tsconfig.json ./backend/
COPY frontend/package.json frontend/tsconfig*.json frontend/vite.config.ts frontend/index.html ./frontend/
RUN pnpm install --frozen-lockfile
COPY shared/src ./shared/src
COPY backend/src ./backend/src
COPY frontend/src ./frontend/src
RUN pnpm build && pnpm deploy --legacy --filter @onlykas/backend --prod /prod/backend

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV FFPROBE_PATH=/usr/bin/ffprobe
WORKDIR /app/backend
RUN apk add --no-cache ffmpeg
COPY --from=build /prod/backend ./
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist /app/frontend/dist
USER 1000
EXPOSE 3000
CMD ["node", "dist/server.js"]
