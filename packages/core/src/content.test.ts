import { describe, expect, it } from 'vitest';
import {
  buildGameTables, buildLegacyImport, buildPlayersTable, buildTickerEntries, computeLiveStats, effectivePlays,
  filterTickerEntries, headerRow, parseCsv, parseLegacyTimestamp, planSheetWrites, playSentence, toCsv, TAB_COLUMNS,
  type Game, type GameEvent, type Player, type PlayData
} from './index.js';

const mk = (id: string, nr: string, name: string, active = true): Player => ({
  id, number: nr, name, active, offense_prio: 1, defense_prio: 1, qb_prio: 9, blitz_prio: 9, updated_at: 0
});
const players = [mk('pq', '54', 'Oskar Küsgen'), mk('pb', '96', 'Daniel Binder'), mk('pw', '93', 'Bryan Wiegand'), mk('pr', '37', 'Robin Konrad'), mk('ph', '14', 'Henrik Jansen'), mk('pl', '23', 'Thorsten Lenz'), mk('pp', '95', 'Lorenz Hornung'), mk('pm', '91', 'Max')];
const lookup = (id: string | undefined | null) => {
  const p = players.find((x) => x.id === id);
  return p ? { number: p.number, name: p.name } : undefined;
};
const L5 = ['pw', 'pq', 'pb', 'pr', 'ph'];
const base = { unit: 'offense', type: 'pass', lineup: L5, qb_id: 'pq' } as const;
const ev = (id: string, ts: number, data: Partial<PlayData>): GameEvent => ({
  id, game_id: 'g1', client_ts: ts, author_id: 'u1', kind: 'play', data: { ...base, ...data } as PlayData
});
const game: Game = { id: 'g1', opponent_team_id: 't', date: '2026-09-19', occasion: 'group_stage', venue: null, status: 'live', ticker_token: 'tok', updated_at: 0 };

