import { describe, expect, it } from 'vitest';
import { buildTickerModel, effectivePlays, extraPointStateBefore, playSummary, type GameEvent, type PlayData } from './index.js';

const lookup = (id: string | undefined | null) => (id === 'b' ? { number: '96', name: 'Daniel Binder' } : undefined);
const L = ['a', 'b', 'c', 'd', 'e'];
const play = (id: string, ts: number, d: Partial<PlayData>): GameEvent => ({ id, game_id: 'g', client_ts: ts, author_id: null, kind: 'play', data: { unit: 'offense', type: 'pass', lineup: L, qb_id: 'a', ...d } as PlayData });

describe('ticker model', () => {
  it('summary of the latest event', () => {
    expect(playSummary({ unit: 'offense', type: 'pass', lineup: L, player_id: 'b', pass_result: 'catch', result: 'first_down' }, lookup)).toBe('Pass, #96 Daniel Binder, First down');
  });

  it('derives score, clock, entries and stats in one go', () => {
    const evs: GameEvent[] = [
      play('1', 1000, { player_id: 'b', pass_result: 'catch', air_yards: 10, result: 'td' }),
      play('2', 2000, { player_id: 'b', pass_result: 'catch', air_yards: 5, xp_result: '1xp_made' }),
      { id: 'm', game_id: 'g', client_ts: 3000, author_id: null, kind: 'marker', marker: 'quarter_end' }
    ];
    const m = buildTickerModel(evs, lookup);
    expect(m.score).toMatchObject({ own: 7, opp: 0 });
    expect(m.periodLabel).toBe('Q2');
    expect(m.clock.atBreak).toBe(true);
    expect(m.entries).toHaveLength(2);
    expect(m.stats.completionRate).toBe(100);
  });

  it('extra-point phase before an older play', () => {
    const plays = effectivePlays([play('1', 1000, { result: 'td' }), play('2', 2000, { xp_result: '1xp_made' }), play('3', 3000, {})]);
    expect(extraPointStateBefore(plays, '2').active).toBe(true);
    expect(extraPointStateBefore(plays, '3').active).toBe(false);
    expect(extraPointStateBefore(plays, '1').active).toBe(false);
  });
});
