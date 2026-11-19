## Context

Greenfield implementation of the concept in `docs/architektur-neukonzeption.md`, based on the verified rules in `docs/feature-analyse-stats-v2.md`. The repository (`flagfootballstats-ai`, GitHub, one initial commit) is empty. Hard constraints: fachliche Korrektheit first, and permanently free operation for a small team (about 16 players, 1 typist, a few dozen ticker viewers, 5–15 games per season, about 300 events per game).

Verified free-tier facts (supabase.com/pricing, checked at design time): Free plan has unlimited API requests, 500 MB database, 5 GB egress, 2 active projects, and **pauses projects after 1 week of inactivity**. A full season is far below 500 MB (an event is well below 1 KB), so size is not a risk; pausing is.

## Goals / Non-Goals

**Goals:**
- Event capture that is fast, offline-capable and enforces the verified field matrix, extra-point phase and reset rules.
- One shared, tested implementation of rules, effective-event derivation, scoring, ticker text, statistics and export mapping, used by the web app, the backend export and the import tool.
- A public ticker, two-stage sync with honest status, Sheets export, legacy import.
- Zero recurring cost; every paid-tier feature avoided.

**Non-Goals:**
- Video, play diagrams, opponent player stats, multi-tenant operation, native apps, real-time multi-typist merging (one active typist per game).
- Live verification against real Supabase/Google accounts in this change; those parts ship as adapters tested against fakes plus a deployment guide.

## Decisions

**D1 One shared core package.** `packages/core` (TypeScript, no runtime dependencies) holds types, rule engine, effective-state fold, scoring, ticker text/stats, export row mapping, legacy mapping. Alternative (separate rules/scoring/ticker packages from the architecture sketch) rejected: they share the same types and would need cross-package versioning for no gain at this size. The web app, the Edge Function (bundled with esbuild into one file) and the import CLI import it.

**D2 Rules as data.** Field rules are a JSON-serializable table (`fields[]` each with `show`/`required` conditions, options, defaults, `optionsBy`). The engine computes visible fields, required fields, options, errors and warnings, and `normalize()` strips invisible values. The UI renders from the engine output; there is no `if (type === ...)` in components. Tests are generated from the matrix in the spec (one test per row and path).

**D3 Event model.** Events: `play`, `marker`, `comment`, `edit`, `void`, each with client-generated UUID, `client_ts` (ms), `game_id`, `author_id`. `edit` carries `replaces_id` and a full new play payload; `void` carries `voids_id`. Order key is `(client_ts, id)`; server `seq` is used only for delta sync and ticker paging. Effective plays = fold(sorted events): last edit per original play wins, voided plays dropped. Undo = void of the newest effective play. Clock skew between handed-over devices is accepted (one typist at a time).

**D4 Extra-point phase derived, not stored.** `extraPointState(effectivePlays)` looks at the newest effective play: result in {td, pick_6, xp_retry} means phase active. Expected unit hint comes from scoring: own scored → offense, opponent scored → defense. Removes the legacy device-local `last-result` bug.

**D5 Behaviour deviations from the legacy app (intentional, documented):**
- QB mandatory for offense plays (legacy: declared but not enforced); carried over so it costs no taps.
- Lineup size: 1–9 allowed, ≠5 needs confirmation; roster membership enforced (legacy accepted ghost players).
- Result optional with warning outside the extra-point phase (decided with the owner).
- Flag pulls missed 0–8 instead of 0–5.
- Foul and foul yards are reset by Clear (legacy leaked them), unit fields are independent.
- Safety scores 2 points (legacy ignored it).
- Foul option lists kept per unit and direction exactly as in the legacy app.

**D6 Persistence on the device: Dexie (IndexedDB).** Tables: `players`, `teams`, `games`, `roster`, `events`, `outbox_state`, `meta`. The device store is the working store in both modes. Without a configured backend (`VITE_SUPABASE_URL` empty) the app is a complete single-device app with CSV/JSON export.

**D7 Sync design.** Two kinds of data:
- *Events*: append-only; client pushes unconfirmed events (`synced=false`) in batches through RPC `push_events`; the server inserts with `on conflict (id) do nothing`, assigns `seq` from a per-game counter under a row lock, returns the acknowledged ids; the client marks them confirmed.
- *Master data* (players, teams, games, roster, typist assignments): admin-edited, last-write-wins on `updated_at`; changes are pushed via upsert, pulled by `updated_at > cursor`. Typists cache them before the game so capture works offline.
Status derives from counts: unconfirmed events, online flag, last error, `export_state.last_run` (sheets_pending when the last exported seq is below the highest confirmed seq).

