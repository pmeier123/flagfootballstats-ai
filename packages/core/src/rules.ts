import type { PlayField, Unit } from './types.js';

type Value = string | number | boolean;

/** JSON-serializable condition evaluated against the draft plus the virtual field `xp` (extra-point phase). */
export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { f: string; eq: Value }
  | { f: string; in: Value[] }
  | { f: string; set: boolean };

export interface FieldRule {
  field: PlayField;
  /** player: single id from the lineup; players: several ids from the lineup; choice: one of options. */
  kind: 'player' | 'players' | 'choice';
  options?: (string | number)[];
  show: Cond;
  required?: Cond;
  default?: string | number;
}

const ALWAYS: Cond = { all: [] };
const eq = (f: string, v: Value): Cond => ({ f, eq: v });
const inn = (f: string, v: Value[]): Cond => ({ f, in: v });
const all = (...c: Cond[]): Cond => ({ all: c });
const any = (...c: Cond[]): Cond => ({ any: c });
const not = (c: Cond): Cond => ({ not: c });
const nonZero = (f: string): Cond => all({ f, set: true }, not(eq(f, 0)));

const YARDS = [0, 5, 10, 15, 20, 30];
const FLAG_PULLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const YARDS_LOST = [-5, 0, -10, -15];
const FOUL_YARDS = [0, -5, -10];
const INCOMPLETE_REASONS = ['fifty_fifty', 'drop', 'uncatchable', 'batted'];
const NORMAL = eq('xp', false);
const XP = eq('xp', true);

export const FOUL_OPTIONS: Record<Unit, { foul_committed: string[]; foul_drawn: string[] }> = {
  offense: {
    foul_committed: ['illegal_contact', 'screening_bb', 'false_start', 'flag_guarding_jumping', 'unsporting', 'other'],
    foul_drawn: ['illegal_contact', 'screening_bb', 'false_start', 'unsporting', 'other']
  },
  defense: {
    foul_committed: ['illegal_contact', 'screening_bb', 'illegal_blitz', 'unsporting', 'other'],
    foul_drawn: ['illegal_contact', 'screening_bb', 'flag_guarding', 'unsporting', 'other']
  }
};

const isFoul = inn('type', ['foul_committed', 'foul_drawn']);

function resultRule(show: Cond, options: string[]): FieldRule {
  return { field: 'result', kind: 'choice', options, show: all(NORMAL, show) };
}

function foulRules(unit: Unit): FieldRule[] {
  return [
    { field: 'foul', kind: 'choice', options: FOUL_OPTIONS[unit].foul_committed, show: eq('type', 'foul_committed'), required: ALWAYS },
    { field: 'foul', kind: 'choice', options: FOUL_OPTIONS[unit].foul_drawn, show: eq('type', 'foul_drawn'), required: ALWAYS },
    { field: 'foul_yards', kind: 'choice', options: FOUL_YARDS, show: all(isFoul, eq('foul', 'other')), required: ALWAYS }
  ];
}

