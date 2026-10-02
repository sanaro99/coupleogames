import { test, expect } from '@playwright/test';
import { phone,nameRoom,testKey } from './room-support';

test('same_seat_cross_room_switch_ignores_old_events',async({browser})=>{
  const a=await phone(browser,3,0);const ap=await phone(browser,3,1);const b=await phone(browser,4,0);const bp=await phone(browser,4,1);
  await nameRoom(a.page,ap.page,['Switch Ada','Switch Bea']);await nameRoom(b.page,bp.page,['Switch Cal','Switch Dee']);
  let release:()=>void=()=>{};await a.page.route('**/api/login',async route=>{await new Promise<void>(r=>{release=r;});await route.continue();});
  await a.page.evaluate(key=>{location.hash=`invite=${key}`;},testKey(4,0));await expect(a.page.getByRole('heading',{name:'Switch Ada & Switch Bea'})).toHaveCount(0,{timeout:1000});release();await expect(a.page.getByRole('heading',{name:'Switch Cal & Switch Dee'})).toBeVisible();
  await ap.page.getByRole('button',{name:'Play In Sync',exact:true}).click();await expect(ap.page.locator('.proposal').getByRole('heading',{name:'In Sync'})).toBeVisible();await expect(a.page.getByRole('button',{name:'I’m ready'})).toHaveCount(0);await expect(a.page.getByRole('heading',{name:'Switch Ada & Switch Bea'})).toHaveCount(0);
  await expect.poll(()=>a.page.evaluate(()=>location.hash)).toBe('');for(const p of [a,ap,b,bp])await p.context.close();
});
test('replacement_cookie_in_another_tab_resynchronizes',async({browser})=>{
  const a=await phone(browser,5,0);const ap=await phone(browser,5,1);const b=await phone(browser,6,0);const bp=await phone(browser,6,1);await nameRoom(a.page,ap.page,['Tab Ada','Tab Bea']);await nameRoom(b.page,bp.page,['Tab Cal','Tab Dee']);
  const tab=await a.context.newPage();await tab.goto(`/#invite=${testKey(6,0)}`);await expect(tab.getByRole('heading',{name:'Tab Cal & Tab Dee'})).toBeVisible();await expect(a.page.getByRole('heading',{name:'Tab Cal & Tab Dee'})).toBeVisible();for(const p of [a,ap,b,bp])await p.context.close();
});
test('failed_invite_recovers_previous_session',async({browser})=>{
  const a=await phone(browser,7,0);const ap=await phone(browser,7,1);await nameRoom(a.page,ap.page,['Recover Ada','Recover Bea']);await a.page.evaluate(()=>{location.hash='invite=invalid';});await expect(a.page.getByRole('alert')).toBeVisible();await expect(a.page.getByRole('heading',{name:'Recover Ada & Recover Bea'})).toBeVisible();await a.page.getByRole('button',{name:'Play In Sync',exact:true}).click();await expect(ap.page.locator('.proposal').getByRole('heading',{name:'In Sync'})).toBeVisible();await a.context.close();await ap.context.close();
});

test('invalid_invitation_on_page_load_keeps_the_previous_room', async ({ browser }) => {
  const a = await phone(browser, 7, 0);
  await expect(a.page.getByRole('button', { name: 'Start playing' }).or(a.page.getByTestId('game-menu'))).toBeVisible();
  if (await a.page.getByRole('button', { name: 'Start playing' }).isVisible()) {
    await a.page.getByLabel('First partner’s name').fill('Recover Ada');
    await a.page.getByLabel('Second partner’s name').fill('Recover Bea');
    await a.page.getByRole('button', { name: 'Start playing' }).click();
  }
  const old = await (await a.page.request.get('/api/session')).json();
  await a.page.goto('/?bad-link=1#invite=invalid');
  await expect(a.page.getByRole('heading', { name: 'Recover Ada & Recover Bea' })).toBeVisible();
  await expect(a.page.getByRole('alert')).toBeVisible();
  expect((await (await a.page.request.get('/api/session')).json()).roomId).toBe(old.roomId);
  expect(await a.page.evaluate(() => location.hash)).toBe('');
  await a.context.close();
});
