import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('./migrations/0001_init.sql', import.meta.url)), 'utf8');

const STUB = `
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  grant usage on schema public, auth to anon, authenticated;
`;

let db: PGlite;
const ids: Record<string, string> = {};

async function as(who: 'anon' | string) {
  await db.exec('reset role');
  if (who === 'anon') {
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.exec('set role anon');
  } else {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ids[who]]);
    await db.exec('set role authenticated');
  }
}
async function rpc<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  const ph = args.map((_, i) => `$${i + 1}${typeof args[i] === 'object' ? '::jsonb' : ''}`).join(', ');
  const r = await db.query<{ r: T }>(`select public.${fn}(${ph}) as r`, args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)));
  return r.rows[0]!.r;
}
const ev = (id: string, game: string, ts: number, kind = 'marker', payload: unknown = { marker: 'drive_end' }) => ({ id, game_id: game, client_ts: ts, kind, payload });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(migration);
  for (const [name, email] of [['admin', 'a@x.de'], ['typist', 't@x.de'], ['other', 'o@x.de'], ['viewer', 'v@x.de']]) {
    const r = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
    ids[name!] = r.rows[0]!.id;
  }
  await db.query(`update public.app_user set role = 'typist' where id in ($1, $2)`, [ids.typist, ids.other]);
});

describe('roles', () => {
  it('first user is admin, later users start as viewer', async () => {
    const r = await db.query<{ email: string; role: string }>('select email, role from public.app_user order by email');
    expect(Object.fromEntries(r.rows.map((x) => [x.email, x.role]))).toMatchObject({ 'a@x.de': 'admin', 'v@x.de': 'viewer' });
  });
});

describe('master data', () => {
  it('admin writes, typist cannot, viewer sees no roster data', async () => {
    await as('admin');
    const now = 1000;
    await rpc('push_rows', 'teams', [{ id: 'own', name: 'Aachen Emperors', is_own: true, updated_at: now }, { id: 'opp', name: 'Knights', is_own: false, updated_at: now }]);
    await rpc('push_rows', 'players', [
      { id: 'p1', number: '12', name: 'Felix', active: true, offense_prio: 1, defense_prio: 3, qb_prio: 9, blitz_prio: 2, updated_at: now },
      { id: 'p2', number: '54', name: 'Oskar', active: true, offense_prio: 1, defense_prio: 9, qb_prio: 1, blitz_prio: 9, updated_at: now }
    ]);
    await rpc('push_rows', 'games', [{ id: 'g1', opponent_team_id: 'opp', date: '2026-09-19', occasion: 'final', venue: null, status: 'live', ticker_token: 'TOKEN-1', updated_at: now }]);
    await rpc('push_rows', 'roster', [{ game_id: 'g1', player_id: 'p1', present: true, updated_at: now }, { game_id: 'g1', player_id: 'p2', present: false, updated_at: now }]);
    await rpc('push_rows', 'typists', [{ id: 'ty1', game_id: 'g1', user_id: ids.typist, from_ts: now, to_ts: null, updated_at: now }]);

    await as('typist');
    await expect(rpc('push_rows', 'players', [{ id: 'p9', number: '1', name: 'X', active: true, offense_prio: 1, defense_prio: 1, qb_prio: 1, blitz_prio: 1, updated_at: 1 }])).rejects.toThrow(/Berechtigung/);
    await as('viewer');
    const pulled = await rpc<{ rows: Record<string, unknown[]> }>('pull_rows', 0);
    expect(pulled.rows.players).toEqual([]);
    expect(pulled.rows.games).toEqual([]);
  });

  it('last write wins: an older update does not overwrite', async () => {
    await as('admin');
    await rpc('push_rows', 'players', [{ id: 'p1', number: '12', name: 'Felix NEU', active: true, offense_prio: 1, defense_prio: 3, qb_prio: 9, blitz_prio: 2, updated_at: 2000 }]);
    await rpc('push_rows', 'players', [{ id: 'p1', number: '12', name: 'Felix ALT', active: true, offense_prio: 1, defense_prio: 3, qb_prio: 9, blitz_prio: 2, updated_at: 1500 }]);
    const r = await db.query<{ name: string }>(`select name from public.players where id = 'p1'`);
    expect(r.rows[0]!.name).toBe('Felix NEU');
  });

  it('pull returns rows changed since the cursor and a new cursor', async () => {
    await as('typist');
    const first = await rpc<{ cursor: number; rows: { players: unknown[] } }>('pull_rows', 0);
    expect(first.rows.players).toHaveLength(2);
    expect(first.cursor).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 20));
    await as('admin');
    await rpc('push_rows', 'players', [{ id: 'p1', number: '12', name: 'Felix 3', active: true, offense_prio: 1, defense_prio: 3, qb_prio: 9, blitz_prio: 2, updated_at: 3000 }]);
    await as('typist');
    const delta = await rpc<{ cursor: number; rows: { players: { id: string; name: string }[] } }>('pull_rows', first.cursor);
    expect(delta.rows.players.find((p) => p.id === 'p1')?.name).toBe('Felix 3');
    expect(delta.cursor).toBeGreaterThan(first.cursor);
    const none = await rpc<{ rows: { players: unknown[] } }>('pull_rows', delta.cursor + 60_000);
    expect(none.rows.players).toEqual([]);
  });
});

