## Why

Die bestehende Budibase-App „Stats V2" erfasst Flag-Football-Spielzüge, hat aber keine Korrektur-/Undo-Funktion, keine Spiel-Entität, uneinheitliche Punkteberechnung (Safety fehlt) und erzeugt inkonsistente Daten (unsichtbare Altwerte werden mitgespeichert). Sie ist nicht offline-fähig, bietet keinen Live-Ticker und keine echte Auswertung. Die Analyse (`docs/feature-analyse-stats-v2.md`) und der Architekturentwurf (`docs/architektur-neukonzeption.md`) liegen vor; jetzt wird das Konzept umgesetzt, mit Vorrang für fachliche Korrektheit und dauerhaft kostenlosen Betrieb.

## What Changes

- Neue Offline-first-PWA (Svelte + Vite + TypeScript) für Admin, Erfassung und öffentlichen Live-Ticker, statisch gehostet.
- Event-Log (append-only) mit Edit/Void/Undo statt überschreibbarer Zeilen; typisierte Payloads ohne `default`-Platzhalter.
- Deklarative Regel-Engine aus der verifizierten Feldmatrix (Sichtbarkeit, Pflicht, Reset, Extra-Point-Modus aus dem Event-Log).
- Zentrale Scoring-Engine inkl. Safety (+2 für die Gegenseite) mit Unit-Tests.
- Zwei-Stufen-Sync mit dauerhafter Statusanzeige (Gerät → Backend, Backend → Google Sheets).
- Live-Ticker mit allen Eventfeldern, lesbaren Sätzen, Highlights, Filtern und Live-Statistik.
- Serverseitiger, idempotenter Export in flache Google-Sheets-Tabellen für Looker Studio.
- Kader-, Gegner- und Spielverwaltung inkl. CSV-Import und Import der Altdaten.
- Backend auf Supabase Free (Postgres, RLS, Auth, Realtime, Edge Functions) mit Keep-alive gegen Pausierung.
- Entschiedene Defaults: Result im Normalbetrieb nur Warnung; Foul-Listen wie im Altsystem; Flag-Pulls missed 0–8; ein Typist pro Spiel mit Übergabe.

## Capabilities

### New Capabilities
- `roster-management`: Spieler, Nummern, Prioritäten, Aktiv-Status, CSV-Import, Spieltagskader.
- `game-management`: Teams/Gegner, Spiele, Anlass, Status, Typist-Zuweisung, Ticker-Link, Marker.
- `event-capture`: Erfassung von Offense-/Defense-Events nach Feldmatrix, Lineups, Extra-Point-Modus, Undo/Edit/Void, Kommentare.
- `scoring-engine`: Punkteberechnung aus effektiven Events.
- `offline-sync`: Outbox, idempotenter Versand, Statusmodell, Datenverlust-Schutz.
- `live-ticker`: Öffentliche Live-Ansicht mit aufbereiteten Texten, Highlights, Filtern, Statistik.
- `sheets-export`: Serverseitiger Batch-Export und Tabellenformat für Looker Studio.
- `access-control`: Rollen, Login, Zugriffsregeln, Ticker-Token.
- `legacy-import`: Übernahme der Altdaten aus den Google-Sheets-Exporten.

### Modified Capabilities

(keine – Greenfield)

## Impact

- Neuer Code im Repo: `apps/web`, `packages/rules`, `packages/scoring`, `packages/ticker`, `supabase/`, `scripts/`.
- Externe Systeme: Cloudflare Pages/GitHub Pages (Hosting), Supabase Free, Google Sheets API (Service Account), Looker Studio.
- Abhängigkeiten: Svelte, Vite, Dexie, Zod, Vitest, Playwright, supabase-js.
- Das Altsystem bleibt unverändert und wird erst nach Datenimport und Paritätsprüfung abgelöst.
- Backend und Google-Anbindung können hier nicht gegen Live-Dienste getestet werden; sie werden als austauschbare Adapter mit Tests gegen Fakes geliefert.
