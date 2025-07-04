# ========================
# 👉 Build stage
# ========================
FROM node:18.20-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci --include=dev

COPY . .

RUN npm run build

# ========================
# 👉 Production stage
# ========================
FROM node:18.20-slim AS runner

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

RUN npm ci --omit=dev

ENV NODE_ENV=production

# Drop privileges: run as node user
USER node

CMD ["node"]
