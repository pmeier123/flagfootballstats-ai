# Analyse „Stats V2" (Aachen Emperors) – Feature- & Datenmodell-Inventar

Quelle: https://aachenemperors.budibase.app/app/stats-v2 (Budibase 3.23.39, Dark-Theme, zuletzt veröffentlicht 12.12.2025).
Methode: UI vollständig durchgeklickt (ohne Speichern) + read-only Auslesen der veröffentlichten App-Definition (Screens, Tabellen, Queries, Daten) über die Budibase-API.
Zweck: Grundlage für Neukonzeption und Neuimplementierung.

---

## 1. Überblick

Mobile/Desktop-Web-App zum **Live-Erfassen von Spielzügen (Play-by-Play) bei Flag-Football-Spielen** der Aachen Emperors (DFFL). Pro Spiel wird für jeden Spielzug Offense **oder** Defense erfasst. Zusätzlich: laufender Spielstand, Kommentare, Spieler-/Gegnerverwaltung.

**Fachlicher Kern:** Ein „Event" = ein Spielzug aus Sicht einer Einheit (Offense / Defense) mit Aufstellung (5 Spieler), Spielzugtyp, Beteiligtem Spieler, Ergebnis und typabhängigen Zusatzfeldern.

Es gibt **keine Auswertungs-/Statistikseiten** in der App – die eigentliche Statistik (Aggregation, Punktestand-Berechnung via Sheet `scores`) passiert in Google Sheets. Die App ist reine Erfassungsmaske.

### Navigation (linke Sidebar, Titel „Stats", blau)
| Menü | Route | Zweck |
|---|---|---|
| New Event | `/event/new` | Spielzug-Erfassung (Hauptfunktion, 3-stufiger Wizard) |
| Matches | `/matches` | Gegner/Spiele verwalten (CRUD) |
| Players | `/players` | Kader verwalten (CRUD, CSV-Import, Mehrfachlöschen) |
| User-Menü (unten) | – | My profile, Update password, Go to portal, Log out |

Alle Screens: Rolle BASIC (Login erforderlich). Aktuell existiert nur 1 Benutzer (Admin/Builder). Budibase-Rollen: ADMIN / POWER / BASIC / PUBLIC.

---

## 2. Feature: Event-Erfassung (`/event/new`) – Wizard in 3 Schritten

### Schritt 1 – „Basedata"
| Feld | Typ | Pflicht | Details |
|---|---|---|---|
| Opponent | Dropdown | ja (verifiziert) | Quelle: Tabelle Matches (Feld Opponent), sortiert; Default leer |
| Occasion | Radio | ja (verifiziert) | DFFL Game (`dffl-game`, Default), Semifinal (`semifinal`), Final (`final`), Group stage (`group-stage`), Other (`other`) |
| Typist | Dropdown | ja (verifiziert) | Quelle: Players (Feld Name) – wer tippt |
| Continue | Button | – | Validiert, wechselt zu Schritt 2, **speichert Opponent/Occasion/Typist persistent im Browser-State** (Vorbelegung beim nächsten Besuch) |

### Schritt 2 – Event-Eingabe (Tabs „Offense" | „Defense")
Gemeinsam unter den Tabs:
- **Edit Basedata** (zurück zu Schritt 1)
- **Previously saved event** (read-only): zeigt `Eventtype, Player, Result` des zuletzt gespeicherten Events (Quick-Check / Undo-Hilfe)
- **Comment** + **Save comment** (freier Text, wird mit Zeitstempel in Sheet `comments` gespeichert, Feld wird danach geleert)
- **Live-Spielstand** „Aachen Emperors : <Gegner>" z. B. `40 : 6`, Buttons **Refresh Score** und **Score details** (→ Schritt 3). Score wird nach jedem Event-Save automatisch refresht.

