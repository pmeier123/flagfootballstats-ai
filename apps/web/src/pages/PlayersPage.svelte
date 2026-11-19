<script lang="ts">
  import { parsePlayersCsv, sortPlayers, toCsv, validatePlayer, type Player, type PlayerCsvResult } from '@ffs/core';
  import { ValidationError } from '@ffs/data';
  import { app, refreshLists, store, syncNow } from '../lib/app.svelte';
  import { download } from '../lib/format';
  import Dialog from '../components/Dialog.svelte';

  let search = $state('');
  let showInactive = $state(true);
  let selected = $state<string[]>([]);
  let message = $state('');
  let editing = $state<{ id?: string; number: string; name: string; active: boolean; offense_prio: number; defense_prio: number; qb_prio: number; blitz_prio: number } | null>(null);
  let formErrors = $state<Record<string, string>>({});
  let csv = $state<PlayerCsvResult | null>(null);

  let list = $derived(
    sortPlayers(app.players).filter(
      (p) => (showInactive || p.active) && `${p.number} ${p.name}`.toLowerCase().includes(search.trim().toLowerCase())
    )
  );
  const prios = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  function blank() {
    return { number: '', name: '', active: true, offense_prio: 9, defense_prio: 9, qb_prio: 9, blitz_prio: 9 };
  }
  function open(p?: Player) {
    formErrors = {};
    editing = p ? { ...p } : blank();
  }

  async function save() {
    if (!editing) return;
    const probe = { id: editing.id ?? '', ...editing };
    formErrors = validatePlayer(probe as Player, app.players);
    if (Object.keys(formErrors).length) return;
    try {
      await store.savePlayer({ ...editing });
      editing = null;
      await refreshLists();
      void syncNow();
    } catch (e) {
      if (e instanceof ValidationError) formErrors = e.errors;
      else message = e instanceof Error ? e.message : String(e);
    }
  }

  async function bulk(active: boolean) {
    try {
      await store.setPlayersActive(selected, active);
      selected = [];
      await refreshLists();
      void syncNow();
    } catch (e) {
      message = e instanceof ValidationError ? Object.values(e.errors).join(' ') : String(e);
    }
  }

  async function remove(p: Player) {
    if (!confirm(`${p.name} wirklich löschen?`)) return;
    try {
      await store.deletePlayer(p.id);
      await refreshLists();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
  }

  async function pickCsv(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    csv = parsePlayersCsv(await file.text(), app.players);
  }

  async function confirmCsv() {
    if (!csv) return;
    for (const p of csv.valid) await store.savePlayer({ ...p });
    message = `${csv.valid.length} Spieler importiert.`;
    csv = null;
    await refreshLists();
    void syncNow();
  }

  function exportCsv() {
    download(
      'spieler.csv',
      toCsv(['number', 'name', 'offense_order', 'defense_order', 'qb_order', 'blitz_order', 'active'],
        sortPlayers(app.players).map((p) => [p.number, p.name, p.offense_prio, p.defense_prio, p.qb_prio, p.blitz_prio, p.active])),
      'text/csv'
    );
  }

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }
</script>

<h1>Spieler</h1>
<p class="muted small">Prioritäten: 1 = höchste Priorität, 9 = nicht vorgesehen. Sie steuern nur die Sortierung der Auswahllisten.</p>

