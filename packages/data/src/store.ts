import Dexie, { type Table } from 'dexie';
import {
  canTransition, generateToken, validateGame, validatePlayer,
  type Game, type GameEvent, type GameStatus, type LegacyBundle, type Player, type PlayerInput, type Role,
  type RosterEntry, type Team, type TypistAssignment
} from '@ffs/core';
import { type MasterRows, type MasterTable, MASTER_TABLES } from './backend.js';

export class ValidationError extends Error {
  constructor(public errors: Record<string, string>, message?: string) {
    super(message ?? Object.values(errors).join('; '));
    this.name = 'ValidationError';
  }
}

type Dirty = { dirty?: 0 | 1 };
export type StoredEvent = GameEvent & { synced: 0 | 1; seq?: number };

interface Meta { key: string; value: unknown }

export interface StoreOptions {
  name?: string;
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
  now?: () => number;
  newId?: () => string;
}

const strip = <T extends Dirty>(r: T): Omit<T, 'dirty'> => {
  const { dirty: _d, ...rest } = r;
  return rest;
};

export class Store {
  readonly db: Dexie;
  readonly now: () => number;
  readonly newId: () => string;
  get players(): Table<Player & Dirty, string> { return this.db.table('players'); }
  get teams(): Table<Team & Dirty, string> { return this.db.table('teams'); }
  get games(): Table<Game & Dirty, string> { return this.db.table('games'); }
  get roster(): Table<RosterEntry & Dirty, [string, string]> { return this.db.table('roster'); }
  get typists(): Table<TypistAssignment & Dirty, string> { return this.db.table('typists'); }
  get events(): Table<StoredEvent, string> { return this.db.table('events'); }
  get meta(): Table<Meta, string> { return this.db.table('meta'); }

  constructor(opts: StoreOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.db = new Dexie(opts.name ?? 'ffs', opts.indexedDB ? { indexedDB: opts.indexedDB, IDBKeyRange: opts.IDBKeyRange } : undefined);
    this.db.version(1).stores({
      players: 'id',
      teams: 'id',
      games: 'id, ticker_token',
      roster: '[game_id+player_id], game_id',
      typists: 'id, game_id',
      events: 'id, game_id, client_ts, synced',
      meta: 'key'
    });
  }

