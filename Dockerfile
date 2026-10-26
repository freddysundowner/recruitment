FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholders only so the build can import modules; the real values are supplied when the container runs.
RUN STANDALONE=1 DATABASE_URL=postgres://build:build@localhost:5432/build SESSION_SECRET=build-time-placeholder-build-time-placeholder npm run build

# The web app
FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data/storage && chown -R app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
ENV STORAGE_DIR=/data/storage
EXPOSE 3000
CMD ["node", "server.js"]

# Applies database migrations: docker compose run --rm migrate
FROM deps AS migrate
WORKDIR /app
COPY tsconfig.json ./
COPY scripts ./scripts
COPY db ./db
COPY src/lib ./src/lib
CMD ["npx", "tsx", "scripts/migrate.ts"]

# Background worker: sends messages and reminders, checks M-Pesa payments that never confirmed, removes deleted files
FROM deps AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src/lib ./src/lib
CMD ["npx", "tsx", "scripts/worker.ts"]
