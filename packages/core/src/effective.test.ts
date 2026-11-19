import { describe, expect, it } from 'vitest';
import {
  computeScore, deriveTimeline, effectiveComments, effectivePlays, extraPointState, gameClock, undoTarget,
  type GameEvent, type PlayData
} from './index.js';

let n = 0;
const L5 = ['p1', 'p2', 'p3', 'p4', 'p5'];
function play(over: Partial<PlayData>, id = `e${++n}`, ts = ++n * 1000): GameEvent {
  return {
    id, game_id: 'g', client_ts: ts, author_id: 'u', kind: 'play',
    data: { unit: 'offense', type: 'pass', lineup: L5, qb_id: 'p1', ...over } as PlayData
  };
}
const marker = (m: GameEvent extends infer E ? (E extends { kind: 'marker' } ? E['marker'] : never) : never, ts: number): GameEvent => ({
  id: `m${ts}`, game_id: 'g', client_ts: ts, author_id: 'u', kind: 'marker', marker: m
});

describe('effective plays', () => {
  it('applies the latest edit and keeps the original in the log', () => {
    const a = play({ player_id: 'p2', pass_result: 'catch', result: 'td' }, 'a', 1000);
    const edit: GameEvent = { id: 'x1', game_id: 'g', client_ts: 2000, author_id: 'u', kind: 'edit', replaces_id: 'a', data: { ...(a as { data: PlayData }).data, result: 'first_down' } };
    const edit2: GameEvent = { id: 'x2', game_id: 'g', client_ts: 3000, author_id: 'u', kind: 'edit', replaces_id: 'a', data: { ...(a as { data: PlayData }).data, result: 'tod' } };
    const plays = effectivePlays([a, edit, edit2]);
    expect(plays).toHaveLength(1);
    expect(plays[0]!.data.result).toBe('tod');
    expect(plays[0]!.corrected).toBe(true);
  });

  it('removes voided plays and ignores edits of unknown plays', () => {
    const a = play({ result: 'td' }, 'a', 1000);
    const v: GameEvent = { id: 'v', game_id: 'g', client_ts: 2000, author_id: 'u', kind: 'void', voids_id: 'a' };
    const stray: GameEvent = { id: 's', game_id: 'g', client_ts: 2500, author_id: 'u', kind: 'edit', replaces_id: 'zzz', data: { unit: 'offense', type: 'pass', lineup: [] } };
    expect(effectivePlays([a, v, stray])).toHaveLength(0);
  });

  it('an edit does not resurrect a voided play', () => {
    const a = play({}, 'a', 1000);
    const v: GameEvent = { id: 'v', game_id: 'g', client_ts: 2000, author_id: 'u', kind: 'void', voids_id: 'a' };
    const e: GameEvent = { id: 'e', game_id: 'g', client_ts: 3000, author_id: 'u', kind: 'edit', replaces_id: 'a', data: { unit: 'offense', type: 'run', lineup: L5 } };
    expect(effectivePlays([a, v, e])).toHaveLength(0);
  });

  it('is independent of input order', () => {
    const evs = [play({ result: 'td' }, 'a', 1000), play({ xp_result: '1xp_made' }, 'b', 2000), play({}, 'c', 3000)];
    expect(effectivePlays([...evs].reverse()).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('undo targets the newest effective play', () => {
    const a = play({}, 'a', 1000);
    const b = play({}, 'b', 2000);
    const v: GameEvent = { id: 'v', game_id: 'g', client_ts: 3000, author_id: 'u', kind: 'void', voids_id: 'b' };
    expect(undoTarget([a, b])!.id).toBe('b');
    expect(undoTarget([a, b, v])!.id).toBe('a');
    expect(undoTarget([])).toBeUndefined();
  });

  it('comments of voided plays are hidden, game comments stay', () => {
    const a = play({}, 'a', 1000);
    const v: GameEvent = { id: 'v', game_id: 'g', client_ts: 2000, author_id: 'u', kind: 'void', voids_id: 'a' };
    const c1: GameEvent = { id: 'c1', game_id: 'g', client_ts: 1500, author_id: 'u', kind: 'comment', text: 'x', play_id: 'a' };
    const c2: GameEvent = { id: 'c2', game_id: 'g', client_ts: 1600, author_id: 'u', kind: 'comment', text: 'y' };
    expect(effectiveComments([a, c1, c2, v]).map((c) => c.id)).toEqual(['c2']);
  });
});

describe('timeline', () => {
  it('derives quarter from markers (end + start => Q2)', () => {
    const evs = [play({}, 'a', 1000), marker('quarter_end', 2000), marker('quarter_start', 2100), play({}, 'b', 3000)];
    const plays = effectivePlays(evs);
    expect(plays.map((p) => p.period)).toEqual([1, 2]);
    expect(gameClock(evs).period).toBe(2);
  });

  it('quarter end followed directly by halftime advances once', () => {
    const evs = [play({}, 'a', 1000), marker('quarter_end', 2000), marker('halftime', 2100), play({}, 'b', 3000)];
    expect(effectivePlays(evs)[1]!.period).toBe(2);
    expect(gameClock([...evs.slice(0, 3)]).halftime).toBe(true);
  });

  it('counts drives and detects game end', () => {
    const evs = [play({}, 'a', 1000), marker('drive_end', 1500), marker('drive_end', 1600), play({}, 'b', 2000), marker('game_end', 3000)];
    expect(effectivePlays(evs).map((p) => p.drive)).toEqual([1, 2]);
    expect(deriveTimeline(evs).clock.ended).toBe(true);
  });
});

describe('extra point detection', () => {
  it('is active after td, pick_6 and xp_retry; inactive otherwise', () => {
    const ep = (d: Partial<PlayData>) => extraPointState(effectivePlays([play(d)]));
    expect(ep({ result: 'td' })).toEqual({ active: true, expectedUnit: 'offense' });
    expect(ep({ unit: 'defense', type: 'target', result: 'td' })).toEqual({ active: true, expectedUnit: 'defense' });
    expect(ep({ unit: 'defense', type: 'target', result: 'pick_6' })).toEqual({ active: true, expectedUnit: 'offense' });
    expect(ep({ result: 'pick_6' })).toEqual({ active: true, expectedUnit: 'defense' });
    expect(ep({ xp_result: 'xp_retry' })).toEqual({ active: true, expectedUnit: 'offense' });
    expect(ep({ xp_result: '1xp_made' }).active).toBe(false);
    expect(ep({ result: 'first_down' }).active).toBe(false);
    expect(extraPointState([]).active).toBe(false);
  });

  it('voiding the touchdown ends the phase', () => {
    const a = play({ result: 'td' }, 'a', 1000);
    const v: GameEvent = { id: 'v', game_id: 'g', client_ts: 2000, author_id: 'u', kind: 'void', voids_id: 'a' };
    expect(extraPointState(effectivePlays([a])).active).toBe(true);
    expect(extraPointState(effectivePlays([a, v])).active).toBe(false);
  });

  it('is derived from the log, so another device sees the same phase', () => {
    const evs = [play({ result: 'td' }, 'a', 1000)];
    expect(extraPointState(effectivePlays(evs)).active).toBe(extraPointState(effectivePlays([...evs])).active);
  });
});

describe('scoring', () => {
  const score = (...ds: Partial<PlayData>[]) => {
    const evs = ds.map((d, i) => play(d, `s${i}`, (i + 1) * 1000));
    const s = computeScore(effectivePlays(evs));
    return [s.own, s.opp];
  };

  it('own offense touchdown and extra point', () => {
    expect(score({ result: 'td' }, { xp_result: '1xp_made' })).toEqual([7, 0]);
  });
  it('opponent touchdown on defense with 2xp allowed', () => {
    expect(score({ unit: 'defense', type: 'target', result: 'td' }, { unit: 'defense', type: 'run', xp_result: '2xp_allowed' })).toEqual([0, 8]);
  });
  it('pick-6 both directions', () => {
    expect(score({ unit: 'defense', type: 'target', result: 'pick_6' }, { result: 'pick_6' })).toEqual([6, 6]);
  });
  it('safety goes to the other side', () => {
    expect(score({ type: 'sack', result: 'safety' })).toEqual([0, 2]);
    expect(score({ unit: 'defense', type: 'sack', result: 'safety' })).toEqual([2, 0]);
  });
  it('no points for misses, fouls, first downs', () => {
    expect(score({ xp_result: '1xp_missed' }, { xp_result: '2xp_missed' }, { unit: 'defense', type: 'run', xp_result: '1xp_prevented' }, { result: 'first_down' }, { result: 'tod' }, { type: 'foul_drawn', foul: 'unsporting' })).toEqual([0, 0]);
  });
  it('2xp made counts 2, defense xp_made is ignored (wrong unit)', () => {
    expect(score({ xp_result: '2xp_made' })).toEqual([2, 0]);
    expect(score({ unit: 'defense', type: 'run', xp_result: '1xp_made' })).toEqual([0, 0]);
  });
  it('edit and void change the score', () => {
    const a = play({ result: 'td' }, 'a', 1000);
    const ed: GameEvent = { id: 'e', game_id: 'g', client_ts: 2000, author_id: 'u', kind: 'edit', replaces_id: 'a', data: { unit: 'offense', type: 'pass', lineup: L5, result: 'first_down' } };
    expect(computeScore(effectivePlays([a])).own).toBe(6);
    expect(computeScore(effectivePlays([a, ed])).own).toBe(0);
  });
  it('lists scoring events chronologically and is order independent', () => {
    const evs = [play({ result: 'td' }, 'a', 1000), play({ xp_result: '1xp_made' }, 'b', 2000)];
    const s = computeScore(effectivePlays([...evs].reverse()));
    expect(s.events.map((e) => [e.event_id, e.points, e.scoring_team])).toEqual([['a', 6, 'own'], ['b', 1, 'own']]);
  });
});
