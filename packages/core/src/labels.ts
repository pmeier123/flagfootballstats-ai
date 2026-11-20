import type { Unit } from './types.js';

export const FIELD_LABELS: Record<string, string> = {
  lineup: 'Players on field',
  qb_id: 'Quarterback',
  blitzer_ids: 'Blitzers',
  type: 'Play type',
  player_id: 'Player',
  pass_result: 'Pass result',
  target_result: 'Target result',
  incomplete_reason: 'Incomplete reason',
  air_yards: 'Air yards',
  yards_after_catch: 'Yards after catch',
  yards_run: 'Run yards',
  flag_pulls_missed: 'Missed flag pulls',
  yards_lost: 'Yards lost',
  flag_puller_id: 'Flag puller',
  failed_puller_ids: 'Missed pullers',
  foul: 'Foul',
  foul_yards: 'Foul yards',
  result: 'Result',
  xp_result: 'Extra point result'
};

export const TYPE_LABELS: Record<Unit, Record<string, string>> = {
  offense: {
    pass: 'Pass', run: 'Run', sack: 'Sack', throwaway: 'Throwaway', dead_snap: 'Dead Snap',
    foul_committed: 'Foul committed', foul_drawn: 'Foul drawn'
  },
  defense: {
    target: 'Target', run: 'Run', sack: 'Sack', throwaway: 'Throwaway', dead_snap: 'Dead Snap',
    foul_committed: 'Foul committed', foul_drawn: 'Foul drawn'
  }
};

export const OPTION_LABELS: Record<string, string> = {
  catch: 'Catch',
  incomplete: 'Incomplete',
  interception: 'Interception',
  catch_allowed: 'Catch allowed',
  fifty_fifty: '50/50 ball',
  drop: 'Drop',
  uncatchable: 'Uncatchable',
  batted: 'Batted',
  td: 'Touchdown',
  first_down: 'First down',
  tod: 'Turnover on downs',
  pick_6: 'Pick 6',
  safety: 'Safety',
  '1xp_made': '1 XP made',
  '1xp_missed': '1 XP missed',
  '2xp_made': '2 XP made',
  '2xp_missed': '2 XP missed',
  '1xp_allowed': '1 XP allowed',
  '1xp_prevented': '1 XP prevented',
  '2xp_allowed': '2 XP allowed',
  '2xp_prevented': '2 XP prevented',
  xp_retry: 'XP retry',
  illegal_contact: 'Illegal contact',
  screening_bb: 'Screening / BB',
  false_start: 'False start',
  flag_guarding_jumping: 'Flag guarding / jumping',
  unsporting: 'Unsportsmanlike conduct',
  illegal_blitz: 'Illegal blitz',
  flag_guarding: 'Flag guarding',
  other: 'Other'
};

export function optionLabel(value: string | number): string {
  if (typeof value === 'number') return value === 30 ? '30+' : String(value);
  return OPTION_LABELS[value] ?? value;
}

export function typeLabel(unit: Unit, type: string): string {
  return TYPE_LABELS[unit][type] ?? type;
}
