import { describe, expect, it } from 'vitest';
import { createSupabaseBackend, NetworkError } from './index.js';

type Res = { data?: unknown; error?: { message: string; status?: number } | null };
const client = (impl: (fn: string, args: Record<string, unknown>) => Res | Promise<Res>) =>
  ({ rpc: async (fn: string, args: Record<string, unknown>) => ({ data: null, error: null, ...(await impl(fn, args)) }) }) as never;

describe('supabase backend adapter', () => {
  it('maps calls to the RPC names and parameters', async () => {
    const calls: [string, unknown][] = [];
    const b = createSupabaseBackend(client((fn, args) => { calls.push([fn, args]); return { data: fn === 'push_events' ? [{ id: 'a', seq: 1 }] : null }; }));
    const acks = await b.pushEvents([{ id: 'a', game_id: 'g', client_ts: 5, author_id: 'u', author_label: null, kind: 'marker', payload: { marker: 'drive_end' } }]);
    expect(acks).toEqual([{ id: 'a', seq: 1 }]);
    await b.pullEvents('g', 3);
    await b.tickerSnapshot('tok', 7);
    await b.pushRows('players', []);
    expect(calls.map((c) => c[0])).toEqual(['push_events', 'pull_events', 'ticker_snapshot', 'push_rows']);
    expect(calls[0]![1]).toEqual({ p_events: [{ id: 'a', game_id: 'g', client_ts: 5, author_label: null, kind: 'marker', payload: { marker: 'drive_end' } }] });
    expect(calls[2]![1]).toEqual({ p_token: 'tok', p_after: 7 });
  });

  it('turns connectivity failures into NetworkError and server errors into plain errors', async () => {
    const down = createSupabaseBackend(client(() => ({ error: { message: 'TypeError: Failed to fetch' } })));
    await expect(down.pullRows(0)).rejects.toBeInstanceOf(NetworkError);
    const thrown = createSupabaseBackend({ rpc: async () => { throw new TypeError('boom'); } } as never);
    await expect(thrown.pullRows(0)).rejects.toBeInstanceOf(NetworkError);
    const rejected = createSupabaseBackend(client(() => ({ error: { message: 'Das Spiel ist beendet' } })));
    const err = await rejected.pushEvents([]).catch((e) => e);
    expect(err).not.toBeInstanceOf(NetworkError);
    expect(err.message).toBe('Das Spiel ist beendet');
  });
});
