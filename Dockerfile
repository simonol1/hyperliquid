# ========================
# 👉 Build stage
# ========================
FROM node:18.20-slim AS builder

WORKDIR /app

# Copy full lock + package.json
COPY package*.json ./

# Add before your npm commands
RUN apt-get update && apt-get install -y ca-certificates


# Install ALL dependencies — including dev — cleanly
RUN npm ci

# Copy the FULL source AFTER install so that code changes don’t invalidate npm ci cache
COPY . .

# Now build with tsup (guaranteed present)
RUN npx tsup

# ========================
# 👉 Production stage
# ========================
FROM node:18.20-slim AS runner

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/dist ./dist

RUN npm ci --omit=dev

ENV NODE_ENV=production
USER node

CMD ["node", "dist/bots/index.js"]
