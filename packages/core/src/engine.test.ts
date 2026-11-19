import { describe, expect, it } from 'vitest';
import {
  activeRules, applyChange, clearedDraft, emptyDraft, evaluateDraft, normalizeDraft, pruneLineup, toPlayData,
  type Draft, type RuleContext, type Unit
} from './index.js';

const L5 = ['p1', 'p2', 'p3', 'p4', 'p5'];
const ctx: RuleContext = { xp: false };
const xpCtx: RuleContext = { xp: true };

function offense(over: Partial<Draft> = {}, c: RuleContext = ctx): Draft {
  return normalizeDraft({ ...emptyDraft('offense', { lineup: L5 }), qb_id: 'p1', ...over }, c);
}
function defense(over: Partial<Draft> = {}, c: RuleContext = ctx): Draft {
  return normalizeDraft({ ...emptyDraft('defense', { lineup: L5 }), ...over }, c);
}

function shown(d: Draft, c: RuleContext = ctx): string[] {
  return activeRules(d, c).map((r) => r.field);
}
function required(d: Draft, c: RuleContext = ctx): string[] {
  const e = evaluateDraft(d, c);
  return e.fields.filter((f) => f.required).map((f) => f.field);
}
function resultOptions(d: Draft, c: RuleContext = ctx): (string | number)[] | null {
  return evaluateDraft(d, c).fields.find((f) => f.field === 'result')?.options ?? null;
}
function options(d: Draft, field: string, c: RuleContext = ctx) {
  return evaluateDraft(d, c).fields.find((f) => f.field === field)?.options ?? null;
}

