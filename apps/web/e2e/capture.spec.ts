import { expect, test, type Page } from '@playwright/test';

const CSV = [
  'number,name,offense_order,defense_order,qb_order,blitz_order',
  '54,Oskar Küsgen,1,9,1,9', '93,Bryan Wiegand,1,9,9,9', '96,Daniel Binder,1,9,9,9', '37,Robin Konrad,1,9,9,9', '14,Henrik Jansen,2,4,9,3',
  '23,Thorsten Lenz,2,1,9,9', '92,Eric Benschneider,9,1,9,9', '91,Max,9,1,9,1', '95,Lorenz Hornung,9,1,9,3', '98,Sebastian Reuter,9,1,9,9'
].join('\n');

async function setup(page: Page) {
  await page.goto('/#/players');
  await page.getByTestId('csv-input').setInputFiles({ name: 'spieler.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page.getByText('10 Zeilen können importiert werden')).toBeVisible();
  await page.getByTestId('csv-confirm').click();
  await expect(page.getByTestId('player-row')).toHaveCount(10);

  await page.goto('/#/');
  await page.getByTestId('g-opponent').fill('Sassenberg Knights');
  await page.getByTestId('g-create').click();
  await expect(page.getByTestId('game-status')).toHaveText('Geplant');
  await page.getByRole('button', { name: 'Alle aktiven' }).click();
  await expect(page.getByRole('heading', { name: 'Spieltagskader (10)' })).toBeVisible();
  await page.getByRole('link', { name: 'Zur Erfassung' }).click();
}

async function lineup(page: Page, numbers: string[]) {
  await page.getByTestId('lineup-edit').click();
  for (const n of numbers) await page.getByTestId(`lineup-${n}`).click();
  await page.getByTestId('lineup-ok').click();
}

test('players, game, capture flow with rules, extra point, undo, ticker preview, reload', async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'local_only');

  // lineup + qb
  await lineup(page, ['54', '93', '96', '37', '14']);
  await page.getByTestId('qb').selectOption({ label: '#54 Oskar Küsgen' });

  // required fields block saving, defaults are visible
  await page.getByTestId('save').click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByTestId('play-row')).toHaveCount(0);

  // pass, catch, air yards required; saving without a result is allowed
  await page.getByTestId('pick-player_id').selectOption({ label: '#96 Daniel Binder' });
  await page.getByTestId('opt-pass_result-catch').click();
  await expect(page.getByTestId('opt-yards_after_catch-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-field="flag_pulls_missed"]')).toHaveCount(0);
  await page.getByTestId('opt-yards_after_catch-5').click();
  await expect(page.locator('[data-field="flag_pulls_missed"]')).toHaveCount(1);
  await expect(page.getByTestId('opt-flag_pulls_missed-8')).toBeVisible();
  await page.getByTestId('save').click(); // air yards missing
  await expect(page.locator('[data-field="air_yards"].invalid')).toHaveCount(1);
  await expect(page.locator('[data-field="air_yards"] .err')).  toHaveText('Required');
    await expect(page.locator('.toast')).toContainText('Air yards');
  await page.getByTestId('opt-air_yards-10').click();
  await page.getByTestId('opt-result-td').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('play-row').first()).toContainText('Daniel Binder');
  await expect(page.getByTestId('play-row').first()).toContainText('Touchdown');
  await expect(page.getByTestId('score')).toContainText('6 : 0');

  // extra point phase: result replaced by xp result on every type
  await expect(page.getByTestId('xp-heading')).toBeVisible();
  await page.getByTestId('type-run').click();
  await expect(page.locator('[data-field="xp_result"]')).toHaveCount(1);
  await expect(page.locator('[data-field="result"]')).toHaveCount(0);
  await page.getByTestId('pick-player_id').selectOption({ label: '#37 Robin Konrad' });
  await page.getByTestId('opt-yards_run-5').click();
  await page.getByTestId('save').click();
  await expect(page.locator('[data-field="xp_result"] .err')).toBeVisible();
  await page.getByTestId('sel-xp_result').selectOption('1xp_made');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('score')).toContainText('7 : 0');
  await expect(page.getByTestId('xp-heading')).toHaveCount(0);

  // undo removes the extra point and re-enters the extra point phase
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('score')).toContainText('6 : 0');
  await expect(page.getByTestId('xp-heading')).toBeVisible();

  // switching the type clears hidden values; foul list differs per unit
  await page.getByTestId('type-foul_drawn').click();
  await expect(page.getByTestId('sel-foul').locator('option[value="false_start"]')).toHaveCount(1);
  await page.getByTestId('unit-defense').click();
  await expect(page.getByTestId('type-target')).toBeVisible();
  await page.getByTestId('type-foul_committed').click();
  await expect(page.getByTestId('sel-foul').locator('option[value="illegal_blitz"]')).toHaveCount(1);
  await expect(page.getByTestId('sel-foul').locator('option[value="false_start"]')).toHaveCount(0);

  // ticker preview shows readable sentences
  await page.goto(page.url().replace('capture', 'preview'));
  await expect(page.getByTestId('ticker-score')).toHaveText('6 : 0');
  await expect(page.getByTestId('feed')).toContainText('Pass from QB #54 Oskar Küsgen to #96 Daniel Binder caught: 10 air yards + 5 yards after the catch');
  await expect(page.getByTestId('feed')).toContainText('Touchdown');

  // everything survives a reload (stored on the device)
  await page.reload();
  await expect(page.getByTestId('ticker-score')).toHaveText('6 : 0');
});

