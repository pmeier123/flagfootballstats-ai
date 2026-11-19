import type {
  Game, GameEvent, MarkerType, PlayData, Player, RosterEntry, Team, TypistAssignment
} from '@ffs/core';

export type MasterTable = 'players' | 'teams' | 'games' | 'roster' | 'typists';
export const MASTER_TABLES: MasterTable[] = ['teams', 'players', 'games', 'roster', 'typists'];

export interface MasterRows {
  players: Player[];
  teams: Team[];
  games: Game[];
  roster: RosterEntry[];
  typists: TypistAssignment[];
}

export interface WireEvent {
  id: string;
  game_id: string;
  client_ts: number;
  author_id: string | null;
  author_label?: string | null;
  kind: GameEvent['kind'];
  payload: Record<string, unknown>;
  seq?: number;
}

export function toWire(e: GameEvent): WireEvent {
  const base = { id: e.id, game_id: e.game_id, client_ts: e.client_ts, author_id: e.author_id, author_label: e.author_label ?? null, kind: e.kind };
  switch (e.kind) {
    case 'play': return { ...base, payload: { data: e.data } };
    case 'marker': return { ...base, payload: { marker: e.marker } };
    case 'comment': return { ...base, payload: { text: e.text, play_id: e.play_id ?? null } };
    case 'edit': return { ...base, payload: { replaces_id: e.replaces_id, data: e.data } };
    case 'void': return { ...base, payload: { voids_id: e.voids_id } };
  }
}

export function fromWire(w: WireEvent): GameEvent {
  const base = {
    id: w.id, game_id: w.game_id, client_ts: Number(w.client_ts), author_id: w.author_id,
    ...(w.author_label ? { author_label: w.author_label } : {})
  };
  const p = w.payload as unknown as { data: PlayData; marker: MarkerType; text: string; play_id?: string; replaces_id: string; voids_id: string };
  switch (w.kind) {
    case 'play': return { ...base, kind: 'play', data: p.data };
    case 'marker': return { ...base, kind: 'marker', marker: p.marker };
    case 'comment': return { ...base, kind: 'comment', text: p.text, ...(p.play_id ? { play_id: p.play_id } : {}) };
    case 'edit': return { ...base, kind: 'edit', replaces_id: p.replaces_id, data: p.data };
    case 'void': return { ...base, kind: 'void', voids_id: p.voids_id };
  }
}

export interface PullResult {
  rows: Partial<MasterRows>;
  /** Server-side cursor to pass to the next pull. */
  cursor: number;
}

export interface TickerSnapshot {
  game: Pick<Game, 'id' | 'date' | 'occasion' | 'status'>;
  own_name: string;
  opp_name: string;
  players: { id: string; number: string; name: string }[];
  events: WireEvent[];
  max_seq: number;
  server_time: number;
}

export interface ExportStatus {
  last_seq: number;
  last_run: number | null;
  last_error: string | null;
}

/** Thrown for connectivity problems; everything else is treated as a rejection by the server. */
export class NetworkError extends Error {
  constructor(message = 'Keine Verbindung') {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface SyncBackend {
  /** Returns acknowledged ids with their server sequence numbers. Re-sending is safe. */
  pushEvents(events: WireEvent[]): Promise<{ id: string; seq: number }[]>;
  pushRows<T extends MasterTable>(table: T, rows: MasterRows[T]): Promise<void>;
  pullRows(since: number): Promise<PullResult>;
  pullEvents(gameId: string, afterSeq: number): Promise<WireEvent[]>;
  tickerSnapshot(token: string, afterSeq: number): Promise<TickerSnapshot | null>;
  /** null when no export is configured for the game. */
  exportStatus(gameId: string): Promise<ExportStatus | null>;
}

