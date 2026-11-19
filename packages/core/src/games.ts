import type { Game, GameEvent, GameStatus, TypistAssignment } from './types.js';

export type Role = 'admin' | 'typist' | 'viewer';

export function validateGame(g: Partial<Pick<Game, 'opponent_team_id' | 'date' | 'occasion'>>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!g.opponent_team_id) errors.opponent_team_id = 'Gegner fehlt';
  if (!g.date || !/^\d{4}-\d{2}-\d{2}$/.test(g.date) || Number.isNaN(Date.parse(g.date))) errors.date = 'Datum fehlt';
  if (!g.occasion) errors.occasion = 'Anlass fehlt';
  return errors;
}

export function canTransition(from: GameStatus, to: GameStatus, role: Role): boolean {
  if (role !== 'admin') return false;
  return (from === 'planned' && to === 'live') || (from === 'live' && to === 'finished') || (from === 'finished' && to === 'live');
}

export function activeTypist(assignments: readonly TypistAssignment[], gameId: string): TypistAssignment | undefined {
  return assignments.find((a) => a.game_id === gameId && a.to_ts === null);
}

export interface WriteCheck { ok: boolean; reason?: string }

/** Who may record events: admins always; typists only as the active typist of a live game. */
export function canRecord(opts: { game: Game; userId: string | null; role: Role; assignments: readonly TypistAssignment[] }): WriteCheck {
  const { game, userId, role, assignments } = opts;
  if (role === 'admin') return { ok: true };
  if (role !== 'typist' || !userId) return { ok: false, reason: 'Keine Berechtigung zum Erfassen' };
  if (game.status === 'finished') return { ok: false, reason: 'Das Spiel ist beendet' };
  if (game.status !== 'live') return { ok: false, reason: 'Das Spiel läuft noch nicht' };
  const active = activeTypist(assignments, game.id);
  if (!active || active.user_id !== userId) return { ok: false, reason: 'Du bist nicht der aktive Typist dieses Spiels' };
  return { ok: true };
}

/** Ends the current assignment and starts a new one; returns the rows to store. */
export function handover(
  assignments: readonly TypistAssignment[],
  gameId: string,
  newUserId: string,
  now: number,
  newId: string
): TypistAssignment[] {
  const out: TypistAssignment[] = [];
  const current = activeTypist(assignments, gameId);
  if (current) {
    if (current.user_id === newUserId) return [];
    out.push({ ...current, to_ts: now, updated_at: now });
  }
  out.push({ id: newId, game_id: gameId, user_id: newUserId, from_ts: now, to_ts: null, updated_at: now });
  return out;
}

export interface FinishWarnings {
  playsWithoutResult: number;
  unsyncedEvents: number;
  missingGameEnd: boolean;
  hasWarnings: boolean;
}

export function finishWarnings(events: readonly GameEvent[], playsWithoutResult: number, unsyncedEvents: number): FinishWarnings {
  const missingGameEnd = !events.some((e) => e.kind === 'marker' && e.marker === 'game_end');
  return { playsWithoutResult, unsyncedEvents, missingGameEnd, hasWarnings: playsWithoutResult > 0 || unsyncedEvents > 0 || missingGameEnd };
}

/** 22 random URL-safe characters (about 130 bits). */
export function generateToken(): string {
  const bytes = new Uint8Array(17);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}
