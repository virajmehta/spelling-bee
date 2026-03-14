# Spelling Bee Betting Pool

A real-time parimutuel betting app for spelling bee competitions. Spectators bet chips on which speller will win — odds shift dynamically as bets come in, and winners split the entire pool.

Built on Cloudflare Workers with zero external dependencies beyond Hono.

## How It Works

1. **Admin creates a room** and adds spellers
2. **Gamblers join** with the room code and receive chips from the admin
3. **Betting opens** — gamblers place bets on who they think will win
4. **Admin runs the bee** — starts rounds, calls spellers, records correct/incorrect results
5. **Spellers get eliminated** — bets on eliminated spellers become dead money in the pool
6. **Admin declares a winner** — the pool is distributed to winning bettors proportionally

### Parimutuel Betting (Zero Rake)

This uses a parimutuel system: all bets go into a shared pool, and winners split the entire pool proportionally to their wager. There's no house cut — 100% of chips bet are paid out.

**Example:** If the total pool is 10,000 chips and you bet 500 on the winner who has 2,000 total chips bet on them, you receive `(500 / 2,000) * 10,000 = 2,500 chips`.

Odds update in real time as bets come in, displayed on the betting floor.

## Three Views

| View | URL | Purpose |
|------|-----|---------|
| **Login** | `/` | Join or create a room |
| **Admin** | `/admin.html` | Control the bee: manage spellers, run rounds, record results, credit chips |
| **Gambler** | `/gambler.html` | Place bets, view odds, watch results |

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/)

### Local Development

```bash
# Install dependencies
pnpm install

# Apply database migrations
pnpm db:migrate:local

# Start dev server
pnpm dev
```

The app runs at `http://localhost:8787`.

### Environment Variables

Create a `.dev.vars` file:

```
JWT_SECRET=your-secret-here
ADMIN_SECRET=your-admin-password
```

- `JWT_SECRET` — signs auth tokens
- `ADMIN_SECRET` — required to create rooms or join as admin

### Deploy to Cloudflare

```bash
pnpm deploy
```

Set `JWT_SECRET` and `ADMIN_SECRET` as secrets in your Cloudflare Workers dashboard.

## Tech Stack

- **Cloudflare Workers** — edge compute runtime
- **Hono** — lightweight web framework
- **D1** — Cloudflare's SQLite database
- **Vanilla JS** — no frontend build step, no framework

## API

### Auth

- `POST /api/auth/create-room` — create a new room (requires admin secret)
- `POST /api/auth/join` — join an existing room by code

### Admin (requires admin role)

- `POST /api/admin/spellers` — add spellers
- `DELETE /api/admin/spellers/:id` — remove a speller
- `POST /api/admin/credits` — credit chips to a gambler
- `POST /api/admin/credits/all` — credit chips to all gamblers
- `POST /api/admin/words/import` — import word list
- `GET /api/admin/gamblers` — list gamblers

### Bee Engine (requires admin role)

- `POST /api/bee/rounds` — start a new round
- `POST /api/bee/rounds/:id/complete` — end a round
- `POST /api/bee/turns` — create a turn (call a speller)
- `PATCH /api/bee/turns/:id` — record result (correct/incorrect)
- `POST /api/bee/spellers/:id/eliminate` — eliminate a speller
- `POST /api/bee/spellers/:id/reinstate` — undo elimination
- `POST /api/bee/finish` — declare winner and compute payouts
- `GET /api/bee/words` — get unused words for a difficulty tier

### Betting (requires gambler role)

- `POST /api/bets` — place a bet

### Polling (any authenticated user)

- `GET /api/poll?version=N` — get current state (returns 304 if unchanged)
