# ReportajGO — Telegram-бот модерации (комплект кода)

Это **автономная копия** всего кода Telegram-бота, собранная в одну папку.
В сам сайт он сейчас НЕ подключён — это «коробка», из которой бота можно
вернуть в проект, когда понадобится.

Поток: **ИИ-агент** находит новость → `POST /api/agent/posts` создаёт `PENDING`
→ бот шлёт карточку с кнопками ✅/❌ и выбором времени в чат модератора →
модератор жмёт кнопку → пост публикуется (или планируется на время) → агент
получает колбэк и/или забирает одобренное через `GET`.

## Файлы и их исходные места

| Файл в этой папке | Куда класть в проекте |
|---|---|
| `telegram.ts` | `src/lib/telegram.ts` |
| `telegram-moderation.ts` | `src/lib/telegram-moderation.ts` |
| `api-telegram-route.ts` | `src/app/api/telegram/route.ts` |
| `set-telegram-webhook.ts` | `scripts/set-telegram-webhook.ts` |
| `agentAuth.ts` | `src/lib/agentAuth.ts` |
| `agentCallback.ts` | `src/lib/agentCallback.ts` |
| `api-agent-posts-route.ts` | `src/app/api/agent/posts/route.ts` |
| `api-posts-id-status-route.ts` | `src/app/api/posts/[id]/status/route.ts` (опц., модерация в админке) |

Импорты внутри файлов используют алиасы `@/lib/...`, `@/i18n/...` — они
заработают сразу, как только файлы окажутся на своих местах в `src/`.

## Как подключить обратно (чек-лист)

1. **Зависимость:** `npm i grammy`

2. **Скопировать файлы** по таблице выше.

3. **Схема Prisma** — добавить в модель `Post` поля и применить
   (`npx prisma db push`):
   ```prisma
   status      String    @default("PENDING") // PENDING | PUBLISHED | REJECTED
   tgChatId    String?
   tgMessageId Int?
   origin      String    @default("manual")  // "manual" | "agent"
   source      String?
   sourceUrl   String?
   dedupeKey   String?   @unique
   approvedAt  DateTime?
   publishAt   DateTime?                      // запланированное время публикации
   @@index([status])
   @@index([status, publishAt])
   ```

4. **Константы** — в `src/lib/constants.ts`:
   ```ts
   export const POST_STATUS = {
     PENDING: "PENDING", PUBLISHED: "PUBLISHED", REJECTED: "REJECTED",
   } as const;
   export type PostStatusValue = (typeof POST_STATUS)[keyof typeof POST_STATUS];
   ```

5. **`.env`** — добавить:
   ```
   TELEGRAM_BOT_TOKEN="<токен от @BotFather>"
   TELEGRAM_MODERATION_CHAT_ID="<chat id модератора>"
   TELEGRAM_ALLOWED_CHAT_IDS="<id,через,запятую>"
   TELEGRAM_WEBHOOK_SECRET="<openssl rand -hex 32>"
   TELEGRAM_WEBHOOK_BASE_URL="https://ваш-домен"   # для скрипта вебхука

   AGENT_API_KEY="<секрет для ИИ-агента>"
   AGENT_CALLBACK_URL=""        # опц.: куда слать колбэк о решении
   AGENT_CALLBACK_SECRET=""     # опц.: проверка подлинности колбэка
   ```

6. **Видимость на сайте** — в `src/lib/posts.ts` публичные запросы должны
   учитывать статус и время. Замените `where: { published: true }` на:
   ```ts
   where: {
     status: "PUBLISHED",
     OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
   }
   ```
   (запланированный пост скрыт до своего времени, появляется без крона).
   В `article/[id]/page.tsx` гейт: `if (!post || post.status !== "PUBLISHED") notFound();`

7. **Создание поста** — в `src/app/api/posts/route.ts` при создании ставить
   `status: PENDING, published: false` и вызвать `notifyNewPost(post)`
   (в `try/catch`, чтобы сбой Telegram не ронял запрос).

8. **npm-скрипты** (`package.json`):
   ```json
   "tg:webhook:set":    "tsx scripts/set-telegram-webhook.ts",
   "tg:webhook:info":   "tsx scripts/set-telegram-webhook.ts --info",
   "tg:webhook:delete": "tsx scripts/set-telegram-webhook.ts --delete"
   ```

## Запуск

1. Поднять публичный HTTPS-URL (деплой или туннель: `npx cloudflared tunnel --url http://localhost:3000`).
2. Вписать его в `TELEGRAM_WEBHOOK_BASE_URL`, затем `npm run tg:webhook:set`.
3. Узнать chat id: написать боту, открыть `https://api.telegram.org/bot<ТОКЕН>/getUpdates`.

## API для ИИ-агента

**Отправить новость на одобрение:**
```
POST /api/agent/posts
x-api-key: <AGENT_API_KEY>
{ "title","excerpt","content","category","language",
  "imageUrl?","source?","sourceUrl?","dedupeKey?","publishAt?" }
```

**Забрать одобренные:**
```
GET /api/agent/posts?status=PUBLISHED&since=<ISO>&limit=50
x-api-key: <AGENT_API_KEY>
```

**Колбэк агенту** (если задан `AGENT_CALLBACK_URL`) — бот шлёт `POST` с
`{ event: "post.approved" | "post.scheduled" | "post.rejected", post: {...} }`.

## Кнопки модерации в боте
```
✅ Сейчас   🕐 +1ч   🕐 +3ч
🌅 Завтра 09:00      ❌ Отклонить
```
Время — по часовому поясу Asia/Tashkent (UTC+5).

## Безопасность
- Вебхук защищён секретом в заголовке `X-Telegram-Bot-Api-Secret-Token`.
- Кнопки принимаются только от Telegram-id из `TELEGRAM_ALLOWED_CHAT_IDS`.
- `grammy` + Prisma требуют Node.js-рантайма (`export const runtime = "nodejs"`).
- Токен бота держите в секрете; при утечке — перевыпустите в @BotFather.
