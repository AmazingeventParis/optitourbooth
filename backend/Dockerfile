# ============================================================
# backend/Dockerfile — Build context : /backend
# Standalone (sans pnpm workspace root)
# ============================================================

# ---- Stage 1 : Build ----
FROM node:20-alpine AS builder

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma/

RUN NODE_ENV=development pnpm install

RUN npx prisma generate

COPY src ./src/
COPY tsconfig.json ./
COPY tsconfig.build.json ./

RUN npx tsc -p tsconfig.build.json

# ---- Stage 2 : Production ----
FROM node:20-alpine

# Required by Prisma query engine (detects OpenSSL 3.x, avoids libssl.so.1.1 error)
RUN apk add --no-cache openssl

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma/

RUN pnpm install --prod
RUN npx -y prisma@5 generate

COPY --from=builder /app/dist ./dist/

RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "dist/app.js"]
