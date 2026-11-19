# Einrichtung und Betrieb (kostenlos)

Die App läuft in zwei Stufen. **Stufe 0 braucht keinerlei Konto** und ist sofort einsatzbereit. Stufe 1 ergänzt den Live-Ticker, mehrere Geräte und den Google-Sheets-Export.

| Stufe | Was geht | Was du brauchst |
|---|---|---|
| 0 – lokal | Kader, Spiele, Erfassung, Undo/Korrektur, Spielstand, Ticker-Vorschau, CSV/JSON-Export, Altdaten-Import, Backup | nur Hosting der statischen Dateien |
| 1 – verbunden | zusätzlich öffentlicher Live-Ticker, Login, mehrere Geräte, Typist-Übergabe, Google Sheets + Looker Studio | Supabase (Free), Google-Dienstkonto |

Alle verwendeten Dienste haben einen dauerhaft kostenlosen Tarif. Prüfe die Konditionen vor dem Start selbst (Stand der Prüfung: Supabase Free = 500 MB Datenbank, 5 GB Traffic, unbegrenzte API-Aufrufe, **Pausierung nach 1 Woche Inaktivität**).

## 1. Hosting der App (statisch)

**Cloudflare Pages (empfohlen, funktioniert auch mit privatem Repo):**
1. Repository mit Cloudflare Pages verbinden.
2. Build-Befehl `npm ci && npm run build`, Ausgabeordner `apps/web/dist`.
3. Optional Umgebungsvariablen `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` setzen (Stufe 1).

**GitHub Pages:** Workflow `Deploy to GitHub Pages` manuell starten (im kostenlosen Tarif nur bei öffentlichem Repository). Secrets `SUPABASE_URL` und `SUPABASE_ANON_KEY` setzen, falls Stufe 1 genutzt wird.

Die App nutzt Hash-Routing (`#/…`) und benötigt keine Server-Regeln. Nach dem ersten Besuch läuft sie offline (Service Worker). Am Handy: Browser-Menü → „Zum Startbildschirm hinzufügen“.

## 2. Stufe 1: Supabase

1. Auf supabase.com ein kostenloses Projekt anlegen (Region EU).
2. Im SQL-Editor den Inhalt von `supabase/migrations/0001_init.sql` ausführen.
3. Unter *Authentication → URL Configuration* die Adresse der App als Site URL und Redirect URL eintragen. Magic-Link-E-Mails sind im Free-Tarif auf wenige pro Stunde begrenzt; für ein kleines Team reicht das. Alternativ den eigenen SMTP-Server eintragen.
4. Project URL und anon key (*Project Settings → API*) in `apps/web/public/config.json` eintragen **oder** als Build-Variablen setzen. Der anon key ist öffentlich vorgesehen; der Schutz liegt in den Zugriffsregeln der Datenbank.
5. App öffnen und mit deiner E-Mail anmelden. **Der erste angemeldete Nutzer wird automatisch Admin**, alle weiteren starten als „Viewer“. Unter *Einstellungen → Benutzer* Rollen vergeben (Typist für Erfasser).
6. Als Admin Spieler anlegen/importieren, Spiel anlegen, Spieltagskader festlegen, Typist zuweisen, Spiel starten.

### Anti-Pause
Der Workflow `Keep Supabase active` ruft einmal pro Woche die Funktion `ping()` auf. Dafür die Repository-Secrets `SUPABASE_URL` und `SUPABASE_ANON_KEY` setzen. Ist ein Projekt trotzdem pausiert, im Supabase-Dashboard „Restore“ wählen; Daten bleiben erhalten, und die App arbeitet bis dahin lokal weiter (Ereignisse bleiben auf dem Gerät und werden danach gesendet).

## 3. Google Sheets und Looker Studio

1. Neues Google Sheet anlegen (leer lassen, die Tabs und Kopfzeilen legt der Export selbst an).
2. In der Google Cloud Console (kostenlos) ein Projekt anlegen, die **Google Sheets API** aktivieren und ein **Dienstkonto** erstellen. Einen JSON-Schlüssel herunterladen.
3. Das Sheet mit der E-Mail-Adresse des Dienstkontos teilen (Rolle *Bearbeiter*).
4. Supabase-CLI installieren und die Funktion bereitstellen:
   ```
   npm run bundle:export
   supabase functions deploy export-sheets --no-verify-jwt
   supabase secrets set EXPORT_SECRET=<langer-zufallswert> GOOGLE_SHEET_ID=<id-aus-der-sheet-url> \
     GOOGLE_CLIENT_EMAIL=<dienstkonto-mail> GOOGLE_PRIVATE_KEY="<private_key aus der JSON-Datei>"
   ```
   (`--no-verify-jwt` ist nötig, weil die Funktion vom Datenbank-Cron mit einem eigenen Geheimnis aufgerufen wird.)
5. `supabase/setup-export-cron.sql` im SQL-Editor ausführen, vorher `<PROJECT_REF>` und `<EXPORT_SECRET>` ersetzen (nicht committen).
6. Fertig: Jede Minute prüft die Datenbank, ob neue Ereignisse vorliegen, und ruft nur dann den Export auf. Die App zeigt „Gesichert, Sheets folgt“, bis der Export aufgeholt hat. Den Stand siehst du auf der Spielseite.

### Tabellen im Sheet
`plays` (ein Spielzug pro Zeile, typisierte Werte, `voided` markiert stornierte Züge), `lineups` (ein Spieler pro Zeile und Spielzug), `scores` (Punkte-Ereignisse mit `scoring_team`), `games`, `players`, `comments`. Die letzten zwei Spalten jedes Tabs (`_key`, `_hash`) sind Hilfsspalten des Exports; **nicht ändern oder löschen**, sie verhindern Dubletten. Eigene Auswertungen in separaten Tabs oder in Looker Studio anlegen.

### Looker Studio
Neue Datenquelle → *Google Sheets* → das Sheet und je Tab eine Quelle hinzufügen. Empfohlene Verknüpfungen: `plays.event_id = lineups.event_id`, `plays.game_id = games.game_id`. Filter `voided = false` verwenden (oder die Tabs `lineups`/`scores`, die gestornte Züge nicht enthalten). Der Bericht kann per Link geteilt werden, ohne dass das Sheet freigegeben wird.

## 4. Altdaten übernehmen
Im alten Google Sheet die Tabs `offense`, `defense` und `comments` als CSV herunterladen. In der App unter *Import* auswählen, **Prüfen** drücken, den Bericht lesen (nicht zuordenbare Spielernummern müssen dem richtigen Spieler zugeordnet werden), dann **Import durchführen**. Der Import ist wiederholbar. Der Spielstand im Bericht folgt den neuen Regeln (Safety zählt 2 Punkte) und kann deshalb vom alten Ergebnis abweichen.

## 5. Sicherung und Fehlerfälle
- Das Statussymbol zeigt, ob alles gesichert ist: **Gesichert** = Browser darf geschlossen werden. **Wird gesendet / Offline / Fehler** = Browser offen lassen.
- Ohne Server-Verbindung: regelmäßig *Einstellungen → Backup herunterladen*. Safari löscht lokale Daten nach längerer Nichtnutzung, deshalb gilt in diesem Modus das Backup als einzige Sicherung.
- Passwörter gibt es nicht (Login per E-Mail-Link). Dienstkonto-Schlüssel und `EXPORT_SECRET` nie ins Repository legen.
