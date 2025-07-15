# ========================
# 👉 Build stage
# ========================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN apk add --no-cache bash ca-certificates \
    && npm ci

COPY . .

RUN npx tsup

# ✅ Copy raw config JSONs into the build output dir
COPY ./src/bots/config ./dist/config

# ========================
# 👉 Runtime stage
# ========================
FROM node:20-alpine AS runner

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/dist ./dist

RUN apk add --no-cache bash ca-certificates \
    && npm ci --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/trend.mjs"] # overridden in compose
