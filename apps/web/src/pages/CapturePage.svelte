<script lang="ts">
  import { onMount } from 'svelte';
  import {
    applyChange, canRecord, clearedDraft, computeScore, effectiveComments, effectivePlays, emptyDraft, evaluateDraft,
    extraPointState, extraPointStateBefore, gameClock, playSentence, playSummary, pruneLineup,
    sortPlayers, toPlayData, undoTarget,
    type Draft, type GameEvent, type Player, type TypistAssignment, type Unit, type Warning
  } from '@ffs/core';
  import { app, engine, lookupPlayer, ownTeam, refreshLists, store, teamName } from '../lib/app.svelte';
  import { href } from '../lib/router.svelte';
  import { playFieldLabel } from '../lib/format';
  import Dialog from '../components/Dialog.svelte';
  import PlayForm from '../components/PlayForm.svelte';
  import PlayerMulti from '../components/PlayerMulti.svelte';
  import PlayerSelect from '../components/PlayerSelect.svelte';

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
  let toastTop = $state(false);
  let commentText = $state('');
  let commentFor = $state<string | null>(null);
  let showAll = $state(false);
  const RECENT = 5;

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
    game && app.user ? canRecord({ game, userId: app.user.id, role: app.user.role, assignments }) : { ok: false, reason: 'Not signed in' }
  );
  let comments = $derived(effectiveComments(events));
  let listed = $derived([...plays].reverse().slice(0, showAll ? plays.length : RECENT));
  let xpHint = $derived(
    xpState.active && xpState.expectedUnit
      ? xpState.expectedUnit === 'offense'
        ? 'Our team scored: record the extra point on offense.'
        : 'The opponent scored: record the extra point on defense.'
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
    if (removed.length) toast = 'Some players are no longer on the game day roster and were removed from the lineup.';
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

  function showToast(msg: string, top = false) {
    toast = msg;
    toastTop = top;
    setTimeout(() => { if (toast === msg) toast = ''; }, top ? 4500 : 3500);
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
    if (!permission.ok) return showToast(permission.reason ?? 'No permission');
    showErrors = true;
    const ev = evaluateDraft($state.snapshot(draft) as Draft, ctx);
    if (!ev.valid) {
      const missing = [
        ...(ev.errors.lineup ? ['Players on field'] : []),
        ...(ev.errors.qb_id ? ['Quarterback'] : []),
        ...ev.fields.filter((f) => f.error).map((f) => playFieldLabel(f.field))
      ];
      showToast(`Please fill in: ${missing.join(', ')}`, true);
      return;
    }
    // A missing result is allowed for now; a play evaluation will decide later when one is required.
    const confirmable = ev.warnings.filter((w) => w.code !== 'no_result');
    if (confirmable.length && !confirmed) {
      warnings = confirmable;
      return;
    }
    warnings = [];
    const data = toPlayData(ev.draft, ctx);
    if (editing) await record({ kind: 'edit', replaces_id: editing.id, data });
    else await record({ kind: 'play', data });
    editing = null;
    showErrors = false;
    drafts[unit] = clearedDraft($state.snapshot(drafts[unit]) as Draft, ctx);
    showToast('Saved');
  }

  function clearEvent() {
    editing = null;
    showErrors = false;
    drafts[unit] = clearedDraft($state.snapshot(drafts[unit]) as Draft, ctx);
  }

  async function undo() {
    if (!permission.ok) return showToast(permission.reason ?? 'No permission');
    const t = undoTarget(events);
    if (!t) return showToast('Nothing to undo');
    await record({ kind: 'void', voids_id: t.id });
    showToast(`Undone: ${playSummary(t.data, lookupPlayer)}`);
  }

  async function voidPlay(id: string) {
    if (!permission.ok) return showToast(permission.reason ?? 'No permission');
    if (!confirm('Void this play?')) return;
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

  async function addComment() {
    const text = commentText.trim();
    if (!text) return showToast('Comment is empty');
    if (!permission.ok) return showToast(permission.reason ?? 'No permission');
    await record({ kind: 'comment', text, ...(commentFor ? { play_id: commentFor } : {}) });
    commentText = '';
    commentFor = null;
    showToast('Comment saved');
  }

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
  const names = $derived({ own: ownTeam()?.name ?? 'Emperors',   opp: game ? teamName(game.opponent_team_id) : 'Opponent' });
</script>

{#if !game}
    <div class="banner error">Game not found. <a href={href('')}>Back to overview</a></div>
{:else}
  <div class="stack">
    {#if ended}
      <div class="banner {app.sync.pending === 0 ? 'ok' : 'warn'}" data-testid="end-banner">
          {#if app.sync.pending === 0 && app.backendConfigured}Everything is saved.
          {:else if app.backendConfigured}{app.sync.pending} events still pending – please stay online.
          {:else}Game end recorded. Data only lives on this device – please export.{/if}
      </div>
    {/if}

    {#if !permission.ok}
      <div class="banner warn">{permission.reason}</div>
    {/if}
    {#if rosterIds.length === 0}
        <div class="banner warn">No game day roster set for this game yet. <a href={href(`game/${gameId}`)}>Set roster</a></div>
    {/if}

    <div class="card capture-form">
      <div class="cap-head">
        <div class="score" data-testid="score">{names.own.split(' ').at(-1)} {score.own} : {score.opp} {names.opp.split(' ').at(-1)}</div>
      </div>
      {#if app.sync.state === 'error'}<div class="small err" data-testid="sync-message">{app.sync.message}</div>{/if}

      <div class="row between nowrap">
        <div class="seg {unit}" role="group" aria-label="Unit">
          <button type="button" aria-pressed={unit === 'offense'} data-testid="unit-offense" onclick={() => (unit = 'offense')}>Offense</button>
          <button type="button" aria-pressed={unit === 'defense'} data-testid="unit-defense" onclick={() => (unit = 'defense')}>Defense</button>
        </div>
        <button type="button" onclick={undo} data-testid="undo">↶ Undo</button>
      </div>

      {#if editing}
        <div class="banner warn edit-banner">
          Editing an earlier play.
          <button type="button" class="small" onclick={clearEvent}>Cancel</button>
        </div>
      {/if}

      <div class="field-row" class:invalid={showErrors && evaluation.errors.lineup} data-testid="lineup">
        <div class="flabel">Players {evaluation.draft.lineup.length ? `(${evaluation.draft.lineup.length})` : ''}</div>
        <div class="fctl">
          <button type="button" class="ctl ctl-btn" onclick={openLineup} data-testid="lineup-edit" aria-label="Select players on field">
            <span class="ellipsis">{lineupPlayers.length ? lineupPlayers.map((p) => `#${p.number}`).join(' ') : showErrors && evaluation.errors.lineup ? 'Please select' : 'Select lineup'}</span>
            <span aria-hidden="true">✎</span>
          </button>
        </div>
        {#if showErrors && evaluation.errors.lineup}<div class="err sr-only" role="alert">{evaluation.errors.lineup}</div>{/if}
      </div>

      {#if unit === 'offense'}
        <div class="field-row" class:invalid={showErrors && evaluation.errors.qb_id} data-field="qb_id">
          <div class="flabel"><span>Quarterback</span><span class="req">*</span></div>
          <div class="fctl">
            <PlayerSelect players={qbOptions} value={evaluation.draft.qb_id} required invalid={showErrors && !!evaluation.errors.qb_id} label="Quarterback" testid="qb" onchange={(id) => change({ qb_id: id })} />
          </div>
          {#if showErrors && evaluation.errors.qb_id}<div class="err sr-only" role="alert">{evaluation.errors.qb_id}</div>{/if}
        </div>
      {:else}
        <div class="field-row" data-field="blitzer_ids">
          <div class="flabel">Blitzers</div>
          <div class="fctl">
            <PlayerMulti players={blitzOptions} values={blitzers} label="Blitzers" testid="blitz" onchange={(ids) => change({ blitzer_ids: ids })} />
          </div>
        </div>
      {/if}

      <PlayForm {unit} {evaluation} {lineupPlayers} xp={ctx.xp} {xpHint} {showErrors} onchange={change} />

      <div class="action-bar">
        <button type="button" class="primary" onclick={() => save()} data-testid="save">{editing ? 'Save changes' : 'Save Event'}</button>
        <button type="button" class="danger" onclick={clearEvent} data-testid="clear">Clear Event</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Comment</h3>
      {#if commentFor}
        {@const target = plays.find((p) => p.id === commentFor)}
        <div class="small muted">On: {target ? playSummary(target.data, lookupPlayer) : 'play'} <button type="button" class="small" onclick={() => (commentFor = null)}>×</button></div>
      {/if}
      <div class="row">
        <input class="grow" placeholder="e.g. forgot ToD" bind:value={commentText} data-testid="comment-input" />
        <button type="button" onclick={addComment} data-testid="comment-save">Save comment</button>
      </div>
      {#each comments.slice(-3).reverse() as c (c.id)}
        <div class="small muted">{time(c.client_ts)} · {c.text}</div>
      {/each}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Plays</h3>
      {#each listed as p (p.id)}
        <div class="event-row" data-testid="play-row">
          <div class="row between">
            <span class="small muted">{time(p.client_ts)} · <span class="tag {p.data.unit}">{p.data.unit === 'offense' ? 'O' : 'D'}</span>{#if p.corrected} · corrected{/if}</span>
            <span class="row">
              <button type="button" class="small" onclick={() => editPlay(p.id)}>Edit</button>
              <button type="button" class="small" onclick={() => { commentFor = p.id; }}>Comment</button>
              <button type="button" class="small danger" onclick={() => voidPlay(p.id)}>Void</button>
            </span>
          </div>
          <div>{playSentence(p.data, lookupPlayer, names)}</div>
        </div>
      {:else}
        <p class="muted">No plays yet.</p>
      {/each}
      {#if plays.length > RECENT && !showAll}<button type="button" class="small" onclick={() => (showAll = true)}>Show all {plays.length}</button>{/if}
    </div>
  </div>

  {#if lineupOpen}
    <Dialog title="Players on field" onclose={() => (lineupOpen = false)}>
      <p class="small muted">Usually 5 players. Sorted by priority ({unit === 'offense' ? 'Offense' : 'Defense'}).</p>
      <div class="chips">
        {#each sortPlayers(rosterPlayers, sortKey) as p (p.id)}
          <button type="button" class="chip" aria-pressed={lineupDraft.includes(p.id)} data-testid="lineup-{p.number}" onclick={() => toggleLineup(p.id)}>#{p.number} {p.name}</button>
        {/each}
      </div>
      <p class:err={lineupDraft.length !== 5}>{lineupDraft.length} selected{lineupDraft.length !== 5 ? ' (usually 5)' : ''}</p>
      <div class="row dialog-actions">
        <button type="button" class="primary" onclick={applyLineup} data-testid="lineup-ok">Apply</button>
        <button type="button" onclick={() => (lineupOpen = false)}>Cancel</button>
      </div>
    </Dialog>
  {/if}

  {#if warnings.length}
    <Dialog title="Please confirm" onclose={() => (warnings = [])}>
      <ul data-testid="warnings">{#each warnings as w (w.code)}<li>{w.message}</li>{/each}</ul>
      <div class="row dialog-actions">
        <button type="button" class="primary" onclick={() => save(true)} data-testid="confirm-save">Save anyway</button>
        <button type="button" onclick={() => (warnings = [])}>Back</button>
      </div>
    </Dialog>
  {/if}

  {#if toast}<div class="toast" class:top={toastTop} role="status">{toast}</div>{/if}
{/if}
