import { fromWire, MASTER_TABLES, NetworkError, toWire, type MasterRows, type MasterTable, type SyncBackend } from './backend.js';
import type { Store } from './store.js';

export type SyncState = 'local_only' | 'synced' | 'sending' | 'offline' | 'error' | 'sheets_pending';

export interface SyncStatus {
  state: SyncState;
  /** Events that are not yet confirmed by the backend. */
  pending: number;
  /** True only when every event is confirmed by the backend. */
  browserMayClose: boolean;
  message: string;
  error?: string;
}

export interface StatusInput {
  backendConfigured: boolean;
  online: boolean;
  pending: number;
  sending: boolean;
  lastError: string | null;
  sheetsBehind: boolean;
}

export function computeSyncStatus(i: StatusInput): SyncStatus {
  if (!i.backendConfigured) {
    return {
      state: 'local_only', pending: i.pending, browserMayClose: false,
      message: `Ereignisse liegen nur auf diesem Gerät${i.pending ? ` (${i.pending})` : ''}. Regelmäßig exportieren.`
    };
  }
  if (i.pending === 0) {
    return i.sheetsBehind
      ? { state: 'sheets_pending', pending: 0, browserMayClose: true, message: 'Gesichert. Google Sheets folgt automatisch. Browser darf geschlossen werden.' }
      : { state: 'synced', pending: 0, browserMayClose: true, message: 'Gesichert. Browser darf geschlossen werden.' };
  }
  if (!i.online) {
    return { state: 'offline', pending: i.pending, browserMayClose: false, message: `Offline. ${i.pending} Ereignisse nur auf diesem Gerät. Browser offen lassen.` };
  }
  if (i.lastError) {
    return { state: 'error', pending: i.pending, browserMayClose: false, message: `Fehler beim Senden: ${i.lastError}. Browser offen lassen.`, error: i.lastError };
  }
  return { state: 'sending', pending: i.pending, browserMayClose: false, message: `${i.pending} Ereignisse werden gesendet. Browser offen lassen.` };
}

export interface EngineOptions {
  batchSize?: number;
  isOnline?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  now?: () => number;
}

type Listener = (s: SyncStatus) => void;

