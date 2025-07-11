# ========================
# 👉 Build stage
# ========================
FROM node:18.20-slim AS builder

WORKDIR /app

COPY package*.json ./

# Add trusted certs (sometimes needed)
RUN apt-get update && apt-get install -y ca-certificates

RUN npm ci

COPY . .

RUN npx tsup

# ========================
# 👉 Runtime stage
# ========================
FROM node:18.20-slim AS runner

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/dist ./dist
COPY ./src/bots/config ./dist/config

RUN npm ci --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/trend.mjs"]  # default, will override in compose
