# ========================
# 👉 Build stage
# ========================
FROM node:18.20-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN apt-get update && apt-get install -y ca-certificates

RUN npm ci

COPY . .

RUN npx tsup

# ✅ Copy raw config JSONs into the build output dir
COPY ./src/bots/config ./dist/config

# ========================
# 👉 Runtime stage
# ========================
FROM node:18.20-slim AS runner

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/dist ./dist

RUN npm ci --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/trend.mjs"]  # overridden in compose
