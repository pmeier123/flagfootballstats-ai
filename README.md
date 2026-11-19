# flagfootballstats

Offline-first-Web-App zur Erfassung von Flag-Football-Spielzügen (Aachen Emperors) mit Live-Ticker und Auswertung über Google Sheets / Looker Studio. Ablösung der Budibase-App „Stats V2“.

- **Erfassung** an der Sideline (Handy, auch ohne Netz): Offense/Defense mit allen Pflicht-/Sichtbarkeitsregeln des Altsystems, Extra-Point-Phase, Undo/Bearbeiten/Stornieren, Kommentare, Marker
- **Live-Ticker** für Zuschauer (ohne Login): alle Details als lesbare Sätze, Highlights, Filter, Spielstatistik
- **Sync** im Hintergrund mit dauerhafter Statusanzeige („Gesichert“ / „Browser offen lassen“)
- **Export** serverseitig in Google Sheets, Auswertung in Looker Studio
- **Altdaten-Import** aus dem alten Sheet

## Dokumentation
- [Einrichtung und Betrieb](docs/einrichtung.md)
- [Analyse des Altsystems](docs/feature-analyse-stats-v2.md) und [Architekturentwurf](docs/architektur-neukonzeption.md)
- Spezifikation: `openspec/changes/build-flag-football-stats-app/`

## Entwicklung
```
npm install
npm run dev            # App auf http://localhost:5173
npm run typecheck
npx vitest run         # Regeln, Scoring, Sync, Datenbank (PGlite), Export
npm run e2e            # Browser-Test (einmalig: npx playwright install chromium)
npm run build          # apps/web/dist
npm run bundle:export  # Edge Function für den Sheets-Export
```

Struktur: `packages/core` (Regeln, Scoring, Ticker, Export-Mapping, Import; ohne Abhängigkeiten), `packages/data` (Gerätespeicher, Sync, Supabase-Adapter), `apps/web` (Svelte-PWA), `supabase/` (Migration, Export-Function, Cron-Setup).