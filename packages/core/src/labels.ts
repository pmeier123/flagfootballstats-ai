import type { Unit } from './types.js';

export const FIELD_LABELS: Record<string, string> = {
  lineup: 'Spieler auf dem Feld',
  qb_id: 'Quarterback',
  blitzer_ids: 'Blitzer',
  type: 'Spielzugtyp',
  player_id: 'Spieler',
  pass_result: 'Passergebnis',
  target_result: 'Target-Ergebnis',
  incomplete_reason: 'Grund Incomplete',
  air_yards: 'Air Yards',
  yards_after_catch: 'Yards after Catch',
  yards_run: 'Gelaufene Yards',
  flag_pulls_missed: 'Verpasste Flag Pulls',
  yards_lost: 'Verlorene Yards',
  flag_puller_id: 'Flag Puller',
  failed_puller_ids: 'Fehlgeschlagene Flag-Pull-Versuche',
  foul: 'Foul',
  foul_yards: 'Foul Yards',
  result: 'Ergebnis',
  xp_result: 'Extrapunkt-Ergebnis'
};

export const TYPE_LABELS: Record<Unit, Record<string, string>> = {
  offense: {
    pass: 'Pass', run: 'Run', sack: 'Sack', throwaway: 'Throwaway', dead_snap: 'Dead Snap',
    foul_committed: 'Foul begangen', foul_drawn: 'Foul gezogen'
  },
  defense: {
    target: 'Target', run: 'Run', sack: 'Sack', throwaway: 'Throwaway', dead_snap: 'Dead Snap',
    foul_committed: 'Foul begangen', foul_drawn: 'Foul gezogen'
  }
};

export const OPTION_LABELS: Record<string, string> = {
  catch: 'Catch',
  incomplete: 'Incomplete',
  interception: 'Interception',
  catch_allowed: 'Catch zugelassen',
  fifty_fifty: '50/50-Ball',
  drop: 'Drop',
  uncatchable: 'Nicht fangbar',
  batted: 'Abgefälscht',
  td: 'Touchdown',
  first_down: 'First Down',
  tod: 'Turnover on Downs',
  pick_6: 'Pick 6',
  safety: 'Safety',
  '1xp_made': '1 XP gemacht',
  '1xp_missed': '1 XP verfehlt',
  '2xp_made': '2 XP gemacht',
  '2xp_missed': '2 XP verfehlt',
  '1xp_allowed': '1 XP zugelassen',
  '1xp_prevented': '1 XP verhindert',
  '2xp_allowed': '2 XP zugelassen',
  '2xp_prevented': '2 XP verhindert',
  xp_retry: 'XP Retry',
  illegal_contact: 'Illegaler Kontakt',
  screening_bb: 'Abschirmen / BB',
  false_start: 'False Start',
  flag_guarding_jumping: 'Flag Guarding / Jumping',
  unsporting: 'Unsportliches Verhalten',
  illegal_blitz: 'Illegaler Blitz',
  flag_guarding: 'Flag Guarding',
  other: 'Sonstiges'
};

export function optionLabel(value: string | number): string {
  if (typeof value === 'number') return value === 30 ? '30+' : String(value);
  return OPTION_LABELS[value] ?? value;
}

export function typeLabel(unit: Unit, type: string): string {
  return TYPE_LABELS[unit][type] ?? type;
}
