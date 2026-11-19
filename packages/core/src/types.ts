export type Unit = 'offense' | 'defense';

export const OFFENSE_TYPES = ['pass', 'run', 'sack', 'throwaway', 'dead_snap', 'foul_committed', 'foul_drawn'] as const;
export const DEFENSE_TYPES = ['target', 'run', 'sack', 'throwaway', 'dead_snap', 'foul_committed', 'foul_drawn'] as const;
export type OffenseType = (typeof OFFENSE_TYPES)[number];
export type DefenseType = (typeof DEFENSE_TYPES)[number];
export type PlayType = OffenseType | DefenseType;

export const DEFAULT_TYPE: Record<Unit, PlayType> = { offense: 'pass', defense: 'target' };
export const TYPES_BY_UNIT: Record<Unit, readonly PlayType[]> = { offense: OFFENSE_TYPES, defense: DEFENSE_TYPES };

export type PassResult = 'catch' | 'incomplete' | 'interception';
export type TargetResult = 'catch_allowed' | 'incomplete' | 'interception';
export type IncompleteReason = 'fifty_fifty' | 'drop' | 'uncatchable' | 'batted';
export type PlayResult = 'td' | 'first_down' | 'tod' | 'pick_6' | 'safety';
export type XpResult =
  | '1xp_made' | '1xp_missed' | '2xp_made' | '2xp_missed'
  | '1xp_allowed' | '1xp_prevented' | '2xp_allowed' | '2xp_prevented'
  | 'xp_retry';
export type Foul =
  | 'illegal_contact' | 'screening_bb' | 'false_start' | 'flag_guarding_jumping'
  | 'unsporting' | 'illegal_blitz' | 'flag_guarding' | 'other';

/** Fields of a recorded play. Absent/undefined means "not recorded or not applicable". */
export interface PlayData {
  unit: Unit;
  type: PlayType;
  lineup: string[];
  qb_id?: string;
  blitzer_ids?: string[];
  player_id?: string;
  pass_result?: PassResult;
  target_result?: TargetResult;
  incomplete_reason?: IncompleteReason;
  air_yards?: number;
  yards_after_catch?: number;
  yards_run?: number;
  flag_pulls_missed?: number;
  yards_lost?: number;
  flag_puller_id?: string;
  failed_puller_ids?: string[];
  foul?: Foul;
  foul_yards?: number;
  result?: PlayResult;
  xp_result?: XpResult;
}

export type PlayField = Exclude<keyof PlayData, 'unit'>;

/** Editable form state: same shape as PlayData, everything but unit optional. */
export type Draft = Partial<Omit<PlayData, 'unit' | 'lineup'>> & { unit: Unit; lineup: string[] };

export type MarkerType = 'quarter_start' | 'quarter_end' | 'halftime' | 'drive_end' | 'timeout' | 'game_end';

interface EventBase {
  id: string;
  game_id: string;
  /** Milliseconds since epoch on the recording device. */
  client_ts: number;
  author_id: string | null;
  /** Free-text author for imported data without a user account (e.g. legacy typist name). */
  author_label?: string;
}
export interface PlayEvent extends EventBase { kind: 'play'; data: PlayData }
export interface MarkerEvent extends EventBase { kind: 'marker'; marker: MarkerType }
export interface CommentEvent extends EventBase { kind: 'comment'; text: string; play_id?: string }
export interface EditEvent extends EventBase { kind: 'edit'; replaces_id: string; data: PlayData }
export interface VoidEvent extends EventBase { kind: 'void'; voids_id: string }
export type GameEvent = PlayEvent | MarkerEvent | CommentEvent | EditEvent | VoidEvent;

export interface Player {
  id: string;
  number: string;
  name: string;
  active: boolean;
  offense_prio: number;
  defense_prio: number;
  qb_prio: number;
  blitz_prio: number;
  updated_at: number;
}

export interface Team { id: string; name: string; is_own: boolean; updated_at: number }

export type Occasion = 'dffl_game' | 'semifinal' | 'final' | 'group_stage' | 'other';
export type GameStatus = 'planned' | 'live' | 'finished';

export interface Game {
  id: string;
  opponent_team_id: string;
  date: string; // YYYY-MM-DD
  occasion: Occasion;
  venue: string | null;
  status: GameStatus;
  ticker_token: string;
  updated_at: number;
}

export interface RosterEntry { game_id: string; player_id: string; present: boolean; updated_at: number }

export interface TypistAssignment {
  id: string;
  game_id: string;
  user_id: string;
  from_ts: number;
  to_ts: number | null;
  updated_at: number;
}

export interface PlayerRef { number: string; name: string }
export type PlayerLookup = (id: string | undefined | null) => PlayerRef | undefined;

export interface EffectivePlay {
  id: string;
  game_id: string;
  client_ts: number;
  author_id: string | null;
  author_label?: string;
  data: PlayData;
  corrected: boolean;
  /** 1-based period (quarter) number at the time of the play. */
  period: number;
  /** 1-based drive number at the time of the play. */
  drive: number;
}