describe('ticker sentences', () => {
  it('names receiver, qb, both yard values, missed pull and first down', () => {
    const t = playSentence({ ...base, player_id: 'pb', pass_result: 'catch', air_yards: 15, yards_after_catch: 15, flag_pulls_missed: 1, result: 'first_down' } as PlayData, lookup);
    expect(t).toContain('#96 Daniel Binder');
    expect(t).toContain('QB #54 Oskar Küsgen');
    expect(t).toContain('15 air yards');
    expect(t).toContain('15 yards after the catch');
    expect(t).toContain('1 missed flag pull');
    expect(t).toContain('First down');
  });

  it('covers every field kind', () => {
    const s = (d: Partial<PlayData>) => playSentence({ ...base, ...d } as PlayData, lookup, { own: 'Emperors', opp: 'Knights' });
    expect(s({ pass_result: 'incomplete', player_id: 'pb', incomplete_reason: 'drop' })).toContain('Drop');
    expect(s({ pass_result: 'interception', player_id: 'pb', result: 'pick_6' })).toContain('Pick 6 for Knights');
    expect(s({ type: 'run', player_id: 'pb', yards_run: 10, flag_pulls_missed: 2, result: 'td' })).toMatch(/10 yards.*2 missed flag pulls.*Touchdown Emperors/);
    expect(s({ type: 'sack', yards_lost: -5, result: 'safety' })).toMatch(/-5 yards.*Safety for Knights/);
    expect(s({ type: 'foul_committed', foul: 'other', foul_yards: -5, player_id: 'pb' })).toContain('Other (-5 yards)');
    expect(s({ type: 'throwaway', result: 'tod' })).toContain('Turnover on downs');
    expect(s({ xp_result: '2xp_made', player_id: 'pb', pass_result: 'catch', air_yards: 5 })).toContain('2 XP made');
  });

  it('defense sentences include pullers and perspective of touchdowns', () => {
    const d: PlayData = { unit: 'defense', type: 'target', lineup: L5, player_id: 'pl', target_result: 'catch_allowed', flag_puller_id: 'pp', failed_puller_ids: ['pm', 'pl'], result: 'td' };
    const t = playSentence(d, lookup, { own: 'Emperors', opp: 'Knights' });
    expect(t).toContain('#23 Thorsten Lenz');
    expect(t).toContain('Flag pull by #95 Lorenz Hornung');
    expect(t).toContain('missed by #91 Max, #23 Thorsten Lenz');
    expect(t).toContain('Touchdown Knights');
  });

  it('builds entries with highlights, scoring, corrections and filters', () => {
    const events: GameEvent[] = [
      ev('a', 1000, { player_id: 'pb', pass_result: 'catch', air_yards: 5, result: 'td' }),
      ev('b', 2000, { type: 'run', player_id: 'pw', yards_run: 5, xp_result: '1xp_made' }),
      ev('c', 3000, { type: 'sack', yards_lost: -5 }),
      { id: 'e', game_id: 'g1', client_ts: 4000, author_id: 'u1', kind: 'edit', replaces_id: 'c', data: { ...base, type: 'sack', yards_lost: -10 } as PlayData }
    ];
    const entries = buildTickerEntries(effectivePlays(events), lookup);
    expect(entries.map((e) => e.highlight)).toEqual(['touchdown', 'xp', 'sack']);
    expect(entries[2]!.corrected).toBe(true);
    expect(entries[0]!.scoring?.points).toBe(6);
    expect(entries[0]!.details[0]).toContain('On field');
    expect(filterTickerEntries(entries, { scoringOnly: true }).map((e) => e.id)).toEqual(['a', 'b']);
    expect(filterTickerEntries(entries, { playerId: 'pq' }).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(filterTickerEntries(entries, { playerId: 'pw' }).map((e) => e.id)).toEqual(['b']);
    expect(filterTickerEntries(entries, { unit: 'defense' })).toHaveLength(0);
  });
});

describe('live statistics', () => {
  it('completion rate is 60% for 6 catches of 10 attempts', () => {
    const evs: GameEvent[] = [];
    for (let i = 0; i < 6; i++) evs.push(ev(`c${i}`, 1000 + i, { player_id: 'pb', pass_result: 'catch', air_yards: 10, yards_after_catch: 5 }));
    for (let i = 0; i < 3; i++) evs.push(ev(`i${i}`, 2000 + i, { player_id: 'pb', pass_result: 'incomplete', incomplete_reason: 'drop' }));
    evs.push(ev('x', 3000, { player_id: 'pb', pass_result: 'interception' }));
    evs.push(ev('t', 3100, { type: 'throwaway' }));
    const s = computeLiveStats(effectivePlays(evs));
    expect(s.passAttempts).toBe(10);
    expect(s.completionRate).toBe(60);
    expect(s.airYards).toBe(60);
    expect(s.yardsAfterCatch).toBe(30);
    expect(s.interceptionsThrown).toBe(1);
    expect(s.top.receptions[0]).toEqual({ playerId: 'pb', value: 6 });
  });

  it('counts defense stats and returns null rate without attempts', () => {
    const evs = [
      ev('d1', 1, { unit: 'defense', type: 'sack', player_id: 'pl' } as never),
      ev('d2', 2, { unit: 'defense', type: 'target', player_id: 'pl', target_result: 'interception' } as never),
      ev('d3', 3, { unit: 'defense', type: 'target', player_id: 'pl', target_result: 'catch_allowed', flag_puller_id: 'pp' } as never),
      ev('d4', 4, { unit: 'defense', type: 'foul_drawn', foul: 'unsporting' } as never)
    ];
    const s = computeLiveStats(effectivePlays(evs));
    expect(s.sacksMade).toBe(1);
    expect(s.interceptionsMade).toBe(1);
    expect(s.foulsDrawn).toBe(1);
    expect(s.top.flagPulls[0]).toEqual({ playerId: 'pp', value: 1 });
    expect(s.completionRate).toBeNull();
  });
});

describe('export tables', () => {
  const events: GameEvent[] = [
    ev('a', 1000, { player_id: 'pb', pass_result: 'catch', air_yards: 15, result: 'td', yards_after_catch: 0 }),
    ev('b', 2000, { type: 'run', player_id: 'pw', yards_run: 5, xp_result: '1xp_made', blitzer_ids: undefined }),
    ev('c', 3000, { type: 'sack', yards_lost: -5 }),
    { id: 'v', game_id: 'g1', client_ts: 4000, author_id: 'u1', kind: 'void', voids_id: 'c' },
    { id: 'k', game_id: 'g1', client_ts: 4500, author_id: 'u1', kind: 'comment', text: 'ToD vergessen' }
  ];
  const t = buildGameTables({ game, opponentName: 'Knights', events, players, authorName: () => 'Bryan' });
  const col = (tab: keyof typeof TAB_COLUMNS, name: string) => TAB_COLUMNS[tab].indexOf(name);

  it('writes one row per play with typed values and marks voided plays', () => {
    expect(t.plays).toHaveLength(3);
    const a = t.plays[0]!;
    expect(a[col('plays', 'air_yards')]).toBe(15);
    expect(a[col('plays', 'incomplete_reason')]).toBeNull();
    expect(a[col('plays', 'player_name')]).toBe('Daniel Binder');
    expect(a[col('plays', 'voided')]).toBe(false);
    expect(t.plays[2]![col('plays', 'voided')]).toBe(true);
    expect(a.length).toBe(headerRow('plays').length);
  });

  it('writes five lineup rows per play and removes voided plays from lineups and scores', () => {
    expect(t.lineups.filter((r) => r[0] === 'a')).toHaveLength(5);
    expect(t.lineups.some((r) => r[0] === 'c')).toBe(false);
    expect(t.scores.map((r) => [r[0], r[col('scores', 'points')]])).toEqual([['a', 6], ['b', 1]]);
    expect(t.games[0]![col('games', 'own_points')]).toBe(7);
    expect(t.games[0]![col('games', 'plays')]).toBe(2);
    expect(t.comments).toHaveLength(1);
  });

  it('players table is keyed by player id', () => {
    expect(buildPlayersTable(players)[0]![0]).toBe('pq');
  });

  it('plans minimal writes: append new, update changed, clear removed, skip identical', () => {
    const first = planSheetWrites([], t.scores, () => true);
    expect(first.appends).toHaveLength(2);
    const existing = t.scores.map((r) => ({ key: String(r[r.length - 2]), hash: String(r[r.length - 1]) }));
    const same = planSheetWrites(existing, t.scores, () => true);
    expect(same).toEqual({ updates: [], appends: [], clears: [] });
    const changed = t.scores.map((r) => [...r]);
    changed[0]![changed[0]!.length - 1] = 'different';
    expect(planSheetWrites(existing, changed, () => true).updates.map((u) => u.rowIndex)).toEqual([0]);
    const removed = planSheetWrites(existing, [t.scores[0]!], () => true);
    expect(removed.clears).toEqual([1]);
    expect(planSheetWrites(existing, [t.scores[0]!], (k) => k !== 'b').clears).toEqual([]);
  });

  it('retry after partial failure never duplicates rows', () => {
    const afterPartial = [{ key: 'a', hash: String(t.scores[0]![t.scores[0]!.length - 1]) }];
    const plan = planSheetWrites(afterPartial, t.scores, () => true);
    expect(plan.appends).toHaveLength(1);
    expect(plan.appends[0]![0]).toBe('b');
  });
});

describe('csv', () => {
  it('parses quotes, semicolons and BOM and writes valid CSV', () => {
    expect(parseCsv('\uFEFFnumber;name\r\n97;"Ulrich; Yunus"\r\n')).toEqual([{ number: '97', name: 'Ulrich; Yunus' }]);
    expect(parseCsv('a,b\n1,"x ""y"""\n')).toEqual([{ a: '1', b: 'x "y"' }]);
    expect(toCsv(['a', 'b'], [[1, 'x,y'], [null, 'z']])).toBe('a,b\r\n1,"x,y"\r\n,z\r\n');
  });
});

describe('legacy import', () => {
  const row = (o: Record<string, string>) => ({
    eventtype: 'Pass', player: 'default', 'current-qb': '54 Oskar Küsgen', 'pass-result': 'default', 'incomplete-reason': 'default',
    'air-yards': '0', 'yards-after-catch': '0', 'yards-run': '0', 'tackles-broken': '0', result: 'default', 'sack-yards-lost': '0',
    foul: 'default', opponent: 'Sassenberg Knights', 'foul-yards': '0', timestamp: '19.09.2026, 10:33', occasion: 'group-stage',
    typist: 'Veronika Schneider', 'line-up': '93,54,96,37,14', ...o
  });
  const drow = (o: Record<string, string>) => ({
    eventtype: 'Target', player: '23 Thorsten Lenz', 'current-blitzer': '91 Max', 'target-result': 'default', 'incomplete-reason': 'default',
    'flag-pull-attempter': 'default', 'flag-puller': 'default', foul: 'default', 'foul-yards': '0', result: 'default', occasion: 'group-stage',
    typist: 'Bryan Wiegand', opponent: 'Sassenberg Knights', 'line-up': '92,91,95,23,98', timestamp: '19.09.2026, 10:29', ...o
  });
  const roster = [...players, mk('pa', '92', 'Eric Benschneider'), mk('ps', '98', 'Sebastian Reuter')];
  const input = (o: Partial<Parameters<typeof buildLegacyImport>[0]> = {}) => ({
    offense: [], defense: [], comments: [], players: roster, existingTeams: [], newToken: () => 'tok', now: 1, ...o
  });

  it('maps default to empty, strings to numbers and old values to enums', () => {
    const { bundle, report } = buildLegacyImport(input({
      offense: [
        row({ 'pass-result': 'Catch', player: '96 Daniel Binder', 'air-yards': '30', 'yards-after-catch': '15', 'tackles-broken': '1', result: 'First down' }),
        row({ 'pass-result': 'Incomplete', player: '96 Daniel Binder', 'incomplete-reason': 'Batted / deflected', timestamp: '19.09.2026, 10:34' })
      ],
      defense: [drow({ 'target-result': 'Catch allowed', 'flag-puller': '95', result: 'Touchdown' })]
    }));
    expect(report.canImport).toBe(true);
    const plays = bundle.events.filter((e) => e.kind === 'play') as Extract<GameEvent, { kind: 'play' }>[];
    const a = plays.find((p) => p.id === 'legacy-offense-0')!.data;
    expect(a).toMatchObject({ pass_result: 'catch', air_yards: 30, yards_after_catch: 15, flag_pulls_missed: 1, result: 'first_down', player_id: 'pb', qb_id: 'pq' });
    expect(a.incomplete_reason).toBeUndefined();
    const b = plays.find((p) => p.id === 'legacy-offense-1')!.data;
    expect(b.incomplete_reason).toBe('batted');
    expect(b.air_yards).toBeUndefined();
    const d = plays.find((p) => p.id === 'legacy-defense-0')!.data;
    expect(d).toMatchObject({ unit: 'defense', target_result: 'catch_allowed', result: 'td', flag_puller_id: 'pp', blitzer_ids: ['pm'] });
  });

  it('maps type, foul and xp values', () => {
    const { bundle } = buildLegacyImport(input({
      offense: [
        row({ eventtype: 'Foul committed', foul: 'Flag guarding / Jumping', player: '96 Daniel Binder', result: 'ToD' }),
        row({ eventtype: 'Pass', 'pass-result': 'Catch', player: '96 Daniel Binder', result: '1XP made', timestamp: '19.09.2026, 10:35' })
      ]
    }));
    const plays = bundle.events.filter((e): e is Extract<GameEvent, { kind: 'play' }> => e.kind === 'play');
    expect(plays[0]!.data).toMatchObject({ type: 'foul_committed', foul: 'flag_guarding_jumping', result: 'tod' });
    expect(plays[1]!.data.xp_result).toBe('1xp_made');
    expect(plays[1]!.data.result).toBeUndefined();
  });

  it('creates one game per opponent+occasion and links plays by id', () => {
    const { bundle, report } = buildLegacyImport(input({
      offense: [row({}), row({ opponent: 'Semi final', occasion: 'semifinal', timestamp: '19.09.2026, 12:00' })]
    }));
    expect(bundle.games).toHaveLength(2);
    expect(new Set(bundle.events.map((e) => e.game_id)).size).toBe(2);
    expect(bundle.teams.map((t) => t.name).sort()).toEqual(['Sassenberg Knights', 'Semi final']);
    expect(report.pseudoOpponents).toEqual(['Semi final']);
    expect(bundle.games.every((g) => g.status === 'finished')).toBe(true);
  });

  it('parses Berlin time (summer and winter) and keeps row order within a minute', () => {
    expect(new Date(parseLegacyTimestamp('19.09.2026, 13:35')!).toISOString()).toBe('2026-09-19T11:35:00.000Z');
    expect(new Date(parseLegacyTimestamp('12.12.2025, 13:35')!).toISOString()).toBe('2025-12-12T12:35:00.000Z');
    expect(parseLegacyTimestamp('kaputt')).toBeUndefined();
    const { bundle } = buildLegacyImport(input({ offense: [row({}), row({}), row({})] }));
    const ts = bundle.events.map((e) => e.client_ts);
    expect(ts).toEqual([...ts].sort((x, y) => x - y));
    expect(new Set(ts).size).toBe(3);
  });

  it('reports unresolved and ambiguous references and blocks the import', () => {
    const dup = [...roster, mk('p97b', '97', 'Yunus B'), mk('p97a', '97', 'Yunus A')];
    const { report } = buildLegacyImport(input({
      players: dup,
      offense: [row({ 'line-up': '17,97,93,54,96' })]
    }));
    expect(report.canImport).toBe(false);
    expect(report.unresolvedRefs).toEqual(expect.arrayContaining([
      { ref: '17', reason: 'unknown', count: 1 }, { ref: '97', reason: 'ambiguous', count: 1 }
    ]));
  });

  it('a mapping file resolves references; null drops them', () => {
    const { report, bundle } = buildLegacyImport(input({
      offense: [row({ 'line-up': '17,93,54,96,37' })],
      numberMap: { '17': null }
    }));
    expect(report.canImport).toBe(true);
    const play = bundle.events[0] as Extract<GameEvent, { kind: 'play' }>;
    expect(play.data.lineup).toEqual(['pw', 'pq', 'pb', 'pr']);
  });

  it('is repeatable: same input gives identical ids and keeps existing tokens', () => {
    const i = input({ offense: [row({})], comments: [{ comment: 'ToD vergessen', timestamp: '19.09.2026, 10:40' }] });
    const a = buildLegacyImport(i);
    const b = buildLegacyImport({ ...i, existingGames: a.bundle.games.map((g) => ({ ...g, ticker_token: 'kept' })), existingTeams: a.bundle.teams });
    expect(b.bundle.events.map((e) => e.id)).toEqual(a.bundle.events.map((e) => e.id));
    expect(b.bundle.games[0]!.ticker_token).toBe('kept');
    expect(b.bundle.teams).toHaveLength(0);
    expect(a.report.counts.comments).toBe(1);
  });

  it('assigns comments by time, reports unassigned ones, ignores "default" comments', () => {
    const { report } = buildLegacyImport(input({
      offense: [row({})],
      comments: [
        { comment: 'x', timestamp: '19.09.2026, 10:50' },
        { comment: 'weit weg', timestamp: '01.01.2026, 10:50' },
        { comment: 'default', timestamp: '19.09.2026, 10:35' }
      ]
    }));
    expect(report.counts.comments).toBe(1);
    expect(report.unassignedComments).toHaveLength(1);
  });

  it('does not import hidden legacy values and reports them', () => {
    const { bundle, report } = buildLegacyImport(input({
      offense: [row({ eventtype: 'Run', player: '96 Daniel Binder', 'pass-result': 'Catch', 'air-yards': '10', 'yards-run': '5' })]
    }));
    const d = (bundle.events[0] as Extract<GameEvent, { kind: 'play' }>).data;
    expect(d.pass_result).toBeUndefined();
    expect(d.air_yards).toBeUndefined();
    expect(d.yards_run).toBe(5);
    expect(report.droppedValues.map((x) => x.field)).toEqual(expect.arrayContaining(['pass_result', 'air_yards']));
  });

  it('reports unmapped values, skipped rows, typists, ambiguous minutes and per-game score', () => {
    const { report } = buildLegacyImport(input({
      offense: [row({ result: 'Touchdown', 'pass-result': 'Catch', player: '96 Daniel Binder' }), row({ eventtype: 'Unbekannt' }), row({ timestamp: 'x' }), row({ foul: 'Neu', eventtype: 'Foul drawn' })],
      defense: [drow({ timestamp: '19.09.2026, 10:33' })]
    }));
    expect(report.skippedRows.map((s) => s.row).sort()).toEqual([1, 2]);
    expect(report.unmappedValues).toEqual([{ column: 'foul', value: 'Neu', count: 1 }]);
    expect(report.typists.sort()).toEqual(['Bryan Wiegand', 'Veronika Schneider']);
    expect(report.ambiguousOrderMinutes).toBe(1);
    expect(report.games[0]).toMatchObject({ own: 6, opp: 0 });
  });
});
