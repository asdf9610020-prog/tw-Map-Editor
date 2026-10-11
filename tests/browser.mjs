import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),pkg=process.env.PLAYWRIGHT_MODULE_ROOT;
const {chromium}=pkg?createRequire(pkg+'/playwright/package.json')('playwright'):require('playwright');
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true,args:['--enable-unsafe-swiftshader']});
const url=process.env.EDITOR_URL||'http://127.0.0.1:8790/';fs.mkdirSync('test-results',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const ready=()=>page.waitForFunction(()=>window.editor?.ready,{}, {timeout:120000});
  await page.goto(url);await ready();assert.equal(await page.title(),'tw Map Editor · 地圖編輯器');
  const before=await page.evaluate(()=>structuredClone(editor.map));assert.equal(before.grid.width,512);assert.equal(before.tiles.length,4);
  await page.locator('#width').fill('1024');await page.locator('#height').fill('1024');await page.locator('#resize').click();await ready();assert.equal(await page.locator('#width').inputValue(),'1024');
  await page.locator('#undo').click();await ready();assert.equal(await page.locator('#width').inputValue(),'512');
  await page.locator('#redo').click();await ready();assert.equal(await page.locator('#width').inputValue(),'1024');
  await page.locator('#name').fill('public editor browser test');await page.locator('#name').press('Tab');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('jp868-map-editor-draft-v1'))?.map?.name==='public editor browser test');
  await page.reload();await ready();assert.equal(await page.locator('#name').inputValue(),'public editor browser test');assert.equal(await page.locator('#width').inputValue(),'1024');
  const saving=page.waitForResponse(r=>r.url().endsWith('/api/projects')&&r.request().method()==='POST');await page.locator('#save').click();assert.equal((await saving).status(),200);
  const download=page.waitForEvent('download');await page.locator('#export').click();await(await download).saveAs('test-results/demo-export.twmap.zip');
  await page.locator('#new').click();await ready();assert.equal((await page.evaluate(()=>editor.map.tiles.length)),0);assert.equal(await page.locator('#width').inputValue(),'512');
  await page.locator('#template').click();await ready();assert.equal((await page.evaluate(()=>editor.map.tiles.length)),4);
  await page.locator('#assets .asset').first().click();const xy=await page.evaluate(()=>editor.cellScreen(340,220));await page.mouse.click(xy.x,xy.y);await ready();assert.equal((await page.evaluate(()=>editor.map.tiles.length)),5);
  await page.locator('#undo').click();await ready();assert.equal((await page.evaluate(()=>editor.map.tiles.length)),4);
  assert.deepEqual(errors,[]);await page.screenshot({path:'test-results/demo-editor.png',fullPage:true});
  fs.writeFileSync('test-results/browser.json',JSON.stringify({passed:true,title:await page.title(),defaultSide:512,maxSide:1024,journeys:['demo-load','resize','undo-redo','compressed-draft-reload','save','zip-export','new-map','template','stamp','undo-stamp'],errors},null,2));console.log('Browser editor journeys passed');
} finally {await browser.close();}
