<script lang="ts">
  import {
    fieldLabel, optionLabel, sortPlayers, typeLabel, TYPES_BY_UNIT,
    type Draft, type Evaluation, type Player, type PlayField, type Unit
  } from '@ffs/core';

  let {
    unit, evaluation, lineupPlayers, xp, xpHint, showErrors, onchange
  }: {
    unit: Unit;
    evaluation: Evaluation;
    lineupPlayers: Player[];
    xp: boolean;
    xpHint: string | null;
    showErrors: boolean;
    onchange: (change: Partial<Draft>) => void;
  } = $props();

  let draft = $derived(evaluation.draft);
  let byNumber = $derived(sortPlayers(lineupPlayers));

  const labelOf = (f: PlayField) => (f === 'xp_result' ? 'Extrapunkt-Ergebnis' : f === 'result' ? 'Ergebnis' : fieldLabel(f));

  function setChoice(field: PlayField, current: unknown, value: string | number, required: boolean) {
    // Tapping the selected option again clears optional fields.
    onchange({ [field]: !required && current === value ? undefined : value } as Partial<Draft>);
  }

  function togglePlayer(field: PlayField, current: unknown, id: string, required: boolean) {
    onchange({ [field]: !required && current === id ? undefined : id } as Partial<Draft>);
  }

  function toggleMany(field: PlayField, current: unknown, id: string) {
    const list = Array.isArray(current) ? (current as string[]) : [];
    onchange({ [field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] } as Partial<Draft>);
  }
</script>

<div data-testid="play-form" data-xp={xp}>
  {#if xp}
    <h2 style="margin-top:0" data-testid="xp-heading"><em>Extra point try</em></h2>
    {#if xpHint}<p class="small muted" style="margin-top:-.3rem">{xpHint}</p>{/if}
  {/if}

  <div class="field-title">Spielzugtyp</div>
  <div class="chips" role="group" aria-label="Spielzugtyp">
    {#each TYPES_BY_UNIT[unit] as t (t)}
      <button type="button" class="chip" aria-pressed={draft.type === t} data-testid="type-{t}" onclick={() => onchange({ type: t })}>
        {typeLabel(unit, t)}
      </button>
    {/each}
  </div>

  {#each evaluation.fields as f (f.field + (f.options?.join(',') ?? ''))}
    <div class="field-block" class:invalid={showErrors && f.error} data-field={f.field}>
      <div class="field-title"><span>{labelOf(f.field)}</span>{#if f.required}<span class="req" title="Pflichtfeld">*</span>{/if}</div>
      {#if f.kind === 'choice'}
        <div class="chips" role="group" aria-label={labelOf(f.field)}>
          {#each f.options ?? [] as o (o)}
            <button type="button" class="chip" aria-pressed={f.value === o}
              data-testid="opt-{f.field}-{o}" onclick={() => setChoice(f.field, f.value, o, f.required)}>
              {optionLabel(o)}
            </button>
          {/each}
        </div>
      {:else if f.kind === 'player'}
        <div class="chips">
          {#each byNumber as p (p.id)}
            <button type="button" class="chip" aria-pressed={f.value === p.id} data-testid="pick-{f.field}-{p.number}" onclick={() => togglePlayer(f.field, f.value, p.id, f.required)}>
              #{p.number} {p.name}
            </button>
          {/each}
        </div>
      {:else}
        <div class="chips">
          {#each byNumber as p (p.id)}
            <button type="button" class="chip" aria-pressed={Array.isArray(f.value) && (f.value as string[]).includes(p.id)} data-testid="pick-{f.field}-{p.number}" onclick={() => toggleMany(f.field, f.value, p.id)}>
              #{p.number} {p.name}
            </button>
          {/each}
        </div>
      {/if}
      {#if showErrors && f.error}<div class="err" role="alert">{f.error}</div>{/if}
    </div>
  {/each}
</div>
