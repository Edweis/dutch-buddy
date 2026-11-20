# --- build stage: compile native deps (better-sqlite3) ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# --- runtime stage: slim image, no build tools ---
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# SQLite file lives here; mount a volume to persist it.
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "src/app.js"]
