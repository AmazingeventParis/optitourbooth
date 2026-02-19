# ============================================================
# frontend/Dockerfile — Build context : /frontend
# Standalone (sans pnpm workspace root)
# ============================================================

# ---- Stage 1 : Build Vite ----
FROM node:20-alpine AS builder

RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json ./

RUN pnpm install

COPY src ./src/
COPY public ./public/
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./
COPY tailwind.config.js ./
COPY postcss.config.js ./

# Variables d'environnement baked au build (passées en ARG par Coolify)
ARG VITE_API_URL
ARG VITE_SOCKET_URL

RUN echo "VITE_API_URL=${VITE_API_URL}" > .env && \
    echo "VITE_SOCKET_URL=${VITE_SOCKET_URL}" >> .env

RUN pnpm build

# ---- Stage 2 : Servir avec nginx ----
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
