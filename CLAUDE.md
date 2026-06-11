# Buckit - Casual Earnings Calculator

Single-page financial simulator for casual/part-time work. Tracks weekly earnings, spending, investing, and savings bucket progress over a configurable period.

## Running

```bash
cd /AI/projects/buckit
./run.sh          # dev mode (default)
./run.sh prod     # build + production
```

Server runs on port 8234. Main calculator at `/`, week-by-week simulator at `/sim`.

## Architecture

Next.js 15 with App Router, TypeScript, react-chartjs-2.

- `app/page.tsx` - Main calculator page (client component). All state management, sliders, charts, buckets, drag-and-drop card ordering.
- `app/sim/page.tsx` - Week-by-week simulator with playback controls. Uses direct DOM refs for animation tweening.
- `app/api/state/route.ts` - GET/POST state endpoint.
- `app/api/events/route.ts` - SSE stream for real-time sync.
- `lib/calc.ts` - Pure computation logic (earnings, tax, buckets, growth).
- `lib/simCalc.ts` - Per-week simulation data builder.
- `lib/serverState.ts` - Server-side in-memory state + SSE client management. Writes atomically to `state.json`.
- `lib/weeks.ts` - 2026 week date utilities.
- `types/index.ts` - All TypeScript types.

## Storage

**Primary (client):** `localStorage['buckit-state']` — works without a server.

**Secondary (server):** `/api/state` endpoints backed by `state.json` — enables Jarvis API access.

State is synced bidirectionally: any change pushes to both localStorage and the server. SSE keeps multiple tabs/clients in sync. 500ms debounce prevents feedback loops.

## API Data Access

Same interface as before:

```bash
curl -s http://localhost:8234/api/state
```

Key computed fields in `_simComputed` (populated after visiting /sim):
- `spendingPower`, `investments`, `netWorth` - final totals
- `weeks[]` - per-week array with `net`, `cash`, `invest`, `liq`, `nw`, `isBreak`, `isFT`

Key computed fields in `_computed`:
- `weekly` - per-week rates (gross, tax, net, spend, cash, invested)
- `cashBalance`, `totalInvested`, `taxRefund`

## Money Flow

earn -> tax -> net -> subtract spend + weekly bills -> surplus
- Surplus > 0: split into cash (1-investPct) and invest (investPct)
- Surplus <= 0: drain from cash only, invest never decreases
- FY return merged as income on the first August week (goes through same surplus split)