describe('events', () => {
  it('active typist records, seq is assigned per game, resending is idempotent', async () => {
    await as('typist');
    const a = await rpc<{ id: string; seq: number }[]>('push_events', [ev('e2', 'g1', 20), ev('e1', 'g1', 10), ev('e3', 'g1', 30)]);
    expect(a.map((x) => [x.id, x.seq])).toEqual([['e1', 1], ['e2', 2], ['e3', 3]]);
    const again = await rpc<{ id: string; seq: number }[]>('push_events', [ev('e2', 'g1', 20), ev('e4', 'g1', 40)]);
    expect(again.map((x) => [x.id, x.seq])).toEqual([['e2', 2], ['e4', 4]]);
    const count = await db.query<{ c: number }>(`select count(*)::int as c from public.events where game_id = 'g1'`);
    expect(count.rows[0]!.c).toBe(4);
  });

  it('rejects non-assigned typists, viewers and unknown games; direct inserts are impossible', async () => {
    await as('other');
    await expect(rpc('push_events', [ev('x1', 'g1', 1)])).rejects.toThrow(/aktive Typist/);
    await as('viewer');
    await expect(rpc('push_events', [ev('x2', 'g1', 1)])).rejects.toThrow(/Berechtigung/);
    await as('typist');
    await expect(rpc('push_events', [ev('x3', 'nope', 1)])).rejects.toThrow(/unbekannt/);
    await expect(db.query(`insert into public.events (id, game_id, seq, client_ts, kind, payload) values ('d', 'g1', 99, 1, 'marker', '{}')`)).rejects.toThrow(/permission|row-level/i);
    await expect(db.query(`update public.events set payload = '{}' where id = 'e1'`)).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    const r = await db.query<{ payload: unknown }>(`select payload from public.events where id = 'e1'`);
    expect(r.rows[0]!.payload).toEqual({ marker: 'drive_end' });
  });

  it('finished games lock typists but not admins; a not-live game rejects typists', async () => {
    await as('admin');
    const g = { id: 'g1', opponent_team_id: 'opp', date: '2026-09-19', occasion: 'final', venue: null, ticker_token: 'TOKEN-1' };
    await rpc('push_rows', 'games', [{ ...g, status: 'finished', updated_at: 5000 }]);
    await as('typist');
    await expect(rpc('push_events', [ev('f1', 'g1', 50)])).rejects.toThrow(/beendet/);
    await as('admin');
    const r = await rpc<{ seq: number }[]>('push_events', [ev('f2', 'g1', 60, 'void', { voids_id: 'e1' })]);
    expect(r[0]!.seq).toBe(5);
    await rpc('push_rows', 'games', [{ ...g, status: 'planned', updated_at: 5001 }]);
    await as('typist');
    await expect(rpc('push_events', [ev('f3', 'g1', 70)])).rejects.toThrow(/läuft noch nicht/);
    await as('admin');
    await rpc('push_rows', 'games', [{ ...g, status: 'live', updated_at: 5002 }]);
  });

  it('handover: typist ends his assignment and starts the next one, the new typist can record', async () => {
    await as('typist');
    await rpc('push_rows', 'typists', [
      { id: 'ty1', game_id: 'g1', user_id: ids.typist, from_ts: 1000, to_ts: 9000, updated_at: 9000 },
      { id: 'ty2', game_id: 'g1', user_id: ids.other, from_ts: 9000, to_ts: null, updated_at: 9000 }
    ]);
    await expect(rpc('push_events', [ev('h1', 'g1', 80)])).rejects.toThrow(/aktive Typist/);
    await as('other');
    const r = await rpc<{ seq: number }[]>('push_events', [ev('h2', 'g1', 90)]);
    expect(r[0]!.seq).toBe(6);
  });
});

