# Architektur Neukonzeption – Flag-Football-Stats (Aachen Emperors)

Grundlage: [feature-analyse-stats-v2.md](./feature-analyse-stats-v2.md) (Ist-System, verifizierte Feldmatrix, Schwächen).
Status: Entwurf zur Abstimmung.

---

## 1. Ziele und Randbedingungen

| Ziel | Konsequenz |
|---|---|
| Paritaet zum Ist-System (Erfassung Offense/Defense, Lineups, Extra-Point-Flow, Score, Kommentare, Matches, Players) | Feldregeln 1:1 aus der Analyse uebernehmen |
| Langfristig kostenlos | Static Hosting, Free-Tier-Backend, Auswertung im Browser/Looker Studio, kleine Datenmenge |
| Erfassung an der Sideline mit schlechtem Netz | **Offline-first**: Events entstehen lokal, Sync im Hintergrund |
| Live-Ticker fuer Zuschauer | Oeffentliche Lese-Seite mit Realtime/Polling, zeigt **alle** Eventfelder, aufbereitet |
| Auswertung in Google Sheets + Looker Studio | Serverseitiger, idempotenter Batch-Export in flache Tabellen |
| Fehler des Altsystems vermeiden | Event-IDs, Edit/Void/Undo, typisierte Daten, zentrale Scoring-Engine, Reset-Regeln |

Nicht-Ziele (v1): Video, Spielzug-Diagramme, Gegner-Spielerstatistiken, Mehrmandanten-Betrieb.

---

## 2. Systemueberblick

```mermaid
flowchart LR
  subgraph Geraet[Typist-Handy (PWA)]
    UI[Erfassungs-UI + Regel-Engine]
    IDB[(IndexedDB\nEvent-Outbox + Cache)]
    SW[Service Worker]
    UI --> IDB
    SW --- IDB
  end

  subgraph Backend[Backend (Free Tier)]
    API[REST / Realtime]
    DB[(Postgres)]
    EXP[Sheets-Export-Worker\n(Cron, Batch)]
    API --- DB
    EXP --- DB
  end

  subgraph Google
    SHEET[(Google Sheet\nflache Tabellen)]
    LOOKER[Looker Studio]
    SHEET --> LOOKER
  end

  TICKER[Live-Ticker\n(oeffentliche PWA-Seite)]

  IDB -- Stufe 1: Push/Ack --> API
  API -- Realtime/Polling --> TICKER
  EXP -- Stufe 2: Append (Batch) --> SHEET
```

Hosting Frontend: Cloudflare Pages (alternativ GitHub Pages). Ein Code-Repository, eine PWA mit drei Bereichen: **Admin**, **Erfassung**, **Ticker** (Ticker ist ohne Login erreichbar).

---

## 3. Technologie-Entscheidungen

| Bereich | Wahl | Begruendung / Alternative |
|---|---|---|
| Frontend | Svelte (oder React) + Vite + TypeScript, PWA | Klein, schnell auf Mobilgeraeten |
| Lokale Daten | IndexedDB via Dexie | Outbox + Cache, Offline-Betrieb |
| Backend | **Supabase Free** (Postgres, Auth, Realtime, Row Level Security, Edge Functions, pg_cron) | Alles in einem. Alternative: Cloudflare Workers + D1 + Durable Objects/Polling |
| Export-Worker | Supabase Edge Function per pg_cron (alle 60 s waehrend `game.status='live'`, sonst alle 15 min) | Alternative: Cloudflare Worker Cron |
| Google-Zugriff | Service Account, Sheets API `values.append` in Batches | Sheet wird mit dem Service-Account-Mail geteilt |
| Validierung | Gemeinsames Regelschema (JSON) + Zod, identisch im Client und in der Edge Function | Eine Quelle der Wahrheit fuer Sichtbarkeit/Pflicht |
| Tests | Vitest (Regel-Engine, Scoring, Ticker-Texte), Playwright (Erfassungs-Flow) | |

Hinweis Free Tier: Supabase pausiert inaktive Free-Projekte nach etwa einer Woche. Gegenmassnahme: Keep-alive-Aufruf (GitHub Actions Cron) und regelmaessiger Export; Backend bleibt austauschbar, da Sync-Protokoll und Export-Format offen sind.

---

## 4. Datenmodell

Alle IDs sind UUIDs, Zeitstempel sind `timestamptz` (ms-genau, UTC).

