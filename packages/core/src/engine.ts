import { evalCond, RULES, type FieldRule } from './rules.js';
import { DEFAULT_TYPE, TYPES_BY_UNIT, type Draft, type PlayData, type PlayField, type Unit } from './types.js';
import { FIELD_LABELS } from './labels.js';

export interface RuleContext {
  /** Extra-point phase is active (derived from the event log). */
  xp: boolean;
  /** Unit that is expected to record the extra point (hint only). */
  xpExpectedUnit?: Unit | null;
  /** Players present in the game roster; when given, lineup members must be part of it. */
  roster?: readonly string[];
}

export interface FieldState {
  field: PlayField;
  kind: FieldRule['kind'];
  options: (string | number)[] | null;
  required: boolean;
  value: unknown;
  error?: string;
}

export type WarningCode = 'lineup_size' | 'no_result' | 'xp_unit_mismatch';
export interface Warning { code: WarningCode; message: string }

export interface Evaluation {
  draft: Draft;
  fields: FieldState[];
  errors: Record<string, string>;
  warnings: Warning[];
  valid: boolean;
}

const REQUIRED_MSG = 'Pflichtfeld';

function valuesOf(draft: Draft, ctx: RuleContext): Record<string, unknown> {
  return { ...draft, xp: ctx.xp };
}

/** The visible rules of the current draft in display order; per field the first matching rule wins. */
export function activeRules(draft: Draft, ctx: RuleContext): FieldRule[] {
  const values = valuesOf(draft, ctx);
  const seen = new Set<string>();
  const out: FieldRule[] = [];
  for (const rule of RULES[draft.unit]) {
    if (seen.has(rule.field) || !evalCond(rule.show, values)) continue;
    seen.add(rule.field);
    out.push(rule);
  }
  return out;
}

