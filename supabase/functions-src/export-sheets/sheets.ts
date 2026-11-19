import { headerRow, type SheetPlan, type TabName, type Cell } from '../../../packages/core/src/index.ts';
import type { SheetsApi } from './job.ts';

export interface GoogleConfig {
  spreadsheetId: string;
  clientEmail: string;
  /** PEM private key of the service account (literal "\n" sequences are accepted). */
  privateKey: string;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const CHUNK = 500;

export function colLetter(index1: number): string {
  let n = index1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const b64url = (data: ArrayBuffer | string): string => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signJwt(cfg: GoogleConfig, now: number): Promise<string> {
  const pem = cfg.privateKey.replace(/\\n/g, '\n');
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  return `${head}.${claim}.${b64url(sig)}`;
}

const cellOut = (c: Cell): string | number | boolean => (c === null ? '' : c);

export class GoogleSheets implements SheetsApi {
  private token: { value: string; expires: number } | null = null;

  constructor(
    private cfg: GoogleConfig,
    private fetchFn: FetchFn = (u, i) => fetch(u, i),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private clock: () => number = () => Date.now()
  ) {}

  private async accessToken(): Promise<string> {
    const now = this.clock();
    if (this.token && this.token.expires > now + 60_000) return this.token.value;
    const jwt = await signJwt(this.cfg, Math.floor(now / 1000));
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
    });
    if (!res.ok) throw new Error(`Google-Anmeldung fehlgeschlagen (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expires: now + json.expires_in * 1000 };
    return json.access_token;
  }

  /** Calls the Sheets API; retries quota and transient errors with exponential backoff. */
  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url, {
        method,
        headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (res.ok) return (await res.json()) as T;
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt < 5) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      throw new Error(
        res.status === 403 || res.status === 404
          ? `Zugriff auf das Google Sheet verweigert oder nicht gefunden (${res.status}). Ist es mit ${this.cfg.clientEmail} geteilt? ${text.slice(0, 200)}`
          : `Google Sheets API ${res.status}: ${text.slice(0, 300)}`
      );
    }
  }

  async ensureTabs(tabs: { name: TabName; header: string[] }[]): Promise<void> {
    const id = this.cfg.spreadsheetId;
    const meta = await this.request<{ sheets?: { properties: { title: string } }[] }>('GET', `${API}/${id}?fields=sheets.properties.title`);
    const have = new Set((meta.sheets ?? []).map((s) => s.properties.title));
    const missing = tabs.filter((t) => !have.has(t.name));
    if (missing.length) {
      await this.request('POST', `${API}/${id}:batchUpdate`, {
        requests: missing.map((t) => ({ addSheet: { properties: { title: t.name } } }))
      });
    }
    const first = await this.request<{ valueRanges?: { values?: unknown[][] }[] }>(
      'GET', `${API}/${id}/values:batchGet?${tabs.map((t) => `ranges=${t.name}!A1:A1`).join('&')}`
    );
    const headers = tabs.filter((_, i) => !first.valueRanges?.[i]?.values?.length);
    if (headers.length) {
      await this.request('POST', `${API}/${id}/values:batchUpdate`, {
        valueInputOption: 'RAW',
        data: headers.map((t) => ({ range: `${t.name}!A1`, values: [t.header] }))
      });
    }
  }

  async readKeys(tab: TabName): Promise<{ key: string; hash: string }[]> {
    const cols = headerRow(tab).length;
    const keyCol = colLetter(cols - 1);
    const hashCol = colLetter(cols);
    const res = await this.request<{ valueRanges?: { values?: string[][] }[] }>(
      'GET', `${API}/${this.cfg.spreadsheetId}/values:batchGet?ranges=${tab}!${keyCol}2:${keyCol}&ranges=${tab}!${hashCol}2:${hashCol}`
    );
    const keys = res.valueRanges?.[0]?.values ?? [];
    const hashes = res.valueRanges?.[1]?.values ?? [];
    const n = Math.max(keys.length, hashes.length);
    return Array.from({ length: n }, (_, i) => ({ key: String(keys[i]?.[0] ?? ''), hash: String(hashes[i]?.[0] ?? '') }));
  }

  async write(tab: TabName, plan: SheetPlan, columns: number): Promise<void> {
    const id = this.cfg.spreadsheetId;
    const last = colLetter(columns);
    for (let i = 0; i < plan.updates.length; i += CHUNK) {
      await this.request('POST', `${API}/${id}/values:batchUpdate`, {
        valueInputOption: 'RAW',
        data: plan.updates.slice(i, i + CHUNK).map((u) => ({ range: `${tab}!A${u.rowIndex + 2}`, values: [u.values.map(cellOut)] }))
      });
    }
    for (let i = 0; i < plan.clears.length; i += CHUNK) {
      await this.request('POST', `${API}/${id}/values:batchClear`, {
        ranges: plan.clears.slice(i, i + CHUNK).map((r) => `${tab}!A${r + 2}:${last}${r + 2}`)
      });
    }
    // Appends last: INSERT_ROWS never overwrites rows that exist below a gap.
    for (let i = 0; i < plan.appends.length; i += CHUNK) {
      await this.request('POST', `${API}/${id}/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        values: plan.appends.slice(i, i + CHUNK).map((r) => r.map(cellOut))
      });
    }
  }
}
