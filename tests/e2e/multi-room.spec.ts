import { test, expect } from '@playwright/test';
import { phone,nameRoom,start } from './room-support';
test('two_pairs_play_and_save_independent_results',async({browser})=>{
  const a=await phone(browser,1,0);const ap=await phone(browser,1,1);const b=await phone(browser,2,0);const bp=await phone(browser,2,1);await nameRoom(a.page,ap.page,['Room Ada','Room Bea']);await nameRoom(b.page,bp.page,['Room Cal','Room Dee']);
  await start(a.page,ap.page,'In Sync');await start(b.page,bp.page,'Know Me Better');
  for(let round=0;round<6;round++) {
    await a.page.getByLabel('Your answer').fill('tea');await a.page.getByRole('button',{name:'Submit answer'}).click();await expect(b.page.getByText('tea',{exact:true})).toHaveCount(0);
    const subject=round%2===0?b.page:bp.page;const guesser=round%2===0?bp.page:b.page;await subject.locator('.answer-option').first().click();await guesser.locator('.answer-option').first().click();
    await ap.page.getByLabel('Your answer').fill('TEA');await ap.page.getByRole('button',{name:'Submit answer'}).click();await expect(a.page.getByText('Same answer',{exact:true})).toBeVisible();
    const next=round===5?'See result':'Next round';for(const p of [a.page,ap.page,b.page,bp.page])await p.getByRole('button',{name:next,exact:true}).click();
  }
  await expect(a.page.getByRole('heading',{name:'You won'})).toBeVisible();await expect(b.page.getByRole('heading',{name:'Draw'})).toBeVisible();
  for(const p of [a.page,b.page]) {await p.getByRole('button',{name:'Games',exact:true}).click();await p.getByRole('button',{name:'Scorecard',exact:true}).click();await expect(p.locator('.history-row')).toHaveCount(1);}
  await expect(a.page.locator('.history-row')).toContainText('In Sync');await expect(b.page.locator('.history-row')).toContainText('Know Me Better');await a.page.reload();await a.page.getByRole('button',{name:'Scorecard'}).click();await expect(a.page.locator('.history-row')).toHaveCount(1);
  await a.page.getByRole('button',{name:'Close dialog'}).click();await b.page.getByRole('button',{name:'Close dialog'}).click();await start(a.page,ap.page,'Doodle Duo');await start(b.page,bp.page,'In Sync');await ap.context.close();await expect(a.page.getByText(/Paused\. Waiting for Room Bea/)).toBeVisible();await expect(b.page.getByText(/Paused\. Waiting/)).toHaveCount(0);
  for(const p of [a,b,bp])await p.context.close();
});
