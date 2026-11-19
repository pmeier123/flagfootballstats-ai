import { parseCsv, type CsvRow } from './csv.js';
import type { Player } from './types.js';

export type PlayerInput = Pick<Player, 'number' | 'name' | 'offense_prio' | 'defense_prio' | 'qb_prio' | 'blitz_prio'>;
export type PrioKey = 'offense' | 'defense' | 'qb' | 'blitz';

export function validatePlayer(p: Pick<Player, 'id' | 'number' | 'name' | 'active' | 'offense_prio' | 'defense_prio' | 'qb_prio' | 'blitz_prio'>, others: readonly Player[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!p.number.trim()) errors.number = 'Nummer fehlt';
  if (!p.name.trim()) errors.name = 'Name fehlt';
  for (const k of ['offense_prio', 'defense_prio', 'qb_prio', 'blitz_prio'] as const) {
    const v = p[k];
    if (!Number.isInteger(v) || v < 1 || v > 9) errors[k] = 'Priorität muss zwischen 1 und 9 liegen';
  }
  if (p.active && p.number.trim()) {
    const clash = others.find((o) => o.id !== p.id && o.active && o.number.trim() === p.number.trim());
    if (clash) errors.number = `Nummer ${p.number.trim()} ist bereits vergeben an ${clash.name}`;
  }
  return errors;
}

function compareNumber(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, 'de', { numeric: true });
}

/** Players sorted for a selection list: ascending priority (when a unit is given), then jersey number. */
export function sortPlayers(players: readonly Player[], by?: PrioKey): Player[] {
  const key = by ? (`${by}_prio` as const) : undefined;
  return [...players].sort((a, b) => (key ? a[key] - b[key] : 0) || compareNumber(a.number, b.number));
}

const ALIASES: Record<string, string> = {
  nr: 'number', nummer: 'number', number: 'number', name: 'name',
  offense_order: 'offense_prio', defense_order: 'defense_prio', qb_order: 'qb_prio', blitz_order: 'blitz_prio',
  offense_prio: 'offense_prio', defense_prio: 'defense_prio', qb_prio: 'qb_prio', blitz_prio: 'blitz_prio'
};

export interface PlayerCsvResult {
  valid: PlayerInput[];
  invalid: { row: number; reason: string }[];
}

/** Parses a roster CSV. Row numbers are 1-based data rows. Nothing is stored here. */
export function parsePlayersCsv(text: string, existing: readonly Player[]): PlayerCsvResult {
  const rows: CsvRow[] = parseCsv(text).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [ALIASES[k.trim().toLowerCase()] ?? k, v]))
  );
  const valid: PlayerInput[] = [];
  const invalid: PlayerCsvResult['invalid'] = [];
  const seen = new Set<string>();
  const activeNumbers = new Map(existing.filter((p) => p.active).map((p) => [p.number.trim(), p.name]));
  rows.forEach((r, i) => {
    const row = i + 1;
    const number = (r.number ?? '').trim();
    const name = (r.name ?? '').trim();
    if (!name) return void invalid.push({ row, reason: 'Name fehlt' });
    if (!number) return void invalid.push({ row, reason: 'Nummer fehlt' });
    if (seen.has(number)) return void invalid.push({ row, reason: `Nummer ${number} kommt in der Datei mehrfach vor` });
    if (activeNumbers.has(number)) return void invalid.push({ row, reason: `Nummer ${number} ist bereits vergeben an ${activeNumbers.get(number)}` });
    const prio = (v: string | undefined): number | undefined => (v === undefined || v === '' ? 9 : Number.isInteger(Number(v)) ? Number(v) : undefined);
    const p = { number, name, offense_prio: prio(r.offense_prio), defense_prio: prio(r.defense_prio), qb_prio: prio(r.qb_prio), blitz_prio: prio(r.blitz_prio) };
    if (Object.values(p).some((v) => v === undefined) || [p.offense_prio, p.defense_prio, p.qb_prio, p.blitz_prio].some((v) => v! < 1 || v! > 9)) {
      return void invalid.push({ row, reason: 'Priorität muss eine Zahl von 1 bis 9 sein' });
    }
    seen.add(number);
    valid.push(p as PlayerInput);
  });
  return { valid, invalid };
}
