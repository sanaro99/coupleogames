import { test, expect, type Page } from '@playwright/test';
const keys = ['e2e-first-private-key-123456789', 'e2e-second-private-key-123456789'];
const waitForCat = (page: Page) => expect(page.locator('.cat-companion')).toHaveAttribute('data-moving', 'false', { timeout: 20000 });
test('cat stands up before moving to another card', async ({ page }) => {
  await enter(page, 0);
  const cat = page.locator('.cat-companion');
  await expect(page.locator('.cat-world canvas')).toBeVisible();
  await expect(cat).toHaveAttribute('data-current-depth', /^-?\d+$/);
  await waitForCat(page);
  const before = await cat.boundingBox();
  await page.getByRole('button', { name: 'How to play Clue Quest' }).focus();
  await expect(cat).toHaveAttribute('data-anchor', 'clue');
  await page.waitForTimeout(400);
  const rising = await cat.boundingBox();
  expect(Math.hypot(rising!.x - before!.x, rising!.y - before!.y)).toBeLessThan(1);
  await waitForCat(page);
  const arrived = await cat.boundingBox();
  expect(Math.hypot(arrived!.x - before!.x, arrived!.y - before!.y)).toBeGreaterThan(10);
});
test('cat moves between interface elements without blocking controls', async ({ page }) => {
  await enter(page, 0);
  await expect(page.locator('.cat-world')).toBeVisible();
  expect(await page.locator('.cat-overlay').evaluate(el => getComputedStyle(el).position)).toBe('fixed');
  await page.getByRole('button', { name: 'How to play Doodle Duo' }).focus();
  await expect(page.locator('.cat-companion')).toHaveAttribute('data-anchor', 'doodle');
  await expect(page.locator('.game-card.peach')).toHaveAttribute('data-cat-visited', 'true');
  await page.getByRole('button', { name: 'How to play Clue Quest' }).focus();
  await expect(page.locator('.cat-companion')).toHaveAttribute('data-anchor', 'clue');
  await expect(page.locator('.cat-companion')).toHaveAttribute('data-depth', 'front');
  await expect.poll(async () => Number(await page.locator('.cat-companion').getAttribute('data-current-depth'))).toBeGreaterThan(80);
  await expect(page.locator('.game-card.peach')).not.toHaveAttribute('data-cat-visited', 'true');
  await page.getByRole('button', { name: 'Ask the cat for help' }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Play Clue Quest', exact: true }).click();
  await expect(page.getByRole('button', { name: 'I’m ready' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('a lost WebGL context restores a visible cat help control', async ({ page }) => {
  await enter(page, 0); await expect(page.locator('.cat-world canvas')).toBeVisible();
  await expect(page.locator('.cat-companion')).toHaveAttribute('data-current-depth', /^-?\d+$/);
  await waitForCat(page);
  const lost = await page.locator('.cat-world canvas').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2'); const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false; extension.loseContext(); return true;
  });
  expect(lost).toBe(true); await expect(page.locator('.cat-static')).toBeVisible();
  await page.getByRole('button', { name: 'Ask the cat for help' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
async function enter(page: Page, seat: number) {
  await page.goto(`/#invite=${keys[seat]}`);
  await expect(page.getByRole('button', { name: 'Start playing' }).or(page.getByTestId('game-menu'))).toBeVisible();
  if (await page.getByRole('button', { name: 'Start playing' }).isVisible()) {
    await page.getByLabel('First partner’s name').fill('Ada'); await page.getByLabel('Second partner’s name').fill('Bea');
    await page.getByRole('button', { name: 'Start playing' }).click();
  }
  await expect(page.getByTestId('game-menu')).toBeVisible();
}
async function start(a: Page, b: Page, name: string) {
  await a.getByRole('button', { name: `Play ${name}`, exact: true }).click();
  await a.getByRole('button', { name: 'I’m ready' }).click(); await b.getByRole('button', { name: 'I’m ready' }).click();
  await expect(a.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
}
test('a private two-phone table completes all four games and keeps the scorecard', async ({ browser }) => {
  test.setTimeout(150000);
  const ca = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const cb = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const a = await ca.newPage(); let b = await cb.newPage(); await enter(a, 0); await enter(b, 1);
  await start(a, b, 'In Sync');
  await waitForCat(a);
  await a.getByRole('button', { name: 'Ask the cat for help' }).click();
  await expect(a.getByRole('dialog').getByRole('heading', { name: 'In Sync', exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Close dialog' }).click();
  await expect(a.locator('.cat-world canvas')).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await a.getByLabel('Your answer').fill('moon'); await a.getByRole('button', { name: 'Submit answer' }).click();
    await expect(b.getByText('moon', { exact: true })).toHaveCount(0);
    await b.getByLabel('Your answer').fill('MOON'); await b.getByRole('button', { name: 'Submit answer' }).click();
    await expect(a.getByText('Same answer')).toBeVisible();
    if (i === 0) {
      await waitForCat(a);
      await a.screenshot({ path: 'test-results/answer.png', fullPage: true });
    }
    await a.getByRole('button', { name: i === 5 ? 'See result' : 'Next round' }).click();
    await b.getByRole('button', { name: i === 5 ? 'See result' : 'Next round' }).click();
  }
  await expect(a.getByRole('heading', { name: 'You won' })).toBeVisible();
  await a.getByRole('button', { name: 'Games' }).click();
  await start(a, b, 'Know Me Better');
  for (let i = 0; i < 6; i++) {
    const subject = i % 2 === 0 ? a : b; const guesser = i % 2 === 0 ? b : a;
    await subject.locator('.answer-option').first().click(); await guesser.locator('.answer-option').first().click();
    await expect(a.locator('.reveal-card')).toBeVisible();
    await a.getByRole('button', { name: i === 5 ? 'See result' : 'Next round' }).click();
    await b.getByRole('button', { name: i === 5 ? 'See result' : 'Next round' }).click();
  }
  await expect(a.getByRole('heading', { name: 'Draw' })).toBeVisible();
  await a.getByRole('button', { name: 'Games' }).click();
  await start(a, b, 'Doodle Duo');
  for (let i = 0; i < 6; i++) {
    const drawer = i % 2 === 0 ? a : b;
    const word = await drawer.getByTestId('drawing-word').innerText();
    const canvas = drawer.getByLabel('Drawing canvas'); const box = (await canvas.boundingBox())!;
    await drawer.mouse.move(box.x + 20, box.y + 20); await drawer.mouse.down(); await drawer.mouse.move(box.x + 90, box.y + 90, { steps: 5 }); await drawer.mouse.up();
    if (i === 0) {
      await expect.poll(async () => (await (await b.request.get('/api/session')).json()).match.strokes.length).toBeGreaterThan(0);
      await b.close(); await expect(a.getByText(/^Paused\./)).toBeVisible();
      b = await cb.newPage(); await b.goto('/');
      await expect(a.getByText(/^Paused\./)).toHaveCount(0);
      await expect(b.getByLabel('Drawing canvas')).toBeVisible();
      expect(await b.getByLabel('Drawing canvas').evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
    }
    const guesser = i % 2 === 0 ? b : a;
    await guesser.getByLabel('Your guess').fill(word); await guesser.getByRole('button', { name: 'Guess', exact: true }).click();
    await expect(a.locator('.reveal-card')).toBeVisible();
    await a.getByRole('button', { name: i === 5 ? 'See result' : 'Next round' }).click();
    await b.getByRole('button', { name: i === 5 ? 'See result' : 'Next round' }).click();
  }
  await a.getByRole('button', { name: 'Games' }).click(); await start(a, b, 'Clue Quest');
  for (let i = 0; i < 2; i++) {
    const giver = i === 0 ? a : b; const guesser = i === 0 ? b : a;
    const words = await giver.locator('.word-tile.your-target').evaluateAll(tiles => tiles.map(tile => tile.getAttribute('aria-label')!));
    await giver.getByLabel('Your one-word clue').fill('cozy'); await giver.getByLabel('Number of tiles').selectOption('3');
    await giver.getByRole('button', { name: 'Send clue' }).click();
    for (const word of words) await guesser.getByRole('button', { name: word.trim(), exact: true }).click();
  }
  await expect(a.getByRole('heading', { name: 'You won' })).toBeVisible();
  await a.getByRole('button', { name: 'Games' }).click();
  await a.getByRole('button', { name: 'Scorecard' }).click();
  await expect(a.getByText('3', { exact: true }).first()).toBeVisible();
  await expect(a.locator('.history-row')).toHaveCount(4);
  await a.reload(); await expect(a.getByTestId('game-menu')).toBeVisible();
  await a.getByRole('button', { name: 'Scorecard' }).click(); await expect(a.locator('.history-row')).toHaveCount(4);
  await a.getByRole('button', { name: 'Close dialog' }).click();
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await waitForCat(a);
  await a.setViewportSize({ width: 1440, height: 900 });
  await expect(a.locator('.cat-overlay')).toHaveCSS('width', '1440px');
  await waitForCat(a);
  await a.screenshot({ path: 'test-results/laptop.png', fullPage: true });
  await a.setViewportSize({ width: 390, height: 844 });
  await expect(a.locator('.cat-overlay')).toHaveCSS('width', '390px');
  await waitForCat(a);
  await expect(a.locator('.cat-companion')).toBeVisible();
  await a.screenshot({ path: 'test-results/phone-viewport.png' });
  await a.screenshot({ path: 'test-results/phone.png', fullPage: true });
  await ca.close(); await cb.close();
});
test('the entry is private and reduced effects preserve the experience', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Join your partner' })).toBeVisible();
  await enter(page, 0); await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Animate the cat').uncheck(); await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.cat-static')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click(); await page.getByLabel('Animate the cat').check();
  await page.getByLabel('3D tiles').uncheck();
  await page.getByLabel('Reduce effects').check(); await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('button', { name: 'Ask the cat for help' })).toBeVisible();
  await expect(page.locator('.cat-static')).toBeVisible();
});
test('unavailable WebGL falls back while a two-phone game still works', async ({ page, browser }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    (window as unknown as { webglAttempts: number }).webglAttempts = 0;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') { (window as unknown as { webglAttempts: number }).webglAttempts++; return null; }
      return getContext.call(this, kind as '2d', ...args as [CanvasRenderingContext2DSettings]);
    } as typeof getContext;
  });
  await enter(page, 0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { webglAttempts: number }).webglAttempts)).toBeGreaterThan(0);
  await expect(page.locator('.cat-static')).toBeVisible();
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } }); const partner = await other.newPage(); await enter(partner, 1);
  await start(page, partner, 'In Sync'); await page.getByLabel('Your answer').fill('tea'); await page.getByRole('button', { name: 'Submit answer' }).click();
  await partner.getByLabel('Your answer').fill('TEA'); await partner.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Same answer')).toBeVisible();
  await page.getByRole('button', { name: 'Leave match' }).click(); await partner.getByRole('button', { name: 'Leave together' }).click();
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await start(page, partner, 'Clue Quest');
  const target = await page.locator('.word-tile.your-target').first().getAttribute('aria-label');
  await page.getByLabel('Your one-word clue').fill('cozy'); await page.getByRole('button', { name: 'Send clue' }).click();
  await partner.getByRole('button', { name: target!, exact: true }).click();
  await expect(page.getByText('Turn 2/8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave match' }).click(); await partner.getByRole('button', { name: 'Leave together' }).click();
  await expect(page.getByTestId('game-menu')).toBeVisible(); await other.close();
});