**D8 Ticker via delta polling, not Realtime.** Anonymous clients call RPC `ticker_snapshot(token, after_seq)` (security definer, validates the token, returns game header, needed player names and only events with `seq > after_seq`). Polling every 7 s transfers a few hundred bytes per poll when idle, so even 100 viewers for 3 hours stay far below the 5 GB egress limit. Realtime was rejected: anonymous Realtime with token-scoped RLS is fragile, and polling needs no extra service. The same ticker view renders local state for the typist preview.

**D9 Backend access control.** Row Level Security on all tables. `app_user(id = auth.uid, role)`. Admin: full access to master data. Authenticated: read master data. Events are only writable through `push_events` (security definer) which checks: caller is the active typist of the game or an admin, game status is live (admin may also write to finished games), event ids unique. Anonymous: no table access, only `ticker_snapshot`. Payload field rules are enforced by the client engine; the backend validates structure and permissions only (risk R2).

**D10 Sheets export.** An Edge Function (Deno) bundles the core, authenticates with a Google service account (RS256 JWT via WebCrypto, secret in Supabase secrets), reads events with `seq > export_state.last_seq` plus all edits/voids touching exported plays, builds rows with the shared mapper and writes via `values.append` (new) / `values.batchUpdate` (changed, found via an `event_id` index column) in batches. A `pg_cron` job calls it through `pg_net` every minute while any game is live and every 30 minutes otherwise; the job only fires when `max(seq) > last_seq`, which keeps invocations far below the 500k/month free quota. Idempotency by `event_id`.

**D11 Anti-pause.** A weekly GitHub Actions workflow calls the public RPC `ping` (a harmless `select 1` through the REST API) so the project registers activity; `pg_cron` jobs inside the project add further activity. If pausing happens anyway the app keeps working locally and the project can be un-paused manually; data lives on devices and in the Sheets export.

**D12 Frontend.** Svelte 5 + Vite + TypeScript, hash routing (static hosting without rewrite rules), service worker for the app shell (hand-written, cache-first for hashed assets, network-first for `index.html`), manifest for installation. Pages: Admin (players, teams, games, roster, typist, finish, import/export), Capture, Ticker (`#/t/<token>`, no login). Styling via plain CSS variables (light/dark), no UI framework.

**D13 Hosting.** Static output (`vite build`, relative base) deployable to Cloudflare Pages (git integration, no workflow, works for private repos) or GitHub Pages (workflow included, requires a public repo or paid plan). Both are free.

**D14 Test strategy.** Vitest for core (matrix-driven rule tests, scoring table, effective-state, extra-point, ticker sentences, stats, export mapping, legacy mapping), sync engine against a fake backend, DB migrations and RPCs against an in-process Postgres (PGlite) with stubbed `auth.uid()`. Playwright smoke test of the capture flow in local mode against the built app.

**D15 Legacy import.** CLI `scripts/import-legacy` reads exported CSV/JSON of the legacy sheets, produces a dry-run report, and on confirmation emits a JSON bundle that the admin imports in the app (works for local-only and backend mode). Unresolved player references block the real import until a mapping file resolves them.

## Risks / Trade-offs

- **R1 Supabase Free pausing / policy change.** Mitigated by D11, offline-first, offline export, open data format (plain Postgres, CSV/JSON), adapter boundary `SyncBackend` so another backend can be substituted.
- **R2 Invalid payload from a modified client.** Only trusted users can write events (typist/admin); ticker and export are tolerant (unknown/invalid values are rendered/exported as-is, never crash).
- **R3 Browser storage eviction (iOS Safari).** `navigator.storage.persist()`, status display, leave warning, immediate push, Sheets as second copy, manual JSON export.
- **R4 Google Sheets quota.** Batching, ≤ 1 request/min typical; backoff on 429.
- **R5 Clock skew between devices after handover.** Accepted; the handover dialog requires the admin or typist to confirm that the previous device shows "saved" before the new typist starts.
- **R6 Rule drift from legacy behaviour.** Deviations are listed in D5; everything else is covered by matrix-driven tests derived from the verified analysis.
- **R7 Not verified live.** Supabase/Google/Looker/Pages connections cannot be exercised in this environment; deployment guide and fakes-based tests reduce but do not remove integration risk.

## Open Questions

None blocking implementation. Deployment prerequisites owned by the user: a Supabase project, a Google service account with the target sheet shared, and the hosting choice (repository visibility decides GitHub Pages vs Cloudflare Pages).