export function emptyDraft(unit: Unit, carry?: Partial<Pick<Draft, 'lineup' | 'qb_id' | 'blitzer_ids'>>): Draft {
  return { unit, type: DEFAULT_TYPE[unit], lineup: carry?.lineup ? [...carry.lineup] : [], qb_id: carry?.qb_id, blitzer_ids: carry?.blitzer_ids ? [...carry.blitzer_ids] : undefined };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Removes every value that is not visible/valid for the current path and fills defaults of visible fields.
 * Idempotent. Guarantees that hidden values are never persisted.
 */
export function normalizeDraft(input: Draft, ctx: RuleContext): Draft {
  let draft: Draft = { ...input };
  if (!TYPES_BY_UNIT[draft.unit].includes(draft.type as never)) draft.type = DEFAULT_TYPE[draft.unit];
  draft.lineup = [...new Set(draft.lineup ?? [])];

  for (let i = 0; i < 6; i++) {
    const rules = activeRules(draft, ctx);
    const next: Draft = { unit: draft.unit, type: draft.type, lineup: draft.lineup };
    if (draft.unit === 'offense' && draft.qb_id !== undefined) next.qb_id = draft.qb_id;
    if (draft.unit === 'defense' && draft.blitzer_ids?.length) next.blitzer_ids = draft.blitzer_ids.filter((id) => draft.lineup.includes(id));
    if (draft.unit === 'offense' && next.qb_id !== undefined && !draft.lineup.includes(next.qb_id)) delete next.qb_id;

    const target = next as unknown as Record<string, unknown>;
    for (const rule of rules) {
      let value = (draft as unknown as Record<string, unknown>)[rule.field];
      if (rule.kind === 'choice') {
        if (value !== undefined && !(rule.options ?? []).includes(value as never)) value = undefined;
      } else if (rule.kind === 'player') {
        if (typeof value !== 'string' || !draft.lineup.includes(value)) value = undefined;
      } else {
        const ids = Array.isArray(value) ? (value as string[]).filter((id) => draft.lineup.includes(id)) : [];
        value = ids.length ? [...new Set(ids)] : undefined;
      }
      if (value === undefined && rule.default !== undefined) value = rule.default;
      if (value !== undefined) target[rule.field] = value;
    }
    if (sameDraft(next, draft)) return next;
    draft = next;
  }
  return draft;
}

/** Sets one field and resets everything that becomes invisible or invalid because of it. */
export function applyChange(draft: Draft, change: Partial<Draft>, ctx: RuleContext): Draft {
  const merged: Draft = { ...draft, ...change };
  for (const key of Object.keys(change) as (keyof Draft)[]) {
    if (change[key] === undefined) delete (merged as unknown as Record<string, unknown>)[key];
  }
  return normalizeDraft(merged, ctx);
}

export function evaluateDraft(input: Draft, ctx: RuleContext): Evaluation {
  const draft = normalizeDraft(input, ctx);
  const rules = activeRules(draft, ctx);
  const values = valuesOf(draft, ctx);
  const errors: Record<string, string> = {};
  const warnings: Warning[] = [];
  const fields: FieldState[] = [];

  const lineup = draft.lineup;
  if (lineup.length === 0) errors.lineup = 'Mindestens ein Spieler muss auf dem Feld stehen';
  else if (lineup.length > 9) errors.lineup = 'Zu viele Spieler auf dem Feld (maximal 9)';
  else if (ctx.roster && lineup.some((id) => !ctx.roster!.includes(id))) errors.lineup = 'Spieler ist nicht im Spieltagskader';
  else if (lineup.length !== 5) warnings.push({ code: 'lineup_size', message: `Nur ${lineup.length} Spieler auf dem Feld? Üblich sind 5.` });

  if (draft.unit === 'offense') {
    if (!draft.qb_id) errors.qb_id = REQUIRED_MSG;
    else if (!lineup.includes(draft.qb_id)) errors.qb_id = 'Quarterback steht nicht auf dem Feld';
  }

  for (const rule of rules) {
    const required = rule.required ? evalCond(rule.required, values) : false;
    const value = (draft as unknown as Record<string, unknown>)[rule.field];
    const state: FieldState = { field: rule.field, kind: rule.kind, options: rule.options ?? null, required, value };
    const missing = value === undefined || (Array.isArray(value) && value.length === 0);
    if (required && missing) {
      state.error = REQUIRED_MSG;
      errors[rule.field] = REQUIRED_MSG;
    }
    fields.push(state);
  }

  if (!ctx.xp) {
    const resultRule = rules.find((r) => r.field === 'result');
    if (resultRule && draft.result === undefined) {
      warnings.push({ code: 'no_result', message: 'Kein Ergebnis gewählt. Der Spielzug wird ohne besonderes Ergebnis gespeichert.' });
    }
  } else if (ctx.xpExpectedUnit && ctx.xpExpectedUnit !== draft.unit) {
    warnings.push({
      code: 'xp_unit_mismatch',
      message: ctx.xpExpectedUnit === 'defense'
        ? 'Der Gegner hat gepunktet: Der Extrapunkt wird normalerweise in der Defense erfasst.'
        : 'Unser Team hat gepunktet: Der Extrapunkt wird normalerweise in der Offense erfasst.'
    });
  }

  return { draft, fields, errors, warnings, valid: Object.keys(errors).length === 0 };
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Converts a valid draft to the persisted play: no hidden values, no empty lists. */
export function toPlayData(input: Draft, ctx: RuleContext): PlayData {
  const draft = normalizeDraft(input, ctx);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (v === undefined || (Array.isArray(v) && v.length === 0 && k !== 'lineup')) continue;
    out[k] = v;
  }
  return out as unknown as PlayData;
}

/** Defaults used after "Clear event": keeps lineup and carry-over fields, resets all play fields. */
export function clearedDraft(draft: Draft, ctx: RuleContext): Draft {
  return normalizeDraft(emptyDraft(draft.unit, draft), ctx);
}

/** Drops lineup members that are not on the game roster and reports who was removed. */
export function pruneLineup(
  lineup: readonly string[],
  roster: readonly string[]
): { lineup: string[]; removed: string[] } {
  const keep: string[] = [];
  const removed: string[] = [];
  for (const id of lineup) (roster.includes(id) ? keep : removed).push(id);
  return { lineup: keep, removed };
}