```
season        (id, name, starts_on, ends_on)
team          (id, name, is_own)                 -- eigenes Team + Gegner als Stammdaten
player        (id, number text, name, active, offense_prio, defense_prio, qb_prio, blitz_prio)
                                                 -- number als String ("2V"); Prioritaeten 1..9 wie im Altsystem
game          (id, season_id, opponent_team_id, date, occasion, venue, status, ticker_token)
                                                 -- occasion: dffl_game|semifinal|final|group_stage|other
                                                 -- status: planned|live|finished
game_roster   (game_id, player_id)               -- Spieltagskader
game_typist   (game_id, user_id, from_ts, to_ts) -- aktiver Typist, Uebergabe moeglich
event         (id, game_id, seq, client_ts, server_ts, typist_id,
               kind, unit, type, payload jsonb,
               lineup uuid[], qb_id, blitzer_ids uuid[],
               voids_id, replaces_id)
app_user      (id, email, role)                  -- admin|typist|viewer
export_state  (target, game_id, last_event_seq, last_run, last_error)
```

### 4.1 Event-Log (append-only)

- `kind`: `play` | `marker` | `comment` | `edit` | `void`.
- `unit`: `offense` | `defense` (nur bei `play`).
- `type`: Offense `pass|run|sack|throwaway|dead_snap|foul_committed|foul_drawn`; Defense `target|run|sack|throwaway|dead_snap|foul_committed|foul_drawn`.
- `marker`: Quarter-Start/Ende, Halbzeit, Drive-Ende, Timeout, Spielende.
- Korrektur: `edit` (mit `replaces_id`, vollstaendiger neuer Payload) bzw. `void` (mit `voids_id`). Nichts wird ueberschrieben oder geloescht; Ticker und Auswertung berechnen den **effektiven Zustand** (letzte Version je Event, ohne gevoidete).
- `seq` pro Spiel monoton (vom Server vergeben), `client_ts` fuer die Offline-Reihenfolge.
- Insert ist idempotent ueber `id` (Client erzeugt die UUID).

### 4.2 Payload je Event (typisiert, keine `default`-Platzhalter)

Beispiel `unit=offense, type=pass`:

```json
{
  "player_id": "…",
  "pass_result": "catch",              // catch|incomplete|interception
  "incomplete_reason": null,           // fifty_fifty|drop|uncatchable|batted
  "air_yards": 15,                     // 0|5|10|15|20|30 (30 = "30+")
  "yards_after_catch": 15,
  "flag_pulls_missed": 1,
  "result": "first_down"               // td|first_down|tod|pick_6|safety|null
}
```

`null` bedeutet „nicht erfasst/nicht anwendbar", unsichtbare Felder werden **nicht** gespeichert (Behebung des Altsystem-Bugs mit „geisternden" Werten).

Extra-Point-Ergebnisse (`xp_result`): Offense `1xp_made|1xp_missed|2xp_made|2xp_missed|xp_retry`, Defense `1xp_allowed|1xp_prevented|2xp_allowed|2xp_prevented|xp_retry`.

---

## 5. Regel-Engine (Herzstueck)

Die verifizierte Feldmatrix aus der Analyse (Abschnitt 2a/2b/2c) wird als **deklaratives JSON** abgelegt und von Formular, Validierung und Ticker gleichermassen benutzt. Kein hartkodiertes `if` in der UI.

```json
{
  "unit": "offense",
  "fields": {
    "player":            { "type": "player", "from": "lineup" },
    "pass_result":       { "type": "radio", "options": ["catch","incomplete","interception"] },
    "incomplete_reason": { "type": "radio", "options": ["fifty_fifty","drop","uncatchable","batted"] },
    "air_yards":         { "type": "radio", "options": [0,5,10,15,20,30] },
    "yards_after_catch": { "type": "radio", "options": [0,5,10,15,20,30], "default": 0 },
    "flag_pulls_missed": { "type": "radio", "options": [0,1,2,3,4,5,6,7,8], "default": 0 },
    "yards_run":         { "type": "radio", "options": [0,5,10,15,20,30], "default": 0 },
    "yards_lost":        { "type": "radio", "options": [-5,0,-10,-15] },
    "foul":              { "type": "radio", "optionsBy": "type" },
    "foul_yards":        { "type": "radio", "options": [0,-5,-10] },
    "result":            { "type": "radio", "optionsBy": "pathResult" }
  },
  "types": {
    "pass": {
      "show":     ["player","pass_result"],
      "required": ["player","pass_result"],
      "when": {
        "pass_result=catch": {
          "show": ["air_yards","yards_after_catch","flag_pulls_missed(if yards_after_catch!=0)","result"],
          "required": ["air_yards"]
        },
        "pass_result=incomplete": {
          "show": ["incomplete_reason","result"],
          "required": ["incomplete_reason"]
        },
        "pass_result=interception": { "show": ["result"] }
      }
    },
    "foul_drawn": {
      "show": ["player","foul","foul_yards(if foul=other)"],
      "required": ["foul","foul_yards(if foul=other)"]
    }
  },
  "extraPoint": {
    "trigger": ["touchdown","pick_6","xp_retry"],
    "resultField": "xp_result",
    "resultRequired": true,
    "replacesResult": true
  }
}
```

