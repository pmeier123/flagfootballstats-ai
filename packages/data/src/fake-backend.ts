import {
  NetworkError, type ExportStatus, type MasterRows, type MasterTable, type PullResult, type SyncBackend, type TickerSnapshot, type WireEvent
} from './backend.js';

/** In-memory backend with the same semantics as the Supabase functions; used for tests and demos. */
export class FakeBackend implements SyncBackend {
  events = new Map<string, WireEvent>();
  private seqByGame = new Map<string, number>();
  rows: { [K in MasterTable]: Map<string, MasterRows[K][number] & { srv: number }> } = {
    players: new Map(), teams: new Map(), games: new Map(), roster: new Map(), typists: new Map()
  } as never;
  clock = 1;
  offline = false;
  /** Acknowledge nothing for the next N pushes although the events are stored (lost response). */
  loseAcks = 0;
  failWith: Error | null = null;
  exportLastSeq: number | null = null;
  pushCalls = 0;

  private guard(): void {
    if (this.offline) throw new NetworkError();
    if (this.failWith) throw this.failWith;
  }

  async pushEvents(events: WireEvent[]): Promise<{ id: string; seq: number }[]> {
    this.pushCalls += 1;
    this.guard();
    const acks: { id: string; seq: number }[] = [];
    for (const e of events) {
      let stored = this.events.get(e.id);
      if (!stored) {
        const seq = (this.seqByGame.get(e.game_id) ?? 0) + 1;
        this.seqByGame.set(e.game_id, seq);
        stored = { ...e, seq };
        this.events.set(e.id, stored);
      }
      acks.push({ id: e.id, seq: stored.seq! });
    }
    if (this.loseAcks > 0) {
      this.loseAcks -= 1;
      throw new NetworkError('Antwort verloren');
    }
    return acks;
  }

  async pushRows<T extends MasterTable>(table: T, rows: MasterRows[T]): Promise<void> {
    this.guard();
    const map = this.rows[table] as Map<string, { updated_at: number; srv: number }>;
    for (const r of rows as unknown as Record<string, unknown>[]) {
      const key = table === 'roster' ? `${r.game_id}|${r.player_id}` : String(r.id);
      const cur = map.get(key);
      if (!cur || cur.updated_at <= Number(r.updated_at)) map.set(key, { ...(r as object), srv: ++this.clock } as never);
    }
  }

  async pullRows(since: number): Promise<PullResult> {
    this.guard();
    const out: Partial<MasterRows> = {};
    for (const t of Object.keys(this.rows) as MasterTable[]) {
      (out as Record<string, unknown[]>)[t] = [...this.rows[t].values()].filter((r) => r.srv > since).map(({ srv: _s, ...r }) => r);
    }
    return { rows: out, cursor: this.clock };
  }

  async pullEvents(gameId: string, afterSeq: number): Promise<WireEvent[]> {
    this.guard();
    return [...this.events.values()].filter((e) => e.game_id === gameId && (e.seq ?? 0) > afterSeq).sort((a, b) => a.seq! - b.seq!);
  }

  async tickerSnapshot(token: string, afterSeq: number): Promise<TickerSnapshot | null> {
    this.guard();
    const game = [...this.rows.games.values()].find((g) => (g as { ticker_token: string }).ticker_token === token) as Record<string, unknown> | undefined;
    if (!game) return null;
    const id = String(game.id);
    const teams = [...this.rows.teams.values()] as unknown as { id: string; name: string; is_own: boolean }[];
    const events = await this.pullEvents(id, afterSeq);
    return {
      game: { id, date: String(game.date), occasion: game.occasion as never, status: game.status as never },
      own_name: teams.find((t) => t.is_own)?.name ?? 'Emperors',
      opp_name: teams.find((t) => t.id === game.opponent_team_id)?.name ?? 'Gegner',
      players: [...this.rows.players.values()].map((p) => ({ id: (p as { id: string }).id, number: (p as { number: string }).number, name: (p as { name: string }).name })),
      events,
      max_seq: this.seqByGame.get(id) ?? 0,
      server_time: Date.now()
    };
  }

  async exportStatus(_gameId: string): Promise<ExportStatus | null> {
    this.guard();
    return this.exportLastSeq === null ? null : { last_seq: this.exportLastSeq, last_run: 1, last_error: null };
  }
}

