# Zoho → Google Calendar Sync

A self-hosted, multi-user web app that reads events from Zoho Calendar (India data center) and mirrors them to Google Calendar as opaque "Busy" blocks. Each user connects their own Zoho and Google accounts via OAuth. A background scheduler syncs every five minutes automatically; users can also trigger a manual sync from the dashboard.

**Live instance:** https://calendar-sync.shubhammttl.com

---

## Table of Contents

- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Running Tests](#running-tests)
- [Architecture Notes](#architecture-notes)
- [License](#license)

---

## How It Works

1. A user registers and logs in with email and password.
2. From the dashboard they connect their Zoho account (OAuth, India data center) and their Google account (OAuth).
3. They select which Google calendars should receive the synced busy blocks.
4. The background scheduler runs `*/5 * * * *` and enqueues a `sync-user` job for every fully-connected user (Zoho + Google + at least one enabled calendar).
5. The sync engine fetches Zoho events in a rolling window of **yesterday through 30 days from now**, compares etags against stored `sync_mappings`, then creates, updates, or deletes the corresponding Google Calendar events.
6. Every action is written to the append-only `sync_history` table. Users can view recent sync history on the History page.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Fastify 5, TypeScript (ESM), tsup, tsx |
| Client | React 19, Vite 8, Tailwind CSS 4, shadcn/ui, TanStack Query 5, React Router 7 |
| Database | PostgreSQL (raw `pg` driver) |
| Background jobs | pg-boss 12 (cron scheduler + job queue backed by PostgreSQL) |
| Auth | JWT (`@fastify/jwt`, 7-day expiry) + bcrypt password hashing |
| Token security | AES-256-GCM encryption at rest for all OAuth tokens |
| Process manager | PM2 |
| Reverse proxy | nginx with Let's Encrypt SSL |

---

## Project Structure

```
zoho-google-calendar-sync/
├── server/                  # Fastify API server (port 3000)
│   └── src/
│       ├── config.ts        # Env var validation — crashes on missing vars
│       ├── crypto.ts        # AES-256-GCM token encryption/decryption
│       ├── index.ts         # App factory + server entry point
│       ├── db/
│       │   ├── client.ts    # pg Pool singleton
│       │   ├── migrate.ts   # Migration runner
│       │   └── migrations/  # Numbered SQL files (001 … 005)
│       ├── routes/          # auth, zoho, google, calendars, history, sync
│       ├── services/        # zoho.service.ts, google.service.ts, sync-engine.ts
│       └── jobs/
│           └── sync-user.job.ts  # pg-boss scheduler + worker
├── client/                  # React SPA (port 5173 in dev)
│   └── src/
│       ├── pages/           # Login, Register, Dashboard, History
│       ├── contexts/        # AuthContext (JWT in localStorage)
│       └── lib/api.ts       # Axios instance — adds Authorization header
├── nginx/
│   └── calendar-sync.conf   # nginx site config with SSL
├── ecosystem.config.cjs     # PM2 app definition (process name: zoho-gcal)
├── .env.example
└── package.json             # npm workspaces root
```

---

## Prerequisites

- Node.js 20 or later
- PostgreSQL 14 or later
- A **Zoho API Console** app configured for the **India data center** (`accounts.zoho.in`)
  - Required OAuth scopes: `ZohoCalendar.calendar.READ,ZohoCalendar.event.READ`
  - Redirect URI: `<your-base-url>/api/zoho/callback`
- A **Google Cloud Console** OAuth 2.0 credential
  - Required scope: `https://www.googleapis.com/auth/calendar`
  - Redirect URI: `<your-base-url>/api/google/callback`

---

## Local Development

```bash
# 1. Clone and install
git clone <repo-url>
cd zoho-google-calendar-sync
npm install

# 2. Create and fill in your environment file
cp .env.example .env
# Edit .env — see Environment Variables section below

# 3. Run database migrations
npm run db:migrate

# 4. Start server (port 3000) and client (port 5173) together
npm run dev
```

The client Vite dev server proxies all `/api/*` requests to `localhost:3000`, so no CORS configuration is needed during local development.

---

## Environment Variables

All variables are validated at server startup by `server/src/config.ts`. A missing required variable crashes the process immediately with a clear error message.

Copy `.env.example` to `.env` and fill in every value before running the server.

```dotenv
# PostgreSQL connection string
DATABASE_URL=postgresql://user:password@localhost:5432/zoho_gcal_sync

# Long random string used to sign JWTs (7-day expiry)
JWT_SECRET=change-me-to-a-long-random-string

# Exactly 64 hex characters (32 bytes) — used for AES-256-GCM token encryption
TOKEN_ENCRYPTION_KEY=change-me-to-64-hex-chars-32-bytes

# Zoho OAuth app credentials (India data center: accounts.zoho.in)
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REDIRECT_URI=https://calendar-sync.shubhammttl.com/api/zoho/callback

# Google OAuth app credentials
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://calendar-sync.shubhammttl.com/api/google/callback

# Server
PORT=3000
NODE_ENV=development

# Where to redirect after OAuth completes
# Dev: http://localhost:5173   |   Prod: https://calendar-sync.shubhammttl.com
CLIENT_URL=http://localhost:5173
```

**`TOKEN_ENCRYPTION_KEY` must be exactly 64 hexadecimal characters.** Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Zoho refresh tokens** are issued only on the first authorization. If a user needs to reconnect, they must first revoke the app in Zoho under My Account → Security → Connected Apps.

---

## Database

PostgreSQL with six tables managed by a custom migration runner. The runner tracks applied files by filename in a `migrations` table and never re-runs a file.

| Table | Purpose |
|---|---|
| `users` | Accounts with bcrypt-hashed passwords |
| `zoho_connections` | Encrypted Zoho OAuth tokens per user |
| `google_connections` | Encrypted Google OAuth tokens per user |
| `google_calendars` | Google calendars the user has selected to receive busy blocks |
| `sync_mappings` | Zoho event ID → Google event ID mapping, plus stored etag for change detection |
| `sync_history` | Append-only audit log (actions: `created`, `updated`, `deleted`, `error`) |

All tables have an `updated_at` column maintained automatically by a shared `BEFORE UPDATE` trigger.

```bash
# Apply pending migrations
npm run db:migrate
```

**Never modify an already-applied migration file.** Create a new numbered SQL file (e.g., `006_your_change.sql`) instead.

---

## Running Tests

```bash
# Run all tests (server vitest + client vitest)
npm test

# Server tests only
npm run test -w server

# Client tests only
npm test -w client

# Watch mode (server)
npm run test:watch -w server

# Single file
cd server && npx vitest run src/__tests__/sync-engine.test.ts
cd client && npx vitest run src/__tests__/Login.test.tsx
```

---

## Architecture Notes

### OAuth flow

The Zoho and Google connect buttons navigate the browser to `/api/zoho/connect?token=<jwt>` and `/api/google/connect?token=<jwt>` respectively — not axios calls — because browser redirects cannot carry `Authorization` headers. The server verifies the JWT from the query parameter, stores the user ID in an `httpOnly` cookie (`pending_user_id`) for the duration of the OAuth round-trip, then redirects back to `CLIENT_URL/dashboard` after the callback completes.

### Sync engine

- **Sync window:** now minus 1 day to now plus 30 days (Zoho API maximum range is 31 days).
- **Change detection:** each Zoho event has an `etag` field. If the stored etag in `sync_mappings` differs from the current value, the Google event is updated.
- **Deleted events:** Zoho returns deleted events as empty objects `{}`. The engine filters these by checking for the presence of `e.uid` before processing.
- **Date format:** Zoho uses iCal format with timezone offsets (`20260629T110000+0530`). The engine converts these to ISO 8601 via a regex match on the offset pattern.
- **Fault isolation:** each create/update/delete is wrapped individually. A failure on one event is recorded in `sync_history` with `action = 'error'` and does not stop the remaining events.
- **Job retries:** each `sync-user` job has `retryLimit: 3` and `retryDelay: 60` seconds.

### Token security

All Zoho and Google OAuth tokens are encrypted with AES-256-GCM before being written to the database (`server/src/crypto.ts`). Tokens are decrypted in memory only during sync and are never logged.

### Adding shadcn/ui components

```bash
cd client && npx shadcn@latest add <component>
```

After adding a component, fix the generated import path: change `import { cn } from "src/lib/utils"` to a relative path (e.g., `import { cn } from "../../lib/utils"`). This is a known issue with the shadcn CLI and this project's alias configuration.

---

## License

Apache License 2.0. Copyright 2026 Shubham Mittal (https://github.com/Shubham-Mi).
See [LICENSE](./LICENSE) for the full text.