{#if message}<div class="banner" role="status" style="margin-bottom:.75rem">{message}</div>{/if}

<div class="row" style="margin-bottom:.75rem">
  <button type="button" class="primary" onclick={() => open()} data-testid="player-add">Spieler hinzufügen</button>
  <label class="btn" style="display:inline-flex;align-items:center">CSV importieren<input type="file" accept=".csv,text/csv" hidden onchange={pickCsv} data-testid="csv-input" /></label>
  <button type="button" onclick={exportCsv}>CSV exportieren</button>
  <input type="search" placeholder="Suchen …" bind:value={search} aria-label="Suchen" />
  <label class="row"><input type="checkbox" bind:checked={showInactive} /> Inaktive anzeigen</label>
</div>

{#if selected.length}
  <div class="banner row" style="margin-bottom:.75rem">
    <b>{selected.length} ausgewählt</b>
    <button type="button" onclick={() => bulk(false)}>Deaktivieren</button>
    <button type="button" onclick={() => bulk(true)}>Aktivieren</button>
    <button type="button" onclick={() => (selected = [])}>Auswahl aufheben</button>
  </div>
{/if}

<div class="card table-wrap">
  <table>
    <thead>
      <tr><th></th><th>Nr</th><th>Name</th><th title="Offense">Off</th><th title="Defense">Def</th><th title="Quarterback">QB</th><th title="Blitz">Blz</th><th>Status</th><th></th></tr>
    </thead>
    <tbody>
      {#each list as p (p.id)}
        <tr class:muted={!p.active} data-testid="player-row">
          <td><input type="checkbox" checked={selected.includes(p.id)} onchange={() => toggle(p.id)} aria-label="{p.name} auswählen" /></td>
          <td>{p.number}</td><td>{p.name}</td>
          <td>{p.offense_prio}</td><td>{p.defense_prio}</td><td>{p.qb_prio}</td><td>{p.blitz_prio}</td>
          <td>{p.active ? 'aktiv' : 'inaktiv'}</td>
          <td class="row"><button type="button" class="small" onclick={() => open(p)}>Bearbeiten</button><button type="button" class="small danger" onclick={() => remove(p)}>Löschen</button></td>
        </tr>
      {:else}
        <tr><td colspan="9" class="muted">Keine Spieler.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

{#if editing}
  <Dialog title={editing.id ? 'Spieler bearbeiten' : 'Spieler hinzufügen'} onclose={() => (editing = null)}>
    <label class="field"><span>Nummer (z. B. 97 oder 2V)</span><input bind:value={editing.number} data-testid="f-number" />{#if formErrors.number}<div class="err">{formErrors.number}</div>{/if}</label>
    <label class="field"><span>Name</span><input bind:value={editing.name} data-testid="f-name" />{#if formErrors.name}<div class="err">{formErrors.name}</div>{/if}</label>
    <div class="row">
      {#each [['offense_prio', 'Offense'], ['defense_prio', 'Defense'], ['qb_prio', 'QB'], ['blitz_prio', 'Blitz']] as [key, label] (key)}
        <label class="field grow"><span>{label}</span>
          <select bind:value={editing[key as 'offense_prio']}>{#each prios as n (n)}<option value={n}>{n}</option>{/each}</select>
          {#if formErrors[key as string]}<div class="err">{formErrors[key as string]}</div>{/if}
        </label>
      {/each}
    </div>
    <label class="row"><input type="checkbox" bind:checked={editing.active} /> Aktiv</label>
    <div class="row" style="margin-top:1rem">
      <button type="button" class="primary" onclick={save} data-testid="f-save">Speichern</button>
      <button type="button" onclick={() => (editing = null)}>Abbrechen</button>
    </div>
  </Dialog>
{/if}

{#if csv}
  <Dialog title="CSV-Import prüfen" onclose={() => (csv = null)}>
    <p><b>{csv.valid.length}</b> Zeilen können importiert werden, <b>{csv.invalid.length}</b> sind fehlerhaft. Es wird erst nach Bestätigung gespeichert.</p>
    {#if csv.invalid.length}
      <ul class="err">{#each csv.invalid as i (i.row)}<li>Zeile {i.row}: {i.reason}</li>{/each}</ul>
    {/if}
    {#if csv.valid.length}<div class="small muted">{csv.valid.map((p) => `#${p.number} ${p.name}`).join(', ')}</div>{/if}
    <div class="row" style="margin-top:1rem">
      <button type="button" class="primary" disabled={!csv.valid.length} onclick={confirmCsv} data-testid="csv-confirm">{csv.valid.length} importieren</button>
      <button type="button" onclick={() => (csv = null)}>Abbrechen</button>
    </div>
  </Dialog>
{/if}
