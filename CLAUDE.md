# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev          # start both server (port 3000) and client (port 5173) concurrently
npm run build        # build server (tsup) + client (tsc + vite)
npm run db:migrate   # run pending SQL migrations against DATABASE_URL
npm test             # run server vitest + client vitest
```

### Server only (from repo root)
```bash
npm run dev -w server
npm run test -w server
npm run test:watch -w server
npm run build -w server
```

### Client only (from repo root)
```bash
npm run dev -w client
npm test -w client
```

### Run a single test file
```bash
cd server && npx vitest run src/__tests__/crypto.test.ts
cd client && npx vitest run src/__tests__/Login.test.tsx
```

### Adding shadcn components
```bash
cd client && npx shadcn@latest add <component>
```
After adding, fix the generated import: change `import { cn } from "src/lib/utils"` → `import { cn } from "../../lib/utils"` and any `import ... from "src/components/ui/..."` → relative path. This is a known shadcn CLI issue with this project's alias setup.

## Architecture

### Monorepo layout
- `server/` — Fastify + TypeScript API server, runs on port 3000
- `client/` — React 19 + Vite SPA, runs on port 5173 in dev
- Root `package.json` uses npm workspaces; env vars loaded via `--env-file=../.env` in server scripts (not `dotenv` at runtime — all imports run before runtime code in ESM)

### Environment
All env vars are validated at startup in `server/src/config.ts` via `requireEnv()`. Missing vars crash the server immediately. `TOKEN_ENCRYPTION_KEY` must be a 64-char hex string (32 bytes). `CLIENT_URL` controls where OAuth callbacks redirect after completion (`http://localhost:5173` in dev, `https://calendar-sync.shubhammttl.com` in prod).

### Request flow
In production, Fastify serves both the API (`/api/*`) and the built React SPA (static files). In dev, Vite proxies `/api/*` to `localhost:3000` via `vite.config.ts` `server.proxy`.

### OAuth flow
OAuth connect buttons are regular `<button>` elements that do `window.location.href = /api/zoho/connect?token=<jwt>` — NOT axios calls — because browser navigation can't send `Authorization` headers. The JWT is verified server-side from the query param, then the user ID is stored in an `httpOnly` cookie (`pending_user_id`) for the duration of the OAuth round-trip. After callback, the server redirects to `config.CLIENT_URL/dashboard`.

### Background sync (pg-boss v12)
`server/src/jobs/sync-user.job.ts` manages the pg-boss scheduler. **Breaking changes from pg-boss v9**: queues must be explicitly created with `boss.createQueue()` before `boss.work()`, the `work()` handler receives `Job<T>[]` (array, not single job), and `teamSize` is replaced by `localConcurrency`.

The cron (`*/5 * * * *`) queries all users with both Zoho and Google connected + at least one enabled calendar, then enqueues individual `sync-user` jobs for each.

### Sync engine (`server/src/services/sync-engine.ts`)
Core logic: fetch Zoho events → compare against `sync_mappings` → create/update/delete on Google Calendar. Key behaviours:
- **Zoho tombstones**: deleted events come back as `{}` empty objects — filtered by `e.uid` presence before processing
- **Date conversion**: Zoho dates are iCal format with timezone offset (`20260629T110000+0530`) — converted to ISO 8601 by `toIso()` using a regex match on the offset pattern
- **Sync window**: now−1 day to now+30 days (Zoho API max range is 31 days)
- **Change detection**: uses Zoho's `etag` field per event; if etag differs from stored value, the event is updated on Google
- **Error handling**: each create/update/delete is wrapped individually — one failure doesn't stop the rest; errors are written to `sync_history` with `action = 'error'`

### Token encryption
All OAuth tokens (Zoho + Google) are encrypted with AES-256-GCM before DB storage (`server/src/crypto.ts`). Tokens are decrypted in-memory only during sync; never logged.

### Database
PostgreSQL with 6 tables. All have `updated_at` maintained by a `BEFORE UPDATE` trigger (defined once in `001_initial.sql`, applied to all tables). Migration runner (`server/src/db/migrate.ts`) tracks applied files by name in a `migrations` table — never re-runs an applied file, so **never modify an already-applied migration**; create a new numbered file instead.

### Zoho API specifics
- Base URL: `https://calendar.zoho.in/api/v1` (India data center)
- Auth header: `Zoho-oauthtoken <token>` (not `Bearer`)
- Required OAuth scopes: `ZohoCalendar.calendar.READ,ZohoCalendar.event.READ`
- Refresh token only issued on first authorization — if reconnecting, user must revoke the app in Zoho (My Account → Security → Connected Apps) first

### Frontend data flow
`client/src/lib/api.ts` is the axios instance used everywhere — it reads JWT from `localStorage` and adds `Authorization: Bearer` on every request; on 401 it clears the token and redirects to `/login`. TanStack Query handles all server state. Auth state lives in `AuthContext` (`client/src/contexts/AuthContext.tsx`).
