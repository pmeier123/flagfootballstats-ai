import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameEvent, PlayData } from '@ffs/core';
import { computeSyncStatus, FakeBackend, NetworkError, Store, SyncEngine, ValidationError } from './index.js';

let n = 0;
function mkStore(): Store {
  return new Store({ name: `t${++n}`, indexedDB: new IDBFactory(), IDBKeyRange, now: () => 1000 + n, newId: () => `id${++n}` });
}
const data: PlayData = { unit: 'offense', type: 'throwaway', lineup: ['a', 'b', 'c', 'd', 'e'], qb_id: 'a' };
const ev = (id: string, ts = 1): GameEvent => ({ id, game_id: 'g', client_ts: ts, author_id: 'u', kind: 'play', data });
const engine = (store: Store, backend: FakeBackend | null, online = () => true) =>
  new SyncEngine(store, backend, { isOnline: online, setTimer: () => 0, clearTimer: () => undefined });

describe('sync status', () => {
  const base = { backendConfigured: true, online: true, pending: 0, sending: false, lastError: null, sheetsBehind: false };
  it('maps inputs to the five states and local-only', () => {
    expect(computeSyncStatus({ ...base, pending: 0 })).toMatchObject({ state: 'synced', browserMayClose: true });
    expect(computeSyncStatus({ ...base, sheetsBehind: true })).toMatchObject({ state: 'sheets_pending', browserMayClose: true });
    expect(computeSyncStatus({ ...base, pending: 3 })).toMatchObject({ state: 'sending', browserMayClose: false, pending: 3 });
    expect(computeSyncStatus({ ...base, pending: 3, online: false })).toMatchObject({ state: 'offline', browserMayClose: false });
    expect(computeSyncStatus({ ...base, pending: 3, lastError: 'kaputt' })).toMatchObject({ state: 'error', error: 'kaputt', browserMayClose: false });
    expect(computeSyncStatus({ ...base, backendConfigured: false, pending: 2 })).toMatchObject({ state: 'local_only', browserMayClose: false });
  });
});

