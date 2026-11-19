import { sideOfTouchdown, type Side } from './xp.js';
import type { EffectivePlay, Unit } from './types.js';

export interface ScoringEvent {
  event_id: string;
  ts: number;
  unit: Unit;
  scoring_team: Side;
  points: number;
  reason: 'touchdown' | 'pick_6' | 'safety' | 'xp_1' | 'xp_2';
}

export interface Score {
  own: number;
  opp: number;
  events: ScoringEvent[];
}

function scoringOf(play: EffectivePlay): Omit<ScoringEvent, 'event_id' | 'ts' | 'unit'> | undefined {
  const d = play.data;
  switch (d.result) {
    case 'td':
      return { scoring_team: sideOfTouchdown(d.unit, 'td'), points: 6, reason: 'touchdown' };
    case 'pick_6':
      return { scoring_team: sideOfTouchdown(d.unit, 'pick_6'), points: 6, reason: 'pick_6' };
    case 'safety':
      return { scoring_team: d.unit === 'offense' ? 'opp' : 'own', points: 2, reason: 'safety' };
    default:
      break;
  }
  const own = d.unit === 'offense';
  switch (d.xp_result) {
    case '1xp_made': return own ? { scoring_team: 'own', points: 1, reason: 'xp_1' } : undefined;
    case '2xp_made': return own ? { scoring_team: 'own', points: 2, reason: 'xp_2' } : undefined;
    case '1xp_allowed': return !own ? { scoring_team: 'opp', points: 1, reason: 'xp_1' } : undefined;
    case '2xp_allowed': return !own ? { scoring_team: 'opp', points: 2, reason: 'xp_2' } : undefined;
    default: return undefined;
  }
}

/** Score from effective plays only; independent of input order. */
export function computeScore(plays: readonly EffectivePlay[]): Score {
  const sorted = [...plays].sort((a, b) => a.client_ts - b.client_ts || (a.id < b.id ? -1 : 1));
  const events: ScoringEvent[] = [];
  let own = 0;
  let opp = 0;
  for (const p of sorted) {
    const s = scoringOf(p);
    if (!s) continue;
    events.push({ event_id: p.id, ts: p.client_ts, unit: p.data.unit, ...s });
    if (s.scoring_team === 'own') own += s.points;
    else opp += s.points;
  }
  return { own, opp, events };
}