export const OFFENSE_RULES: FieldRule[] = [
  { field: 'player_id', kind: 'player', show: inn('type', ['pass', 'run', 'foul_committed', 'foul_drawn']), required: inn('type', ['pass', 'run']) },
  { field: 'pass_result', kind: 'choice', options: ['catch', 'incomplete', 'interception'], show: eq('type', 'pass'), required: ALWAYS },
  { field: 'incomplete_reason', kind: 'choice', options: INCOMPLETE_REASONS, show: all(eq('type', 'pass'), eq('pass_result', 'incomplete')), required: ALWAYS },
  { field: 'air_yards', kind: 'choice', options: YARDS, show: all(eq('type', 'pass'), eq('pass_result', 'catch')), required: ALWAYS },
  { field: 'yards_after_catch', kind: 'choice', options: YARDS, default: 0, show: all(eq('type', 'pass'), eq('pass_result', 'catch')) },
  { field: 'yards_run', kind: 'choice', options: YARDS, default: 0, show: eq('type', 'run'), required: ALWAYS },
  {
    field: 'flag_pulls_missed', kind: 'choice', options: FLAG_PULLS, default: 0,
    show: any(
      all(eq('type', 'pass'), eq('pass_result', 'catch'), nonZero('yards_after_catch')),
      all(eq('type', 'run'), nonZero('yards_run'))
    )
  },
  { field: 'yards_lost', kind: 'choice', options: YARDS_LOST, show: eq('type', 'sack'), required: ALWAYS },
  ...foulRules('offense'),
  resultRule(all(eq('type', 'pass'), eq('pass_result', 'catch')), ['td', 'first_down', 'tod']),
  resultRule(all(eq('type', 'pass'), eq('pass_result', 'incomplete')), ['tod']),
  resultRule(all(eq('type', 'pass'), eq('pass_result', 'interception')), ['pick_6']),
  resultRule(eq('type', 'run'), ['td', 'first_down', 'tod']),
  resultRule(eq('type', 'sack'), ['tod', 'safety']),
  resultRule(inn('type', ['throwaway', 'dead_snap', 'foul_committed']), ['tod']),
  {
    field: 'xp_result', kind: 'choice', show: XP, required: ALWAYS,
    options: ['1xp_made', '1xp_missed', '2xp_made', '2xp_missed', 'xp_retry']
  }
];

const TARGET_PULLABLE = all(eq('type', 'target'), not(inn('target_result', ['incomplete', 'interception'])));
const PULL_SHOW = any(TARGET_PULLABLE, eq('type', 'run'));

export const DEFENSE_RULES: FieldRule[] = [
  { field: 'player_id', kind: 'player', show: inn('type', ['target', 'sack', 'throwaway', 'foul_committed', 'foul_drawn']), required: eq('type', 'target') },
  { field: 'target_result', kind: 'choice', options: ['catch_allowed', 'incomplete', 'interception'], show: eq('type', 'target'), required: ALWAYS },
  { field: 'incomplete_reason', kind: 'choice', options: INCOMPLETE_REASONS, show: all(eq('type', 'target'), eq('target_result', 'incomplete')), required: ALWAYS },
  { field: 'flag_puller_id', kind: 'player', show: PULL_SHOW },
  { field: 'failed_puller_ids', kind: 'players', show: PULL_SHOW },
  ...foulRules('defense'),
  resultRule(all(eq('type', 'target'), eq('target_result', 'catch_allowed')), ['td', 'first_down', 'tod']),
  resultRule(all(eq('type', 'target'), eq('target_result', 'incomplete')), ['tod']),
  resultRule(all(eq('type', 'target'), eq('target_result', 'interception')), ['pick_6']),
  resultRule(eq('type', 'run'), ['td', 'first_down', 'tod']),
  resultRule(eq('type', 'sack'), ['tod', 'safety']),
  resultRule(inn('type', ['throwaway', 'dead_snap', 'foul_drawn']), ['tod']),
  {
    field: 'xp_result', kind: 'choice', show: XP, required: ALWAYS,
    options: ['1xp_allowed', '1xp_prevented', '2xp_allowed', '2xp_prevented', 'xp_retry']
  }
];

export const RULES: Record<Unit, FieldRule[]> = { offense: OFFENSE_RULES, defense: DEFENSE_RULES };

export function evalCond(cond: Cond, values: Record<string, unknown>): boolean {
  if ('all' in cond) return cond.all.every((c) => evalCond(c, values));
  if ('any' in cond) return cond.any.some((c) => evalCond(c, values));
  if ('not' in cond) return !evalCond(cond.not, values);
  const v = values[cond.f];
  if ('eq' in cond) return v === cond.eq;
  if ('in' in cond) return cond.in.includes(v as Value);
  const present = v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  return cond.set ? present : !present;
}
