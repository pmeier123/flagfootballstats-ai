import { describe, expect, it } from 'vitest';
import {
  activeTypist, canRecord, canTransition, finishWarnings, generateToken, handover, parsePlayersCsv, sortPlayers,
  validateGame, validatePlayer, type Game, type Player, type TypistAssignment
} from './index.js';

const mk = (id: string, number: string, name: string, over: Partial<Player> = {}): Player => ({
  id, number, name, active: true, offense_prio: 9, defense_prio: 9, qb_prio: 9, blitz_prio: 9, updated_at: 0, ...over
});

describe('roster rules', () => {
  it('validates priorities and mandatory fields', () => {
    expect(validatePlayer(mk('a', '97', 'Yunus', { offense_prio: 0 }), [])).toHaveProperty('offense_prio');
    expect(validatePlayer(mk('a', '97', 'Yunus', { qb_prio: 10 }), [])).toHaveProperty('qb_prio');
    expect(validatePlayer(mk('a', '', ''), [])).toMatchObject({ number: expect.any(String), name: expect.any(String) });
    expect(validatePlayer(mk('a', '2V', 'Veronika'), [])).toEqual({});
  });

  it('rejects a duplicate number among active players, allows it for inactive', () => {
    const other = mk('b', '97', 'Yunus Ulrich');
    expect(validatePlayer(mk('a', '97', 'Neu'), [other]).number).toContain('Yunus Ulrich');
    expect(validatePlayer(mk('a', '97', 'Neu', { active: false }), [other])).toEqual({});
    expect(validatePlayer(mk('b', '97', 'Yunus Ulrich'), [other])).toEqual({});
  });

  it('sorts by priority then jersey number', () => {
    const ps = [mk('a', '93', 'A', { qb_prio: 9 }), mk('b', '97', 'B', { qb_prio: 2 }), mk('c', '54', 'C', { qb_prio: 1 }), mk('d', '2V', 'D', { qb_prio: 9 }), mk('e', '12', 'E', { qb_prio: 9 })];
    expect(sortPlayers(ps, 'qb').map((p) => p.id)).toEqual(['c', 'b', 'd', 'e', 'a']);
    expect(sortPlayers(ps).map((p) => p.number)).toEqual(['2V', '12', '54', '93', '97']);
  });

  it('CSV import reports invalid rows and nothing else is stored', () => {
    const csv = 'number;name;offense_order\r\n1;Anna;2\r\n;Ohne Nummer;1\r\n2;;1\r\n1;Doppelt;1\r\n97;Yunus Neu;1\r\n3;Falsch;11\r\n';
    const r = parsePlayersCsv(csv, [mk('x', '97', 'Yunus Ulrich')]);
    expect(r.valid.map((p) => p.number)).toEqual(['1']);
    expect(r.valid[0]).toMatchObject({ offense_prio: 2, defense_prio: 9 });
    expect(r.invalid.map((i) => i.row)).toEqual([2, 3, 4, 5, 6]);
    expect(r.invalid[3]!.reason).toContain('Yunus Ulrich');
  });
});

const game: Game = { id: 'g', opponent_team_id: 't', date: '2026-09-19', occasion: 'final', venue: null, status: 'live', ticker_token: 'x', updated_at: 0 };
const asg = (user: string, to: number | null = null): TypistAssignment => ({ id: `a-${user}`, game_id: 'g', user_id: user, from_ts: 0, to_ts: to, updated_at: 0 });

describe('game rules', () => {
  it('requires opponent, date and occasion', () => {
    expect(Object.keys(validateGame({})).sort()).toEqual(['date', 'occasion', 'opponent_team_id']);
    expect(validateGame({ opponent_team_id: 't', date: '2026-09-19', occasion: 'final' })).toEqual({});
    expect(validateGame({ opponent_team_id: 't', date: 'morgen', occasion: 'final' })).toHaveProperty('date');
  });

  it('allows only planned>live, live>finished and admin reopen', () => {
    expect(canTransition('planned', 'live', 'admin')).toBe(true);
    expect(canTransition('live', 'finished', 'admin')).toBe(true);
    expect(canTransition('finished', 'live', 'admin')).toBe(true);
    expect(canTransition('planned', 'finished', 'admin')).toBe(false);
    expect(canTransition('finished', 'planned', 'admin')).toBe(false);
    expect(canTransition('planned', 'live', 'typist')).toBe(false);
  });

  it('only the active typist may record in a live game; admins always', () => {
    const a = [asg('u1')];
    expect(canRecord({ game, userId: 'u1', role: 'typist', assignments: a }).ok).toBe(true);
    expect(canRecord({ game, userId: 'u2', role: 'typist', assignments: a }).ok).toBe(false);
    expect(canRecord({ game: { ...game, status: 'finished' }, userId: 'u1', role: 'typist', assignments: a }).reason).toContain('beendet');
    expect(canRecord({ game: { ...game, status: 'planned' }, userId: 'u1', role: 'typist', assignments: a }).ok).toBe(false);
    expect(canRecord({ game: { ...game, status: 'finished' }, userId: 'adm', role: 'admin', assignments: [] }).ok).toBe(true);
    expect(canRecord({ game, userId: 'v', role: 'viewer', assignments: a }).ok).toBe(false);
  });

  it('handover ends the previous assignment and starts a new one', () => {
    const rows = handover([asg('u1')], 'g', 'u2', 500, 'n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: 'u1', to_ts: 500 });
    expect(rows[1]).toMatchObject({ user_id: 'u2', to_ts: null });
    expect(activeTypist([...rows], 'g')!.user_id).toBe('u2');
    expect(handover([asg('u1')], 'g', 'u1', 500, 'n')).toEqual([]);
  });

  it('finish warnings list open issues', () => {
    expect(finishWarnings([], 2, 1)).toMatchObject({ hasWarnings: true, missingGameEnd: true, playsWithoutResult: 2, unsyncedEvents: 1 });
    expect(finishWarnings([{ id: 'm', game_id: 'g', client_ts: 1, author_id: null, kind: 'marker', marker: 'game_end' }], 0, 0).hasWarnings).toBe(false);
  });

  it('tokens are random and url safe', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateToken()).not.toBe(t);
  });
});
