import { computeScore } from './scoring.js';
import { effectivePlays } from './effective.js';
import { normalizeDraft, toPlayData } from './engine.js';
import type { CsvRow } from './csv.js';
import type {
  Draft, Foul, Game, GameEvent, Occasion, PlayData, PlayType, Player, RosterEntry, Team, Unit
} from './types.js';

export interface LegacyInput {
  offense: CsvRow[];
  defense: CsvRow[];
  comments: CsvRow[];
  players: readonly Player[];
  existingTeams: readonly Team[];
  existingGames?: readonly Game[];
  /** Manual decisions for references that match no/several players: legacy number -> player id, or null to drop. */
  numberMap?: Record<string, string | null>;
  newToken?: () => string;
  now?: number;
}

export interface LegacyBundle {
  teams: Team[];
  games: Game[];
  roster: RosterEntry[];
  events: GameEvent[];
}

export interface ImportReport {
  canImport: boolean;
  counts: { plays: number; comments: number; games: number; newTeams: number };
  games: { id: string; opponent: string; occasion: Occasion; plays: number; own: number; opp: number }[];
  /** Numbers/names that match no player or several players. Block the import until mapped. */
  unresolvedRefs: { ref: string; reason: 'unknown' | 'ambiguous'; count: number }[];
  unmappedValues: { column: string; value: string; count: number }[];
  /** Values that existed in the legacy row but are invisible/invalid under the new rules and were not imported. */
  droppedValues: { field: string; count: number }[];
  skippedRows: { sheet: string; row: number; reason: string }[];
  unassignedComments: { row: number; text: string }[];
  pseudoOpponents: string[];
  typists: string[];
  /** Minutes in which both units have plays; their relative order cannot be known from minute-precise legacy data. */
  ambiguousOrderMinutes: number;
}

const OCCASIONS: Record<string, Occasion> = {
  'dffl-game': 'dffl_game', semifinal: 'semifinal', final: 'final', 'group-stage': 'group_stage', other: 'other'
};
const OFFENSE_TYPES: Record<string, PlayType> = {
  pass: 'pass', run: 'run', sack: 'sack', throwaway: 'throwaway', 'dead snap': 'dead_snap',
  'foul committed': 'foul_committed', 'foul commited': 'foul_committed', 'foul drawn': 'foul_drawn'
};
const DEFENSE_TYPES: Record<string, PlayType> = {
  target: 'target', run: 'run', sack: 'sack', throwaway: 'throwaway', 'knee/throwaway': 'throwaway', 'dead snap': 'dead_snap',
  'foul committed': 'foul_committed', 'foul commited': 'foul_committed', 'foul drawn': 'foul_drawn'
};
const PASS_RESULTS: Record<string, string> = { catch: 'catch', incomplete: 'incomplete', interception: 'interception' };
const TARGET_RESULTS: Record<string, string> = { 'catch allowed': 'catch_allowed', incomplete: 'incomplete', interception: 'interception' };
const REASONS: Record<string, string> = {
  '50/50-ball': 'fifty_fifty', drop: 'drop', uncatchable: 'uncatchable', 'batted / deflected': 'batted'
};
const FOULS: Record<string, Foul> = {
  'illegaler kontakt': 'illegal_contact', 'abschirmen / bb': 'screening_bb', 'false start': 'false_start',
  'flag guarding / jumping': 'flag_guarding_jumping', 'flag guarding': 'flag_guarding',
  'unsportliches verhalten': 'unsporting', 'illegaler blitz': 'illegal_blitz', sonstiges: 'other'
};
const RESULTS: Record<string, string> = {
  touchdown: 'result:td', 'first down': 'result:first_down', tod: 'result:tod', 'pick 6': 'result:pick_6',
  'pick-6': 'result:pick_6', safety: 'result:safety',
  '1xp made': 'xp:1xp_made', '1xp missed': 'xp:1xp_missed', '2xp made': 'xp:2xp_made', '2xp missed': 'xp:2xp_missed',
  '1xp allowed': 'xp:1xp_allowed', '1xp prevented': 'xp:1xp_prevented', '2xp allowed': 'xp:2xp_allowed',
  '2xp prevented': 'xp:2xp_prevented', 'xp retry': 'xp:xp_retry'
};

