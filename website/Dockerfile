FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
ENV DATABASE_URL=postgresql://reportajgo:reportajgo@localhost:5432/reportajgo_frontend?schema=public
COPY . .
RUN npx prisma generate
RUN NEXTAUTH_SECRET=build-time-placeholder NEXTAUTH_URL=http://localhost:3000 AGENT_API_KEY=build-time-placeholder npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