describe('ticker access', () => {
  it('anonymous users cannot read tables but can call ticker_snapshot with a valid token', async () => {
    await as('anon');
    await expect(db.query('select * from public.events')).rejects.toThrow(/permission denied/);
    await expect(db.query('select * from public.games')).rejects.toThrow(/permission denied/);
    await expect(db.query('select * from public.players')).rejects.toThrow(/permission denied/);
    await expect(rpc('push_events', [ev('z', 'g1', 1)])).rejects.toThrow();
    expect(await rpc('ticker_snapshot', 'wrong-token', 0)).toBeNull();
    expect(await rpc('ping')).toBe(1);

    const snap = await rpc<{
      game: { id: string }; own_name: string; opp_name: string; players: { id: string }[]; events: { seq: number; author_id?: string }[]; max_seq: number;
    }>('ticker_snapshot', 'TOKEN-1', 0);
    expect(snap.game.id).toBe('g1');
    expect([snap.own_name, snap.opp_name]).toEqual(['Aachen Emperors', 'Knights']);
    expect(snap.players.map((p) => p.id)).toEqual(['p1']);
    expect(snap.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(snap.events[0]).not.toHaveProperty('author_id');
    expect(snap.max_seq).toBe(6);

    const delta = await rpc<{ events: { seq: number }[] }>('ticker_snapshot', 'TOKEN-1', 5);
    expect(delta.events.map((e) => e.seq)).toEqual([6]);
  });

  it('regenerating the token invalidates the old link', async () => {
    await as('admin');
    await rpc('push_rows', 'games', [{ id: 'g1', opponent_team_id: 'opp', date: '2026-09-19', occasion: 'final', venue: null, status: 'live', ticker_token: 'TOKEN-2', updated_at: 9999 }]);
    await as('anon');
    expect(await rpc('ticker_snapshot', 'TOKEN-1', 0)).toBeNull();
    expect(await rpc('ticker_snapshot', 'TOKEN-2', 0)).not.toBeNull();
    await expect(db.query('select * from public.game_seq')).rejects.toThrow(/permission denied/);
    await expect(db.query('select * from public.settings')).rejects.toThrow(/permission denied/);
  });
});

describe('export status', () => {
  it('is hidden until the export is switched on and then shows progress', async () => {
    await as('typist');
    expect(await rpc('export_status', 'g1')).toBeNull();
    await db.exec('reset role');
    await db.exec(`insert into public.settings values ('sheets_export', 'on')`);
    await db.exec(`insert into public.export_state (game_id, last_seq) values ('g1', 4)`);
    await as('typist');
    expect(await rpc('export_status', 'g1')).toMatchObject({ last_seq: 4, last_error: null });
    await as('anon');
    await expect(rpc('export_status', 'g1')).rejects.toThrow();
  });
});
