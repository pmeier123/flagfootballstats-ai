## 1. Workspace setup

- [x] 1.1 Create npm workspace (`packages/core`, `apps/web`, `scripts`), TypeScript base config, Vitest, `.gitignore`, README
- [x] 1.2 Add lint/typecheck scripts and a CI workflow running typecheck, unit tests and build

## 2. Core: domain, rules, scoring

- [x] 2.1 Define domain types (player, team, game, event kinds, play fields and enumerations)
- [x] 2.2 Implement event ordering, effective-state fold (edit/void) and undo target
- [x] 2.3 Implement the field rule table for offense and defense from the spec
- [x] 2.4 Implement rule engine (visible/required/options/errors/warnings, normalize, reset on change)
- [x] 2.5 Implement extra-point phase detection and expected-unit hint
- [x] 2.6 Implement lineup validation (size, roster membership, QB, blitzers, defense puller fields)
- [x] 2.7 Implement scoring engine and scoring events
- [x] 2.8 Matrix-driven tests for every spec row/path, extra-point, effective state, scoring table

## 3. Core: ticker, statistics, export, import

- [x] 3.1 Implement quarter and drive derivation from markers
- [x] 3.2 Implement German ticker sentence builder covering every field, highlight classification
- [x] 3.3 Implement live statistics (completion rate, yards, sacks, interceptions, fouls, top players)
- [x] 3.4 Implement export row mapper (plays, lineups, scores, games, players, comments) with typed cells
- [x] 3.5 Implement legacy import mapping (values, timestamps, lineups, unresolved references, dry-run report)
- [x] 3.6 Tests for ticker text, stats, export mapping and legacy mapping

## 4. Device storage and sync engine

- [x] 4.1 Implement Dexie schema and repositories (players, teams, games, roster, events, meta)
- [x] 4.2 Implement `SyncBackend` interface, outbox flush with batching, ack, backoff, online/visibility triggers
- [x] 4.3 Implement sync status model (synced, sending, offline, error, sheets_pending, local-only)
- [x] 4.4 Implement master-data last-write-wins push/pull
- [x] 4.5 Tests against a fake backend (duplicates, lost ack, offline, retry, status transitions)

## 5. Backend (Supabase)

- [x] 5.1 Write migrations: tables, indexes, per-game sequence, `app_user`, `export_state`
- [x] 5.2 Write RLS policies and RPCs `push_events`, `ticker_snapshot`, `ping`, handover
- [x] 5.3 Test migrations, RLS and RPCs against in-process Postgres
- [x] 5.4 Implement Supabase `SyncBackend` adapter in the web app
- [x] 5.5 Implement Sheets export Edge Function (JWT, append/update, progress, backoff) and bundle script
- [x] 5.6 Write cron/pg_net setup SQL and keep-alive GitHub workflow
- [x] 5.7 Test export function logic against a fake Sheets API

## 6. Web app

- [x] 6.1 App shell, hash router, theme, manifest, service worker, persistent storage request
- [x] 6.2 Login (magic link) and role-aware navigation; local-only mode without backend
- [x] 6.3 Admin: players (CRUD, deactivate, CSV import, bulk), teams, games, roster, typist and handover, token and QR, finish check
- [x] 6.4 Capture: header with score, quarter and sync status, unit switch, lineup/QB/blitzer selection, rule-driven play form, extra-point mode, markers
- [x] 6.5 Capture: event list with edit/void/undo, comments, previous-event summary, leave warning, wake lock
- [x] 6.6 Ticker view: header, feed with drives and quarters, highlights, expandable details, filters, live stats, polling, stable scroll, local preview
- [x] 6.7 Manual export (CSV/JSON) and legacy import screen with dry-run report

## 7. Verification and delivery

- [x] 7.1 Playwright smoke test of capture flow, correction and ticker preview in local mode
- [x] 7.2 Production build check and bundle size review
- [x] 7.3 Deployment guide (Supabase, Google service account and sheet, Looker Studio, Cloudflare/GitHub Pages, keep-alive) and Looker data model description
- [x] 7.4 Final review against all specs and `openspec validate`