  // ---- meta -------------------------------------------------------------------------------------------------
  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.table<Meta>('meta').get(key))?.value as T | undefined;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.table<Meta>('meta').put({ key, value });
  }

  // ---- players ------------------------------------------------------------------------------------------------
  async listPlayers(): Promise<Player[]> {
    return (await this.players.toArray()).map(strip) as Player[];
  }

  async savePlayer(input: PlayerInput & { id?: string; active?: boolean }): Promise<Player> {
    const all = await this.listPlayers();
    const existing = input.id ? all.find((p) => p.id === input.id) : undefined;
    const player: Player = {
      id: existing?.id ?? input.id ?? this.newId(),
      number: input.number.trim(),
      name: input.name.trim(),
      active: input.active ?? existing?.active ?? true,
      offense_prio: input.offense_prio,
      defense_prio: input.defense_prio,
      qb_prio: input.qb_prio,
      blitz_prio: input.blitz_prio,
      updated_at: this.now()
    };
    const errors = validatePlayer(player, all);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    await this.players.put({ ...player, dirty: 1 });
    return player;
  }

  async setPlayersActive(ids: readonly string[], active: boolean): Promise<void> {
    const all = await this.listPlayers();
    const errors: Record<string, string> = {};
    for (const id of ids) {
      const p = all.find((x) => x.id === id);
      if (!p) continue;
      const e = validatePlayer({ ...p, active }, all.map((o) => (ids.includes(o.id) ? { ...o, active } : o)));
      if (e.number) errors[id] = e.number;
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const ts = this.now();
    await this.players.bulkPut(all.filter((p) => ids.includes(p.id)).map((p) => ({ ...p, active, updated_at: ts, dirty: 1 as const })));
  }

  /** Players referenced by any event or roster entry may not be deleted, only deactivated. */
  async isPlayerReferenced(id: string): Promise<boolean> {
    if ((await this.roster.toArray()).some((r) => r.player_id === id && r.present)) return true;
    for (const e of await this.events.toArray()) {
      const d = e.kind === 'play' || e.kind === 'edit' ? e.data : undefined;
      if (!d) continue;
      if (d.lineup.includes(id) || d.qb_id === id || d.player_id === id || d.flag_puller_id === id ||
        d.blitzer_ids?.includes(id) || d.failed_puller_ids?.includes(id)) return true;
    }
    return false;
  }

  async deletePlayer(id: string): Promise<void> {
    if (await this.isPlayerReferenced(id)) {
      throw new ValidationError({ id: 'Der Spieler wird in Spielen verwendet und kann nur deaktiviert werden' });
    }
    await this.players.delete(id);
  }

  // ---- teams --------------------------------------------------------------------------------------------------
  async listTeams(): Promise<Team[]> {
    return (await this.teams.toArray()).map(strip) as Team[];
  }

  /** Reuses an existing team with the same name (case-insensitive). */
  async saveTeam(name: string, isOwn = false, id?: string): Promise<Team> {
    const trimmed = name.trim();
    if (!trimmed) throw new ValidationError({ name: 'Name fehlt' });
    const all = await this.listTeams();
    const same = all.find((t) => t.name.toLowerCase() === trimmed.toLowerCase() && t.id !== id);
    if (same && !id) return same;
    if (same) throw new ValidationError({ name: 'Dieses Team existiert bereits' });
    const existing = id ? all.find((t) => t.id === id) : undefined;
    const team: Team = { id: existing?.id ?? id ?? this.newId(), name: trimmed, is_own: existing?.is_own ?? isOwn, updated_at: this.now() };
    await this.teams.put({ ...team, dirty: 1 });
    return team;
  }

  // ---- games --------------------------------------------------------------------------------------------------
  async listGames(): Promise<Game[]> {
    return ((await this.games.toArray()).map(strip) as Game[]).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  async saveGame(input: Pick<Game, 'opponent_team_id' | 'date' | 'occasion'> & { id?: string; venue?: string | null }): Promise<Game> {
    const errors = validateGame(input);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const existing = input.id ? await this.games.get(input.id) : undefined;
    const game: Game = {
      id: existing?.id ?? input.id ?? this.newId(),
      opponent_team_id: input.opponent_team_id,
      date: input.date,
      occasion: input.occasion,
      venue: input.venue?.trim() || null,
      status: existing?.status ?? 'planned',
      ticker_token: existing?.ticker_token ?? generateToken(),
      updated_at: this.now()
    };
    await this.games.put({ ...game, dirty: 1 });
    return game;
  }

  async setGameStatus(gameId: string, to: GameStatus, role: Role): Promise<Game> {
    const g = await this.games.get(gameId);
    if (!g) throw new ValidationError({ id: 'Spiel nicht gefunden' });
    if (!canTransition(g.status, to, role)) throw new ValidationError({ status: `Statuswechsel ${g.status} → ${to} nicht erlaubt` });
    const next = { ...strip(g), status: to, updated_at: this.now() } as Game;
    await this.games.put({ ...next, dirty: 1 });
    return next;
  }

  /** Invalidates the old ticker link. */
  async regenerateToken(gameId: string): Promise<Game> {
    const g = await this.games.get(gameId);
    if (!g) throw new ValidationError({ id: 'Spiel nicht gefunden' });
    const next = { ...strip(g), ticker_token: generateToken(), updated_at: this.now() } as Game;
    await this.games.put({ ...next, dirty: 1 });
    return next;
  }

  // ---- roster / typists ---------------------------------------------------------------------------------------------
  async rosterOf(gameId: string): Promise<string[]> {
    return (await this.roster.where('game_id').equals(gameId).toArray()).filter((r) => r.present).map((r) => r.player_id);
  }

  async setRoster(gameId: string, playerIds: readonly string[]): Promise<void> {
    const current = await this.roster.where('game_id').equals(gameId).toArray();
    const ts = this.now();
    const wanted = new Set(playerIds);
    const rows: (RosterEntry & Dirty)[] = [];
    for (const id of wanted) {
      const c = current.find((r) => r.player_id === id);
      if (!c || !c.present) rows.push({ game_id: gameId, player_id: id, present: true, updated_at: ts, dirty: 1 });
    }
    for (const c of current) if (c.present && !wanted.has(c.player_id)) rows.push({ ...c, present: false, updated_at: ts, dirty: 1 });
    if (rows.length) await this.roster.bulkPut(rows);
  }

  async listTypists(gameId?: string): Promise<TypistAssignment[]> {
    const rows = gameId ? await this.typists.where('game_id').equals(gameId).toArray() : await this.typists.toArray();
    return rows.map(strip) as TypistAssignment[];
  }

  async saveTypists(rows: readonly TypistAssignment[]): Promise<void> {
    await this.typists.bulkPut(rows.map((r) => ({ ...r, dirty: 1 as const })));
  }

  // ---- events -------------------------------------------------------------------------------------------------
  async recordEvent(e: GameEvent): Promise<void> {
    await this.events.put({ ...e, synced: 0 });
  }

  async eventsOf(gameId: string): Promise<GameEvent[]> {
    return (await this.events.where('game_id').equals(gameId).toArray()).map(({ synced: _s, seq: _q, ...e }) => e as GameEvent);
  }

  async pendingEvents(limit = 50): Promise<StoredEvent[]> {
    return this.events.where('synced').equals(0).limit(limit).toArray();
  }

  async countPending(gameId?: string): Promise<number> {
    const q = this.events.where('synced').equals(0);
    return gameId ? (await q.toArray()).filter((e) => e.game_id === gameId).length : q.count();
  }

  async markSynced(acks: readonly { id: string; seq: number }[]): Promise<void> {
    await this.db.transaction('rw', this.events, async () => {
      for (const a of acks) await this.events.update(a.id, { synced: 1, seq: a.seq });
    });
  }

  async maxSeq(gameId: string): Promise<number> {
    return (await this.events.where('game_id').equals(gameId).toArray()).reduce((m, e) => Math.max(m, e.seq ?? 0), 0);
  }

  /** Inserts events received from the server; never overwrites an event that already exists locally. */
  async applyRemoteEvents(events: readonly (GameEvent & { seq: number })[]): Promise<void> {
    await this.db.transaction('rw', this.events, async () => {
      for (const e of events) {
        const have = await this.events.get(e.id);
        if (have) {
          if (!have.synced || have.seq === undefined) await this.events.update(e.id, { synced: 1, seq: e.seq });
        } else await this.events.put({ ...e, synced: 1 });
      }
    });
  }

  // ---- master data sync helpers ---------------------------------------------------------------------------------------
  async dirtyRows(): Promise<{ [K in MasterTable]: MasterRows[K] }> {
    const pick = async <T extends Dirty>(t: Table<T, never>) => (await t.toArray()).filter((r) => r.dirty === 1).map(strip);
    return {
      players: (await pick(this.players as never)) as Player[],
      teams: (await pick(this.teams as never)) as Team[],
      games: (await pick(this.games as never)) as Game[],
      roster: (await pick(this.roster as never)) as RosterEntry[],
      typists: (await pick(this.typists as never)) as TypistAssignment[]
    };
  }

  async markClean<T extends MasterTable>(table: T, rows: MasterRows[T]): Promise<void> {
    const t = this.table(table);
    await this.db.transaction('rw', t, async () => {
      for (const r of rows as unknown as Record<string, unknown>[]) {
        const key = this.keyOf(table, r);
        const cur = await t.get(key as never);
        // Only clear the flag when nothing changed in the meantime.
        if (cur && (cur as { updated_at: number }).updated_at === r.updated_at) await t.update(key as never, { dirty: 0 } as never);
      }
    });
  }

  /** Last-write-wins merge of rows received from the server. Local unsynced newer edits are kept. */
  async applyRemoteRows<T extends MasterTable>(table: T, rows: MasterRows[T]): Promise<void> {
    const t = this.table(table);
    await this.db.transaction('rw', t, async () => {
      for (const r of rows as unknown as Record<string, unknown>[]) {
        const cur = (await t.get(this.keyOf(table, r) as never)) as ({ updated_at: number } & Dirty) | undefined;
        const remoteTs = Number(r.updated_at);
        if (!cur || (cur.dirty !== 1 && cur.updated_at <= remoteTs) || (cur.dirty === 1 && cur.updated_at < remoteTs)) {
          await t.put({ ...r, updated_at: remoteTs, dirty: 0 } as never);
        }
      }
    });
  }

  private table(table: MasterTable): Table<Record<string, unknown>, unknown> {
    return this[table] as unknown as Table<Record<string, unknown>, unknown>;
  }
  private keyOf(table: MasterTable, r: Record<string, unknown>): unknown {
    return table === 'roster' ? [r.game_id, r.player_id] : r.id;
  }

  // ---- bulk -------------------------------------------------------------------------------------------------------
  /** Applies an import bundle. Idempotent: ids are stable, existing ticker tokens are kept by the bundle builder. */
  async applyBundle(b: LegacyBundle): Promise<void> {
    const ts = this.now();
    await this.db.transaction('rw', [this.teams, this.games, this.roster, this.events], async () => {
      await this.teams.bulkPut(b.teams.map((t) => ({ ...t, updated_at: ts, dirty: 1 as const })));
      await this.games.bulkPut(b.games.map((g) => ({ ...g, updated_at: ts, dirty: 1 as const })));
      await this.roster.bulkPut(b.roster.map((r) => ({ ...r, updated_at: ts, dirty: 1 as const })));
      for (const e of b.events) {
        const have = await this.events.get(e.id);
        if (!have) await this.events.put({ ...e, synced: 0 });
      }
    });
  }

  async exportAll(): Promise<Record<string, unknown>> {
    const rows = await this.dirtyRowsAll();
    return { version: 1, exported_at: this.now(), ...rows, events: (await this.events.toArray()).map(({ synced: _s, seq: _q, ...e }) => e) };
  }

  private async dirtyRowsAll() {
    return {
      players: await this.listPlayers(),
      teams: await this.listTeams(),
      games: await this.listGames(),
      roster: (await this.roster.toArray()).map(strip),
      typists: await this.listTypists()
    };
  }

  async importAll(dump: Record<string, unknown>): Promise<void> {
    for (const t of MASTER_TABLES) {
      const rows = (dump[t] as Record<string, unknown>[] | undefined) ?? [];
      await this.table(t).bulkPut(rows.map((r) => ({ ...r, dirty: 1 })));
    }
    for (const e of ((dump.events as GameEvent[] | undefined) ?? [])) {
      if (!(await this.events.get(e.id))) await this.events.put({ ...e, synced: 0 });
    }
  }
}

