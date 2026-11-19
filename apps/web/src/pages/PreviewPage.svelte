<script lang="ts">
  import { buildTickerModel, type GameEvent } from '@ffs/core';
  import { app, lookupPlayer, store, ownTeam, teamName } from '../lib/app.svelte';
  import { dateLabel, occasionLabel } from '../lib/format';
  import { href } from '../lib/router.svelte';
  import TickerView from '../components/TickerView.svelte';

  let { gameId }: { gameId: string } = $props();

  let events = $state<GameEvent[]>([]);
  let lastUpdate = $state<number | null>(null);
  let game = $derived(app.games.find((g) => g.id === gameId));

  async function load() {
    events = await store.eventsOf(gameId);
    lastUpdate = Date.now();
  }

  $effect(() => {
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  });

  let ownName = $derived(ownTeam()?.name ?? 'Emperors');
  let oppName = $derived(game ? teamName(game.opponent_team_id) : 'Gegner');
  let model = $derived(buildTickerModel(events, lookupPlayer, { own: ownName, opp: oppName }));
  let playerIds = $derived(app.players.map((p) => p.id));
</script>

<div class="stack">
  <div class="row between">
    <h1 style="margin:0">Ticker-Vorschau</h1>
    <a href={href(`capture/${gameId}`)}>Zurück zur Erfassung</a>
  </div>
  <p class="muted small">So sehen Zuschauer den Ticker. Die Vorschau nutzt die Daten dieses Geräts und funktioniert auch offline.</p>
  {#if game}
    <TickerView
      {model} {ownName} {oppName} status={game.status}
      occasionLabel={occasionLabel(game.occasion)} dateLabel={dateLabel(game.date)}
      lookup={lookupPlayer} {playerIds} {lastUpdate}
    />
  {:else}
    <div class="banner error">Spiel nicht gefunden.</div>
  {/if}
</div>
