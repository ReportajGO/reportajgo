# RΞPORTAJ GO

Multilingual (UZ / RU / EN) world-news portal.

## Stack
- **Next.js 15** (App Router) · React 19 · TypeScript
- **Tailwind CSS** (brand palette in `tailwind.config.ts`)
- **Prisma** + SQLite (swap to PostgreSQL for prod)
- **next-intl** (i18n routing) · **next-themes** (light/deep-dark)
- **NextAuth.js** (credentials) for the protected admin

## Getting started
```bash
npm install
npx prisma db push      # create the SQLite schema
npm run db:seed         # admin user + categories + sample posts
npm run dev             # http://localhost:3000
```

The root `/` redirects to `/ru`. Switch languages with the UZ/RU/EN toggle.

## Admin
- URL: `/ru/admin` (or `/en/admin`, `/uz/admin`) — also linked in the footer.
- Login: **admin@reportajgo.uz** / **admin123** (change in `prisma/seed.ts`).
- CRUD posts: headline, excerpt, body, category, image URL, language, breaking & published flags.

## Project layout
```
src/
  app/
    [locale]/
      (public)/        # site: home, [category], article/[id], search
      admin/           # dashboard, new, [id]/edit  (auth-guarded)
      login/           # credentials sign-in
    api/
      auth/[...nextauth]/   # NextAuth
      posts/ , posts/[id]/  # CRUD API
      rates/                # currency ticker service
  components/          # Logo, Header, Ticker, NavBar, cards, admin/*
  i18n/                # next-intl routing / request / navigation
  lib/                 # prisma, posts, rates, auth, constants, time
  messages/            # uz.json, ru.json, en.json
prisma/                # schema.prisma, seed.ts
```

## Production database
Edit `prisma/schema.prisma` → `provider = "postgresql"`, set `DATABASE_URL`,
then `npx prisma migrate deploy`.
