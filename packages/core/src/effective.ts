import type { CommentEvent, EffectivePlay, GameEvent, MarkerEvent, PlayData } from './types.js';

/** Total order of events: device time, then id as tie-breaker. */
export function sortEvents<T extends GameEvent>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.client_ts - b.client_ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface GameClock {
  period: number;
  drive: number;
  /** Last recorded thing was a period boundary (quarter end / halftime). */
  atBreak: boolean;
  halftime: boolean;
  ended: boolean;
}

/**
 * Walks the sorted events once. Consecutive boundary markers without a play in between collapse
 * into one boundary, so "quarter end" followed by "halftime" does not advance twice.
 */
export function deriveTimeline(events: readonly GameEvent[]): {
  clock: GameClock;
  positionOf: Map<string, { period: number; drive: number }>;
} {
  const sorted = sortEvents(events);
  const positionOf = new Map<string, { period: number; drive: number }>();
  let period = 1;
  let drive = 1;
  let playSinceBoundary = true;
  let playSinceDriveEnd = true;
  let atBreak = false;
  let halftime = false;
  let ended = false;

  for (const e of sorted) {
    if (e.kind === 'play') {
      positionOf.set(e.id, { period, drive });
      playSinceBoundary = true;
      playSinceDriveEnd = true;
      atBreak = false;
      halftime = false;
    } else if (e.kind === 'marker') {
      switch (e.marker) {
        case 'quarter_end':
        case 'halftime':
          if (playSinceBoundary) {
            period += 1;
            playSinceBoundary = false;
          }
          atBreak = true;
          halftime = e.marker === 'halftime' ? true : halftime;
          break;
        case 'drive_end':
          if (playSinceDriveEnd) {
            drive += 1;
            playSinceDriveEnd = false;
          }
          break;
        case 'game_end':
          ended = true;
          break;
        default:
          break;
      }
    }
  }
  return { clock: { period, drive, atBreak, halftime, ended }, positionOf };
}

export function periodLabel(period: number): string {
  return period <= 4 ? `Q${period}` : 'OT';
}

function foldPlays(events: readonly GameEvent[], includeVoided: boolean): (EffectivePlay & { voided: boolean })[] {
  const sorted = sortEvents(events);
  const { positionOf } = deriveTimeline(sorted);
  const voided = new Set<string>();
  const latestEdit = new Map<string, PlayData>();
  for (const e of sorted) {
    if (e.kind === 'void') voided.add(e.voids_id);
    else if (e.kind === 'edit') latestEdit.set(e.replaces_id, e.data);
  }
  const out: (EffectivePlay & { voided: boolean })[] = [];
  for (const e of sorted) {
    if (e.kind !== 'play') continue;
    const isVoided = voided.has(e.id);
    if (isVoided && !includeVoided) continue;
    const edit = latestEdit.get(e.id);
    const pos = positionOf.get(e.id) ?? { period: 1, drive: 1 };
    out.push({
      id: e.id,
      game_id: e.game_id,
      client_ts: e.client_ts,
      author_id: e.author_id,
      author_label: e.author_label,
      data: edit ?? e.data,
      corrected: edit !== undefined,
      period: pos.period,
      drive: pos.drive,
      voided: isVoided
    });
  }
  return out;
}

/**
 * Effective plays: the latest edit replaces the original, voided plays disappear.
 * Edits that reference unknown plays are ignored.
 */
export function effectivePlays(events: readonly GameEvent[]): EffectivePlay[] {
  return foldPlays(events, false).map(({ voided: _v, ...play }) => play);
}

/** All plays including voided ones (flagged), used by the export to mark rows instead of deleting them. */
export function playsWithVoided(events: readonly GameEvent[]): (EffectivePlay & { voided: boolean })[] {
  return foldPlays(events, true);
}

export function gameClock(events: readonly GameEvent[]): GameClock {
  return deriveTimeline(events).clock;
}

export function markers(events: readonly GameEvent[]): MarkerEvent[] {
  return sortEvents(events.filter((e): e is MarkerEvent => e.kind === 'marker'));
}

/** Comments attached to the game or to a play that is still effective. */
export function effectiveComments(events: readonly GameEvent[]): CommentEvent[] {
  const live = new Set(effectivePlays(events).map((p) => p.id));
  return sortEvents(events.filter((e): e is CommentEvent => e.kind === 'comment')).filter(
    (c) => !c.play_id || live.has(c.play_id)
  );
}

/** The play an "undo" removes: the newest effective play. */
export function undoTarget(events: readonly GameEvent[]): EffectivePlay | undefined {
  const plays = effectivePlays(events);
  return plays[plays.length - 1];
}