export class SyncEngine {
  private status: SyncStatus;
  private listeners = new Set<Listener>();
  private sending = false;
  private lastError: string | null = null;
  private networkDown = false;
  private sheetsBehind = false;
  private attempt = 0;
  private timer: unknown = null;
  private running: Promise<void> | null = null;
  private watched: string | null = null;
  private readonly batchSize: number;
  private readonly isOnline: () => boolean;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private store: Store, private backend: SyncBackend | null, opts: EngineOptions = {}) {
    this.batchSize = opts.batchSize ?? 50;
    this.isOnline = opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.status = computeSyncStatus({ backendConfigured: !!backend, online: true, pending: 0, sending: false, lastError: null, sheetsBehind: false });
  }

  get current(): SyncStatus { return this.status; }
  get configured(): boolean { return !!this.backend; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  /** Game whose export progress is shown as "sheets pending". */
  watchGame(gameId: string | null): void { this.watched = gameId; }

  async refreshStatus(): Promise<SyncStatus> {
    const pending = await this.store.countPending();
    const online = this.isOnline() && !this.networkDown;
    this.status = computeSyncStatus({
      backendConfigured: !!this.backend, online, pending, sending: this.sending, lastError: this.lastError, sheetsBehind: this.sheetsBehind
    });
    this.listeners.forEach((l) => l(this.status));
    return this.status;
  }

  /** Sends all unconfirmed events. Safe to call concurrently; calls share one run. */
  flush(): Promise<void> {
    if (!this.backend) return this.refreshStatus().then(() => undefined);
    if (!this.running) {
      this.running = this.doFlush().finally(() => { this.running = null; });
    }
    return this.running;
  }

  private async doFlush(): Promise<void> {
    const backend = this.backend!;
    this.clearRetry();
    if (!this.isOnline()) {
      await this.refreshStatus();
      return;
    }
    this.sending = true;
    try {
      for (;;) {
        const batch = await this.store.pendingEvents(this.batchSize);
        if (!batch.length) break;
        await this.refreshStatus();
        const acks = await backend.pushEvents(batch.map(toWire));
        await this.store.markSynced(acks);
        const acked = new Set(acks.map((a) => a.id));
        if (!batch.some((e) => acked.has(e.id))) throw new Error('Server hat keine Ereignisse bestätigt');
      }
      this.lastError = null;
      this.networkDown = false;
      this.attempt = 0;
      await this.updateSheetsState();
    } catch (err) {
      if (err instanceof NetworkError) this.networkDown = true;
      else { this.lastError = err instanceof Error ? err.message : String(err); this.networkDown = false; }
      this.scheduleRetry();
    } finally {
      this.sending = false;
      await this.refreshStatus();
    }
  }

  private async updateSheetsState(): Promise<void> {
    if (!this.backend || !this.watched) { this.sheetsBehind = false; return; }
    try {
      const st = await this.backend.exportStatus(this.watched);
      this.sheetsBehind = !!st && (await this.store.maxSeq(this.watched)) > st.last_seq;
    } catch {
      this.sheetsBehind = false;
    }
  }

  /** Re-checks export progress (used by a periodic timer in the app). */
  async pollExport(): Promise<void> {
    if (!(await this.store.countPending())) await this.updateSheetsState();
    await this.refreshStatus();
  }

  private scheduleRetry(): void {
    const delay = Math.min(60_000, 2_000 * 2 ** this.attempt);
    this.attempt += 1;
    this.clearRetry();
    this.timer = this.setTimer(() => { this.timer = null; void this.flush(); }, delay);
  }
  private clearRetry(): void {
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
  }

  /** Push dirty master rows, then pull changes from the server (last write wins). */
  async syncMaster(): Promise<void> {
    if (!this.backend || !this.isOnline()) return;
    try {
      const dirty = await this.store.dirtyRows();
      for (const t of MASTER_TABLES) {
        const rows = dirty[t];
        if (rows.length) {
          await this.backend.pushRows(t as MasterTable, rows as never);
          await this.store.markClean(t, rows as never);
        }
      }
      const cursor = (await this.store.getMeta<number>('master_cursor')) ?? 0;
      const pulled = await this.backend.pullRows(cursor);
      for (const t of MASTER_TABLES) {
        const rows = pulled.rows[t] as MasterRows[typeof t] | undefined;
        if (rows?.length) await this.store.applyRemoteRows(t, rows as never);
      }
      await this.store.setMeta('master_cursor', pulled.cursor);
      this.lastError = null;
      this.networkDown = false;
    } catch (err) {
      if (err instanceof NetworkError) this.networkDown = true;
      else this.lastError = err instanceof Error ? err.message : String(err);
    }
    await this.refreshStatus();
  }

  /** Fetches events of a game that other devices recorded (e.g. after a handover). */
  async pullGame(gameId: string): Promise<void> {
    if (!this.backend || !this.isOnline()) return;
    try {
      const after = await this.store.maxSeq(gameId);
      const remote = await this.backend.pullEvents(gameId, after);
      await this.store.applyRemoteEvents(remote.map((w) => ({ ...fromWire(w), seq: w.seq ?? 0 })));
    } catch (err) {
      if (err instanceof NetworkError) this.networkDown = true;
    }
    await this.refreshStatus();
  }

  /** Wires browser events. Returns a function that removes the listeners. */
  start(win: Pick<Window, 'addEventListener' | 'removeEventListener'> & { document?: Document } = window): () => void {
    const onOnline = () => { this.networkDown = false; void this.flush(); void this.syncMaster(); };
    const onOffline = () => void this.refreshStatus();
    const onHide = () => { if (win.document?.visibilityState === 'hidden') void this.flush(); };
    const onPageHide = () => void this.flush();
    win.addEventListener('online', onOnline);
    win.addEventListener('offline', onOffline);
    win.addEventListener('pagehide', onPageHide);
    win.document?.addEventListener('visibilitychange', onHide);
    void this.flush();
    return () => {
      win.removeEventListener('online', onOnline);
      win.removeEventListener('offline', onOffline);
      win.removeEventListener('pagehide', onPageHide);
      win.document?.removeEventListener('visibilitychange', onHide);
      this.clearRetry();
    };
  }
}
