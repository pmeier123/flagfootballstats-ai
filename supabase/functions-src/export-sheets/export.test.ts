import { describe, expect, it } from 'vitest';
import { headerRow, TAB_COLUMNS, TABS, type Cell, type Game, type GameEvent, type Player, type SheetPlan, type TabName } from '../../../packages/core/src/index.ts';
import { runExport, type DbApi, type SheetsApi } from './job.ts';
import { colLetter, GoogleSheets } from './sheets.ts';

const game: Game = { id: 'g1', opponent_team_id: 't', date: '2026-09-19', occasion: 'final', venue: null, status: 'live', ticker_token: 'x', updated_at: 1 };
const players: Player[] = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, number: String(10 + i), name: `Spieler ${id}`, active: true, offense_prio: 1, defense_prio: 1, qb_prio: 1, blitz_prio: 1, updated_at: 0 }));
const L5 = players.map((p) => p.id);
const play = (id: string, ts: number, data: object): GameEvent => ({
  id, game_id: 'g1', client_ts: ts, author_id: 'u', kind: 'play', data: { unit: 'offense', type: 'pass', lineup: L5, qb_id: 'a', ...data } as never
});

class FakeDb implements DbApi {
  events: GameEvent[] = [];
  lastSeq = 0;
  error: string | null = null;
  progressWrites = 0;
  maxSeq = () => this.events.length;
  async gamesNeedingExport() { return this.maxSeq() > this.lastSeq ? [{ game_id: 'g1', max_seq: this.maxSeq(), last_seq: this.lastSeq }] : []; }
  async loadGame() { return { game, opponentName: 'Knights', events: [...this.events], maxSeq: this.maxSeq() }; }
  async loadPlayers() { return players; }
  async authorNames() { return new Map([['u', 'Bryan']]); }
  async saveProgress(_g: string, seq: number, error: string | null) { this.progressWrites++; this.error = error; if (!error) this.lastSeq = seq; }
}

class FakeSheet implements SheetsApi {
  tabs = new Map<TabName, (Cell[] | null)[]>();
  writes = 0;
  failAfter = Infinity;
  async ensureTabs(t: { name: TabName }[]) { t.forEach((x) => this.tabs.has(x.name) || this.tabs.set(x.name, [])); }
  async readKeys(tab: TabName) { return (this.tabs.get(tab) ?? []).map((r) => (r ? { key: String(r[r.length - 2]), hash: String(r[r.length - 1]) } : { key: '', hash: '' })); }
  async write(tab: TabName, plan: SheetPlan) {
    if (++this.writes > this.failAfter) throw new Error('Quota');
    const rows = this.tabs.get(tab)!;
    plan.updates.forEach((u) => (rows[u.rowIndex] = u.values));
    plan.clears.forEach((i) => (rows[i] = null));
    plan.appends.forEach((r) => rows.push(r));
  }
  live(tab: TabName) { return (this.tabs.get(tab) ?? []).filter((r): r is Cell[] => !!r); }
}