Regeln der Engine:
1. **Sichtbarkeit und Pflicht** kommen ausschliesslich aus dem Schema; Aenderung der Optionen = Aenderung der Konfiguration, kein Codeumbau.
2. **Wechsel von Eventtyp oder Zwischenwert** loescht automatisch alle nun unsichtbaren Felder (kein Geisterwert).
3. **Clear Event** setzt alle Eventfelder zurueck (auch `foul` und `foul_yards`; Offense und Defense haben getrennte Felder).
4. **Extra-Point-Modus** wird aus dem Event-Log abgeleitet (letztes effektives Ergebnis ist Touchdown/Pick-6/XP-Retry), nicht aus lokalem Browser-State.
5. **Lineup** hat 5 Spieler (Flag-Football 5 v 5). Abweichung ist ein **Hinweis** mit Bestaetigung („nur 4 Spieler auf dem Feld?"), kein Hartfehler. Spieler muessen im Spieltagskader sein.
6. Optionslisten fuer Fouls je Einheit und je committed/drawn getrennt, wie im Ist-System (siehe Analyse). Offene Frage: ob die Unterschiede fachlich gewollt sind (Abschnitt 13).
7. **Result im Normalmodus**: im Altsystem optional. Neu: **Warnung** bei fehlendem Ergebnis, Speichern bleibt moeglich (bewusste Entscheidung offen, Abschnitt 13).

---

## 6. Scoring-Engine

Reine Funktion `score(events) -> { own, opp, scoringEvents[] }`, mit Unit-Tests, im Client und im Export-Worker identisch eingebunden.

| Ereignis | Punkte |
|---|---|
| Touchdown Offense | Eigenes Team +6 |
| Touchdown Defense (Gegner-TD) | Gegner +6 |
| Pick-6 durch die Defense | Eigenes Team +6 |
| Pick-6 gegen die Offense | Gegner +6 |
| `1xp_made` / `2xp_made` | Eigenes Team +1 / +2 |
| `1xp_allowed` / `2xp_allowed` | Gegner +1 / +2 |
| Safety | **offen**: im Altsystem nicht gewertet; Vorschlag +2 fuer die Gegenseite (Abschnitt 13) |
| Verfehlte/verhinderte XPs, Fouls | keine Punkte |

Gevoidete oder ersetzte Events werden vor der Berechnung ausgefiltert. Jedes Scoring-Event hat ein explizites Feld `scoring_team` (`own|opp`), damit die Looker-Studio-Auswertung nicht rechnen muss.

---

## 7. Bedienung in drei Phasen

### 7.1 Vorbereitung (Admin)
- **Kader:** Liste, CSV-Import, Mehrfachauswahl, Aktiv-Schalter statt Loeschen, Prioritaeten (Offense/Defense/QB/Blitz), eindeutige Nummer.
- **Gegner/Teams** als Stammdaten, **Spiel anlegen** (Gegner, Datum, Anlass, Ort), **Spieltagskader**, **Typist zuweisen**, **Ticker-Link/QR** (zufaelliger Token), Status `planned → live → finished`.

### 7.2 Waehrend des Spiels (Typist, Mobil)
- Kopf: Spielstand, Quarter, **Sync-Status**, Einheit-Umschalter Offense/Defense.
- Lineup wird vom letzten Spielzug uebernommen; „Wechsel" oeffnet die Auswahl (Sortierung nach Prioritaeten).
- Eventtyp als grosse Tasten, Folgefelder nach Regel-Engine, **Speichern** mit einem Tap, direkt naechster Spielzug.
- Extra-Point-Modus automatisch; Marker (Quarter, Halbzeit, Drive-Ende, Timeout, Spielende).
- **Undo**, Event antippen zum Bearbeiten/Stornieren, Kommentar je Event oder Spiel, Liste der letzten Events.
- Warnung bei Verlassen, solange Events nicht gesichert sind.

### 7.3 Live-Ticker (Zuschauer, ohne Login)
Zeigt **alle** Eventfelder, aufbereitet:
- **Kopf:** Teams, grosser Spielstand, Quarter/Halbzeit, Status, „zuletzt aktualisiert vor n s".
- **Feed:** neueste oben, gruppiert nach Drive, Quarter-Trenner, farblich nach Einheit, ein Satz pro Spielzug aus Textbausteinen, z. B. „#96 Daniel Binder faengt einen Pass von QB #54 Kuesgen (15 Air Yards + 15 nach dem Catch), 1 verpasster Flag-Pull. First Down."
- **Aufklappbar:** Aufstellung auf dem Feld, Blitzer, Flag-Puller und fehlgeschlagene Versuche, Typist, Uhrzeit.
- **Highlights** (Touchdown, Pick-6, Interception, Sack, Safety, XP, Fouls) mit Icon und Farbe; Korrekturen sichtbar als „Eintrag korrigiert".
- **Live-Box:** Passquote, Air- und YAC-Yards, Sacks, Interceptions, Fouls, Top-Spieler.
- **Filter:** Offense, Defense, nur Punkte, nur Highlights, Spieler. Auto-Update ohne Neuladen, stabile Scrollposition, hell/dunkel, mobil zuerst.
- **Datenquelle:** Realtime-Abo auf `event` (Filter `game_id`); Fallback Polling alle 5–10 s ueber gecachte JSON-Antwort. Textbausteine liegen im Client (gleiche Texte fuer Vorschau in der Erfassung).

### 7.4 Danach (Google Sheets und Looker Studio)
Siehe Abschnitt 9.

---

## 8. Sync und Statusanzeige

Zwei Stufen, weil ein Browser nach dem Schliessen nicht zuverlaessig weiter synchronisieren kann (Background Sync API gibt es nur in Chromium, nicht auf iOS-Safari).

**Stufe 1 – Geraet → Backend** (Browser muss offen sein, bis bestaetigt)
- Jedes Event geht zuerst in die **Outbox** (IndexedDB), dann Versand in Batches; Server antwortet mit `ack` pro Event-ID und vergibt `seq`.
- Idempotent ueber `event.id`; Wiederholung mit wachsendem Abstand (Backoff).
- Online-/Offline-Erkennung, Flush bei Netz-Rueckkehr und bei `visibilitychange`, `pagehide`.
- Persistenter Speicher (`navigator.storage.persist`), optionaler Wake Lock waehrend `live`.

**Stufe 2 – Backend → Google Sheets** (serverseitig, unabhaengig vom Browser)
- Export-Worker liest alle Events mit `seq > export_state.last_event_seq`, berechnet effektiven Zustand, schreibt per `values.append` in Batches und speichert den Fortschritt.
- Idempotenz: eindeutige `event_id`-Spalte; Korrekturen aktualisieren die Zeile per Schluessel (`values.update` auf bekannte Zeilen) oder werden als `voided`-Flag nachgetragen.
- Sheets-Limit (ca. 60 Schreibzugriffe/Minute) wird durch Batching eingehalten.

**Statusmodell**

| Zustand | Anzeige | Browser noetig? |
|---|---|---|
| `synced` | grüner Haken „Gesichert · Sheets in ca. 1 min" | nein |
| `sending` | gelb „n Events werden gesendet" | ja |
| `offline` | orange „Offline · n Events nur auf diesem Geraet" | ja |
| `error` | rot mit Ursache und „Erneut versuchen" | ja |
| `sheets_pending` | grau „Gesichert, Sheets folgt" | nein |

Abschluss: Beim Beenden des Spiels bestaetigt die App „Alles gesichert" oder zeigt „Noch n Events offen – bitte online bleiben". Der Status „Sheets aktuell bis …" kommt aus `export_state`.

---

## 9. Google Sheets und Looker Studio

Flache, typisierte Tabellen (eine Zeile pro Entitaet, lesbare Namen **und** IDs):

| Tab | Spalten (Auszug) |
|---|---|
| `plays` | event_id, game_id, game_date, opponent, occasion, seq, ts, quarter, drive_no, unit, type, player_nr, player_name, qb, pass_result, incomplete_reason, air_yards, yards_after_catch, yards_run, flag_pulls_missed, yards_lost, foul, foul_yards, result, xp_result, flag_puller, failed_pullers, blitzers, typist, voided |
| `lineups` | event_id, unit, player_nr, player_name (5 Zeilen je Event, fuer Zaehlungen pro Spieler) |
| `scores` | event_id, game_id, ts, unit, scoring_team (own\|opp), points, reason |
| `games` | game_id, date, opponent, occasion, venue, own_points, opp_points, status |
| `players` | player_id, number, name, active |
| `comments` | comment_id, game_id, event_id, ts, text |

Looker Studio verbindet sich direkt mit dem Sheet. Berichtsseiten: Spielueberblick (Score-Verlauf, Drives), Offense (Passquote, Air Yards, YAC, Targets, Interceptions), Defense (Flag-Pulls, Sacks, Blitz, Incomplete-Gruende), Fouls, Spieler- und Saisonvergleich mit Filtern nach Spiel und Anlass.

---

## 10. Rollen und Sicherheit

| Rolle | Rechte |
|---|---|
| admin | Kader, Spiele, Teams, Typisten, Spiel abschliessen, Korrekturen nach Abschluss |
| typist | Events fuer zugewiesene Spiele anlegen/korrigieren |
| viewer / oeffentlich | Ticker-Lesezugriff ueber Token |

- Postgres **Row Level Security**: `event` schreibbar nur fuer zugewiesene Typisten, lesbar im Ticker nur ueber `game.ticker_token`.
- Login per Magic Link; Service-Account-Schluessel nur als Secret in der Edge Function, nie im Client.
- Abgeschlossene Spiele sind fuer Typisten gesperrt.
- Datenschutz: Namen sind im Ticker sichtbar (Entscheidung: alles sichtbar); der Ticker-Link ist ein unratbarer Token und nicht durchsuchbar (`noindex`).

---

## 11. Projektstruktur (Vorschlag)

```
/apps/web            PWA (Admin, Erfassung, Ticker)
/packages/rules      Regelschema (JSON) + Engine + Zod-Validierung
/packages/scoring    Scoring-Engine + Tests
/packages/ticker     Textbausteine, Highlight-Regeln, Live-Statistik
/supabase/migrations SQL, RLS
/supabase/functions  sync, export-sheets
/docs                Analyse + Architektur
```

---

## 12. Umsetzungsphasen

1. **MVP ohne Backend:** Kader, Spiel, Erfassung inkl. Regel-Engine, Extra-Point, Scoring, Undo/Edit, lokaler Ticker-Vorschau, CSV-Export.
2. **Backend und Sync Stufe 1:** Auth, Postgres, RLS, Outbox, Statusanzeige, oeffentlicher Live-Ticker.
3. **Sheets-Export Stufe 2:** Worker, Tabellen, Fortschritt, Looker-Studio-Vorlage.
4. **Komfort:** Drive-/Halbzeit-Marker, Sub-Workflow, Live-Statistik-Box, Altdaten-Import aus den Google Sheets (`offense`, `defense`, `comments`).

Altdaten-Import: Mapping `default → null`, Gegner-Strings → Team/Spiel, Zeitstempel (Minutenstring) → `timestamptz` mit Reihenfolge ueber Zeilennummer, `line-up`-CSV → `lineup[]`, doppelte Nr. 97 manuell klaeren.

---

## 13. Offene Entscheidungen

1. **Safety** im Spielstand werten (+2) und wem gutschreiben.
2. **Result Pflicht** im Normalmodus oder nur Warnung.
3. **Foul-Listen**: Sind die Unterschiede zwischen Offense/Defense und committed/drawn fachlich gewollt? Soll ein Foul das Ergebnis/Turnover-Logik beeinflussen (Ist: Result nur bei Offense-committed und Defense-drawn).
4. **Flag pulls missed**: Obergrenze (Ist 5, Wunsch: mehr) und echte Yards statt 5er-Buckets.
5. **Mehrere Typisten parallel** pro Spiel oder genau einer mit Uebergabe.
6. **Backend-Wahl** endgueltig: Supabase vs. Cloudflare (Inaktivitaets-Pause vs. Aufwand fuer Realtime).
7. **Looker-Bericht** oeffentlich per Link oder nur fuer Team.

## 14. Risiken

| Risiko | Gegenmassnahme |
|---|---|
| Free-Tier-Aenderung oder Pausierung | Keep-alive, offenes Datenformat, Export, austauschbares Backend |
| Browser loescht lokale Daten (Safari) | `storage.persist`, schneller Sync, Warnhinweise, regelmaessiger Export |
| Sheets-Limits | Batching, idempotente Appends, Fortschritt in `export_state` |
| Regeldrift zwischen Client und Server | Gemeinsames Schema-Paket, Tests |
| Pflege ohne Verantwortlichen | Wenige Abhaengigkeiten, Tests fuer Regeln, Scoring und Ticker-Texte |
