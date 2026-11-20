import { optionLabel, typeLabel } from './labels.js';
import { computeScore, type Score, type ScoringEvent } from './scoring.js';
import { sideOfTouchdown } from './xp.js';
import { effectivePlays, gameClock, periodLabel, type GameClock } from './effective.js';
import { computeLiveStats, type LiveStats } from './stats.js';
import type { EffectivePlay, GameEvent, PlayData, PlayerLookup, PlayerRef, Unit } from './types.js';

export type Highlight = 'touchdown' | 'pick_6' | 'safety' | 'xp' | 'interception' | 'sack' | 'foul';

export interface TickerNames { own: string; opp: string }

export interface TickerEntry {
  id: string;
  ts: number;
  period: number;
  drive: number;
  unit: Unit;
  text: string;
  highlight: Highlight | null;
  corrected: boolean;
  scoring: ScoringEvent | null;
  /** Expandable detail lines (lineup, quarterback, blitzers, flag pullers, typist). */
  details: string[];
  /** Player ids involved (for filters). */
  playerIds: string[];
}

const DEFAULT_NAMES: TickerNames = { own: 'Emperors', opp: 'Opponent' };

export function playerText(lookup: PlayerLookup, id: string | undefined | null): string {
  const p: PlayerRef | undefined = lookup(id);
  return p ? `#${p.number} ${p.name}` : 'unknown player';
}

