FROM node:20-slim AS builder

WORKDIR /app

# Install build deps for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json ./
# Don't copy lockfile — rebuild native modules for Linux
RUN npm install --legacy-peer-deps

COPY . .

# USE_MOCK_DATA=true only during `next build` so static page data collection
# doesn't try to touch a non-existent SQLite file. Runtime value comes from
# Cloud Run env (USE_MOCK_DATA=false in prod).
ENV USE_MOCK_DATA=true
RUN npm run build

# Production image
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
# USE_MOCK_DATA and LOCAL_DB_PATH come from Cloud Run env, not baked in.

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080

CMD ["node", "server.js"]
