<script lang="ts">
  import { buildTickerModel, type GameEvent, type PlayerLookup } from '@ffs/core';
  import { fromWire, type TickerSnapshot } from '@ffs/data';
  import { app, backend } from '../lib/app.svelte';
  import { dateLabel, occasionLabel } from '../lib/format';
  import TickerView from '../components/TickerView.svelte';

  let { token }: { token: string } = $props();

  let snapshot = $state<TickerSnapshot | null>(null);
  let events = $state<GameEvent[]>([]);
  let notFound = $state(false);
  let stale = $state(false);
  let lastUpdate = $state<number | null>(null);
  let loaded = $state(false);

  const seen = new Map<string, GameEvent & { seq: number }>();
  let afterSeq = 0;
  let busy = false;

  async function poll() {
    if (!backend || busy) return;
    busy = true;
    try {
      const snap = await backend.tickerSnapshot(token, afterSeq);
      if (!snap) {
        notFound = true;
        return;
      }
      notFound = false;
      snapshot = snap;
      for (const w of snap.events) {
        seen.set(w.id, { ...fromWire(w), seq: w.seq ?? 0 });
        afterSeq = Math.max(afterSeq, w.seq ?? 0);
      }
      events = [...seen.values()];
      stale = false;
      lastUpdate = Date.now();
    } catch {
      stale = true;
    } finally {
      loaded = true;
      busy = false;
    }
  }

  $effect(() => {
    if (!app.ready) return;
    void poll();
    const t = setInterval(() => void poll(), 7000);
    const onVis = () => document.visibilityState === 'visible' && void poll();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  let lookup = $derived<PlayerLookup>((id) => {
    const p = snapshot?.players.find((x) => x.id === id);
    return p ? { number: p.number, name: p.name } : undefined;
  });
  let model = $derived(
    buildTickerModel(events, lookup, { own: snapshot?.own_name ?? 'Emperors', opp: snapshot?.opp_name ?? 'Gegner' })
  );
  let playerIds = $derived(snapshot?.players.map((p) => p.id) ?? []);
</script>

<div class="shell">
  {#if !app.backendConfigured}
    <div class="banner warn" style="margin-top:1rem">Der Live-Ticker braucht eine Server-Verbindung. Diese Installation läuft nur lokal.</div>
  {:else if notFound}
    <div class="banner error" style="margin-top:1rem">Dieser Ticker-Link ist ungültig oder wurde zurückgesetzt.</div>
  {:else if !snapshot}
    <p class="muted" style="margin-top:2rem;text-align:center">
      {#if stale && loaded}Verbindung gestört. Neuer Versuch läuft …{:else}Ticker wird geladen …{/if}
    </p>
  {:else}
    <TickerView
      {model}
      ownName={snapshot.own_name}
      oppName={snapshot.opp_name}
      status={snapshot.game.status}
      occasionLabel={occasionLabel(snapshot.game.occasion)}
      dateLabel={dateLabel(snapshot.game.date)}
      {lookup}
      {playerIds}
      {lastUpdate}
      {stale}
    />
  {/if}
</div>
