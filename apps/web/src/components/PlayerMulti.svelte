<script lang="ts">
  import type { Player } from '@ffs/core';
  import Dialog from './Dialog.svelte';

  let {
    players, values, label, testid, onchange
  }: {
    players: Player[];
    values: string[];
    label: string;
    testid: string;
    onchange: (ids: string[]) => void;
  } = $props();

  let open = $state(false);
  let chosen = $derived(players.filter((p) => values.includes(p.id)));

  function toggle(id: string) {
    onchange(values.includes(id) ? values.filter((x) => x !== id) : [...values, id]);
  }
</script>

<button type="button" class="ctl ctl-btn" aria-label={label} data-testid={testid} onclick={() => (open = true)}>
  <span class="ellipsis">{chosen.length ? chosen.map((p) => `#${p.number}`).join(' ') : '–'}</span>
  <span aria-hidden="true">▾</span>
</button>

{#if open}
  <Dialog title={label} onclose={() => (open = false)}>
    <div class="check-grid">
      {#each players as p (p.id)}
        <label class="check">
          <input type="checkbox" checked={values.includes(p.id)} data-testid="{testid}-{p.number}" onchange={() => toggle(p.id)} />
          #{p.number} {p.name}
        </label>
      {:else}
        <p class="muted">No players on the field.</p>
      {/each}
    </div>
    <div class="row dialog-actions">
      <button type="button" class="primary" data-testid="{testid}-ok" onclick={() => (open = false)}>OK</button>
    </div>
  </Dialog>
{/if}