describe('event delivery', () => {
  let store: Store;
  let backend: FakeBackend;
  beforeEach(() => { store = mkStore(); backend = new FakeBackend(); });

  it('stores locally first and works offline', async () => {
    backend.offline = true;
    const e = engine(store, backend, () => false);
    await store.recordEvent(ev('a'));
    await store.recordEvent(ev('b', 2));
    await store.recordEvent(ev('c', 3));
    await e.flush();
    expect(await store.countPending()).toBe(3);
    expect(e.current).toMatchObject({ state: 'offline', pending: 3, browserMayClose: false });
    expect((await store.eventsOf('g')).length).toBe(3);
    expect(backend.pushCalls).toBe(0);
  });

  it('delivers in batches, marks confirmed only after acknowledgement and assigns seq', async () => {
    const e = new SyncEngine(store, backend, { batchSize: 2, isOnline: () => true, setTimer: () => 0, clearTimer: () => undefined });
    for (let i = 0; i < 5; i++) await store.recordEvent(ev(`e${i}`, i));
    await e.flush();
    expect(backend.pushCalls).toBe(3);
    expect(await store.countPending()).toBe(0);
    expect(e.current).toMatchObject({ state: 'synced', browserMayClose: true });
    expect(await store.maxSeq('g')).toBe(5);
  });

  it('lost acknowledgement: resend creates no duplicates', async () => {
    await store.recordEvent(ev('a'));
    await store.recordEvent(ev('b', 2));
    backend.loseAcks = 1;
    const e = engine(store, backend);
    await e.flush();
    expect(await store.countPending()).toBe(2);
    expect(e.current.state).toBe('offline');
    await e.flush();
    expect(await store.countPending()).toBe(0);
    expect(backend.events.size).toBe(2);
  });

  it('server rejection shows an error with the cause and keeps events; recovers afterwards', async () => {
    await store.recordEvent(ev('a'));
    backend.failWith = new Error('Das Spiel ist beendet');
    const e = engine(store, backend);
    await e.flush();
    expect(e.current).toMatchObject({ state: 'error', pending: 1, error: 'Das Spiel ist beendet' });
    backend.failWith = null;
    await e.flush();
    expect(e.current.state).toBe('synced');
  });

  it('network failure is shown as offline with the pending count and retries on reconnect', async () => {
    await store.recordEvent(ev('a'));
    backend.offline = true;
    const e = engine(store, backend);
    await e.flush();
    expect(e.current).toMatchObject({ state: 'offline', pending: 1 });
    backend.offline = false;
    await e.flush();
    expect(e.current.state).toBe('synced');
  });

  it('schedules retries with growing delay', async () => {
    const delays: number[] = [];
    const e = new SyncEngine(store, backend, { isOnline: () => true, setTimer: (_f, ms) => { delays.push(ms); return 1; }, clearTimer: () => undefined });
    await store.recordEvent(ev('a'));
    backend.offline = true;
    await e.flush();
    await e.flush();
    await e.flush();
    expect(delays).toEqual([2000, 4000, 8000]);
  });

  it('concurrent flushes share one run', async () => {
    await store.recordEvent(ev('a'));
    const e = engine(store, backend);
    await Promise.all([e.flush(), e.flush(), e.flush()]);
    expect(backend.pushCalls).toBe(1);
  });

  it('shows sheets_pending while the export is behind, synced when it caught up', async () => {
    await store.recordEvent(ev('a'));
    backend.exportLastSeq = 0;
    const e = engine(store, backend);
    e.watchGame('g');
    await e.flush();
    expect(e.current).toMatchObject({ state: 'sheets_pending', browserMayClose: true });
    backend.exportLastSeq = 1;
    await e.pollExport();
    expect(e.current.state).toBe('synced');
  });

  it('works without a backend: local only, nothing is sent', async () => {
    await store.recordEvent(ev('a'));
    const e = engine(store, null);
    await e.flush();
    expect(e.current).toMatchObject({ state: 'local_only', pending: 1, browserMayClose: false });
    expect(e.current.message).toContain('nur auf diesem Gerät');
  });

  it('pulls events recorded on another device without overwriting local ones', async () => {
    await store.recordEvent(ev('mine'));
    const e = engine(store, backend);
    await e.flush();
    backend.events.set('theirs', { ...({ id: 'theirs', game_id: 'g', client_ts: 5, author_id: 'x', kind: 'marker', payload: { marker: 'drive_end' }, seq: 2 }) });
    await e.pullGame('g');
    const ids = (await store.eventsOf('g')).map((x) => x.id).sort();
    expect(ids).toEqual(['mine', 'theirs']);
    expect(await store.countPending()).toBe(0);
  });
});