const isDefault = (v: string | undefined): boolean => v === undefined || v === '' || v.toLowerCase() === 'default';

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const berlin = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
});

function berlinParts(ms: number): { y: number; mo: number; d: number; h: number; mi: number } {
  const p = Object.fromEntries(berlin.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year!, mo: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute! };
}

/** "dd.MM.yyyy, HH:mm" as Europe/Berlin wall-clock time to epoch milliseconds. */
export function parseLegacyTimestamp(s: string): number | undefined {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const [, d, mo, y, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = berlinParts(guess);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += wall - shown;
  }
  return guess;
}

export function berlinDate(ms: number): string {
  const p = berlinParts(ms);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Legacy "93 Bryan Wiegand" / "93" -> "93". */
function legacyNumber(ref: string): string {
  return ref.trim().split(/\s+/, 1)[0] ?? '';
}

interface Raw {
  sheet: 'offense' | 'defense';
  row: number;
  ts: number;
  opponent: string;
  occasion: Occasion;
  src: CsvRow;
}

export function buildLegacyImport(input: LegacyInput): { report: ImportReport; bundle: LegacyBundle } {
  const unresolved = new Map<string, { reason: 'unknown' | 'ambiguous'; count: number }>();
  const unmapped = new Map<string, number>();
  const dropped = new Map<string, number>();
  const skipped: ImportReport['skippedRows'] = [];
  const typists = new Set<string>();

  const byNumber = new Map<string, Player[]>();
  for (const p of input.players) byNumber.set(p.number, [...(byNumber.get(p.number) ?? []), p]);

  const resolveNumber = (num: string): string | undefined | null => {
    if (input.numberMap && num in input.numberMap) return input.numberMap[num];
    const cands = byNumber.get(num) ?? [];
    const active = cands.filter((p) => p.active);
    const pool = active.length ? active : cands;
    if (pool.length === 1) return pool[0]!.id;
    const entry = unresolved.get(num) ?? { reason: pool.length === 0 ? 'unknown' : 'ambiguous', count: 0 };
    entry.count += 1;
    unresolved.set(num, entry);
    return undefined;
  };
  const resolveRef = (ref: string | undefined): string | undefined => {
    if (isDefault(ref)) return undefined;
    const r = resolveNumber(legacyNumber(ref!));
    return r ?? undefined;
  };
  const resolveList = (s: string | undefined, sep = ','): string[] =>
    isDefault(s) ? [] : s!.split(sep).map((x) => resolveRef(x)).filter((x): x is string => !!x);

  const mapValue = (column: string, table: Record<string, string>, value: string | undefined): string | undefined => {
    if (isDefault(value)) return undefined;
    const hit = table[value!.trim().toLowerCase()];
    if (hit === undefined) {
      const k = `${column}\u0000${value}`;
      unmapped.set(k, (unmapped.get(k) ?? 0) + 1);
    }
    return hit;
  };
  const num = (v: string | undefined): number | undefined => (isDefault(v) || Number.isNaN(Number(v)) ? undefined : Number(v));

  // 1. Collect raw rows with timestamps and order them.
  const raws: Raw[] = [];
  const collect = (rows: CsvRow[], sheet: 'offense' | 'defense') =>
    rows.forEach((src, row) => {
      const ts = parseLegacyTimestamp(src.timestamp ?? '');
      const opponent = (src.opponent ?? '').trim();
      const occasion = OCCASIONS[(src.occasion ?? '').trim().toLowerCase()];
      if (ts === undefined) return void skipped.push({ sheet, row, reason: 'Zeitstempel nicht lesbar' });
      if (!opponent) return void skipped.push({ sheet, row, reason: 'Gegner fehlt' });
      if (!occasion) return void skipped.push({ sheet, row, reason: `Anlass unbekannt: ${src.occasion ?? ''}` });
      raws.push({ sheet, row, ts, opponent, occasion, src });
    });
  collect(input.offense, 'offense');
  collect(input.defense, 'defense');
  raws.sort((a, b) => a.ts - b.ts || (a.sheet === b.sheet ? a.row - b.row : a.sheet === 'offense' ? -1 : 1));

  // minute groups -> ms offsets keep the original order
  const perMinute = new Map<number, Raw[]>();
  for (const r of raws) perMinute.set(r.ts, [...(perMinute.get(r.ts) ?? []), r]);
  let ambiguousOrderMinutes = 0;
  const tsOf = new Map<Raw, number>();
  for (const [minute, group] of perMinute) {
    if (new Set(group.map((g) => g.sheet)).size > 1) ambiguousOrderMinutes += 1;
    group.forEach((g, i) => tsOf.set(g, minute + i * 100));
  }

  // 2. Games and teams.
  const teamsByName = new Map(input.existingTeams.map((t) => [t.name, t]));
  const newTeams = new Map<string, Team>();
  const now = input.now ?? Date.now();
  const gameKeyOf = (r: Raw) => `${r.opponent}\u0000${r.occasion}`;
  const gameInfo = new Map<string, { id: string; opponent: string; occasion: Occasion; first: number; last: number }>();
  for (const r of raws) {
    const key = gameKeyOf(r);
    const ts = tsOf.get(r)!;
    const g = gameInfo.get(key);
    if (g) { g.first = Math.min(g.first, ts); g.last = Math.max(g.last, ts); }
    else gameInfo.set(key, { id: `legacy-game-${slug(r.opponent)}-${r.occasion}`, opponent: r.opponent, occasion: r.occasion, first: ts, last: ts });
  }
  const teamIdOf = (name: string): string => {
    const known = teamsByName.get(name) ?? newTeams.get(name);
    if (known) return known.id;
    const t: Team = { id: `legacy-team-${slug(name)}`, name, is_own: false, updated_at: now };
    newTeams.set(name, t);
    return t.id;
  };
  const existingGames = new Map((input.existingGames ?? []).map((g) => [g.id, g]));
  const newToken = input.newToken ?? (() => crypto.randomUUID());
  const games: Game[] = [...gameInfo.values()].map((g) => ({
    id: g.id,
    opponent_team_id: teamIdOf(g.opponent),
    date: berlinDate(g.first),
    occasion: g.occasion,
    venue: null,
    status: 'finished' as const,
    ticker_token: existingGames.get(g.id)?.ticker_token ?? newToken(),
    updated_at: now
  }));

  // 3. Events.
  const events: GameEvent[] = [];
  const rosterSet = new Set<string>();
  for (const r of raws) {
    const g = gameInfo.get(gameKeyOf(r))!;
    const s = r.src;
    const unit: Unit = r.sheet;
    const typeTable = unit === 'offense' ? OFFENSE_TYPES : DEFENSE_TYPES;
    const type = typeTable[(s.eventtype ?? '').trim().toLowerCase()];
    if (!type) {
      skipped.push({ sheet: r.sheet, row: r.row, reason: `Eventtyp unbekannt: ${s.eventtype ?? ''}` });
      continue;
    }
    if (s.typist) typists.add(s.typist);

    const lineup = resolveList(s['line-up']);
    lineup.forEach((id) => rosterSet.add(id));
    const raw: Draft = { unit, type, lineup };
    const set = <K extends keyof Draft>(k: K, v: Draft[K] | undefined) => { if (v !== undefined) raw[k] = v; };

    const resultMapped = mapValue('result', RESULTS, s.result);
    let isXp = false;
    if (resultMapped?.startsWith('xp:')) { isXp = true; set('xp_result', resultMapped.slice(3) as never); }
    else if (resultMapped) set('result', resultMapped.slice(7) as never);

    set('player_id', resolveRef(s.player));
    set('incomplete_reason', mapValue('incomplete-reason', REASONS, s['incomplete-reason']) as never);
    set('foul', mapValue('foul', FOULS as Record<string, string>, s.foul) as never);
    set('foul_yards', num(s['foul-yards']));
    if (unit === 'offense') {
      set('qb_id', resolveRef(s['current-qb']));
      set('pass_result', mapValue('pass-result', PASS_RESULTS, s['pass-result']) as never);
      set('air_yards', num(s['air-yards']));
      set('yards_after_catch', num(s['yards-after-catch']));
      set('yards_run', num(s['yards-run']));
      set('flag_pulls_missed', num(s['tackles-broken']));
      set('yards_lost', num(s['sack-yards-lost']));
    } else {
      const blitz = resolveList(s['current-blitzer']);
      if (blitz.length) raw.blitzer_ids = blitz;
      set('target_result', mapValue('target-result', TARGET_RESULTS, s['target-result']) as never);
      set('flag_puller_id', resolveRef(s['flag-puller']));
      const failed = resolveList(s['flag-pull-attempter']);
      if (failed.length) raw.failed_puller_ids = failed;
    }

    const ctx = { xp: isXp };
    const normalized = normalizeDraft(raw, ctx);
    for (const [field, value] of Object.entries(raw)) {
      if (field === 'lineup' || field === 'unit' || field === 'type') continue;
      const kept = (normalized as unknown as Record<string, unknown>)[field];
      const had = value !== undefined && value !== 0 && !(Array.isArray(value) && value.length === 0);
      if (had && JSON.stringify(kept) !== JSON.stringify(value)) dropped.set(field, (dropped.get(field) ?? 0) + 1);
    }
    const data: PlayData = toPlayData(raw, ctx);
    events.push({
      id: `legacy-${r.sheet}-${r.row}`, game_id: g.id, client_ts: tsOf.get(r)!, author_id: null,
      author_label: s.typist || undefined, kind: 'play', data
    });
  }

  // 4. Comments -> game whose time span (plus 30 min) contains them.
  const unassigned: ImportReport['unassignedComments'] = [];
  let commentCount = 0;
  input.comments.forEach((c, row) => {
    const text = (c.comment ?? '').trim();
    if (isDefault(text)) return;
    const ts = parseLegacyTimestamp(c.timestamp ?? '');
    const g = ts === undefined ? undefined : [...gameInfo.values()].find((x) => ts >= x.first - 30 * 60_000 && ts <= x.last + 30 * 60_000);
    if (!g || ts === undefined) return void unassigned.push({ row, text });
    events.push({ id: `legacy-comment-${row}`, game_id: g.id, client_ts: ts, author_id: null, kind: 'comment', text });
    commentCount += 1;
  });

  const roster: RosterEntry[] = [...gameInfo.values()].flatMap((g) => {
    const ids = new Set<string>();
    for (const e of events) if (e.game_id === g.id && e.kind === 'play') e.data.lineup.forEach((p) => ids.add(p));
    return [...ids].map((player_id) => ({ game_id: g.id, player_id, present: true, updated_at: now }));
  });

  const reportGames = games.map((g) => {
    const evs = events.filter((e) => e.game_id === g.id);
    const plays = effectivePlays(evs);
    const sc = computeScore(plays);
    return { id: g.id, opponent: [...gameInfo.values()].find((x) => x.id === g.id)!.opponent, occasion: g.occasion, plays: plays.length, own: sc.own, opp: sc.opp };
  });

  const unresolvedRefs = [...unresolved.entries()].map(([ref, v]) => ({ ref, ...v }));
  const report: ImportReport = {
    canImport: unresolvedRefs.length === 0,
    counts: { plays: events.filter((e) => e.kind === 'play').length, comments: commentCount, games: games.length, newTeams: newTeams.size },
    games: reportGames,
    unresolvedRefs,
    unmappedValues: [...unmapped.entries()].map(([k, count]) => {
      const [column, value] = k.split('\u0000') as [string, string];
      return { column, value, count };
    }),
    droppedValues: [...dropped.entries()].map(([field, count]) => ({ field, count })),
    skippedRows: skipped,
    unassignedComments: unassigned,
    pseudoOpponents: [...gameInfo.values()].map((g) => g.opponent).filter((n) => /final|platz|place/i.test(n)),
    typists: [...typists],
    ambiguousOrderMinutes
  };
  return {
    report,
    bundle: { teams: [...newTeams.values()], games, roster, events }
  };
}

