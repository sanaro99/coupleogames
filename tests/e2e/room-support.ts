import { expect, type Browser, type Page } from '@playwright/test';
export const testKey=(room:number,seat:number)=>`e2e-room-${room}-seat-${seat}-private-key-123456789`;
export async function phone(browser:Browser,room:number,seat:number) {
  const context=await browser.newContext({baseURL:'http://localhost:3101',viewport:{width:390,height:844},extraHTTPHeaders:{'X-Forwarded-For':`192.0.2.${room*10+seat+1}`},reducedMotion:'reduce'});
  const page=await context.newPage(); await page.goto(`/#invite=${testKey(room,seat)}`); return {context,page};
}
export async function nameRoom(a:Page,b:Page,names:[string,string]) {
  await a.getByLabel('First partner’s name').fill(names[0]);await a.getByLabel('Second partner’s name').fill(names[1]);await a.getByRole('button',{name:'Start playing'}).click();await expect(a.getByTestId('game-menu')).toBeVisible();await expect(b.getByTestId('game-menu')).toBeVisible();
}
export async function start(a:Page,b:Page,game:string) {await a.getByRole('button',{name:`Play ${game}`,exact:true}).click();await a.getByRole('button',{name:'I’m ready'}).click();await b.getByRole('button',{name:'I’m ready'}).click();}
export async function leave(a:Page,b:Page) {await a.getByRole('button',{name:'Leave match',exact:true}).click();await b.getByRole('button',{name:'Leave together',exact:true}).click();await expect(a.getByTestId('game-menu')).toBeVisible();}
