import {
  buildGameTables, buildPlayersTable, headerRow, planSheetWrites, TABS,
  type Cell, type Game, type GameEvent, type Player, type SheetPlan, type TabName
} from '../../../packages/core/src/index.ts';

export interface ExportGame {
  game: Game;
  opponentName: string;
  events: GameEvent[];
  maxSeq: number;
}

export interface DbApi {
  /** Games whose highest event sequence is above the exported one. */
  gamesNeedingExport(): Promise<{ game_id: string; max_seq: number; last_seq: number }[]>;
  loadGame(gameId: string): Promise<ExportGame>;
  loadPlayers(): Promise<Player[]>;
  authorNames(): Promise<Map<string, string>>;
  saveProgress(gameId: string, lastSeq: number, error: string | null): Promise<void>;
}

export interface SheetsApi {
  ensureTabs(tabs: { name: TabName; header: string[] }[]): Promise<void>;
  /** Key and hash of every data row (row 2 and below) in sheet order; blank rows have an empty key. */
  readKeys(tab: TabName): Promise<{ key: string; hash: string }[]>;
  write(tab: TabName, plan: SheetPlan, columns: number): Promise<void>;
}

export interface ExportResult {
  games: string[];
  writes: Partial<Record<TabName, { updates: number; appends: number; clears: number }>>;
  failed: { gameId: string; error: string }[];
}

/**
 * One export run: for every game with new events, rebuild its tables from the full event log and write only what
 * differs from the sheet (by row key and content hash). Safe to repeat; progress only advances after a full success.
 */
export async function runExport(db: DbApi, sheets: SheetsApi): Promise<ExportResult> {
  const result: ExportResult = { games: [], writes: {}, failed: [] };
  const pending = await db.gamesNeedingExport();
  if (!pending.length) return result;

  const [players, names] = await Promise.all([db.loadPlayers(), db.authorNames()]);
  const authorName = (id: string | null) => (id ? names.get(id) : undefined);

  try {
    await sheets.ensureTabs(TABS.map((name) => ({ name, header: headerRow(name) })));

    const loaded: ExportGame[] = [];
    for (const p of pending) loaded.push(await db.loadGame(p.game_id));

    const desired: Record<TabName, Cell[][]> = { plays: [], lineups: [], scores: [], games: [], players: buildPlayersTable(players), comments: [] };
    const eventIds = new Set<string>();
    const commentIds = new Set<string>();
    const gameIds = new Set<string>();
    for (const g of loaded) {
      const t = buildGameTables({ game: g.game, opponentName: g.opponentName, events: g.events, players, authorName });
      desired.plays.push(...t.plays);
      desired.lineups.push(...t.lineups);
      desired.scores.push(...t.scores);
      desired.games.push(...t.games);
      desired.comments.push(...t.comments);
      gameIds.add(g.game.id);
      for (const e of g.events) (e.kind === 'comment' ? commentIds : eventIds).add(e.id);
    }

    const scope: Record<TabName, (key: string) => boolean> = {
      plays: (k) => eventIds.has(k),
      scores: (k) => eventIds.has(k),
      lineups: (k) => eventIds.has(k.split('|')[0] ?? ''),
      comments: (k) => commentIds.has(k),
      games: (k) => gameIds.has(k),
      players: () => true
    };

    for (const tab of TABS) {
      const existing = await sheets.readKeys(tab);
      const plan = planSheetWrites(existing, desired[tab], scope[tab]);
      if (plan.updates.length || plan.appends.length || plan.clears.length) {
        await sheets.write(tab, plan, headerRow(tab).length);
        result.writes[tab] = { updates: plan.updates.length, appends: plan.appends.length, clears: plan.clears.length };
      }
    }

    for (const g of loaded) {
      const maxSeq = pending.find((p) => p.game_id === g.game.id)!.max_seq;
      await db.saveProgress(g.game.id, Math.max(maxSeq, g.maxSeq), null);
      result.games.push(g.game.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const p of pending) {
      await db.saveProgress(p.game_id, p.last_seq, message).catch(() => undefined);
      result.failed.push({ gameId: p.game_id, error: message });
    }
  }
  return result;
}
