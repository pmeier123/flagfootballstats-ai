// Deno entry point of the Sheets export. Bundled by `npm run bundle:export` into supabase/functions/export-sheets/index.ts.
// Required secrets: EXPORT_SECRET, GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fromWire, type WireEvent } from '../../../packages/data/src/backend.ts';
import type { Game, Player } from '../../../packages/core/src/index.ts';
import { runExport, type DbApi } from './job.ts';
import { GoogleSheets } from './sheets.ts';

declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Secret ${name} fehlt`);
  return v;
}

function makeDb(): DbApi {
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const ok = <T>(r: { data: T | null; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data as T;
  };
  return {
    async gamesNeedingExport() {
      const seqs = ok(await sb.from('game_seq').select('game_id,next_seq')) as { game_id: string; next_seq: number }[];
      const state = ok(await sb.from('export_state').select('game_id,last_seq')) as { game_id: string; last_seq: number }[];
      const last = new Map(state.map((s) => [s.game_id, Number(s.last_seq)]));
      return seqs
        .map((s) => ({ game_id: s.game_id, max_seq: Number(s.next_seq), last_seq: last.get(s.game_id) ?? 0 }))
        .filter((s) => s.max_seq > s.last_seq);
    },
    async loadGame(gameId) {
      const game = ok(await sb.from('games').select('*').eq('id', gameId).single()) as Game;
      const team = ok(await sb.from('teams').select('name').eq('id', game.opponent_team_id).maybeSingle()) as { name: string } | null;
      const rows = ok(await sb.from('events').select('*').eq('game_id', gameId).order('seq')) as (WireEvent & { seq: number })[];
      return {
        game: { ...game, date: String(game.date), updated_at: Number(game.updated_at) },
        opponentName: team?.name ?? 'Gegner',
        events: rows.map(fromWire),
        maxSeq: rows.reduce((m, r) => Math.max(m, Number(r.seq)), 0)
      };
    },
    async loadPlayers() {
      return ok(await sb.from('players').select('*')) as Player[];
    },
    async authorNames() {
      const rows = ok(await sb.from('app_user').select('id,display_name,email')) as { id: string; display_name: string | null; email: string | null }[];
      return new Map(rows.map((r) => [r.id, r.display_name ?? r.email ?? r.id]));
    },
    async saveProgress(gameId, lastSeq, error) {
      const row: Record<string, unknown> = { game_id: gameId, last_run: new Date().toISOString(), last_error: error };
      if (error === null) row.last_seq = lastSeq;
      ok(await sb.from('export_state').upsert(row, { onConflict: 'game_id' }));
    }
  };
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get('authorization') !== `Bearer ${env('EXPORT_SECRET')}`) return new Response('Unauthorized', { status: 401 });
    const sheets = new GoogleSheets({
      spreadsheetId: env('GOOGLE_SHEET_ID'), clientEmail: env('GOOGLE_CLIENT_EMAIL'), privateKey: env('GOOGLE_PRIVATE_KEY')
    });
    const result = await runExport(makeDb(), sheets);
    return Response.json(result, { status: result.failed.length ? 502 : 200 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});
