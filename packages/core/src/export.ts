import { computeScore } from './scoring.js';
import { effectiveComments, playsWithVoided } from './effective.js';
import type { Game, GameEvent, Player, PlayData } from './types.js';

export type Cell = string | number | boolean | null;
export type TabName = 'plays' | 'lineups' | 'scores' | 'games' | 'players' | 'comments';

/** Every tab ends with two helper columns: `_key` (identity of the row) and `_hash` (content hash). */
export const TAB_COLUMNS: Record<TabName, string[]> = {
  plays: [
    'event_id', 'game_id', 'game_date', 'opponent', 'occasion', 'ts', 'period', 'drive', 'unit', 'type',
    'player_id', 'player_nr', 'player_name', 'qb_id', 'qb_nr', 'qb_name',
    'pass_result', 'target_result', 'incomplete_reason', 'air_yards', 'yards_after_catch', 'yards_run',
    'flag_pulls_missed', 'yards_lost', 'foul', 'foul_yards', 'result', 'xp_result',
    'flag_puller_id', 'flag_puller_nr', 'flag_puller_name', 'failed_pullers', 'blitzers', 'lineup_size',
    'typist', 'corrected', 'voided'
  ],
  lineups: ['event_id', 'game_id', 'unit', 'player_id', 'player_nr', 'player_name', 'is_qb', 'is_blitzer'],
  scores: ['event_id', 'game_id', 'ts', 'unit', 'scoring_team', 'points', 'reason'],
  games: ['game_id', 'date', 'opponent', 'occasion', 'venue', 'status', 'own_points', 'opp_points', 'plays'],
  players: ['player_id', 'number', 'name', 'active'],
  comments: ['comment_id', 'game_id', 'play_id', 'ts', 'text', 'author']
};

export const TABS = Object.keys(TAB_COLUMNS) as TabName[];

/** Header row including helper columns. */
export function headerRow(tab: TabName): string[] {
  return [...TAB_COLUMNS[tab], '_key', '_hash'];
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function withKey(cells: Cell[], key: string): Cell[] {
  return [...cells, key, fnv1a(JSON.stringify(cells))];
}

const iso = (ms: number) => new Date(ms).toISOString();
const empty = (v: unknown): Cell => (v === undefined || v === null || v === '' ? null : (v as Cell));

export interface ExportInput {
  game: Game;
  opponentName: string;
  events: readonly GameEvent[];
  players: readonly Player[];
  authorName?: (id: string | null) => string | undefined;
}

export interface GameTables {
  plays: Cell[][];
  lineups: Cell[][];
  scores: Cell[][];
  games: Cell[][];
  comments: Cell[][];
}

export function buildGameTables(input: ExportInput): GameTables {
  const { game, opponentName, events, players, authorName } = input;
  const byId = new Map(players.map((p) => [p.id, p]));
  const nr = (id?: string) => empty(id ? byId.get(id)?.number : undefined);
  const nm = (id?: string) => empty(id ? byId.get(id)?.name : undefined);

  const all = playsWithVoided(events);
  const effective = all.filter((p) => !p.voided);
  const score = computeScore(effective);

  const plays: Cell[][] = all.map((p) => {
    const d: PlayData = p.data;
    const cells: Cell[] = [
      p.id, game.id, game.date, opponentName, game.occasion, iso(p.client_ts), p.period, p.drive, d.unit, d.type,
      empty(d.player_id), nr(d.player_id), nm(d.player_id), empty(d.qb_id), nr(d.qb_id), nm(d.qb_id),
      empty(d.pass_result), empty(d.target_result), empty(d.incomplete_reason),
      empty(d.air_yards), empty(d.yards_after_catch), empty(d.yards_run), empty(d.flag_pulls_missed),
      empty(d.yards_lost), empty(d.foul), empty(d.foul_yards), empty(d.result), empty(d.xp_result),
      empty(d.flag_puller_id), nr(d.flag_puller_id), nm(d.flag_puller_id),
      empty((d.failed_puller_ids ?? []).map((id) => byId.get(id)?.number ?? id).join(', ')),
      empty((d.blitzer_ids ?? []).map((id) => byId.get(id)?.number ?? id).join(', ')),
      d.lineup.length, empty(authorName?.(p.author_id) ?? p.author_label), p.corrected, p.voided
    ];
    return withKey(cells, p.id);
  });

  const lineups: Cell[][] = effective.flatMap((p) =>
    p.data.lineup.map((pid) =>
      withKey(
        [p.id, game.id, p.data.unit, pid, nr(pid), nm(pid), p.data.qb_id === pid, (p.data.blitzer_ids ?? []).includes(pid)],
        `${p.id}|${pid}`
      )
    )
  );

  const scores: Cell[][] = score.events.map((e) =>
    withKey([e.event_id, game.id, iso(e.ts), e.unit, e.scoring_team, e.points, e.reason], e.event_id)
  );

  const games: Cell[][] = [
    withKey([game.id, game.date, opponentName, game.occasion, empty(game.venue), game.status, score.own, score.opp, effective.length], game.id)
  ];

  const comments: Cell[][] = effectiveComments(events).map((c) =>
    withKey([c.id, game.id, empty(c.play_id), iso(c.client_ts), c.text, empty(authorName?.(c.author_id) ?? c.author_label)], c.id)
  );

  return { plays, lineups, scores, games, comments };
}

export function buildPlayersTable(players: readonly Player[]): Cell[][] {
  return players.map((p) => withKey([p.id, p.number, p.name, p.active], p.id));
}

export interface SheetPlan {
  /** Rows (0-based data index, i.e. sheet row = index + 2) to overwrite. */
  updates: { rowIndex: number; values: Cell[] }[];
  appends: Cell[][];
  /** Data row indices to clear (key no longer present). */
  clears: number[];
}

/**
 * Compares the desired rows of a game against what is in the sheet (key and hash columns) and plans the
 * minimal writes. `existing` lists the (key, hash) of every data row in sheet order; scope limits clears to
 * keys that belong to the processed game(s).
 */
export function planSheetWrites(
  existing: readonly { key: string; hash: string }[],
  desired: readonly Cell[][],
  inScope: (key: string) => boolean
): SheetPlan {
  const rowOfKey = new Map<string, number>();
  existing.forEach((r, i) => {
    if (r.key && !rowOfKey.has(r.key)) rowOfKey.set(r.key, i);
  });
  const plan: SheetPlan = { updates: [], appends: [], clears: [] };
  const seen = new Set<string>();
  for (const row of desired) {
    const key = String(row[row.length - 2]);
    const hash = String(row[row.length - 1]);
    seen.add(key);
    const at = rowOfKey.get(key);
    if (at === undefined) plan.appends.push([...row]);
    else if (existing[at]!.hash !== hash) plan.updates.push({ rowIndex: at, values: [...row] });
  }
  existing.forEach((r, i) => {
    if (r.key && !seen.has(r.key) && inScope(r.key) && rowOfKey.get(r.key) === i) plan.clears.push(i);
  });
  return plan;
}