for (const scheme of ['light', 'dark'] as const)
for (const vp of [{ name: 'iPhone 15', width: 393, height: 659 }, { name: 'small phone', width: 360, height: 640 }]) {
  test(`capture form fits without scrolling on ${vp.name} (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await setup(page);
    await lineup(page, ['54', '93', '96', '37', '14']);
    await page.getByTestId('qb').selectOption({ label: '#54 Oskar Küsgen' });

    const fits = async (label: string) => {
      const card = await page.locator('.capture-form').boundingBox();
      expect(card!.y + card!.height, `${label}: whole form inside viewport`).toBeLessThanOrEqual(vp.height);
      const save = await page.getByTestId('save').boundingBox();
      expect(save, label).not.toBeNull();
      expect(save!.y + save!.height, `${label}: save bar inside viewport`).toBeLessThanOrEqual(vp.height);
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflowX, `${label}: no horizontal overflow`).toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => window.scrollY), `${label}: not scrolled`).toBe(0);
      await page.screenshot({ path: `test-results/shots/${scheme}-${vp.width}-${label}.png` });
    };

    await fits('start');
    await page.getByTestId('type-pass').click();
    await page.getByTestId('opt-pass_result-catch').click();
    await page.getByTestId('opt-yards_after_catch-5').click();
    await fits('pass-catch');

    await page.getByTestId('save').click();
    await fits('pass-errors');

    await page.getByTestId('type-run').click();
    await page.getByTestId('pick-player_id').selectOption({ label: '#37 Robin Konrad' });
    await page.getByTestId('opt-yards_run-5').click();
    await fits('run');

    await page.getByTestId('unit-defense').click();
    await lineup(page, ['92', '91', '95', '98', '23']);
    await page.getByTestId('type-target').click();
    await page.getByTestId('opt-target_result-catch_allowed').click();
    await page.getByTestId('pick-flag_puller_id').selectOption({ label: '#92 Eric Benschneider' });
    await page.getByTestId('multi-failed_puller_ids').click();
    await page.getByTestId('multi-failed_puller_ids-91').check();
    await page.getByTestId('multi-failed_puller_ids-95').check();
    await page.getByTestId('multi-failed_puller_ids-ok').click();
    await expect(page.getByTestId('multi-failed_puller_ids')).toHaveText(/#91 #95/);
    await fits('defense-target');

    await page.getByTestId('type-foul_committed').click();
    await page.getByTestId('sel-foul').selectOption('other');
    await fits('defense-foul-other');
  });
}

test('a play without a result saves directly', async ({ page }) => {
  await setup(page);
  await lineup(page, ['54', '93', '96', '37', '14']);
  await page.getByTestId('qb').selectOption({ label: '#54 Oskar Küsgen' });
  await page.getByTestId('type-throwaway').click();
  await page.getByTestId('opt-result-tod').click();
  await expect(page.getByTestId('opt-result-tod')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('clear-result').click(); // referee changed their mind: reset only the result
  await expect(page.getByTestId('opt-result-tod')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('clear-result')).toBeDisabled();
  await expect(page.getByTestId('qb')).not.toHaveValue('');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('warnings')).toHaveCount(0);
  await expect(page.getByTestId('play-row')).toHaveCount(1);
});

test('lineup dialog keeps its confirm button reachable on a short screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await setup(page);
  await page.getByTestId('lineup-edit').click();
  const ok = await page.getByTestId('lineup-ok').boundingBox();
  expect(ok!.y + ok!.height).toBeLessThanOrEqual(420);
  await page.screenshot({ path: 'test-results/shots/lineup-dialog.png' });
  await page.getByTestId('lineup-54').click();
  await page.getByTestId('lineup-ok').click();
  await expect(page.getByTestId('lineup-edit')).toContainText('#54');
});

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Spiele' })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await context.setOffline(true);
  await page.goto('/#/players');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Spieler' })).toBeVisible();
});

test('public ticker route does not expose the app', async ({ page }) => {
  await page.goto('/#/t/unknown-token');
  await expect(page.getByText('braucht eine Server-Verbindung')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Spieler' })).toHaveCount(0);
});
