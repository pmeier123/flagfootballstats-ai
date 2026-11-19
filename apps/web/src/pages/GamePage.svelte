<script lang="ts">
  import qrcode from 'qrcode-generator';
  import {
    buildGameTables, canTransition, effectivePlays, evaluateDraft, finishWarnings, handover, headerRow, sortPlayers, toCsv,
    type Draft, type GameStatus, type TypistAssignment
  } from '@ffs/core';
  import { listAppUsers, ValidationError, type AppUser } from '@ffs/data';
  import { app, backend, refreshLists, store, supabase, syncNow, teamName } from '../lib/app.svelte';
  import { dateLabel, download, OCCASIONS, STATUS_LABEL, tickerUrl } from '../lib/format';
  import { href } from '../lib/router.svelte';
  import Dialog from '../components/Dialog.svelte';

  let { gameId }: { gameId: string } = $props();

  let game = $derived(app.games.find((g) => g.id === gameId));
  let roster = $state<string[]>([]);
  let assignments = $state<TypistAssignment[]>([]);
  let users = $state<AppUser[]>([]);
  let message = $state('');
  let errors = $state<Record<string, string>>({});
  let finishDialog = $state<ReturnType<typeof finishWarnings> | null>(null);
  let sheetsInfo = $state<string>('');

  let form = $state({ opponent: '', date: '', occasion: 'dffl_game' as (typeof OCCASIONS)[number]['value'], venue: '' });
  let formLoaded = false;

  async function load() {
    roster = await store.rosterOf(gameId);
    assignments = await store.listTypists(gameId);
    if (!formLoaded && game) {
      form = { opponent: teamName(game.opponent_team_id), date: game.date, occasion: game.occasion, venue: game.venue ?? '' };
      formLoaded = true;
    }
    if (app.backendConfigured && app.user?.role === 'admin' && supabase) {
      try { users = (await listAppUsers(supabase)).filter((u) => u.role === 'typist' || u.role === 'admin'); } catch { /* offline */ }
    }
    if (backend) {
      try {
        const st = await backend.exportStatus(gameId);
        sheetsInfo = st
          ? `Google Sheets: bis Ereignis ${st.last_seq} exportiert${st.last_run ? `, letzter Lauf ${new Date(st.last_run).toLocaleString('de-DE')}` : ''}${st.last_error ? `. Fehler: ${st.last_error}` : ''}`
          : 'Google-Sheets-Export ist nicht eingerichtet.';
      } catch { sheetsInfo = ''; }
    }
  }
  $effect(() => { void game?.id; void load(); });

  let activeTypist = $derived(assignments.find((a) => a.to_ts === null));
  let allPlayers = $derived(sortPlayers(app.players.filter((p) => p.active || roster.includes(p.id))));
  let url = $derived(game ? tickerUrl(game.ticker_token) : '');
  let qr = $derived.by(() => {
    if (!url) return '';
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  });

  async function saveDetails() {
    errors = {};
    try {
      const team = form.opponent.trim() ? await store.saveTeam(form.opponent) : undefined;
      await store.saveGame({ id: gameId, opponent_team_id: team?.id ?? '', date: form.date, occasion: form.occasion, venue: form.venue });
      await refreshLists();
      message = 'Gespeichert.';
      void syncNow();
    } catch (e) {
      errors = e instanceof ValidationError ? e.errors : { opponent_team_id: String(e) };
    }
  }

  async function toggleRoster(id: string) {
    const next = roster.includes(id) ? roster.filter((x) => x !== id) : [...roster, id];
    await store.setRoster(gameId, next);
    roster = next;
    void syncNow();
  }
  async function rosterAll(all: boolean) {
    const next = all ? app.players.filter((p) => p.active).map((p) => p.id) : [];
    await store.setRoster(gameId, next);
    roster = next;
    void syncNow();
  }

  async function status(to: GameStatus, confirmed = false) {
    if (!game) return;
    if (to === 'finished' && !confirmed) {
      const events = await store.eventsOf(gameId);
      const without = effectivePlays(events).filter((p) => {
        if (p.data.xp_result) return false;
        return evaluateDraft(p.data as Draft, { xp: false }).warnings.some((w) => w.code === 'no_result');
      }).length;
      finishDialog = finishWarnings(events, without, await store.countPending(gameId));
      if (!finishDialog.hasWarnings) { finishDialog = null; return status(to, true); }
      return;
    }
    finishDialog = null;
    try {
      await store.setGameStatus(gameId, to, 'admin');
      await refreshLists();
      void syncNow();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
  }

  async function assign(userId: string) {
    if (!userId) return;
    const rows = handover(assignments, gameId, userId, Date.now(), crypto.randomUUID());
    if (!rows.length) return;
    await store.saveTypists(rows);
    assignments = await store.listTypists(gameId);
    void syncNow();
    message = 'Typist zugewiesen. Das bisherige Gerät sollte vorher „Gesichert“ anzeigen.';
  }

  async function regenerate() {
    if (!confirm('Der bisherige Ticker-Link wird ungültig. Fortfahren?')) return;
    await store.regenerateToken(gameId);
    await refreshLists();
    void syncNow();
  }

  async function copy() {
    try { await navigator.clipboard.writeText(url); message = 'Link kopiert.'; } catch { message = url; }
  }

  async function exportGame(kind: 'csv' | 'json') {
    if (!game) return;
    const events = await store.eventsOf(gameId);
    if (kind === 'json') return download(`spiel-${game.date}.json`, JSON.stringify({ game, events }, null, 2), 'application/json');
    const t = buildGameTables({ game, opponentName: teamName(game.opponent_team_id), events, players: app.players });
    download(`spiel-${game.date}-plays.csv`, toCsv(headerRow('plays'), t.plays), 'text/csv');
  }

  const userName = (id: string) => users.find((u) => u.id === id)?.display_name ?? users.find((u) => u.id === id)?.email ?? id;
</script>

{#if !game}
  <div class="banner error">Spiel nicht gefunden. <a href={href('')}>Zur Übersicht</a></div>
{:else}
  <div class="row between">
    <h1>{teamName(game.opponent_team_id)} · {dateLabel(game.date)}</h1>
    <span class="tag" data-testid="game-status">{STATUS_LABEL[game.status]}</span>
  </div>
  {#if message}<div class="banner" role="status" style="margin-bottom:.75rem">{message}</div>{/if}

  <div class="row" style="margin-bottom:1rem">
    <a class="btn primary" href={href(`capture/${gameId}`)}>Zur Erfassung</a>
    <a class="btn" href={href(`preview/${gameId}`)}>Ticker-Vorschau</a>
    {#if canTransition(game.status, 'live', 'admin')}<button type="button" onclick={() => status('live')} data-testid="start-game">{game.status === 'finished' ? 'Wieder öffnen' : 'Spiel starten'}</button>{/if}
    {#if canTransition(game.status, 'finished', 'admin')}<button type="button" onclick={() => status('finished')} data-testid="finish-game">Spiel beenden</button>{/if}
  </div>

  <div class="card">
    <h2 style="margin-top:0">Spieldaten</h2>
    <div class="row">
      <label class="field grow"><span>Gegner</span>
        <input list="opp" bind:value={form.opponent} /><datalist id="opp">{#each app.teams.filter((t) => !t.is_own) as t (t.id)}<option value={t.name}></option>{/each}</datalist>
        {#if errors.opponent_team_id}<div class="err">{errors.opponent_team_id}</div>{/if}
      </label>
      <label class="field"><span>Datum</span><input type="date" bind:value={form.date} />{#if errors.date}<div class="err">{errors.date}</div>{/if}</label>
      <label class="field"><span>Anlass</span><select bind:value={form.occasion}>{#each OCCASIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}</select></label>
      <label class="field"><span>Ort</span><input bind:value={form.venue} /></label>
    </div>
    <button type="button" onclick={saveDetails}>Speichern</button>
  </div>

  <div class="card">
    <div class="row between">
      <h2 style="margin:0">Spieltagskader ({roster.length})</h2>
      <span class="row"><button type="button" class="small" onclick={() => rosterAll(true)}>Alle aktiven</button><button type="button" class="small" onclick={() => rosterAll(false)}>Keine</button></span>
    </div>
    <p class="small muted">Nur diese Spieler stehen bei der Erfassung zur Auswahl.</p>
    <div class="chips">
      {#each allPlayers as p (p.id)}
        <button type="button" class="chip" class:off={!p.active} aria-pressed={roster.includes(p.id)} data-testid="roster-{p.number}" onclick={() => toggleRoster(p.id)}>#{p.number} {p.name}</button>
      {/each}
    </div>
  </div>

  <div class="card">
    <h2 style="margin-top:0">Typist</h2>
    {#if app.backendConfigured}
      <p>Aktiver Typist: <b>{activeTypist ? userName(activeTypist.user_id) : 'niemand'}</b></p>
      <label class="field"><span>Typist zuweisen / Übergabe</span>
        <select onchange={(e) => assign((e.currentTarget as HTMLSelectElement).value)}>
          <option value="">– auswählen –</option>
          {#each users as u (u.id)}<option value={u.id}>{u.display_name ?? u.email} ({u.role})</option>{/each}
        </select>
      </label>
      <p class="small muted">Bei einer Übergabe zuerst am bisherigen Gerät warten, bis „Gesichert“ angezeigt wird.</p>
    {:else}
      <p class="muted">Lokaler Modus: Du erfasst als Admin auf diesem Gerät.</p>
    {/if}
  </div>

  <div class="card">
    <h2 style="margin-top:0">Live-Ticker-Link</h2>
    {#if app.backendConfigured}
      <div class="row"><input class="grow" readonly value={url} aria-label="Ticker-Link" data-testid="ticker-url" /><button type="button" onclick={copy}>Kopieren</button></div>
      <div style="max-width:200px;margin:.75rem 0">{@html qr}</div>
      <button type="button" class="danger small" onclick={regenerate}>Link zurücksetzen</button>
      <p class="small muted">Wer den Link hat, sieht alle Details des Spiels. Beim Zurücksetzen wird der alte Link ungültig.</p>
    {:else}
      <p class="muted">Der öffentliche Ticker braucht die Server-Verbindung (siehe Einrichtungsanleitung). Die lokale Vorschau funktioniert immer.</p>
    {/if}
  </div>

  <div class="card">
    <h2 style="margin-top:0">Export</h2>
    <div class="row"><button type="button" onclick={() => exportGame('csv')}>Spielzüge als CSV</button><button type="button" onclick={() => exportGame('json')}>Spiel als JSON</button></div>
    {#if sheetsInfo}<p class="small muted">{sheetsInfo}</p>{/if}
  </div>

  {#if finishDialog}
    <Dialog title="Spiel beenden?" onclose={() => (finishDialog = null)}>
      <ul>
        {#if finishDialog.missingGameEnd}<li>Es wurde kein Spielende-Marker erfasst.</li>{/if}
        {#if finishDialog.playsWithoutResult}<li>{finishDialog.playsWithoutResult} Spielzüge ohne Ergebnis.</li>{/if}
        {#if finishDialog.unsyncedEvents}<li>{finishDialog.unsyncedEvents} Ereignisse sind noch nicht auf dem Server bestätigt.</li>{/if}
      </ul>
      <div class="row">
        <button type="button" class="primary" onclick={() => status('finished', true)} data-testid="confirm-finish">Trotzdem beenden</button>
        <button type="button" onclick={() => (finishDialog = null)}>Abbrechen</button>
      </div>
    </Dialog>
  {/if}
{/if}