#### 2a) Tab OFFENSE
Kopf-Felder:
- **Offense players on the field** – Multi-Select aus allen Spielern (Label `Nr Name`, Wert `Nr`), Optionen sortiert nach `offense_order`. **Pflicht = mindestens 1** (leer → „Required"). Die „genau 5"-Regel ist **nur ein Warn-Toast** („You should select 5 players") bei jeder Änderung ≠ 5 – **beim Speichern wird sie nicht geprüft** (verifiziert: Speichern mit 2, 3 und 10 Spielern wird akzeptiert). Papierkorb-Button leert die Auswahl.
- **Current QB** – Dropdown, nur Spieler aus dem Lineup, sortiert nach `qb_order`. **Praktisch optional**: In der Konfiguration als Pflicht deklariert, beim Speichern mit leerem QB wird aber **kein** Fehler erzeugt (verifiziert).

Eventtype (Radio, Tabelle `eventtypes-offense`, sortiert nach Rank; Default Pass):
`Pass(1), Run(2), Sack(3), Throwaway(4), Dead snap(5), Foul committed(6), Foul drawn(7)`

**Verifizierte Feld-Matrix Offense** (Normalmodus, d. h. kein Extra-Point-Try aktiv). ✱ = Pflicht, ○ = sichtbar/optional, – = nicht sichtbar. Alle Pfade wurden in der UI durchgeklickt und mit „Save Event" auf Validierungsfehler geprüft (Schreibzugriff dabei blockiert).

| Pfad | Player | Pass result | Incomplete reason | Air Yards | Yards after catch | Yards run | Flag pulls missed | Yards lost | Foul | Foul Yards | Result (Optionen) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Pass** (noch kein Pass result) | ✱ | ✱ | – | – | – | – | – | – | – | – | – (kein Result sichtbar) |
| Pass › **Catch** | ✱ | ✱ (Catch) | – | ✱ 0/5/10/15/20/30+ | ○ 0/5/10/15/20/30+ (Default 0) | – | ○ 0–5 (Default 0), **nur sichtbar wenn Yards after catch ≠ 0** | – | – | – | ○ TD / First down / ToD |
| Pass › **Incomplete** | ✱ | ✱ (Incomplete) | ✱ 50/50-ball / Drop / Uncatchable / Batted-deflected | – | – | – | – | – | – | – | ○ ToD |
| Pass › **Interception** | ✱ | ✱ (Interception) | – | – | – | – | – | – | – | – | ○ Pick 6 |
| **Run** | ✱ | – | – | – | – | ✱ 0/5/10/15/20/30+ (Default 0 → faktisch immer gefüllt) | ○ 0–5 (Default 0), **nur sichtbar wenn Yards run ≠ 0** | – | – | – | ○ TD / First down / ToD |
| **Sack** | – | – | – | – | – | – | – | ✱ -5 / 0 / -10 / -15 (kein Default) | – | – | ○ ToD / Safety |
| **Throwaway** | – | – | – | – | – | – | – | – | – | – | ○ ToD |
| **Dead snap** | – | – | – | – | – | – | – | – | – | – | ○ ToD |
| **Foul committed** | ○ | – | – | – | – | – | – | – | ✱ Illegaler Kontakt / Abschirmen-BB / False Start / Flag guarding-Jumping / Unsportliches Verhalten / Sonstiges | ✱ 0/-5/-10 **nur wenn Foul = Sonstiges** | ○ ToD |
| **Foul drawn** | ○ | – | – | – | – | – | – | – | ✱ Illegaler Kontakt / Abschirmen-BB / False Start / Unsportliches Verhalten / Sonstiges (**ohne** „Flag guarding-Jumping") | ✱ 0/-5/-10 **nur wenn Foul = Sonstiges** | – (**kein** Result-Feld) |

Weitere Regeln Offense:
- Alle Zahl-Buckets sind Radios mit Strings: `0, 5, 10, 15, 20, 30+` (gespeichert wird `30` für „30+").
- Der **Player**-Dropdown enthält nur die Spieler des gewählten Offense-Lineups, nach Nummer sortiert.
- **Result ist im Normalmodus nie Pflicht** (Spielzug darf ohne Result gespeichert werden; dann steht `default` im Sheet). Kommentare im Echtbetrieb („ToD vergessen") zeigen, dass dies in der Praxis zu Fehlern führt.
- Result-Radio hat einen Papierkorb-Button (erscheint, sobald ein Wert gesetzt ist), um die Auswahl zu entfernen.
- Ein Spielzug ist speicherbar, sobald alle ✱-Felder des Pfads gefüllt sind (Beispiele verifiziert: Sack › -5 ohne alles andere; Throwaway/Dead snap ohne jede Eingabe; Foul committed › Illegaler Kontakt ohne Player).

Buttons: **Save Event** (validiert → speichert → Reset), **Clear Event** (setzt alle Eventfelder zurück, Eventtype → Pass).

#### 2b) Tab DEFENSE
Kopf-Felder:
- **Defense players on the field** – Multi-Select, Optionen sortiert nach `defense_order`. Pflicht = mindestens 1; „genau 5" nur als Warn-Toast (nicht beim Speichern geprüft, verifiziert mit 2 und 3 Spielern).
- **Current Blitzer(s)** – Multi-Select aus den Lineup-Spielern, sortiert nach `blitz_order`. **Optional** (Speichern ohne Blitzer funktioniert, verifiziert); Mehrfachauswahl möglich (gespeichert als CSV, z. B. „90 Robin Hahn,91 Max").

Eventtype (Radio, `eventtypes-defense`, Rank): `Target(1), Run(2), Sack(3), Throwaway(4), Dead snap(5), Foul committed(6), Foul drawn(7)` (Default **Target**).

**Verifizierte Feld-Matrix Defense** (Normalmodus). ✱ = Pflicht, ○ = sichtbar/optional, – = nicht sichtbar.

| Pfad | Player | Target result | Incomplete reason | Flag puller | Failed flag pull attempts | Foul | Foul Yards lost | Result (Optionen) |
|---|---|---|---|---|---|---|---|---|
| **Target** (noch kein Target result) | ✱ | ✱ Catch allowed / Incomplete / Interception | – | ○ | ○ | – | – | – |
| Target › **Catch allowed** | ✱ | ✱ | – | ○ (1 Spieler aus Lineup) | ○ (Mehrfach aus Lineup) | – | – | ○ TD / First down / ToD |
| Target › **Incomplete** | ✱ | ✱ | ✱ 50/50-ball / Drop / Uncatchable / Batted-deflected | – | – | – | – | ○ ToD |
| Target › **Interception** | ✱ | ✱ | – | – | – | – | – | ○ Pick 6 |
| **Run** | – | – | – | ○ | ○ | – | – | ○ TD / First down / ToD |
| **Sack** | ○ | – | – | – | – | – | – | ○ ToD / Safety |
| **Throwaway** | ○ | – | – | – | – | – | – | ○ ToD |
| **Dead snap** | – | – | – | – | – | – | – | ○ ToD |
| **Foul committed** | ○ | – | – | – | – | ✱ Illegaler Kontakt / Abschirmen-BB / **Illegaler Blitz** / Unsportliches Verhalten / Sonstiges | ✱ 0/-5/-10 nur bei Sonstiges | – (**kein** Result-Feld) |
| **Foul drawn** | ○ | – | – | – | – | ✱ Illegaler Kontakt / Abschirmen-BB / **Flag Guarding** / Unsportliches Verhalten / Sonstiges | ✱ 0/-5/-10 nur bei Sonstiges | ○ ToD |

Weitere Regeln Defense:
- Bei **Target** sind Flag puller / Failed flag pull attempts schon sichtbar, bevor ein Target result gewählt ist; sie verschwinden bei Incomplete und Interception.
- Alle Spieler-Dropdowns (Player, Flag puller, Failed attempts) enthalten nur das gewählte Defense-Lineup.
- Wichtig: **Offense-Foul-Listen und Defense-Foul-Listen unterscheiden sich** (Offense committed: *False Start, Flag guarding/Jumping*; Offense drawn: *False Start*; Defense committed: *Illegaler Blitz*; Defense drawn: *Flag Guarding*). Gemeinsam: Illegaler Kontakt, Abschirmen/BB, Unsportliches Verhalten, Sonstiges.
- Auch Offense-Fouls haben „Result" nur bei *committed* (ToD), Defense nur bei *drawn* (ToD) – die Zuordnung ist spiegelverkehrt (Strafe gegen uns/für uns → Turnover-Logik ist nicht dokumentiert; im Neukonzept fachlich klären).
- Sack/Throwaway zeigen in der Defense ein optionales Player-Feld (Sack = sackender Spieler), Pflicht ist es nicht.

#### 2c) Extra-Point-Flow (zustandsgesteuert)
Wird als **Result** eines Events `Touchdown` oder `pick-6` (oder `XP Retry`) gespeichert, schaltet die Maske für den **nächsten** Event in den „**Extra point try**"-Modus (Überschrift, kursiv):
- Verifiziert durch Setzen von `last-result=Touchdown` und Durchklicken **aller** Pfade in Offense und Defense.
- Es erscheint die Überschrift „**Extra point try**". Alle normalen Result-Felder (TD / First down / ToD / Pick 6 / Safety …) werden ersetzt durch **ein einziges Result-Radio, das auf JEDEM Eventtyp Pflicht ist** (auch bei Foul drawn, Throwaway, Sack, Dead snap, Run, Target …):
  - **Offense:** `1XP made / 1XP missed / 2XP made / 2XP missed / XP Retry`
  - **Defense:** `1XP allowed / 1XP prevented / 2XP allowed / 2XP prevented / XP Retry`
- Alle **anderen** Feldregeln der Matrix bleiben unverändert (z. B. Offense Pass: Player ✱, Pass result ✱, Air Yards ✱ bei Catch; Sack: Yards lost ✱; Fouls: Foul ✱; Defense Target: Player ✱, Target result ✱, Incomplete reason ✱ bei Incomplete). Der Extra-Point wird also als normales Event (typisch Pass/Run mit Player) erfasst; das Ergebnis wird nur über Result unterschieden.
- Trigger: `last-result` ∈ {`Touchdown`, `pick-6`, `XP Retry`} (Wert des Result-Radios des **zuletzt gespeicherten** Events, gilt für beide Tabs). Bei `XP Retry` bleibt der Modus aktiv. Jeder andere gespeicherte Wert (auch leer/`default`, `1XP made` usw.) beendet ihn.
- `last-result` ist **persistent** (Browser-localStorage) → überlebt Reload; Offense und Defense teilen sich denselben Wert.
- Der XP-Modus ist **nicht an Offense/Defense-Zugehörigkeit gebunden**: Ein Defense-TD (Gegner-TD) setzt ebenfalls den Modus, dann zeigt die Defense `allowed/prevented`.

#### 2d) Persistenter Browser-State (UX-Komfort)
localStorage-Schlüssel (pro App): `occasion-state`, `opponent-state`, `typist-state` (gesetzt bei **Continue**), `last-result`, `current-qb-state`, `offense-lineup-state`, `defense-lineup-state`, `current-blitzer-state` (gesetzt bei erfolgreichem **Save Event**). → Aufstellung muss nicht bei jedem Play neu gewählt werden.

*Beobachtung:* Der gemerkte Zustand enthält Altlasten aus einer früheren Saison: Offense-Lineup `17,27,36,10,0`, Defense-Lineup `21,52,3T,8T,42`, QB „0 Nils Heidingsfeld", Blitzer „3T Paul Heidenreich" – **keine dieser Personen existiert im aktuellen Kader**. Das Lineup-Feld ist damit vorbelegt und besteht die Pflichtprüfung, ohne dass ein echter Spieler gewählt wurde (der Player-Dropdown ist dann leer). → Neukonzept: Referenzen gegen aktuellen Kader validieren.

#### 2d-2) Reset-Verhalten und Datenhygiene-Bugs (verifiziert)
- **Clear Event** setzt zurück: Eventtype (→ Pass bzw. Target), Player, Pass result, Air/YAC/Run-Yards, Flag pulls missed, Result, Incomplete reason, Sack-Yards, Target result. **Nicht** zurückgesetzt: `foul` (gemeinsames Feld für Offense *und* Defense!) und `foul-yards`. Folge: Ein zuvor gewählter Foul-Wert bleibt aktiv, wird im nächsten Foul-Event ggf. unsichtbar übernommen (Pflichtprüfung „Foul" gilt dann als erfüllt, obwohl nichts sichtbar gewählt ist – in Defense verifiziert).
- **Eventtype-Wechsel ohne Clear** setzt abhängige Felder **nicht** zurück: Wechsel Pass › Catch › Air Yards 10 → Run → zurück zu Pass zeigt wieder „Catch / Air Yards 10". Beim Wechsel zu Run mit altem Pass result „Incomplete" erscheinen sogar „Incomplete reason" und zwei Result-Gruppen gleichzeitig. Beim Speichern werden **alle** Feldwerte (auch unsichtbare/veraltete) mitgeschrieben → potenziell inkonsistente Datensätze (z. B. Run-Event mit `pass-result=Catch`).
- Offense und Defense teilen sich Felder gleichen Namens (`foul`, `result`, `incomplete-reason`, `player`) in **einem** Formular; Werte „lecken" zwischen den Tabs.
- „Save Event" validiert das gesamte Formular. Ist alles gültig, wird sofort geschrieben – es gibt **keine Bestätigung und kein Undo**.

#### 2e) Speichern (Schreibpfad)
Event wird mit **Zeitstempel (Client-Zeit, de-DE `dd.MM.yyyy, HH:mm` – nur Minutengenauigkeit!)** als neue Zeile in Google Sheet **`offense`** bzw. **`defense`** geschrieben. Leere Werte werden als Literal `default` gespeichert; numerische Defaults als `"0"`. Alle Werte Strings.

### Schritt 3 – „Score details"
- Back-Button, Score-Anzeige
- Tabelle (Grid, sortierbar nach Zeitstempel) mit Spalten `result`, `unit`, `timestamp`, `player` – alle Scoring-Events des Spiels (Touchdown, 1XP made, 2XP made …). Grid ist konfiguriert mit „add/edit/delete rows erlaubt", die Datenquelle ist aber eine Read-Query (de facto read-only).

---

## 3. Feature: Spielstand-Berechnung

Query „Get summarized score by opponent" (Sheet `scores`, gefiltert per Gegnername):
| Ergebnis | Einheit | Punkte für |
|---|---|---|
| `Touchdown` | offense | Emperors +6 |
| `Touchdown` | defense | Gegner +6 (Touchdown gegen die Defense) |
| `1XP made` | – | Emperors +1 |
| `2XP made` | – | Emperors +2 |
| `1XP allowed` | – | Gegner +1 |
| `2XP allowed` | – | Gegner +2 |
| `pick-6` | offense | Gegner +6 (Pick-6 gegen Offense) |
| `pick-6` | defense | Emperors +6 |
| `Safety`, `1XP/2XP missed/prevented` | | **keine Punkte** (Safety = 2 Punkte wird derzeit nicht gezählt → Lücke/Bug) |

Ausgabe „`<Emperors> : <Gegner>`". Sheet `scores` wird offenbar per Formel aus `offense`/`defense` abgeleitet (Spalten result, player, opponent, unit, timestamp; Suche via API liefert leere Zeilen). Das Feld `unit` hat den Wert `default` für eine Einheit und sonst für die andere – **die Mapping-Logik ist in den zwei Queries unterschiedlich/uneinheitlich** (Score-Zusammenfassung vs. Detailtabelle zeigen widersprüchliche Labels) → im Neu-Konzept sauber als `unit: offense|defense` + `scoring_team` modellieren.

Beobachtetes Beispiel (Sassenberg Knights): 40 : 6.

---

## 4. Feature: Matches (`/matches`)
- Tabelle mit einer Spalte `Opponent`, 8 Zeilen/Seite, Paginierung, „Create row"-Button.
- Klick auf Zeile → Seitenpanel (Detail) mit ID, Feld Opponent (Textbox), **Save**, **Delete**.
- Datenmodell: `Matches { Auto ID, Opponent:string, Created/Updated At/By }`.
- Aktuelle Werte: *Mülheim Shamrocks II, Sassenberg Knights, Semi final, Final, 3rd place game* → **„Match" ist faktisch nur ein Gegner-/Spiel-Name ohne Datum, Ergebnis, Saison, Turnier, Ort.** Spielzuordnung der Events läuft über den **Namen als String** (keine ID).

## 5. Feature: Players (`/players`)
- Tabelle (Paginierung/Scroll) mit Spalten `nr_name, Name, defense_order, Nr, offense_order, blitz_order, qb_order`, Checkbox-Mehrfachauswahl, „Create row".
- **Delete selected players** (erscheint bei Auswahl, mit Bestätigungsdialog „Do you want to delete the selected players?").
- **CSV-Import** (Drag&Drop/Klick, Buttons Import / Reset / Copy errors) → danach Tabelle refreshen.
- Zeilenklick → Seitenpanel mit Edit-Formular: Name, Nr, nr_name, offense_order, defense_order, blitz_order, qb_order; Save / Delete.
- **Sortier-Prioritäten (`*_order`, 1 = höchste Priorität, 9 = „nicht vorgesehen")** steuern die Reihenfolge in den Auswahllisten der Erfassung (Offense-Lineup, Defense-Lineup, QB, Blitzer). Beispiel: QB-Priorität: Oskar Küsgen 1, Yunus Ulrich 1/2.
- `nr_name` = `"<Nr> <Name>"` (redundant gespeichert, wird als Anzeige-Label und als Wert in Events benutzt).
- Aktueller Kader: 16 Zeilen (Nr als **String**, da „2V"): 12 Felix Heidenreich, 14 Henrik Jansen, 23 Thorsten Lenz, 37 Robin Konrad, 54 Oskar Küsgen, 90 Robin Hahn, 91 Max, 92 Eric Benschneider, 93 Bryan Wiegand, 95 Lorenz Hornung, 96 Daniel Binder, 97 Yunus Ulrich (**doppelt**, mit unterschiedlichen QB-Orders 1 und 2 → Dublette), 98 Sebastian Reuter, 99 Dimitri Makris, 2V Veronika Schneider.

## 6. Kommentare
Freitext-Annotationen (Zeitstempel + Text), **nicht** mit Event/Spiel verknüpft. Reale Nutzung zeigt den Bedarf an **Korrektur/Undo**: „ToD vergessen", „War kein TD nur First Down, dazu Jumping gegen Yunus", „Der XP hat so nicht stattgefunden", „End of Half", „End of Game", „Last Play was ToD", „Yunus war für den gesamten vorherigen Drive statt Robin drauf", sowie die Anforderung *„mehr als 5 Flag Pulls Missed erlauben"*. → Neu-Konzept: Events editier-/löschbar, Drive-/Halbzeit-Marker, Lineup-Korrektur rückwirkend, Kommentar je Event/Spiel.

## 7. Authentifizierung / Admin
Budibase-Login (E-Mail + Passwort), Profile, Passwort ändern, Portal, Logout. Dark-Theme, Sidebar-Navigation links, abgerundete Buttons (16 px).

---

## 8. Datenmodell (Ist)

**Budibase-DB (intern):** `Matches`, `Players`, `eventtypes-offense` / `eventtypes-defense` (Name, Rank), `Eventtypes` (alt/ungenutzt: Sack, Run, Target, Foul commited, Foul drawn, Flag pull attempt, Interception), `Users`.

**Google Sheets (Event-Daten):** (alle Spalten String)
- `offense`: eventtype, player, current-qb, pass-result, incomplete-reason, air-yards, yards-after-catch, yards-run, tackles-broken (= Flag pulls missed), result, sack-yards-lost, foul, foul-yards, opponent, occasion, typist, line-up (CSV der Nr, z. B. `93,54,96,37,14`), timestamp
- `defense`: eventtype, player, current-blitzer (CSV von nr_name), target-result, incomplete-reason, flag-puller (Nr), flag-pull-attempter (CSV Nr), foul, foul-yards, result, opponent, occasion, typist, line-up, timestamp
- `scores`: result, player, opponent, unit, timestamp (abgeleitet)
- `comments`: comment, timestamp

**Datenumfang (Stand Analyse):** 141 Offense-Events, 166 Defense-Events, 77 Score-Zeilen, 13 Kommentare, 5 Gegner/Spiele, Typists: Veronika Schneider (Hauptschreiber), Bryan Wiegand. Datum der Events u. a. 12.07.2026 und 19.09.2026.

**Ist-Wertebereiche (Auswertung der echten Daten):**
- Offense eventtype: Pass 115, Run 18, Foul committed 4, Throwaway 2, Sack 1, Foul drawn 1 · pass-result: Catch 74, Incomplete 37, Interception 5 · results: Touchdown 22, First down 16, 1XP missed 12, 1XP made 8, ToD 5, 2XP made 1, 2XP missed 1
- Defense eventtype: Target 125, Run 28, Sack 5, Dead snap 2, Foul committed 2, Throwaway 2, Foul drawn 2 · results: First down 16, Touchdown 13, ToD 8, 1XP allowed 7, 1XP prevented 4, Safety 1, 2XP allowed 1
- Occasions in Daten: group-stage, semifinal, final

**Queries (Ist):** `Create Offense`, `Create Defense`, `Create Comment`, `Get summarized score by opponent`, `Get current scores by opponent`. Keine Automationen, keine Views.

---

## 9. Schwächen / Bugs / Lücken des Ist-Systems (Lessons für Neukonzeption)
1. **Kein Spiel-Entity:** Events referenzieren Gegner per Freitext-Name; „Final", „Semi final", „3rd place game" sind als „Gegner" angelegt. Kein Datum/Saison/Turnier/Ergebnis/Heim-Auswärts. Occasion wird pro Event wiederholt.
2. **Keine Event-IDs / kein Edit / kein Delete / kein Undo** in der App – Korrekturen nur per Kommentar oder manuell im Sheet.
3. **Zeitstempel nur minutengenau, lokalisierter String** → Reihenfolge innerhalb einer Minute nicht eindeutig; keine Drive-/Quarter-/Halbzeit-Information, keine Down & Distance / Feldposition.
4. **Alles String-typisiert**, `default` als Null-Platzhalter; Zahlen als Text (`"30"` für „30+").
5. **Inkonsistente Scoring-Logik** (zwei Queries mit gegensätzlicher unit-Zuordnung, im UI eingebetteter Code weicht von der Live-Query ab, `Pick 6` vs. `pick-6`). **Safety (2 Pkt.) und Strafen werden nicht gewertet**, 2-Pt-Defense-Return etc. nicht modelliert.
6. **Redundanz:** `nr_name`, Lineup als CSV-String, Blitzer als `nr_name`-CSV, Flag-Puller als `Nr` → uneinheitliche Spielerreferenzen. Doppelter Spieler (97 Yunus Ulrich).
7. **Fixe 5er-Lineups** (Flag Football 5v5) – Hinweis zu Fouls/Sonderfällen: Eventtyp-Listen und Optionen sind teilweise in Tabellen (Eventtypes), teilweise hartkodiert in der UI.
8. **Fixe Limits:** Flag pulls missed 0–5 (Nutzer wünscht mehr), Yards-Buckets 0/5/10/15/20/30+ (grob, keine echten Yards), Sack-Yards -5…-15.
9. **Persistenter UI-State** mit veralteten Referenzen (siehe 2d); kein Offline-Betrieb (Live am Spielfeld!) und kein Multi-Typist-Konflikthandling.
10. **Keine Statistik-Auswertung in der App** (Quarterback-Rating, Catch-Quote, Air/YAC-Yards, Flag-Pulls, Sacks, Fouls je Spieler, Blitz-Erfolg, Drive-Analyse …) – laut Datenlage aber genau das Ziel der erfassten Felder.
11. **Rollen/Rechte:** nur 1 Admin-User; Typist-Auswahl ist unabhängig vom Login-User.

## 10. Abgeleitete Feature-Liste für die Neukonzeption

**Muss (Parität):**
- Login/Benutzer, Rollen (Admin, Typist, Viewer)
- Spieler-Verwaltung inkl. CSV-Import, Mehrfachlöschen, Nummer, Prioritäten für Offense/Defense/QB/Blitz
- Gegner/Spiel-Verwaltung
- Wizard: Spiel + Anlass + Typist wählen
- Offense-Erfassung (7 Eventtypen, bedingte Felder lt. Matrix oben)
- Defense-Erfassung (7 Eventtypen inkl. Blitzer, Flag-Puller, Failed Pulls)
- 5er-Lineup-Auswahl mit Validierung, QB-Auswahl, Blitzer-Mehrfachauswahl, Merken zwischen Events
- Extra-Point-Folgeflow (1XP/2XP, Retry; Offense made/missed, Defense allowed/prevented)
- Live-Spielstand + Score-Detail-Liste
- Kommentare
- „Zuletzt gespeichertes Event"-Anzeige, Clear Event

**Soll (Verbesserungen aus der Analyse):**
- Echte Entities: Season/Tournament → Game → Drive → Play (Event) mit stabilen IDs, ms-genauem Zeitstempel, Halbzeit/Quarter-Marker
- Events nachträglich bearbeiten, löschen, Undo des letzten Events, Kommentar je Event
- Lineup-Wechsel (Sub) als eigener Vorgang mit rückwirkender Korrektur
- Korrekte, zentrale Scoring-Engine (TD, XP 1/2, Pick-6, Safety, Strafen) mit Tests
- Offline-fähig (PWA), schnelle Touch-Bedienung, Dark-Mode
- Konfigurierbare Auswahllisten (Fouls, Incomplete-Gründe, Yards-Buckets/echte Yards)
- Auswertungs-Dashboards je Spiel/Saison/Spieler + Export (CSV/Sheets)
- Spieler-Stammdaten ohne Redundanz (id, number, name, active, position-priorities)
- Mehrere Typists parallel / Konflikte, Audit-Log (Wer hat was getippt)