describe('export run', () => {
  it('exports all tabs once and writes nothing on the second run', async () => {
    const db = new FakeDb();
    const sheet = new FakeSheet();
    db.events = [play('a', 1000, { player_id: 'b', pass_result: 'catch', air_yards: 15, result: 'td' }), play('b', 2000, { type: 'run', player_id: 'c', yards_run: 5, xp_result: '1xp_made' })];
    const first = await runExport(db, sheet);
    expect(first.games).toEqual(['g1']);
    expect(sheet.live('plays')).toHaveLength(2);
    expect(sheet.live('lineups')).toHaveLength(10);
    expect(sheet.live('scores')).toHaveLength(2);
    expect(sheet.live('games')[0]![TAB_COLUMNS.games.indexOf('own_points')]).toBe(7);
    expect(sheet.live('players')).toHaveLength(5);
    expect(db.lastSeq).toBe(2);

    const writes = sheet.writes;
    const second = await runExport(db, sheet);
    expect(second.games).toEqual([]);
    expect(sheet.writes).toBe(writes);
    db.lastSeq = 0; // force a re-run without changes
    const third = await runExport(db, sheet);
    expect(third.writes).toEqual({});
    expect(sheet.writes).toBe(writes);
    expect(sheet.live('plays')).toHaveLength(2);
  });

  it('propagates edits and voids: updates the row, flags voided, removes score and lineup rows', async () => {
    const db = new FakeDb();
    const sheet = new FakeSheet();
    db.events = [play('a', 1000, { player_id: 'b', pass_result: 'catch', air_yards: 15, result: 'td' })];
    await runExport(db, sheet);
    db.events.push({ id: 'ed', game_id: 'g1', client_ts: 2000, author_id: 'u', kind: 'edit', replaces_id: 'a', data: { unit: 'offense', type: 'pass', lineup: L5, qb_id: 'a', player_id: 'b', pass_result: 'catch', air_yards: 20, result: 'first_down' } });
    await runExport(db, sheet);
    const row = sheet.live('plays')[0]!;
    expect(row[TAB_COLUMNS.plays.indexOf('air_yards')]).toBe(20);
    expect(row[TAB_COLUMNS.plays.indexOf('corrected')]).toBe(true);
    expect(sheet.live('scores')).toHaveLength(0);

    db.events.push(play('b', 3000, { type: 'run', player_id: 'c', yards_run: 5, result: 'td' }));
    await runExport(db, sheet);
    expect(sheet.live('scores')).toHaveLength(1);
    db.events.push({ id: 'v', game_id: 'g1', client_ts: 4000, author_id: 'u', kind: 'void', voids_id: 'b' });
    await runExport(db, sheet);
    expect(sheet.live('scores')).toHaveLength(0);
    expect(sheet.live('plays')).toHaveLength(2);
    const voided = sheet.live('plays').find((r) => r[0] === 'b')!;
    expect(voided[TAB_COLUMNS.plays.indexOf('voided')]).toBe(true);
    expect(sheet.live('lineups').filter((r) => r[0] === 'b')).toHaveLength(0);
    expect(sheet.live('lineups').filter((r) => r[0] === 'a')).toHaveLength(5);
  });

  it('failure keeps progress and records the error; the retry writes no duplicates', async () => {
    const db = new FakeDb();
    const sheet = new FakeSheet();
    db.events = [play('a', 1000, { player_id: 'b', pass_result: 'catch', air_yards: 15, result: 'td' }), play('b', 2000, { type: 'run', player_id: 'c', yards_run: 5 })];
    sheet.failAfter = 2;
    const failed = await runExport(db, sheet);
    expect(failed.failed).toHaveLength(1);
    expect(db.lastSeq).toBe(0);
    expect(db.error).toBe('Quota');
    sheet.failAfter = Infinity;
    const ok = await runExport(db, sheet);
    expect(ok.failed).toEqual([]);
    expect(db.error).toBeNull();
    expect(db.lastSeq).toBe(2);
    expect(sheet.live('plays')).toHaveLength(2);
    expect(new Set(sheet.live('plays').map((r) => r[0])).size).toBe(2);
    expect(sheet.live('lineups')).toHaveLength(10);
  });

  it('exports a large backlog in one run', async () => {
    const db = new FakeDb();
    const sheet = new FakeSheet();
    db.events = Array.from({ length: 500 }, (_, i) => play(`e${i}`, 1000 + i, { type: 'throwaway' }));
    await runExport(db, sheet);
    expect(sheet.live('plays')).toHaveLength(500);
    expect(sheet.live('lineups')).toHaveLength(2500);
  });
});

