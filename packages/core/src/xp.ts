import type { EffectivePlay, PlayData, Unit } from './types.js';

export type Side = 'own' | 'opp';

export interface ExtraPointState {
  active: boolean;
  /** Unit expected to record the attempt (hint only). */
  expectedUnit: Unit | null;
}

/** The side that benefits from a touchdown/pick-6 recorded by `unit`. */
export function sideOfTouchdown(unit: Unit, result: 'td' | 'pick_6'): Side {
  if (result === 'td') return unit === 'offense' ? 'own' : 'opp';
  return unit === 'offense' ? 'opp' : 'own';
}

/**
 * Extra-point phase: the newest effective play scored a touchdown/pick-6 or asked for an XP retry.
 * Derived from the log so it survives device changes and reloads.
 */
export function extraPointState(plays: readonly EffectivePlay[]): ExtraPointState {
  const last = plays[plays.length - 1]?.data;
  if (!last) return { active: false, expectedUnit: null };
  return extraPointStateOfPlay(last);
}

export function extraPointStateOfPlay(last: PlayData): ExtraPointState {
  if (last.xp_result === 'xp_retry') return { active: true, expectedUnit: last.unit };
  if (last.result === 'td' || last.result === 'pick_6') {
    const side = sideOfTouchdown(last.unit, last.result);
    return { active: true, expectedUnit: side === 'own' ? 'offense' : 'defense' };
  }
  return { active: false, expectedUnit: null };
}

/** Extra-point phase as it was right before the given play (used when editing an older play). */
export function extraPointStateBefore(plays: readonly EffectivePlay[], playId: string): ExtraPointState {
  const i = plays.findIndex((p) => p.id === playId);
  return extraPointState(i < 0 ? plays : plays.slice(0, i));
}


