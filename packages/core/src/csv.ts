export type CsvRow = Record<string, string>;

/** Minimal RFC-4180 parser. The delimiter (comma or semicolon) is detected from the header line. */
export function parseCsv(text: string): CsvRow[] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      records.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const nonEmpty = records.filter((r) => r.some((x) => x.trim() !== ''));
  const header = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return nonEmpty.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