describe('Google Sheets client', () => {
  async function config() {
    const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    let bin = '';
    for (const b of der) bin += String.fromCharCode(b);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
    return { spreadsheetId: 'SID', clientEmail: 'svc@x.iam', privateKey: pem.replace(/\n/g, '\\n') };
  }

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

  it('column letters', () => {
    expect([1, 26, 27, 39, 52, 53].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AM', 'AZ', 'BA']);
  });

  it('authenticates with a signed JWT, caches the token and plans requests as expected', async () => {
    const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : undefined, auth: headers.authorization });
      if (url.startsWith('https://oauth2.googleapis.com')) return json({ access_token: 'TOK', expires_in: 3600 });
      if (url.includes('fields=sheets.properties.title')) return json({ sheets: [{ properties: { title: 'plays' } }] });
      if (url.includes('A1:A1')) return json({ valueRanges: TABS.map((t) => (t === 'plays' ? { values: [['event_id']] } : {})) });
      if (url.includes('values:batchGet?ranges=plays')) return json({ valueRanges: [{ values: [['k1'], [], ['k3']] }, { values: [['h1'], [], ['h3']] }] });
      return json({});
    };
    const sheets = new GoogleSheets(await config(), fetchFn, async () => undefined);
    await sheets.ensureTabs(TABS.map((name) => ({ name, header: headerRow(name) })));
    const keys = await sheets.readKeys('plays');
    expect(keys).toEqual([{ key: 'k1', hash: 'h1' }, { key: '', hash: '' }, { key: 'k3', hash: 'h3' }]);
    await sheets.write('scores', { updates: [{ rowIndex: 3, values: ['x', null, 2] }], appends: [['n', 1, true]], clears: [0] }, 9);

    const token = calls.filter((c) => c.url.startsWith('https://oauth2'));
    expect(token).toHaveLength(1);
    const assertion = new URLSearchParams(token[0]!.body).get('assertion')!;
    const [h, c] = assertion.split('.');
    expect(JSON.parse(atob(h!.replace(/-/g, '+').replace(/_/g, '/')))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(atob(c!.replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ iss: 'svc@x.iam', scope: 'https://www.googleapis.com/auth/spreadsheets' });
    const api = calls.filter((x) => x.url.startsWith('https://sheets'));
    expect(api.every((x) => x.auth === 'Bearer TOK')).toBe(true);
    const addSheet = api.find((x) => x.body?.includes('addSheet'))!;
    expect(JSON.parse(addSheet.body!).requests.map((r: { addSheet: { properties: { title: string } } }) => r.addSheet.properties.title)).not.toContain('plays');
    const headerWrite = api.find((x) => x.url.endsWith('values:batchUpdate') && x.body!.includes('lineups!A1'))!;
    expect(headerWrite.body).not.toContain('plays!A1');
    const upd = JSON.parse(api.find((x) => x.url.endsWith('values:batchUpdate') && x.body!.includes('scores!A5'))!.body!);
    expect(upd.data[0]).toEqual({ range: 'scores!A5', values: [['x', '', 2]] });
    const clr = JSON.parse(api.find((x) => x.url.endsWith('values:batchClear'))!.body!);
    expect(clr.ranges).toEqual(['scores!A2:I2']);
    const app = api.find((x) => x.url.includes('append'))!;
    expect(app.url).toContain('insertDataOption=INSERT_ROWS');
    expect(JSON.parse(app.body!).values).toEqual([['n', 1, true]]);
    expect(api.findIndex((x) => x.url.includes('append'))).toBeGreaterThan(api.findIndex((x) => x.url.endsWith('values:batchClear')));
  });

  it('backs off on quota errors (429) and then succeeds', async () => {
    let n = 0;
    const waits: number[] = [];
    const fetchFn = async (url: string) => {
      if (url.startsWith('https://oauth2')) return json({ access_token: 'T', expires_in: 3600 });
      return ++n < 3 ? json({ error: 'quota' }, 429) : json({ valueRanges: [] });
    };
    const sheets = new GoogleSheets(await config(), fetchFn, async (ms) => void waits.push(ms));
    expect(await sheets.readKeys('players')).toEqual([]);
    expect(waits).toEqual([1000, 2000]);
  });

  it('explains missing sharing and gives up after repeated failures', async () => {
    const forbidden = new GoogleSheets(await config(), async (u) => (u.startsWith('https://oauth2') ? json({ access_token: 'T', expires_in: 3600 }) : json({ error: 'nope' }, 403)), async () => undefined);
    await expect(forbidden.readKeys('plays')).rejects.toThrow(/geteilt/);
    let calls = 0;
    const flaky = new GoogleSheets(await config(), async (u) => (u.startsWith('https://oauth2') ? json({ access_token: 'T', expires_in: 3600 }) : (calls++, json({}, 503))), async () => undefined);
    await expect(flaky.readKeys('plays')).rejects.toThrow(/503/);
    expect(calls).toBe(6);
  });
});
