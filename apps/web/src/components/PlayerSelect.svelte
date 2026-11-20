<script lang="ts">
  import type { Player } from '@ffs/core';

  let {
    players, value, required = false, invalid = false, label, testid, onchange
  }: {
    players: Player[];
    value: string | undefined;
    required?: boolean;
    invalid?: boolean;
    label: string;
    testid: string;
    onchange: (id: string | undefined) => void;
  } = $props();
</script>

<select class="ctl" aria-label={label} aria-invalid={invalid} data-testid={testid} value={value ?? ''} onchange={(e) => onchange(e.currentTarget.value || undefined)}>
  <option value="">{required ? (invalid ? 'Please select' : 'Select …') : '–'}</option>
  {#each players as p (p.id)}
    <option value={p.id}>#{p.number} {p.name}</option>
  {/each}
</select>
