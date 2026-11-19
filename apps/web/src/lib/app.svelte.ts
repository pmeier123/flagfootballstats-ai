import type { Game, Player, PlayerLookup, Role, Team } from '@ffs/core';
import {
  createSupabaseBackend, createSupabaseClient, loadAppUser, NetworkError, Store, SyncEngine,
  type AppUser, type SupabaseClient, type SyncBackend, type SyncStatus
} from '@ffs/data';

export interface RuntimeConfig { url?: string; anonKey?: string }

export const OWN_TEAM_NAME = 'Aachen Emperors';

interface AppState {
  ready: boolean;
  /** Backend (Supabase) configured. Without it the app is a complete single-device app. */
  backendConfigured: boolean;
  user: { id: string; email: string | null; role: Role } | null;
  players: Player[];
  teams: Team[];
  games: Game[];
  sync: SyncStatus;
  error: string | null;
}

export const app: AppState = $state({
  ready: false,
  backendConfigured: false,
  user: null,
  players: [],
  teams: [],
  games: [],
  sync: { state: 'local_only', pending: 0, browserMayClose: false, message: '' },
  error: null
});

export let store: Store;
export let engine: SyncEngine;
export let backend: SyncBackend | null = null;
export let supabase: SupabaseClient | null = null;

async function loadConfig(): Promise<RuntimeConfig> {
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) return { url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY };
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) return (await res.json()) as RuntimeConfig;
  } catch {
    /* no runtime config: local mode */
  }
  return {};
}

const USER_CACHE = 'ffs.user';

export async function refreshLists(): Promise<void> {
  app.players = await store.listPlayers();
  app.teams = await store.listTeams();
  app.games = await store.listGames();
}

export async function refreshUser(): Promise<void> {
  if (!supabase) return;
  try {
    const u = await loadAppUser(supabase);
    app.user = u ? { id: u.id, email: u.email, role: u.role } : null;
    if (u) localStorage.setItem(USER_CACHE, JSON.stringify(app.user));
    else localStorage.removeItem(USER_CACHE);
  } catch (e) {
    if (e instanceof NetworkError) {
      const cached = localStorage.getItem(USER_CACHE);
      app.user = cached ? JSON.parse(cached) : null;
    } else app.error = e instanceof Error ? e.message : String(e);
  }
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
  localStorage.removeItem(USER_CACHE);
  app.user = null;
}

export async function syncNow(): Promise<void> {
  await engine.syncMaster();
  await engine.flush();
  await refreshLists();
}

export async function initApp(): Promise<void> {
  const cfg = await loadConfig();
  store = new Store();
  if (cfg.url && cfg.anonKey) {
    supabase = createSupabaseClient({ url: cfg.url, anonKey: cfg.anonKey });
    backend = createSupabaseBackend(supabase);
    app.backendConfigured = true;
  }
  engine = new SyncEngine(store, backend);
  engine.subscribe((s) => { app.sync = s; });

  if (app.backendConfigured) {
    await refreshUser();
    supabase!.auth.onAuthStateChange(() => void refreshUser().then(() => syncNow()));
  } else {
    app.user = { id: 'local', email: null, role: 'admin' };
  }

  if (app.user && (app.user.role === 'admin' || !app.backendConfigured)) {
    if (!(await store.listTeams()).some((t) => t.is_own)) await store.saveTeam(OWN_TEAM_NAME, true);
  }
  await refreshLists();
  engine.start();
  if (app.backendConfigured && app.user) await syncNow();
  setInterval(() => { if (app.user) void syncNow(); }, 60_000);
  setInterval(() => void engine.pollExport(), 30_000);

  if ('storage' in navigator && navigator.storage.persist) void navigator.storage.persist();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }
  app.ready = true;
}

export function ownTeam(): Team | undefined {
  return app.teams.find((t) => t.is_own);
}

export function teamName(id: string): string {
  return app.teams.find((t) => t.id === id)?.name ?? 'Gegner';
}

export const lookupPlayer: PlayerLookup = (id) => {
  const p = app.players.find((x) => x.id === id);
  return p ? { number: p.number, name: p.name } : undefined;
};

export type { AppUser };