describe('offense field matrix', () => {
  it('pass without pass result', () => {
    const d = offense();
    expect(shown(d)).toEqual(['player_id', 'pass_result']);
    expect(required(d)).toEqual(['player_id', 'pass_result']);
    expect(resultOptions(d)).toBeNull();
  });

  it('pass catch', () => {
    const d = offense({ pass_result: 'catch' });
    expect(shown(d)).toEqual(['player_id', 'pass_result', 'air_yards', 'yards_after_catch', 'result']);
    expect(required(d)).toEqual(['player_id', 'pass_result', 'air_yards']);
    expect(d.yards_after_catch).toBe(0);
    expect(resultOptions(d)).toEqual(['td', 'first_down', 'tod']);
    expect(options(d, 'air_yards')).toEqual([0, 5, 10, 15, 20, 30]);
  });

  it('flag pulls missed only visible when yards after catch is not 0', () => {
    const base = offense({ pass_result: 'catch' });
    expect(shown(base)).not.toContain('flag_pulls_missed');
    const d = applyChange(base, { yards_after_catch: 5 }, ctx);
    expect(shown(d)).toContain('flag_pulls_missed');
    expect(d.flag_pulls_missed).toBe(0);
    expect(options(d, 'flag_pulls_missed')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const back = applyChange({ ...d, flag_pulls_missed: 3 }, { yards_after_catch: 0 }, ctx);
    expect(back.flag_pulls_missed).toBeUndefined();
  });

  it('pass incomplete', () => {
    const d = offense({ pass_result: 'incomplete' });
    expect(shown(d)).toEqual(['player_id', 'pass_result', 'incomplete_reason', 'result']);
    expect(required(d)).toEqual(['player_id', 'pass_result', 'incomplete_reason']);
    expect(options(d, 'incomplete_reason')).toEqual(['fifty_fifty', 'drop', 'uncatchable', 'batted']);
    expect(resultOptions(d)).toEqual(['tod']);
  });

  it('pass interception', () => {
    const d = offense({ pass_result: 'interception' });
    expect(shown(d)).toEqual(['player_id', 'pass_result', 'result']);
    expect(resultOptions(d)).toEqual(['pick_6']);
  });

  it('run', () => {
    const d = offense({ type: 'run' });
    expect(shown(d)).toEqual(['player_id', 'yards_run', 'result']);
    expect(required(d)).toEqual(['player_id', 'yards_run']);
    expect(d.yards_run).toBe(0);
    expect(resultOptions(d)).toEqual(['td', 'first_down', 'tod']);
    const moving = applyChange(d, { yards_run: 10 }, ctx);
    expect(shown(moving)).toContain('flag_pulls_missed');
  });

  it('sack', () => {
    const d = offense({ type: 'sack' });
    expect(shown(d)).toEqual(['yards_lost', 'result']);
    expect(required(d)).toEqual(['yards_lost']);
    expect(options(d, 'yards_lost')).toEqual([-5, 0, -10, -15]);
    expect(resultOptions(d)).toEqual(['tod', 'safety']);
  });

  it.each(['throwaway', 'dead_snap'] as const)('%s', (type) => {
    const d = offense({ type });
    expect(shown(d)).toEqual(['result']);
    expect(required(d)).toEqual([]);
    expect(resultOptions(d)).toEqual(['tod']);
  });

  it('foul committed', () => {
    const d = offense({ type: 'foul_committed' });
    expect(shown(d)).toEqual(['player_id', 'foul', 'result']);
    expect(required(d)).toEqual(['foul']);
    expect(options(d, 'foul')).toEqual(['illegal_contact', 'screening_bb', 'false_start', 'flag_guarding_jumping', 'unsporting', 'other']);
    expect(resultOptions(d)).toEqual(['tod']);
  });

  it('foul drawn has no result and its own list', () => {
    const d = offense({ type: 'foul_drawn' });
    expect(shown(d)).toEqual(['player_id', 'foul']);
    expect(options(d, 'foul')).toEqual(['illegal_contact', 'screening_bb', 'false_start', 'unsporting', 'other']);
    expect(resultOptions(d)).toBeNull();
  });

  it('foul yards required only for other', () => {
    const d = offense({ type: 'foul_drawn', foul: 'other' });
    expect(shown(d)).toContain('foul_yards');
    expect(required(d)).toEqual(['foul', 'foul_yards']);
    expect(options(d, 'foul_yards')).toEqual([0, -5, -10]);
    const e = offense({ type: 'foul_drawn', foul: 'false_start' });
    expect(shown(e)).not.toContain('foul_yards');
  });
});

describe('defense field matrix', () => {
  it('target without result', () => {
    const d = defense();
    expect(d.type).toBe('target');
    expect(shown(d)).toEqual(['player_id', 'target_result', 'flag_puller_id', 'failed_puller_ids']);
    expect(required(d)).toEqual(['player_id', 'target_result']);
    expect(resultOptions(d)).toBeNull();
  });

  it('target catch allowed', () => {
    const d = defense({ target_result: 'catch_allowed' });
    expect(shown(d)).toEqual(['player_id', 'target_result', 'flag_puller_id', 'failed_puller_ids', 'result']);
    expect(resultOptions(d)).toEqual(['td', 'first_down', 'tod']);
  });

  it('target incomplete hides pullers and clears them', () => {
    const d = defense({ target_result: 'catch_allowed', flag_puller_id: 'p2', failed_puller_ids: ['p3'] });
    expect(d.flag_puller_id).toBe('p2');
    const inc = applyChange(d, { target_result: 'incomplete' }, ctx);
    expect(shown(inc)).toEqual(['player_id', 'target_result', 'incomplete_reason', 'result']);
    expect(inc.flag_puller_id).toBeUndefined();
    expect(inc.failed_puller_ids).toBeUndefined();
    expect(required(inc)).toEqual(['player_id', 'target_result', 'incomplete_reason']);
    expect(resultOptions(inc)).toEqual(['tod']);
  });

  it('target interception', () => {
    const d = defense({ target_result: 'interception' });
    expect(shown(d)).toEqual(['player_id', 'target_result', 'result']);
    expect(resultOptions(d)).toEqual(['pick_6']);
  });

  it('run', () => {
    const d = defense({ type: 'run' });
    expect(shown(d)).toEqual(['flag_puller_id', 'failed_puller_ids', 'result']);
    expect(required(d)).toEqual([]);
    expect(resultOptions(d)).toEqual(['td', 'first_down', 'tod']);
  });

  it('sack and throwaway have optional player', () => {
    const s = defense({ type: 'sack' });
    expect(shown(s)).toEqual(['player_id', 'result']);
    expect(required(s)).toEqual([]);
    expect(resultOptions(s)).toEqual(['tod', 'safety']);
    const t = defense({ type: 'throwaway' });
    expect(shown(t)).toEqual(['player_id', 'result']);
    expect(resultOptions(t)).toEqual(['tod']);
  });

  it('dead snap', () => {
    const d = defense({ type: 'dead_snap' });
    expect(shown(d)).toEqual(['result']);
    expect(resultOptions(d)).toEqual(['tod']);
  });

  it('foul committed has no result, foul drawn has tod', () => {
    const c = defense({ type: 'foul_committed' });
    expect(shown(c)).toEqual(['player_id', 'foul']);
    expect(options(c, 'foul')).toEqual(['illegal_contact', 'screening_bb', 'illegal_blitz', 'unsporting', 'other']);
    expect(options(c, 'foul')).not.toContain('false_start');
    const d = defense({ type: 'foul_drawn' });
    expect(shown(d)).toEqual(['player_id', 'foul', 'result']);
    expect(options(d, 'foul')).toEqual(['illegal_contact', 'screening_bb', 'flag_guarding', 'unsporting', 'other']);
    expect(resultOptions(d)).toEqual(['tod']);
  });
});

describe('extra point phase', () => {
  it.each([
    ['offense', 'pass', { pass_result: 'catch', air_yards: 5 }],
    ['offense', 'run', {}],
    ['offense', 'sack', { yards_lost: 0 }],
    ['offense', 'throwaway', {}],
    ['offense', 'foul_drawn', { foul: 'false_start' }],
    ['defense', 'target', { target_result: 'catch_allowed' }],
    ['defense', 'run', {}],
    ['defense', 'dead_snap', {}],
    ['defense', 'foul_committed', { foul: 'unsporting' }]
  ] as [Unit, string, Partial<Draft>][])('%s %s: xp_result replaces result and is mandatory', (unit, type, extra) => {
    const base = unit === 'offense' ? offense({ type: type as never, ...extra }, xpCtx) : defense({ type: type as never, ...extra }, xpCtx);
    const f = shown(base, xpCtx);
    expect(f).toContain('xp_result');
    expect(f).not.toContain('result');
    expect(required(base, xpCtx)).toContain('xp_result');
    expect(options(base, 'xp_result', xpCtx)).toEqual(
      unit === 'offense'
        ? ['1xp_made', '1xp_missed', '2xp_made', '2xp_missed', 'xp_retry']
        : ['1xp_allowed', '1xp_prevented', '2xp_allowed', '2xp_prevented', 'xp_retry']
    );
  });

  it('other rules stay unchanged in the phase', () => {
    const d = offense({}, xpCtx);
    expect(required(d, xpCtx)).toEqual(['player_id', 'pass_result', 'xp_result']);
  });

  it('warns about unit mismatch but does not block', () => {
    const c: RuleContext = { xp: true, xpExpectedUnit: 'defense' };
    const d = offense({ type: 'run', player_id: 'p2', xp_result: '1xp_made' }, c);
    const e = evaluateDraft(d, c);
    expect(e.valid).toBe(true);
    expect(e.warnings.map((w) => w.code)).toContain('xp_unit_mismatch');
  });

  it('changing result to td in normal mode is dropped when xp starts', () => {
    const d = offense({ type: 'run', result: 'td' }, ctx);
    const inXp = normalizeDraft(d, xpCtx);
    expect(inXp.result).toBeUndefined();
  });
});

describe('validation', () => {
  it('rejects an empty lineup', () => {
    const d = normalizeDraft({ ...emptyDraft('offense'), type: 'sack' }, ctx);
    const e = evaluateDraft(d, ctx);
    expect(e.valid).toBe(false);
    expect(e.errors.lineup).toBeTruthy();
  });

  it('asks for confirmation when the lineup does not have 5 players, accepts 1..9', () => {
    for (const n of [1, 4, 6, 9]) {
      const lineup = Array.from({ length: n }, (_, i) => `x${i}`);
      const d = normalizeDraft({ ...emptyDraft('offense', { lineup }), qb_id: 'x0', type: 'throwaway' }, ctx);
      const e = evaluateDraft(d, ctx);
      expect(e.valid).toBe(true);
      expect(e.warnings.map((w) => w.code)).toContain('lineup_size');
    }
    const ten = Array.from({ length: 10 }, (_, i) => `x${i}`);
    expect(evaluateDraft(normalizeDraft({ ...emptyDraft('offense', { lineup: ten }), qb_id: 'x0' }, ctx), ctx).errors.lineup).toBeTruthy();
    const five = evaluateDraft(offense({ type: 'throwaway' }), ctx);
    expect(five.warnings.map((w) => w.code)).not.toContain('lineup_size');
  });

  it('requires a quarterback from the lineup on offense', () => {
    const noQb = normalizeDraft({ ...emptyDraft('offense', { lineup: L5 }), type: 'throwaway' }, ctx);
    expect(evaluateDraft(noQb, ctx).errors.qb_id).toBeTruthy();
    const outside = evaluateDraft({ ...noQb, qb_id: 'zz' }, ctx);
    expect(outside.draft.qb_id).toBeUndefined();
    expect(outside.errors.qb_id).toBeTruthy();
  });

  it('blitzers are optional and must come from the lineup', () => {
    const d = defense({ type: 'dead_snap', blitzer_ids: ['p1', 'zz'] });
    expect(d.blitzer_ids).toEqual(['p1']);
    expect(evaluateDraft(defense({ type: 'dead_snap' }), ctx).valid).toBe(true);
  });

  it('rejects lineup members that are not on the roster', () => {
    const c: RuleContext = { xp: false, roster: ['p1', 'p2', 'p3', 'p4'] };
    const e = evaluateDraft(offense({ type: 'throwaway' }), c);
    expect(e.errors.lineup).toBeTruthy();
  });

  it('pruneLineup removes stale members', () => {
    expect(pruneLineup(['a', 'b', 'c'], ['a', 'c'])).toEqual({ lineup: ['a', 'c'], removed: ['b'] });
  });

  it('missing result is a warning, not an error, and not in the xp phase', () => {
    const d = offense({ pass_result: 'catch', player_id: 'p2', air_yards: 5 });
    const e = evaluateDraft(d, ctx);
    expect(e.valid).toBe(true);
    expect(e.warnings.map((w) => w.code)).toContain('no_result');
    const sack = evaluateDraft(offense({ type: 'foul_drawn', foul: 'false_start' }), ctx);
    expect(sack.warnings.map((w) => w.code)).not.toContain('no_result');
  });

  it('allows saves that are complete per path (spec examples)', () => {
    expect(evaluateDraft(offense({ type: 'sack', yards_lost: -5 }), ctx).valid).toBe(true);
    expect(evaluateDraft(offense({ type: 'throwaway' }), ctx).valid).toBe(true);
    expect(evaluateDraft(offense({ type: 'foul_committed', foul: 'illegal_contact' }), ctx).valid).toBe(true);
    expect(evaluateDraft(offense({ type: 'foul_committed', foul: 'other' }), ctx).valid).toBe(false);
  });
});

describe('no hidden values', () => {
  it('switching type clears invisible fields', () => {
    let d = offense({ pass_result: 'catch', player_id: 'p2', air_yards: 10, result: 'first_down' });
    d = applyChange(d, { type: 'run' }, ctx);
    const play = toPlayData(d, ctx);
    expect(play.pass_result).toBeUndefined();
    expect(play.air_yards).toBeUndefined();
    expect(play.result).toBe('first_down');
    expect(play.player_id).toBe('p2');
    d = applyChange(d, { type: 'sack' }, ctx);
    expect(d.player_id).toBeUndefined();
    expect(d.yards_run).toBeUndefined();
  });

  it('result is cleared when it is no longer an option', () => {
    let d = offense({ type: 'run', result: 'td' });
    d = applyChange(d, { type: 'foul_drawn' }, ctx);
    expect(d.result).toBeUndefined();
  });

  it('clearing resets foul and keeps lineup/qb', () => {
    const d = offense({ type: 'foul_drawn', foul: 'other', foul_yards: -5, player_id: 'p3' });
    const c = clearedDraft(d, ctx);
    expect(c.type).toBe('pass');
    expect(c.foul).toBeUndefined();
    expect(c.foul_yards).toBeUndefined();
    expect(c.lineup).toEqual(L5);
    expect(c.qb_id).toBe('p1');
  });

  it('offense and defense drafts are independent', () => {
    const o = offense({ type: 'foul_drawn', foul: 'other' });
    const d = defense();
    expect(d.foul).toBeUndefined();
    expect(o.foul).toBe('other');
  });

  it('removing a player from the lineup clears references to that player', () => {
    const d = defense({ target_result: 'catch_allowed', player_id: 'p2', flag_puller_id: 'p3', failed_puller_ids: ['p3', 'p4'] });
    const next = applyChange(d, { lineup: ['p1', 'p2', 'p4', 'p5'] }, ctx);
    expect(next.flag_puller_id).toBeUndefined();
    expect(next.failed_puller_ids).toEqual(['p4']);
  });

  it('normalize is idempotent', () => {
    const d = offense({ pass_result: 'catch', air_yards: 5, yards_after_catch: 5 });
    expect(normalizeDraft(d, ctx)).toEqual(d);
  });
});