function yards(n: number): string {
  return `${n === 30 ? '30+' : n} yards`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function list(lookup: PlayerLookup, ids: readonly string[] | undefined): string {
  return (ids ?? []).map((id) => playerText(lookup, id)).join(', ');
}

function resultText(d: PlayData, names: TickerNames): string {
  switch (d.result) {
    case 'td': return sideOfTouchdown(d.unit, 'td') === 'own' ? `Touchdown ${names.own}!` : `Touchdown ${names.opp}!`;
    case 'pick_6': return sideOfTouchdown(d.unit, 'pick_6') === 'own' ? `Pick 6 for ${names.own}!` : `Pick 6 for ${names.opp}!`;
    case 'safety': return d.unit === 'offense' ? `Safety for ${names.opp}!` : `Safety for ${names.own}!`;
    case 'first_down': return 'First down.';
    case 'tod': return 'Turnover on downs.';
    default: return '';
  }
}

function foulText(d: PlayData): string {
  const base = d.foul ? optionLabel(d.foul) : 'unknown';
  return d.foul_yards !== undefined && d.foul === 'other' ? `${base} (${yards(d.foul_yards)})` : base;
}

function offenseSentence(d: PlayData, lk: PlayerLookup): string {
  const p = d.player_id ? playerText(lk, d.player_id) : undefined;
  const qb = d.qb_id ? `QB ${playerText(lk, d.qb_id)}` : 'unknown QB';
  const flags = d.flag_pulls_missed ? `, ${plural(d.flag_pulls_missed, 'missed flag pull', 'missed flag pulls')}` : '';
  switch (d.type) {
    case 'pass':
      if (d.pass_result === 'catch') {
        return `Pass from ${qb} to ${p} caught: ${d.air_yards ?? 0} air yards + ${d.yards_after_catch ?? 0} yards after the catch${flags}.`;
      }
      if (d.pass_result === 'incomplete') {
        return `Pass from ${qb} to ${p} incomplete${d.incomplete_reason ? ` (${optionLabel(d.incomplete_reason)})` : ''}.`;
      }
      if (d.pass_result === 'interception') return `Pass from ${qb} to ${p} intercepted.`;
      return `Pass from ${qb} to ${p}.`;
    case 'run':
      return `Run by ${p}: ${d.yards_run ?? 0} yards${flags}.`;
    case 'sack':
      return `Sack against ${qb}: ${yards(d.yards_lost ?? 0)}.`;
    case 'throwaway':
      return `Throwaway by ${qb}.`;
    case 'dead_snap':
      return 'Dead snap.';
    case 'foul_committed':
      return `Foul committed${p ? ` by ${p}` : ''}: ${foulText(d)}.`;
    case 'foul_drawn':
      return `Foul drawn${p ? ` by ${p}` : ''}: ${foulText(d)}.`;
    default:
      return `${typeLabel('offense', d.type)}.`;
  }
}

function defenseSentence(d: PlayData, lk: PlayerLookup): string {
  const p = d.player_id ? playerText(lk, d.player_id) : undefined;
  const puller = d.flag_puller_id ? ` Flag pull by ${playerText(lk, d.flag_puller_id)}` : '';
  const failed = d.failed_puller_ids?.length ? `, missed by ${list(lk, d.failed_puller_ids)}` : '';
  const pulls = puller || failed ? `${puller || ' Flag pull'}${failed}.` : '';
  switch (d.type) {
    case 'target':
      if (d.target_result === 'catch_allowed') return `Opponent pass against ${p}: catch allowed.${pulls}`;
      if (d.target_result === 'incomplete') {
        return `Opponent pass against ${p}: incomplete${d.incomplete_reason ? ` (${optionLabel(d.incomplete_reason)})` : ''}.`;
      }
      if (d.target_result === 'interception') return `Opponent pass against ${p}: interception!`;
      return `Opponent pass against ${p}.${pulls}`;
    case 'run':
      return `Opponent run.${pulls}`;
    case 'sack':
      return `Sack${p ? ` by ${p}` : ''}.`;
    case 'throwaway':
      return `Opponent throwaway${p ? ` (pressure by ${p})` : ''}.`;
    case 'dead_snap':
      return 'Opponent dead snap.';
    case 'foul_committed':
      return `Foul committed${p ? ` by ${p}` : ''}: ${foulText(d)}.`;
    case 'foul_drawn':
      return `Foul drawn${p ? ` by ${p}` : ''}: ${foulText(d)}.`;
    default:
      return `${typeLabel('defense', d.type)}.`;
  }
}

export function playSentence(d: PlayData, lookup: PlayerLookup, names: TickerNames = DEFAULT_NAMES): string {
  const base = d.unit === 'offense' ? offenseSentence(d, lookup) : defenseSentence(d, lookup);
  const result = resultText(d, names);
  const xp = d.xp_result ? ` Extra point: ${optionLabel(d.xp_result)}.` : '';
  return [base, result, xp.trim()].filter(Boolean).join(' ');
}

export function classifyHighlight(d: PlayData): Highlight | null {
  if (d.result === 'td') return 'touchdown';
  if (d.result === 'pick_6') return 'pick_6';
  if (d.result === 'safety') return 'safety';
  if (d.xp_result) return 'xp';
  if (d.pass_result === 'interception' || d.target_result === 'interception') return 'interception';
  if (d.type === 'sack') return 'sack';
  if (d.type === 'foul_committed' || d.type === 'foul_drawn') return 'foul';
  return null;
}

export function playerIdsOf(d: PlayData): string[] {
  const ids = [d.player_id, d.qb_id, d.flag_puller_id, ...(d.failed_puller_ids ?? [])];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

function detailLines(p: EffectivePlay, lk: PlayerLookup, author?: (id: string | null) => string | undefined): string[] {
  const d = p.data;
  const lines = [`On field: ${list(lk, d.lineup)}`];
  if (d.qb_id) lines.push(`Quarterback: ${playerText(lk, d.qb_id)}`);
  if (d.blitzer_ids?.length) lines.push(`Blitz: ${list(lk, d.blitzer_ids)}`);
  if (d.flag_puller_id) lines.push(`Flag puller: ${playerText(lk, d.flag_puller_id)}`);
  if (d.failed_puller_ids?.length) lines.push(`Missed attempts: ${list(lk, d.failed_puller_ids)}`);
  const by = author?.(p.author_id) ?? p.author_label;
  if (by) lines.push(`Recorded by: ${by}`);
  return lines;
}

/** Ticker entries oldest first; the UI reverses for display. */
export function buildTickerEntries(
  plays: readonly EffectivePlay[],
  lookup: PlayerLookup,
  names: TickerNames = DEFAULT_NAMES,
  author?: (id: string | null) => string | undefined
): TickerEntry[] {
  const scoring = new Map(computeScore(plays).events.map((e) => [e.event_id, e]));
  return plays.map((p) => ({
    id: p.id,
    ts: p.client_ts,
    period: p.period,
    drive: p.drive,
    unit: p.data.unit,
    text: playSentence(p.data, lookup, names),
    highlight: classifyHighlight(p.data),
    corrected: p.corrected,
    scoring: scoring.get(p.id) ?? null,
    details: detailLines(p, lookup, author),
    playerIds: playerIdsOf(p.data)
  }));
}

export type TickerFilter = { unit?: Unit; scoringOnly?: boolean; highlightsOnly?: boolean; playerId?: string };

export function filterTickerEntries(entries: readonly TickerEntry[], f: TickerFilter): TickerEntry[] {
  return entries.filter(
    (e) =>
      (!f.unit || e.unit === f.unit) &&
      (!f.scoringOnly || e.scoring !== null) &&
      (!f.highlightsOnly || e.highlight !== null) &&
      (!f.playerId || e.playerIds.includes(f.playerId))
  );
}


/** Short one-line summary, e.g. "Pass, #96 Daniel Binder, First Down". */
export function playSummary(d: PlayData, lookup: PlayerLookup): string {
  const parts: string[] = [typeLabel(d.unit, d.type)];
  if (d.player_id) parts.push(playerText(lookup, d.player_id));
  const res = d.xp_result ?? d.result;
  if (res) parts.push(optionLabel(res));
  return parts.join(', ');
}

export interface TickerModel {
  score: Score;
  clock: GameClock;
  periodLabel: string;
  /** Oldest first. */
  entries: TickerEntry[];
  stats: LiveStats;
}

/** Everything the ticker view needs, derived from the raw event log. */
export function buildTickerModel(
  events: readonly GameEvent[],
  lookup: PlayerLookup,
  names: TickerNames = DEFAULT_NAMES,
  author?: (id: string | null) => string | undefined
): TickerModel {
  const plays = effectivePlays(events);
  const clock = gameClock(events);
  return {
    score: computeScore(plays),
    clock,
    periodLabel: periodLabel(clock.period),
    entries: buildTickerEntries(plays, lookup, names, author),
    stats: computeLiveStats(plays)
  };
}
