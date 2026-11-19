import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '@ffs/core';
import {
  NetworkError, type ExportStatus, type MasterRows, type MasterTable, type PullResult, type SyncBackend, type TickerSnapshot, type WireEvent
} from './backend.js';

export interface SupabaseConfig { url: string; anonKey: string }

export function createSupabaseClient(cfg: SupabaseConfig): SupabaseClient {
  return createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
}

function isNetwork(err: { message?: string; code?: string; status?: number }): boolean {
  return err.status === 0 || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(err.message ?? '');
}

type Rpc = Pick<SupabaseClient, 'rpc'>;

async function call<T>(client: Rpc, fn: string, args: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await client.rpc(fn, args);
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : undefined);
  }
  if (res.error) {
    if (isNetwork(res.error as never)) throw new NetworkError();
    throw new Error(res.error.message);
  }
  return res.data as T;
}

export function createSupabaseBackend(client: Rpc): SyncBackend {
  return {
    pushEvents: (events: WireEvent[]) =>
      call<{ id: string; seq: number }[]>(client, 'push_events', {
        p_events: events.map((e) => ({ id: e.id, game_id: e.game_id, client_ts: e.client_ts, author_label: e.author_label ?? null, kind: e.kind, payload: e.payload }))
      }),
    pushRows: async <T extends MasterTable>(table: T, rows: MasterRows[T]) => {
      await call<void>(client, 'push_rows', { p_table: table, p_rows: rows });
    },
    pullRows: (since: number) => call<PullResult>(client, 'pull_rows', { p_since: since }),
    pullEvents: (gameId: string, afterSeq: number) => call<WireEvent[]>(client, 'pull_events', { p_game: gameId, p_after: afterSeq }),
    tickerSnapshot: (token: string, afterSeq: number) => call<TickerSnapshot | null>(client, 'ticker_snapshot', { p_token: token, p_after: afterSeq }),
    exportStatus: (gameId: string) => call<ExportStatus | null>(client, 'export_status', { p_game: gameId })
  };
}

export interface AppUser { id: string; email: string | null; display_name: string | null; role: Role }

/** Reads the role of the signed-in user from app_user. */
export async function loadAppUser(client: SupabaseClient): Promise<AppUser | null> {
  const { data: session } = await client.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return null;
  const { data, error } = await client.from('app_user').select('id,email,display_name,role').eq('id', uid).maybeSingle();
  if (error) {
    if (isNetwork(error as never)) throw new NetworkError();
    throw new Error(error.message);
  }
  return (data as AppUser | null) ?? null;
}

export async function listAppUsers(client: SupabaseClient): Promise<AppUser[]> {
  const { data, error } = await client.from('app_user').select('id,email,display_name,role').order('email');
  if (error) throw new Error(error.message);
  return (data ?? []) as AppUser[];
}

export async function setUserRole(client: SupabaseClient, id: string, role: Role): Promise<void> {
  const { error } = await client.from('app_user').update({ role }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function sendLoginLink(client: SupabaseClient, email: string, redirectTo: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (error) throw new Error(error.message);
}

export type { SupabaseClient } from '@supabase/supabase-js';
