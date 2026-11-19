import type { EffectivePlay } from './types.js';

export interface TopEntry { playerId: string; value: number }

export interface LiveStats {
  passAttempts: number;
  completions: number;
  /** 0..100 or null when there are no pass attempts. */
  completionRate: number | null;
  interceptionsThrown: number;
  airYards: number;
  yardsAfterCatch: number;
  runYards: number;
  sacksTaken: number;
  sacksMade: number;
  interceptionsMade: number;
  foulsCommitted: number;
  foulsDrawn: number;
  top: {
    receptions: TopEntry[];
    runningYards: TopEntry[];
    flagPulls: TopEntry[];
    sacks: TopEntry[];
    interceptions: TopEntry[];
  };
}

function top(counter: Map<string, number>, n = 3): TopEntry[] {
  return [...counter.entries()]
    .map(([playerId, value]) => ({ playerId, value }))
    .sort((a, b) => b.value - a.value || (a.playerId < b.playerId ? -1 : 1))
    .slice(0, n);
}

function add(m: Map<string, number>, id: string | undefined, by = 1): void {
  if (id) m.set(id, (m.get(id) ?? 0) + by);
}

export function computeLiveStats(plays: readonly EffectivePlay[]): LiveStats {
  const s: LiveStats = {
    passAttempts: 0, completions: 0, completionRate: null, interceptionsThrown: 0, airYards: 0, yardsAfterCatch: 0,
    runYards: 0, sacksTaken: 0, sacksMade: 0, interceptionsMade: 0, foulsCommitted: 0, foulsDrawn: 0,
    top: { receptions: [], runningYards: [], flagPulls: [], sacks: [], interceptions: [] }
  };
  const rec = new Map<string, number>();
  const run = new Map<string, number>();
  const pulls = new Map<string, number>();
  const sacks = new Map<string, number>();
  const ints = new Map<string, number>();

  for (const { data: d } of plays) {
    if (d.type === 'foul_committed') s.foulsCommitted += 1;
    if (d.type === 'foul_drawn') s.foulsDrawn += 1;
    if (d.unit === 'offense') {
      if (d.type === 'pass' && d.pass_result) {
        s.passAttempts += 1;
        if (d.pass_result === 'catch') {
          s.completions += 1;
          s.airYards += d.air_yards ?? 0;
          s.yardsAfterCatch += d.yards_after_catch ?? 0;
          add(rec, d.player_id);
        }
        if (d.pass_result === 'interception') s.interceptionsThrown += 1;
      }
      if (d.type === 'run') {
        s.runYards += d.yards_run ?? 0;
        add(run, d.player_id, d.yards_run ?? 0);
      }
      if (d.type === 'sack') s.sacksTaken += 1;
    } else {
      if (d.type === 'sack') {
        s.sacksMade += 1;
        add(sacks, d.player_id);
      }
      if (d.type === 'target' && d.target_result === 'interception') {
        s.interceptionsMade += 1;
        add(ints, d.player_id);
      }
      if (d.type === 'target' || d.type === 'run') add(pulls, d.flag_puller_id);
    }
  }
  s.completionRate = s.passAttempts ? Math.round((s.completions / s.passAttempts) * 100) : null;
  s.top = {
    receptions: top(rec), runningYards: top(run).filter((t) => t.value > 0),
    flagPulls: top(pulls), sacks: top(sacks), interceptions: top(ints)
  };
  return s;
}
