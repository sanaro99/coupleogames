import { test, expect } from '@playwright/test';

test('visitors create their own room, keep their invitations and join as separate partners', async ({ browser }) => {
  const creator = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const partner = await browser.newContext();
  const page = await creator.newPage();
  const other = await partner.newPage();
  try {
    await creator.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start a game', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/self-service-entry.png', fullPage: true });
    await page.getByRole('button', { name: 'Start a game', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your names' })).toBeVisible();
    const partnerLink = await page.getByLabel('Partner invitation link').inputValue();
    const ownLink = await page.getByLabel('Your return link').inputValue();
    expect(partnerLink).not.toBe(ownLink);
    await page.getByRole('button', {name:'Copy partner link',exact:true}).click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(partnerLink);
    await page.reload();
    await expect(page.getByLabel('Partner invitation link')).toHaveValue(partnerLink);
    const returning=await creator.newPage();
    await returning.goto('/');
    await expect(returning.getByLabel('Partner invitation link')).toHaveValue(partnerLink);
    await returning.close();
    await page.getByLabel('First partner’s name').fill('Ada');
    await page.getByLabel('Second partner’s name').fill('Bea');
    await page.getByRole('button', { name: 'Start playing', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ada & Bea' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(page.getByLabel('Partner invitation link')).toHaveValue(partnerLink);
    await other.goto('/');
    await other.getByLabel('Invitation code').fill(partnerLink);
    await other.getByRole('button', { name: 'Join a game', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Ada & Bea' })).toBeVisible();
    const [a, b] = await Promise.all([page.request.get('/api/session'), other.request.get('/api/session')]);
    expect((await a.json()).seat).toBe(0);
    expect((await b.json()).seat).toBe(1);
    expect((await a.json()).roomId).toBe((await b.json()).roomId);
    await other.goto('about:blank');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.goto(ownLink);
    await expect(page.getByRole('heading', { name: 'Ada & Bea' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(page.getByLabel('Partner invitation link')).toHaveValue(partnerLink);
  } finally { await Promise.allSettled([creator.close(), partner.close()]); }
});
