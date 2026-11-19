import type { Occasion } from '@ffs/core';

export const OCCASIONS: { value: Occasion; label: string }[] = [
  { value: 'dffl_game', label: 'DFFL-Spiel' },
  { value: 'semifinal', label: 'Halbfinale' },
  { value: 'final', label: 'Finale' },
  { value: 'group_stage', label: 'Gruppenphase' },
  { value: 'other', label: 'Sonstiges' }
];

export const occasionLabel = (o: Occasion): string => OCCASIONS.find((x) => x.value === o)?.label ?? o;

export const STATUS_LABEL = { planned: 'Geplant', live: 'Läuft', finished: 'Beendet' } as const;

export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

export function download(filename: string, content: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function tickerUrl(token: string): string {
  return `${location.origin}${location.pathname}#/t/${token}`;
}
