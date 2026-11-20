<script lang="ts">
  import {
    optionLabel, sortPlayers, typeLabel, TYPES_BY_UNIT,
    type Draft, type Evaluation, type Player, type PlayField, type Unit
  } from '@ffs/core';
  import { playFieldLabel } from '../lib/format';
  import PlayerMulti from './PlayerMulti.svelte';
  import PlayerSelect from './PlayerSelect.svelte';

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

  const labelOf = playFieldLabel;

  // Abbreviations keep short option sets on one segmented row.
  const COMPACT: Record<string, string> = { td: 'TD', first_down: '1st Down', tod: 'ToD', interception: 'INT', catch_allowed: 'Catch', pick_6: 'Pick 6' };
  const short = (o: string | number) => (typeof o === 'string' && COMPACT[o]) || optionLabel(o);
  const segmented = (opts: (string | number)[]) =>
    (opts.length <= 6 && opts.reduce((n: number, o) => n + short(o).length, 0) <= 28) || wide(opts);
  // Up to 9 plain numbers (flag pulls) fit as a full-width segmented row.
  const wide = (opts: (string | number)[]) => opts.length > 6 && opts.length <= 9 && opts.every((o) => typeof o === 'number');

  function setChoice(field: PlayField, current: unknown, value: string | number, required: boolean) {
    // Tapping the selected option again clears optional fields.
    onchange({ [field]: !required && current === value ? undefined : value } as Partial<Draft>);
  }

  function selectChoice(field: PlayField, options: (string | number)[], raw: string) {
    onchange({ [field]: options.find((o) => String(o) === raw) } as Partial<Draft>);
  }
</script>

<div data-testid="play-form" data-xp={xp}>
  {#if xp}
    <div class="xp-head" data-testid="xp-heading"><em>Extra point try</em>{#if xpHint} <span class="muted">{xpHint}</span>{/if}</div>
  {/if}

  <div class="type-grid" role="group" aria-label="Play type">
    {#each TYPES_BY_UNIT[unit] as t (t)}
      <button type="button" aria-pressed={draft.type === t} data-testid="type-{t}" onclick={() => onchange({ type: t })}>
        {typeLabel(unit, t)}
      </button>
    {/each}
  </div>

  {#each evaluation.fields as f (f.field + (f.options?.join(',') ?? ''))}
    {@const bad = showErrors && !!f.error}
    <div class="field-row" class:invalid={bad} class:wide={f.kind === 'choice' && wide(f.options ?? [])} data-field={f.field}>
      <div class="flabel"><span>{labelOf(f.field)}</span>{#if f.required}<span class="req" title="Required">*</span>{/if}
        {#if bad}<div class="err sr-only" role="alert">{f.error}</div>{/if}
      </div>
      <div class="fctl">
        {#if f.kind === 'choice'}
          {@const opts = f.options ?? []}
          {#if segmented(opts)}
            <div class="segmented" role="group" aria-label={labelOf(f.field)}>
              {#each opts as o (o)}
                <button type="button" aria-pressed={f.value === o} data-testid="opt-{f.field}-{o}" onclick={() => setChoice(f.field, f.value, o, f.required)}>
                  {short(o)}
                </button>
              {/each}
              {#if f.field === 'result'}
                <button type="button" class="seg-clear" aria-label="Clear result" data-testid="clear-result" disabled={f.value === undefined}
                  onclick={() => onchange({ result: undefined })}>×</button>
              {/if}
            </div>
          {:else}
            <select class="ctl" aria-label={labelOf(f.field)} aria-invalid={bad} data-testid="sel-{f.field}" value={f.value === undefined ? '' : String(f.value)}
              onchange={(e) => selectChoice(f.field, opts, e.currentTarget.value)}>
              <option value="">{f.required ? (bad ? 'Please select' : 'Select …') : '–'}</option>
              {#each opts as o (o)}<option value={String(o)}>{optionLabel(o)}</option>{/each}
            </select>
          {/if}
        {:else if f.kind === 'player'}
          <PlayerSelect players={byNumber} value={f.value as string | undefined} required={f.required} invalid={bad} label={labelOf(f.field)}
            testid="pick-{f.field}" onchange={(id) => onchange({ [f.field]: id } as Partial<Draft>)} />
        {:else}
          <PlayerMulti players={byNumber} values={Array.isArray(f.value) ? (f.value as string[]) : []} label={labelOf(f.field)}
            testid="multi-{f.field}" onchange={(ids) => onchange({ [f.field]: ids } as Partial<Draft>)} />
        {/if}
      </div>
    </div>
  {/each}
</div>
