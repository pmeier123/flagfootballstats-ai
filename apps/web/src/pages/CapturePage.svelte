<script lang="ts">
  import { onMount } from 'svelte';
  import {
    applyChange, canRecord, clearedDraft, computeScore, effectiveComments, effectivePlays, emptyDraft, evaluateDraft,
    extraPointState, extraPointStateBefore, gameClock, periodLabel, playSentence, playSummary, pruneLineup,
    sortPlayers, toPlayData, undoTarget,
    type Draft, type GameEvent, type MarkerType, type Player, type TypistAssignment, type Unit, type Warning
  } from '@ffs/core';
  import { app, engine, lookupPlayer, ownTeam, refreshLists, store, teamName } from '../lib/app.svelte';
  import { href } from '../lib/router.svelte';
  import { occasionLabel } from '../lib/format';
  import Dialog from '../components/Dialog.svelte';
  import PlayForm from '../components/PlayForm.svelte';
  import SyncBadge from '../components/SyncBadge.svelte';

  let { gameId }: { gameId: string } = $props();

  let events = $state<GameEvent[]>([]);
  let rosterIds = $state<string[]>([]);
  let assignments = $state<TypistAssignment[]>([]);
  let unit = $state<Unit>('offense');
  let drafts = $state<Record<Unit, Draft>>({ offense: emptyDraft('offense'), defense: emptyDraft('defense') });
  let editing = $state<{ id: string; unit: Unit } | null>(null);
  let showErrors = $state(false);
  let warnings = $state<Warning[]>([]);
  let lineupOpen = $state(false);
  let toast = $state('');
  let commentText = $state('');
  let commentFor = $state<string | null>(null);
  let showAll = $state(false);

  let game = $derived(app.games.find((g) => g.id === gameId));
  let plays = $derived(effectivePlays(events));
  let score = $derived(computeScore(plays));
  let clock = $derived(gameClock(events));
  let xpState = $derived(editing ? extraPointStateBefore(plays, editing.id) : extraPointState(plays));
  let ctx = $derived({ xp: xpState.active, xpExpectedUnit: xpState.expectedUnit, roster: rosterIds });
  let draft = $derived(drafts[unit]);
  let evaluation = $derived(evaluateDraft($state.snapshot(draft) as Draft, ctx));
  let rosterPlayers = $derived(app.players.filter((p) => rosterIds.includes(p.id)));
  let lineupPlayers = $derived(evaluation.draft.lineup.map((id) => app.players.find((p) => p.id === id)).filter((p): p is Player => !!p));
  let permission = $derived(
    game && app.user ? canRecord({ game, userId: app.user.id, role: app.user.role, assignments }) : { ok: false, reason: 'Nicht angemeldet' }
  );
  let lastPlay = $derived(plays[plays.length - 1]);
  let comments = $derived(effectiveComments(events));
  let listed = $derived([...plays].reverse().slice(0, showAll ? plays.length : 8));
  let xpHint = $derived(
    xpState.active && xpState.expectedUnit
      ? xpState.expectedUnit === 'offense'
        ? 'Unser Team hat gepunktet: Extrapunkt in der Offense erfassen.'
        : 'Der Gegner hat gepunktet: Extrapunkt in der Defense erfassen.'
      : null
  );
  let ended = $derived(clock.ended);

  async function load() {
    events = await store.eventsOf(gameId);
    rosterIds = await store.rosterOf(gameId);
    assignments = await store.listTypists(gameId);
  }

  function carryOver(u: Unit): Partial<Draft> | null {
    const last = [...plays].reverse().find((p) => p.data.unit === u);
    if (!last) return null;
    const { lineup, removed } = pruneLineup(last.data.lineup, rosterIds);
    if (removed.length) toast = 'Einige Spieler sind nicht mehr im Spieltagskader und wurden aus der Aufstellung entfernt.';
    return { lineup, qb_id: last.data.qb_id, blitzer_ids: last.data.blitzer_ids };
  }

  function initDrafts() {
    for (const u of ['offense', 'defense'] as Unit[]) {
      if (drafts[u].lineup.length === 0) {
        const c = carryOver(u);
        if (c) drafts[u] = applyChange(emptyDraft(u), c, ctx);
      }
    }
  }

  onMount(() => {
    void (async () => {
      await load();
      initDrafts();
      engine.watchGame(gameId);
      void engine.pullGame(gameId).then(load);
    })();
    const poll = setInterval(() => void engine.pullGame(gameId).then(load), 15000);

    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (app.backendConfigured && app.sync.pending > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);

    let lock: { release(): Promise<void> } | null = null;
    const acquire = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
        if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
      } catch {
        /* not supported or denied */
      }
    };
    void acquire();
    const onVis = () => void acquire();
    document.addEventListener('visibilitychange', onVis);

    return () => {
      clearInterval(poll);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', onVis);
      engine.watchGame(null);
      void lock?.release();
    };
  });

  function showToast(msg: string) {
    toast = msg;
    setTimeout(() => { if (toast === msg) toast = ''; }, 3500);
  }

  function change(c: Partial<Draft>) {
    drafts[unit] = applyChange($state.snapshot(drafts[unit]) as Draft, c, ctx);
  }

  function nextTs(): number {
    const last = events.reduce((m, e) => Math.max(m, e.client_ts), 0);
    return Math.max(Date.now(), last + 1);
  }

  async function record(e: Omit<GameEvent, 'id' | 'game_id' | 'client_ts' | 'author_id'> & Record<string, unknown>) {
    const ev = { id: crypto.randomUUID(), game_id: gameId, client_ts: nextTs(), author_id: app.user && app.user.id !== 'local' ? app.user.id : null, ...e } as GameEvent;
    await store.recordEvent($state.snapshot(ev) as GameEvent);
    if (game?.status === 'planned' && app.user?.role === 'admin') {
      await store.setGameStatus(gameId, 'live', 'admin');
      await refreshLists();
    }
    await load();
    void engine.flush();
  }

  async function save(confirmed = false) {
    if (!permission.ok) return showToast(permission.reason ?? 'Keine Berechtigung');
    showErrors = true;
    const ev = evaluateDraft($state.snapshot(draft) as Draft, ctx);
    if (!ev.valid) {
      await Promise.resolve();
      document.querySelector('.err')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (ev.warnings.length && !confirmed) {
      warnings = ev.warnings;
      return;
    }
    warnings = [];
    const data = toPlayData(ev.draft, ctx);
    if (editing) await record({ kind: 'edit', replaces_id: editing.id, data });
    else await record({ kind: 'play', data });
    editing = null;
    showErrors = false;
    drafts[unit] = clearedDraft($state.snapshot(drafts[unit]) as Draft, ctx);
    showToast('Gespeichert');
  }

  function clearEvent() {
    editing = null;
    showErrors = false;
    drafts[unit] = clearedDraft($state.snapshot(drafts[unit]) as Draft, ctx);
  }

  async function undo() {
    if (!permission.ok) return showToast(permission.reason ?? 'Keine Berechtigung');
    const t = undoTarget(events);
    if (!t) return showToast('Nichts zum Rückgängigmachen');
    await record({ kind: 'void', voids_id: t.id });
    showToast(`Rückgängig: ${playSummary(t.data, lookupPlayer)}`);
  }

  async function voidPlay(id: string) {
    if (!permission.ok) return showToast(permission.reason ?? 'Keine Berechtigung');
    if (!confirm('Diesen Spielzug stornieren?')) return;
    await record({ kind: 'void', voids_id: id });
    if (editing?.id === id) clearEvent();
  }

  function editPlay(id: string) {
    const p = plays.find((x) => x.id === id);
    if (!p) return;
    const before = extraPointStateBefore(plays, id);
    editing = { id, unit: p.data.unit };
    unit = p.data.unit;
    const c = { xp: before.active, xpExpectedUnit: before.expectedUnit, roster: rosterIds };
    drafts[p.data.unit] = applyChange(emptyDraft(p.data.unit), $state.snapshot(p.data) as Partial<Draft>, c);
    showErrors = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function marker(m: MarkerType) {
    if (!permission.ok) return showToast(permission.reason ?? 'Keine Berechtigung');
    await record({ kind: 'marker', marker: m });
    showToast(MARKER_LABEL[m]);
  }

  async function addComment() {
    const text = commentText.trim();
    if (!text) return showToast('Kommentar ist leer');
    if (!permission.ok) return showToast(permission.reason ?? 'Keine Berechtigung');
    await record({ kind: 'comment', text, ...(commentFor ? { play_id: commentFor } : {}) });
    commentText = '';
    commentFor = null;
    showToast('Kommentar gespeichert');
  }

  const MARKER_LABEL: Record<MarkerType, string> = {
    quarter_start: 'Viertel-Beginn', quarter_end: 'Viertel-Ende', halftime: 'Halbzeit', drive_end: 'Drive-Ende', timeout: 'Timeout', game_end: 'Spielende'
  };
  const MARKERS: MarkerType[] = ['drive_end', 'timeout', 'quarter_end', 'halftime', 'quarter_start', 'game_end'];

  // lineup dialog
  let lineupDraft = $state<string[]>([]);
  function openLineup() {
    lineupDraft = [...evaluation.draft.lineup];
    lineupOpen = true;
  }
  function toggleLineup(id: string) {
    lineupDraft = lineupDraft.includes(id) ? lineupDraft.filter((x) => x !== id) : [...lineupDraft, id];
  }
  function applyLineup() {
    change({ lineup: lineupDraft });
    lineupOpen = false;
  }
  const sortKey = $derived(unit === 'offense' ? 'offense' : 'defense');
  let qbOptions = $derived(sortPlayers(lineupPlayers, 'qb'));
  let blitzOptions = $derived(sortPlayers(lineupPlayers, 'blitz'));
  let blitzers = $derived(evaluation.draft.blitzer_ids ?? []);

  const time = (ts: number) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const names = $derived({ own: ownTeam()?.name ?? 'Emperors', opp: game ? teamName(game.opponent_team_id) : 'Gegner' });
</script>

{#if !game}
  <div class="banner error">Spiel nicht gefunden. <a href={href('')}>Zur Übersicht</a></div>
{:else}
  <div class="stack">
    <div class="card">
      <div class="row between">
        <div class="small muted">{occasionLabel(game.occasion)} · {names.opp}</div>
        <SyncBadge />
      </div>
      <div class="row between" style="align-items:flex-end">
        <div>
          <div class="score" data-testid="score">{names.own.split(' ').at(-1)} {score.own} : {score.opp} {names.opp.split(' ').at(-1)}</div>
          <div class="small muted" data-testid="clock">
            {clock.halftime && clock.atBreak ? 'Halbzeit' : clock.ended ? 'Spielende' : periodLabel(clock.period)} · Drive {clock.drive}
          </div>
        </div>
        <div class="row">
          <a class="btn" href={href(`preview/${gameId}`)}>Ticker-Vorschau</a>
        </div>
      </div>
      <div class="small" style="margin-top:.4rem" data-testid="sync-message">{app.sync.message}</div>
    </div>

    {#if ended}
      <div class="banner {app.sync.pending === 0 ? 'ok' : 'warn'}" data-testid="end-banner">
        {#if app.sync.pending === 0 && app.backendConfigured}Alles gesichert.
        {:else if app.backendConfigured}Noch {app.sync.pending} Ereignisse offen – bitte online bleiben.
        {:else}Spielende erfasst. Daten liegen nur auf diesem Gerät – bitte exportieren.{/if}
      </div>
    {/if}

    {#if !permission.ok}
      <div class="banner warn">{permission.reason}</div>
    {/if}
    {#if rosterIds.length === 0}
      <div class="banner warn">Für dieses Spiel ist noch kein Spieltagskader festgelegt. <a href={href(`game/${gameId}`)}>Kader festlegen</a></div>
    {/if}

    <div class="card">
      <div class="row between">
        <div class="seg {unit}" role="group" aria-label="Einheit">
          <button type="button" aria-pressed={unit === 'offense'} data-testid="unit-offense" onclick={() => (unit = 'offense')}>Offense</button>
          <button type="button" aria-pressed={unit === 'defense'} data-testid="unit-defense" onclick={() => (unit = 'defense')}>Defense</button>
        </div>
        <button type="button" onclick={undo} data-testid="undo">↶ Rückgängig</button>
      </div>

      {#if editing}
        <div class="banner warn" style="margin-top:.6rem">
          Du bearbeitest einen früheren Spielzug.
          <button type="button" class="small" onclick={clearEvent}>Abbrechen</button>
        </div>
      {/if}

      <div class="field-title">Spieler auf dem Feld {evaluation.draft.lineup.length ? `(${evaluation.draft.lineup.length})` : ''}</div>
      <div class="chips" data-testid="lineup">
        {#each lineupPlayers as p (p.id)}<span class="chip on">#{p.number} {p.name}</span>{/each}
        <button type="button" class="chip" onclick={openLineup} data-testid="lineup-edit">{lineupPlayers.length ? 'Wechsel' : 'Aufstellung wählen'}</button>
      </div>
      {#if showErrors && evaluation.errors.lineup}<div class="err" role="alert">{evaluation.errors.lineup}</div>{/if}

      {#if unit === 'offense'}
        <div class="field-title"><span>Quarterback</span><span class="req">*</span></div>
        <div class="chips">
          {#each qbOptions as p (p.id)}
            <button type="button" class="chip" aria-pressed={evaluation.draft.qb_id === p.id} data-testid="qb-{p.number}" onclick={() => change({ qb_id: p.id })}>#{p.number} {p.name}</button>
          {/each}
        </div>
        {#if showErrors && evaluation.errors.qb_id}<div class="err" role="alert">{evaluation.errors.qb_id}</div>{/if}
      {:else}
        <div class="field-title">Blitzer (optional)</div>
        <div class="chips">
          {#each blitzOptions as p (p.id)}
            <button type="button" class="chip" aria-pressed={blitzers.includes(p.id)} data-testid="blitz-{p.number}"
              onclick={() => change({ blitzer_ids: blitzers.includes(p.id) ? blitzers.filter((x) => x !== p.id) : [...blitzers, p.id] })}>#{p.number} {p.name}</button>
          {/each}
        </div>
      {/if}

      <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0" />

      <PlayForm {unit} {evaluation} {lineupPlayers} xp={ctx.xp} {xpHint} {showErrors} onchange={change} />

      <div class="row" style="margin-top:1.25rem">
        <button type="button" class="primary" style="min-width:9rem" onclick={() => save()} data-testid="save">{editing ? 'Änderung speichern' : 'Save Event'}</button>
        <button type="button" class="danger" onclick={clearEvent} data-testid="clear">Clear Event</button>
      </div>
    </div>

    <div class="card">
      <div class="small muted">Zuletzt gespeichert</div>
      <div data-testid="last-event">{lastPlay ? playSummary(lastPlay.data, lookupPlayer) : '–'}</div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Spielstand-Marker</h3>
      <div class="chips">
        {#each MARKERS as m (m)}<button type="button" class="chip" data-testid="marker-{m}" onclick={() => marker(m)}>{MARKER_LABEL[m]}</button>{/each}
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Kommentar</h3>
      {#if commentFor}
        {@const target = plays.find((p) => p.id === commentFor)}
        <div class="small muted">Zu: {target ? playSummary(target.data, lookupPlayer) : 'Spielzug'} <button type="button" class="small" onclick={() => (commentFor = null)}>×</button></div>
      {/if}
      <div class="row">
        <input class="grow" placeholder="z. B. ToD vergessen" bind:value={commentText} data-testid="comment-input" />
        <button type="button" onclick={addComment} data-testid="comment-save">Save comment</button>
      </div>
      {#each comments.slice(-3).reverse() as c (c.id)}
        <div class="small muted">{time(c.client_ts)} · {c.text}</div>
      {/each}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Spielzüge</h3>
      {#each listed as p (p.id)}
        <div class="event-row" data-testid="play-row">
          <div class="row between">
            <span class="small muted">{time(p.client_ts)} · {periodLabel(p.period)} · <span class="tag {p.data.unit}">{p.data.unit === 'offense' ? 'O' : 'D'}</span>{#if p.corrected} · korrigiert{/if}</span>
            <span class="row">
              <button type="button" class="small" onclick={() => editPlay(p.id)}>Bearbeiten</button>
              <button type="button" class="small" onclick={() => { commentFor = p.id; }}>Kommentar</button>
              <button type="button" class="small danger" onclick={() => voidPlay(p.id)}>Stornieren</button>
            </span>
          </div>
          <div>{playSentence(p.data, lookupPlayer, names)}</div>
        </div>
      {:else}
        <p class="muted">Noch keine Spielzüge.</p>
      {/each}
      {#if plays.length > 8 && !showAll}<button type="button" class="small" onclick={() => (showAll = true)}>Alle {plays.length} anzeigen</button>{/if}
    </div>
  </div>

  {#if lineupOpen}
    <Dialog title="Spieler auf dem Feld" onclose={() => (lineupOpen = false)}>
      <p class="small muted">Meist 5 Spieler. Sortierung nach Priorität ({unit === 'offense' ? 'Offense' : 'Defense'}).</p>
      <div class="chips">
        {#each sortPlayers(rosterPlayers, sortKey) as p (p.id)}
          <button type="button" class="chip" aria-pressed={lineupDraft.includes(p.id)} data-testid="lineup-{p.number}" onclick={() => toggleLineup(p.id)}>#{p.number} {p.name}</button>
        {/each}
      </div>
      <p class:err={lineupDraft.length !== 5}>{lineupDraft.length} ausgewählt{lineupDraft.length !== 5 ? ' (üblich: 5)' : ''}</p>
      <div class="row">
        <button type="button" class="primary" onclick={applyLineup} data-testid="lineup-ok">Übernehmen</button>
        <button type="button" onclick={() => (lineupOpen = false)}>Abbrechen</button>
      </div>
    </Dialog>
  {/if}

  {#if warnings.length}
    <Dialog title="Bitte bestätigen" onclose={() => (warnings = [])}>
      <ul data-testid="warnings">{#each warnings as w (w.code)}<li>{w.message}</li>{/each}</ul>
      <div class="row">
        <button type="button" class="primary" onclick={() => save(true)} data-testid="confirm-save">Trotzdem speichern</button>
        <button type="button" onclick={() => (warnings = [])}>Zurück</button>
      </div>
    </Dialog>
  {/if}

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
{/if}
