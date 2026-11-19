<script lang="ts">
  import { buildLegacyImport, parseCsv, sortPlayers, type CsvRow, type ImportReport, type LegacyBundle } from '@ffs/core';
  import { app, refreshLists, store, syncNow } from '../lib/app.svelte';

  let offense = $state<CsvRow[]>([]);
  let defense = $state<CsvRow[]>([]);
  let comments = $state<CsvRow[]>([]);
  let names = $state({ offense: '', defense: '', comments: '' });
  let mapping = $state<Record<string, string>>({});
  let result = $state<{ report: ImportReport; bundle: LegacyBundle } | null>(null);
  let done = $state('');

  async function pick(kind: 'offense' | 'defense' | 'comments', e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (kind === 'offense') offense = rows;
    else if (kind === 'defense') defense = rows;
    else comments = rows;
    names[kind] = `${file.name} (${rows.length} Zeilen)`;
    result = null;
  }

  function dryRun() {
    done = '';
    const numberMap: Record<string, string | null> = {};
    for (const [num, v] of Object.entries(mapping)) if (v) numberMap[num] = v === '__drop' ? null : v;
    result = buildLegacyImport({
      offense, defense, comments, players: app.players, existingTeams: app.teams, existingGames: app.games, numberMap
    });
  }

  async function apply() {
    if (!result?.report.canImport) return;
    await store.applyBundle(result.bundle);
    await refreshLists();
    void syncNow();
    done = `${result.report.counts.plays} Spielzüge und ${result.report.counts.comments} Kommentare in ${result.report.counts.games} Spielen importiert.`;
    result = null;
  }
  let hasInput = $derived(offense.length + defense.length + comments.length > 0);
</script>

<h1>Altdaten importieren</h1>
<p class="muted">
  Exportiere die Tabellenblätter <code>offense</code>, <code>defense</code> und <code>comments</code> des alten Google Sheets als CSV und wähle sie hier aus.
  Es wird erst nach der Prüfung gespeichert; ein erneuter Import erzeugt keine Dubletten.
</p>

{#if done}<div class="banner ok" role="status">{done}</div>{/if}

<div class="card stack">
  <label class="field"><span>offense.csv {names.offense}</span><input type="file" accept=".csv,text/csv" onchange={(e) => pick('offense', e)} data-testid="imp-offense" /></label>
  <label class="field"><span>defense.csv {names.defense}</span><input type="file" accept=".csv,text/csv" onchange={(e) => pick('defense', e)} data-testid="imp-defense" /></label>
  <label class="field"><span>comments.csv (optional) {names.comments}</span><input type="file" accept=".csv,text/csv" onchange={(e) => pick('comments', e)} /></label>
  <button type="button" class="primary" disabled={!hasInput || app.players.length === 0} onclick={dryRun} data-testid="imp-dry">Prüfen (nichts wird gespeichert)</button>
  {#if app.players.length === 0}<div class="err">Lege zuerst die Spieler an (Nummern müssen zu den Altdaten passen).</div>{/if}
</div>

{#if result}
  {@const r = result.report}
  <div class="card" data-testid="imp-report">
    <h2 style="margin-top:0">Prüfbericht</h2>
    <p>{r.counts.plays} Spielzüge, {r.counts.comments} Kommentare, {r.counts.games} Spiele, {r.counts.newTeams} neue Teams.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Spiel</th><th>Anlass</th><th>Spielzüge</th><th>Spielstand (neue Regeln)</th></tr></thead>
        <tbody>{#each r.games as g (g.id)}<tr><td>{g.opponent}</td><td>{g.occasion}</td><td>{g.plays}</td><td>{g.own} : {g.opp}</td></tr>{/each}</tbody>
      </table>
    </div>
    <p class="small muted">Der Spielstand folgt den neuen Regeln (inkl. Safety). Bitte mit dem alten Ergebnis vergleichen.</p>

    {#if r.unresolvedRefs.length}
      <h3>Nicht zuordenbare Spielernummern (blockiert den Import)</h3>
      {#each r.unresolvedRefs as u (u.ref)}
        <div class="row" style="margin:.3rem 0">
          <span style="min-width:12rem">Nr. {u.ref} ({u.reason === 'unknown' ? 'unbekannt' : 'mehrdeutig'}, {u.count}×)</span>
          <select bind:value={mapping[u.ref]} onchange={dryRun}>
            <option value="">– entscheiden –</option>
            <option value="__drop">Verweis weglassen</option>
            {#each sortPlayers(app.players) as p (p.id)}<option value={p.id}>#{p.number} {p.name}{p.active ? '' : ' (inaktiv)'}</option>{/each}
          </select>
        </div>
      {/each}
    {/if}
    {#if r.unmappedValues.length}
      <h3>Unbekannte Werte (werden nicht übernommen)</h3>
      <ul>{#each r.unmappedValues as u (u.column + u.value)}<li>{u.column}: „{u.value}“ ({u.count}×)</li>{/each}</ul>
    {/if}
    {#if r.droppedValues.length}
      <h3>Werte, die nach den neuen Regeln nicht gelten</h3>
      <p class="small muted">Diese Angaben standen in den Altdaten, sind für den jeweiligen Spielzug aber nicht vorgesehen und werden weggelassen.</p>
      <ul>{#each r.droppedValues as d (d.field)}<li>{d.field}: {d.count}×</li>{/each}</ul>
    {/if}
    {#if r.skippedRows.length}
      <h3>Übersprungene Zeilen</h3>
      <ul>{#each r.skippedRows.slice(0, 30) as s (s.sheet + s.row)}<li>{s.sheet} Zeile {s.row + 2}: {s.reason}</li>{/each}</ul>
    {/if}
    {#if r.unassignedComments.length}
      <h3>Kommentare ohne passendes Spiel</h3>
      <ul>{#each r.unassignedComments as c (c.row)}<li>{c.text}</li>{/each}</ul>
    {/if}
    {#if r.pseudoOpponents.length}
      <div class="banner warn">„{r.pseudoOpponents.join('“, „')}“ wirken nicht wie echte Gegner. Sie werden als Team angelegt und können später umbenannt werden.</div>
    {/if}
    {#if r.ambiguousOrderMinutes}
      <div class="banner">In {r.ambiguousOrderMinutes} Minuten gibt es Offense- und Defense-Einträge. Ihre Reihenfolge innerhalb der Minute ist in den Altdaten nicht bekannt (Offense zuerst).</div>
    {/if}
    {#if r.typists.length}<p class="small muted">Erfasser in den Altdaten: {r.typists.join(', ')}</p>{/if}

    <div class="row" style="margin-top:1rem">
      <button type="button" class="primary" disabled={!r.canImport} onclick={apply} data-testid="imp-apply">Import durchführen</button>
      {#if !r.canImport}<span class="err">Erst die Nummern oben zuordnen.</span>{/if}
    </div>
  </div>
{/if}
