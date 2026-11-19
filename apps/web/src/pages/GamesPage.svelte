<script lang="ts">
  import { canRecord, type TypistAssignment } from '@ffs/core';
  import { ValidationError } from '@ffs/data';
  import { app, refreshLists, store, syncNow, teamName } from '../lib/app.svelte';
  import { dateLabel, OCCASIONS, occasionLabel, STATUS_LABEL } from '../lib/format';
  import { go, href } from '../lib/router.svelte';

  let opponent = $state('');
  let date = $state(new Date().toISOString().slice(0, 10));
  let occasion = $state<(typeof OCCASIONS)[number]['value']>('dffl_game');
  let venue = $state('');
  let errors = $state<Record<string, string>>({});
  let assignments = $state<TypistAssignment[]>([]);

  $effect(() => {
    void store.listTypists().then((a) => (assignments = a));
  });

  let isAdmin = $derived(app.user?.role === 'admin');

  async function create() {
    errors = {};
    try {
      const team = opponent.trim() ? await store.saveTeam(opponent) : undefined;
      const g = await store.saveGame({ opponent_team_id: team?.id ?? '', date, occasion, venue });
      await refreshLists();
      void syncNow();
      opponent = '';
      venue = '';
      go(`game/${g.id}`);
    } catch (e) {
      if (e instanceof ValidationError) errors = e.errors;
      else errors = { opponent_team_id: e instanceof Error ? e.message : String(e) };
    }
  }

  const may = (gameId: string) => {
    const g = app.games.find((x) => x.id === gameId);
    return !!g && !!app.user && canRecord({ game: g, userId: app.user.id, role: app.user.role, assignments }).ok;
  };
</script>

<h1>Spiele</h1>

{#if app.user?.role === 'viewer'}
  <div class="banner warn">Dein Konto hat nur Leserechte. Den Live-Ticker erreichst du über den Ticker-Link des Spiels. Ein Admin kann dir die Rolle „Typist“ geben.</div>
{/if}

{#if isAdmin}
  <div class="card">
    <h2 style="margin-top:0">Neues Spiel</h2>
    <div class="row">
      <label class="field grow"><span>Gegner</span>
        <input list="teams" bind:value={opponent} placeholder="Gegner wählen oder eingeben" data-testid="g-opponent" />
        <datalist id="teams">{#each app.teams.filter((t) => !t.is_own) as t (t.id)}<option value={t.name}></option>{/each}</datalist>
        {#if errors.opponent_team_id}<div class="err">{errors.opponent_team_id}</div>{/if}
      </label>
      <label class="field"><span>Datum</span><input type="date" bind:value={date} data-testid="g-date" />{#if errors.date}<div class="err">{errors.date}</div>{/if}</label>
      <label class="field"><span>Anlass</span>
        <select bind:value={occasion} data-testid="g-occasion">{#each OCCASIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}</select>
      </label>
      <label class="field"><span>Ort (optional)</span><input bind:value={venue} /></label>
    </div>
    <button type="button" class="primary" onclick={create} data-testid="g-create">Spiel anlegen</button>
  </div>
{/if}

<div class="stack" style="margin-top:1rem">
  {#each app.games as g (g.id)}
    <div class="card" data-testid="game-row">
      <div class="row between">
        <div>
          <b>{teamName(g.opponent_team_id)}</b>
          <div class="small muted">{dateLabel(g.date)} · {occasionLabel(g.occasion)}{g.venue ? ` · ${g.venue}` : ''}</div>
        </div>
        <span class="tag">{STATUS_LABEL[g.status]}</span>
      </div>
      <div class="row" style="margin-top:.5rem">
        {#if may(g.id)}<a class="btn primary" href={href(`capture/${g.id}`)} data-testid="go-capture">Erfassen</a>{/if}
        <a class="btn" href={href(`preview/${g.id}`)}>Ticker-Vorschau</a>
        {#if isAdmin}<a class="btn" href={href(`game/${g.id}`)} data-testid="go-game">Details</a>{/if}
      </div>
    </div>
  {:else}
    <p class="muted">Noch keine Spiele.</p>
  {/each}
</div>