describe('master data', () => {
  it('validates players, blocks duplicate numbers and deletes of referenced players', async () => {
    const s = mkStore();
    const p = await s.savePlayer({ number: '97', name: 'Yunus', offense_prio: 1, defense_prio: 9, qb_prio: 1, blitz_prio: 9 });
    await expect(s.savePlayer({ number: '97', name: 'Doppelt', offense_prio: 1, defense_prio: 1, qb_prio: 1, blitz_prio: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.savePlayer({ number: '1', name: 'X', offense_prio: 0, defense_prio: 1, qb_prio: 1, blitz_prio: 1 })).rejects.toThrow();
    const team = await s.saveTeam('Knights');
    const game = await s.saveGame({ opponent_team_id: team.id, date: '2026-09-19', occasion: 'final' });
    await s.recordEvent({ id: 'e', game_id: game.id, client_ts: 1, author_id: null, kind: 'play', data: { ...data, lineup: [p.id], qb_id: p.id } });
    await expect(s.deletePlayer(p.id)).rejects.toThrow(/deaktiviert/);
    await s.setPlayersActive([p.id], false);
    expect((await s.listPlayers())[0]!.active).toBe(false);
    const q = await s.savePlayer({ number: '97', name: 'Neu', offense_prio: 1, defense_prio: 1, qb_prio: 1, blitz_prio: 1 });
    await expect(s.setPlayersActive([p.id], true)).rejects.toBeInstanceOf(ValidationError);
    await s.deletePlayer(q.id);
  });

  it('reuses teams by name, enforces game lifecycle and invalidates old token', async () => {
    const s = mkStore();
    const a = await s.saveTeam('Knights');
    const b = await s.saveTeam(' knights ');
    expect(b.id).toBe(a.id);
    const g = await s.saveGame({ opponent_team_id: a.id, date: '2026-09-19', occasion: 'dffl_game' });
    await expect(s.saveGame({ opponent_team_id: '', date: '', occasion: 'final' } as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.setGameStatus(g.id, 'finished', 'admin')).rejects.toBeInstanceOf(ValidationError);
    await s.setGameStatus(g.id, 'live', 'admin');
    await s.setGameStatus(g.id, 'finished', 'admin');
    expect((await s.setGameStatus(g.id, 'live', 'admin')).status).toBe('live');
    const g2 = await s.regenerateToken(g.id);
    expect(g2.ticker_token).not.toBe(g.ticker_token);
  });

  it('roster: set, remove, list', async () => {
    const s = mkStore();
    await s.setRoster('g', ['a', 'b']);
    await s.setRoster('g', ['b', 'c']);
    expect((await s.rosterOf('g')).sort()).toEqual(['b', 'c']);
  });

  it('last-write-wins sync between two devices', async () => {
    const backend = new FakeBackend();
    const s1 = mkStore();
    const s2 = mkStore();
    const e1 = engine(s1, backend);
    const e2 = engine(s2, backend);
    const p = await s1.savePlayer({ number: '12', name: 'Felix', offense_prio: 1, defense_prio: 3, qb_prio: 9, blitz_prio: 2 });
    await e1.syncMaster();
    await e2.syncMaster();
    expect((await s2.listPlayers()).map((x) => x.name)).toEqual(['Felix']);
    await s2.savePlayer({ id: p.id, number: '12', name: 'Felix H.', offense_prio: 1, defense_prio: 3, qb_prio: 9, blitz_prio: 2 });
    await e2.syncMaster();
    await e1.syncMaster();
    expect((await s1.listPlayers())[0]!.name).toBe('Felix H.');
  });

  it('keeps a newer local unsynced edit when the server has an older version', async () => {
    const backend = new FakeBackend();
    const s = mkStore();
    const p = await s.savePlayer({ number: '1', name: 'Alt', offense_prio: 1, defense_prio: 1, qb_prio: 1, blitz_prio: 1 });
    await s.applyRemoteRows('players', [{ ...p, name: 'Server alt', updated_at: p.updated_at - 10 }]);
    expect((await s.listPlayers())[0]!.name).toBe('Alt');
    await s.applyRemoteRows('players', [{ ...p, name: 'Server neu', updated_at: p.updated_at + 10 }]);
    expect((await s.listPlayers())[0]!.name).toBe('Server neu');
    void backend;
  });

  it('applying an import bundle twice does not duplicate anything', async () => {
    const s = mkStore();
    const bundle = {
      teams: [{ id: 't', name: 'K', is_own: false, updated_at: 1 }],
      games: [{ id: 'g', opponent_team_id: 't', date: '2026-09-19', occasion: 'final' as const, venue: null, status: 'finished' as const, ticker_token: 'x', updated_at: 1 }],
      roster: [{ game_id: 'g', player_id: 'a', present: true, updated_at: 1 }],
      events: [ev('x1')]
    };
    await s.applyBundle(bundle);
    await s.applyBundle(bundle);
    expect(await s.eventsOf('g')).toHaveLength(1);
    expect(await s.listGames()).toHaveLength(1);
    expect(NetworkError).toBeDefined();
  });
});
