FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
ENV DATABASE_URL=postgresql://reportajgo:reportajgo@localhost:5432/reportajgo_backend?schema=public
COPY tsconfig.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY brand ./brand
RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# fonts-dejavu-core: bold TTF the branded-card renderer needs (templateCard.ts) —
#   without it the slim image has no fonts and the card headline renders blank.
# xvfb: virtual display so the Instagram "web" publisher can run a headed Chromium
#   (open → post → close, like a human) on the headless server.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl fonts-dejavu-core xvfb && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY brand ./brand
# Chromium + its OS libraries for the Instagram web publisher (Playwright). Only
# the worker uses it, but the backend image is shared across app/worker/bot.
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
CMD ["npm", "run", "start:app"]
