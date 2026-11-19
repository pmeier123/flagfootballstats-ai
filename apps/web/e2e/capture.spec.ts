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
  await page.getByTestId('qb-54').click();

  // required fields block saving, defaults are visible
  await page.getByTestId('save').click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByTestId('last-event')).toHaveText('–');

  // pass, catch, air yards -> save with result missing asks for confirmation
  await page.getByTestId('pick-player_id-96').click();
  await page.getByTestId('opt-pass_result-catch').click();
  await expect(page.getByTestId('opt-yards_after_catch-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-field="flag_pulls_missed"]')).toHaveCount(0);
  await page.getByTestId('opt-yards_after_catch-5').click();
  await expect(page.locator('[data-field="flag_pulls_missed"]')).toHaveCount(1);
  await page.getByTestId('save').click(); // air yards missing
  await expect(page.locator('[data-field="air_yards"] .err')).toBeVisible();
  await page.getByTestId('opt-air_yards-10').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('warnings')).toContainText('Kein Ergebnis');
  await page.getByRole('button', { name: 'Zurück' }).click();
  await page.getByTestId('opt-result-td').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('last-event')).toHaveText('Pass, #96 Daniel Binder, Touchdown');
  await expect(page.getByTestId('score')).toContainText('6 : 0');

  // extra point phase: result replaced by xp result on every type
  await expect(page.getByTestId('xp-heading')).toBeVisible();
  await page.getByTestId('type-run').click();
  await expect(page.locator('[data-field="xp_result"]')).toHaveCount(1);
  await expect(page.locator('[data-field="result"]')).toHaveCount(0);
  await page.getByTestId('pick-player_id-37').click();
  await page.getByTestId('opt-yards_run-5').click();
  await page.getByTestId('save').click();
  await expect(page.locator('[data-field="xp_result"] .err')).toBeVisible();
  await page.getByTestId('opt-xp_result-1xp_made').click();
  await page.getByTestId('save').click();
  await expect(page.getByTestId('score')).toContainText('7 : 0');
  await expect(page.getByTestId('xp-heading')).toHaveCount(0);

  // undo removes the extra point and re-enters the extra point phase
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('score')).toContainText('6 : 0');
  await expect(page.getByTestId('xp-heading')).toBeVisible();

  // switching the type clears hidden values; foul list differs per unit
  await page.getByTestId('type-foul_drawn').click();
  await expect(page.getByTestId('opt-foul-false_start')).toBeVisible();
  await page.getByTestId('unit-defense').click();
  await expect(page.getByTestId('type-target')).toBeVisible();
  await page.getByTestId('type-foul_committed').click();
  await expect(page.getByTestId('opt-foul-illegal_blitz')).toBeVisible();
  await expect(page.getByTestId('opt-foul-false_start')).toHaveCount(0);

  // ticker preview shows readable sentences
  await page.goto(page.url().replace('capture', 'preview'));
  await expect(page.getByTestId('ticker-score')).toHaveText('6 : 0');
  await expect(page.getByTestId('feed')).toContainText('Pass von QB #54 Oskar Küsgen auf #96 Daniel Binder gefangen: 10 Air Yards + 5 Yards nach dem Catch');
  await expect(page.getByTestId('feed')).toContainText('Touchdown');

  // everything survives a reload (stored on the device)
  await page.reload();
  await expect(page.getByTestId('ticker-score')).toHaveText('6 : 0');
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
