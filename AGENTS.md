# AGENTS.md

## Project Overview

Spelling Bee Betting Pool — a real-time parimutuel betting app for spelling bee competitions. Cloudflare Workers + Hono backend, vanilla JS frontend, D1 (SQLite) database.

## Tech Stack

- **Backend:** Cloudflare Workers, Hono.js, TypeScript
- **Database:** Cloudflare D1 (SQLite)
- **Frontend:** Vanilla JS, HTML, CSS (no build step)
- **Auth:** Custom HMAC-SHA256 JWT (CF Workers crypto API)
- **Package manager:** pnpm

## Project Structure

```
src/
  index.ts              # Hono app entry, router setup
  types.ts              # TypeScript interfaces
  middleware/auth.ts     # JWT creation/verification, role-based auth
  routes/
    auth.ts             # Join room, create room
    admin.ts            # Speller/chip/word management (admin only)
    bee.ts              # Rounds, turns, elimination, finish (admin only)
    betting.ts          # Place bets (gambler only)
    poll.ts             # State polling with version-based 304 diffing
  services/
    bee-engine.ts       # Round/turn state machine, elimination logic
    pool-math.ts        # Odds calculation
    payout.ts           # Zero-rake parimutuel payout computation
public/
  index.html            # Login/join page
  admin.html            # Admin control room
  gambler.html          # Gambler betting floor
  js/                   # Client-side modules (auth, api, polling, rendering)
  css/                  # Styles (theme tokens, components, page-specific)
migrations/             # D1 schema migrations
words/words.json        # Word list by difficulty tier (1-5)
```

## Dev Commands

```bash
pnpm dev               # Start wrangler dev server (localhost:8787)
pnpm db:migrate:local  # Apply database migrations locally
pnpm db:seed:local     # Seed word data
pnpm deploy            # Deploy to Cloudflare
```

## Key Architecture Decisions

- **Version-based polling:** Room table has a `version` counter incremented on every state change. Poll endpoint returns 304 when client version matches. Polling intervals: admin 5s, gambler 7s, observer 10s.
- **Zero-rake parimutuel:** All pooled chips go to winners. No house cut. Payout = `floor((betAmount / winnerPool) * totalPool)`.
- **Three roles:** Admin (full control), Gambler (bet + view), Observer (view only). Enforced via JWT claims + middleware.
- **Room lifecycle:** `setup → active → finished`. Betting opens/closes around rounds. One active round at a time.
- **Per-room word library:** Words imported from `words.json` at room creation, tracked per room.

## Database

Schema in `migrations/0001_initial_schema.sql`. Core tables: `rooms`, `users`, `spellers`, `rounds`, `turns`, `words`, `bets`, `chip_transactions`.

## Auth

- JWT with 3-hour TTL stored in localStorage (`sb_token`)
- `ADMIN_SECRET` required to create rooms or join as admin
- Secrets in `.dev.vars` locally, CF env in production

## Code Conventions

- Hono route handlers follow `(c: Context) => Response` pattern
- All database queries use D1 prepared statements
- Frontend uses no frameworks — DOM manipulation via vanilla JS render functions
- `forcePoll()` called after mutations for immediate UI update
