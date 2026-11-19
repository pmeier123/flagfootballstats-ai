<script lang="ts">
  import { tick } from 'svelte';
  import {
    filterTickerEntries, periodLabel, type Highlight, type PlayerLookup, type TickerEntry, type TickerFilter, type TickerModel
  } from '@ffs/core';

  let {
    model, ownName, oppName, status, occasionLabel, dateLabel, lookup, playerIds, lastUpdate = null, stale = false
  }: {
    model: TickerModel;
    ownName: string;
    oppName: string;
    status: 'planned' | 'live' | 'finished';
    occasionLabel: string;
    dateLabel: string;
    lookup: PlayerLookup;
    playerIds: string[];
    lastUpdate?: number | null;
    stale?: boolean;
  } = $props();

  const ICONS: Record<Highlight, string> = {
    touchdown: '🏈', pick_6: '🔥', interception: '✋', sack: '💥', safety: '🛡️', xp: '🎯', foul: '🚩'
  };
  const BIG = new Set<Highlight>(['touchdown', 'pick_6', 'safety']);

  let unit = $state<'all' | 'offense' | 'defense'>('all');
  let scoringOnly = $state(false);
  let highlightsOnly = $state(false);
  let playerId = $state('');
  let now = $state(Date.now());

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  let filter = $derived<TickerFilter>({
    unit: unit === 'all' ? undefined : unit,
    scoringOnly,
    highlightsOnly,
    playerId: playerId || undefined
  });
  let visible = $derived(filterTickerEntries(model.entries, filter).slice().reverse());

  interface Group { key: string; period: number; drive: number; entries: TickerEntry[] }
  let groups = $derived.by(() => {
    const out: Group[] = [];
    for (const e of visible) {
      const key = `${e.period}-${e.drive}`;
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, period: e.period, drive: e.drive, entries: [] };
        out.push(g);
      }
      g.entries.push(e);
    }
    return out;
  });

  const time = (ts: number) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  let ago = $derived(lastUpdate ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : null);
  const pct = (n: number | null) => (n === null ? '–' : `${n} %`);
  let s = $derived(model.stats);
  const nameOf = (id: string) => {
    const p = lookup(id);
    return p ? `#${p.number} ${p.name}` : id;
  };

  // Keep the reading position stable while new entries are inserted above.
  let lastHeight = 0;
  $effect(() => {
    void model.entries.length;
    void tick().then(() => {
      const h = document.documentElement.scrollHeight;
      if (lastHeight && window.scrollY > 40 && h > lastHeight) window.scrollBy(0, h - lastHeight);
      lastHeight = h;
    });
  });
</script>

<section class="ticker" data-testid="ticker">
  <div class="card ticker-head">
    <div class="small muted">{occasionLabel} · {dateLabel}</div>
    <div class="teams"><b>{ownName}</b><span class="score" data-testid="ticker-score">{model.score.own} : {model.score.opp}</span><b>{oppName}</b></div>
    <div class="small">
      {#if status === 'live'}<span class="live-dot"></span>LIVE{:else if status === 'finished'}Beendet{:else}Noch nicht gestartet{/if}
      · {model.clock.halftime && model.clock.atBreak ? 'Halbzeit' : model.clock.ended ? 'Spielende' : model.periodLabel}
      {#if model.clock.atBreak && !model.clock.halftime} (Pause){/if}
    </div>
    <div class="small muted" class:stale>
      {#if stale}Verbindung gestört, Daten evtl. veraltet. {/if}{#if ago !== null}Aktualisiert vor {ago} s{/if}
    </div>
  </div>

  <div class="card" style="margin-top:.75rem">
    <h3 style="margin-top:0">Spielstatistik</h3>
    <div class="stat-grid">
      <div class="stat"><b>{pct(s.completionRate)}</b><span>Passquote ({s.completions}/{s.passAttempts})</span></div>
      <div class="stat"><b>{s.airYards}</b><span>Air Yards</span></div>
      <div class="stat"><b>{s.yardsAfterCatch}</b><span>Yards after Catch</span></div>
      <div class="stat"><b>{s.runYards}</b><span>Lauf-Yards</span></div>
      <div class="stat"><b>{s.sacksMade} / {s.sacksTaken}</b><span>Sacks (wir / gegen uns)</span></div>
      <div class="stat"><b>{s.interceptionsMade} / {s.interceptionsThrown}</b><span>Interceptions (wir / gegen uns)</span></div>
      <div class="stat"><b>{s.foulsCommitted} / {s.foulsDrawn}</b><span>Fouls (begangen / gezogen)</span></div>
    </div>
    {#if s.top.receptions.length || s.top.flagPulls.length || s.top.sacks.length}
      <div class="small muted" style="margin-top:.6rem">
        {#if s.top.receptions.length}<div>Meiste Catches: {s.top.receptions.map((t) => `${nameOf(t.playerId)} (${t.value})`).join(', ')}</div>{/if}
        {#if s.top.runningYards.length}<div>Lauf-Yards: {s.top.runningYards.map((t) => `${nameOf(t.playerId)} (${t.value})`).join(', ')}</div>{/if}
        {#if s.top.flagPulls.length}<div>Flag Pulls: {s.top.flagPulls.map((t) => `${nameOf(t.playerId)} (${t.value})`).join(', ')}</div>{/if}
        {#if s.top.sacks.length}<div>Sacks: {s.top.sacks.map((t) => `${nameOf(t.playerId)} (${t.value})`).join(', ')}</div>{/if}
        {#if s.top.interceptions.length}<div>Interceptions: {s.top.interceptions.map((t) => `${nameOf(t.playerId)} (${t.value})`).join(', ')}</div>{/if}
      </div>
    {/if}
  </div>

  <div class="card row" style="margin-top:.75rem" aria-label="Filter">
    <div class="seg" role="group" aria-label="Einheit">
      <button type="button" aria-pressed={unit === 'all'} onclick={() => (unit = 'all')}>Alle</button>
      <button type="button" aria-pressed={unit === 'offense'} onclick={() => (unit = 'offense')}>Offense</button>
      <button type="button" aria-pressed={unit === 'defense'} onclick={() => (unit = 'defense')}>Defense</button>
    </div>
    <label class="row"><input type="checkbox" bind:checked={scoringOnly} /> Nur Punkte</label>
    <label class="row"><input type="checkbox" bind:checked={highlightsOnly} /> Nur Highlights</label>
    <select bind:value={playerId} aria-label="Spieler">
      <option value="">Alle Spieler</option>
      {#each playerIds as id (id)}<option value={id}>{nameOf(id)}</option>{/each}
    </select>
  </div>

  <div data-testid="feed">
    {#each groups as g (g.key)}
      <div class="divider">{periodLabel(g.period)} · Drive {g.drive}</div>
      {#each g.entries as e (e.id)}
        <article class="entry {e.unit}" class:hl={!!e.highlight} class:big={e.highlight && BIG.has(e.highlight)} data-testid="entry">
          <div class="meta">
            <span>{time(e.ts)}</span>
            <span class="tag {e.unit}">{e.unit === 'offense' ? 'Offense' : 'Defense'}</span>
            {#if e.highlight}<span aria-hidden="true">{ICONS[e.highlight]}</span>{/if}
            {#if e.scoring}<b>+{e.scoring.points}</b>{/if}
            {#if e.corrected}<span class="tag" title="Eintrag wurde korrigiert">korrigiert</span>{/if}
          </div>
          <div class="text">{e.text}</div>
          <details>
            <summary>Details</summary>
            <ul>{#each e.details as d (d)}<li>{d}</li>{/each}</ul>
          </details>
        </article>
      {/each}
    {:else}
      <p class="muted" style="text-align:center;margin-top:2rem">Noch keine Einträge.</p>
    {/each}
  </div>
</section>
