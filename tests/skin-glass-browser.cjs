// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs/promises'),path=require('node:path');
const {createApp}=require('../server.cjs'),State=require('../lib/state.cjs');

async function run() {
  const engine=process.argv[2] || 'chromium';
  const old=engine==='83';
  const driver=require((old?process.env.PIPI_BROWSER_DRIVER:process.env.PIPI_PLAYWRIGHT_MODULE)||(old?'puppeteer-core':'playwright'));
  const browser=await (old?driver:driver[engine]).launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE});
  const state=State.initial();State.apply(state,'role.save',{name:'玻璃测试'});State.message(state,state.roles[0],'assistant','你好');
  const app=createApp({host:'127.0.0.1',port:0,dataDir:await fs.mkdtemp(path.join(os.tmpdir(),'pipi-glass-ui-')),mediaTimers:false,initialState:()=>state});
  await app.listen();
  const page=await browser.newPage();page.setDefaultTimeout(10000);
  try {
    if(old)await page.setViewport({width:390,height:844});else await page.setViewportSize({width:390,height:844});
    await page.goto('http://127.0.0.1:'+app.server.address().port);
    await page.click('#dismiss-notice');
    await page.waitForSelector('#auth-form [name=displayName]');
    await page.evaluate(()=>{document.querySelector('[name=displayName]').value='Browser';for(const node of document.querySelectorAll('[type=password]'))node.value='GlassUiTest2026';document.querySelector('#auth-form [type=submit]').click();});
    await page.waitForSelector('[data-open-chat]');
    const openSkins=()=>page.evaluate(()=>Pipi.showView('skins'));
    const choose=async value=>{
      await openSkins();
      await page.waitForFunction(()=>!document.querySelector('.navigation-snapshot'));
      await page.click('[data-action="glass-mode"]');await page.click('.assignment-option input[value="'+value+'"]');
      const closed=v=>PipiSkins.glassChoice===v&&!document.querySelector('#overlay .model-sheet');
      if(old)await page.waitForFunction(closed,{},value);else await page.waitForFunction(closed,value);
    };
    const styles=async skin=>{
      await page.evaluate(skin=>{PipiSkins.configure({waterdropActivated:true});PipiSkins.select(skin);Pipi.showView('chat',Pipi.getState().roles[0].id);},skin);
      await page.waitForSelector('.message-bubble');
      return page.evaluate(()=>{
        const bubble=document.querySelector('.message-bubble'),list=document.querySelector('#chat-messages');
        const computed=n=>{const c=getComputedStyle(n);return c.backdropFilter||c.webkitBackdropFilter||'none';};
        const samples=['message-bubble forward-card','message-bubble payment-card message-transfer','message-quote','voice-transcript'].map(className=>{
          const n=document.createElement('div');n.className=className;list.appendChild(n);const result=computed(n);n.remove();return result;
        });
        return {bubble:computed(bubble),gradient:getComputedStyle(bubble).backgroundImage,header:computed(document.querySelector('.topbar h2')),samples};
      });
    };
    await choose('full');
    const classic=await styles('classic'),full=await styles('waterdrop');
    assert.match(full.bubble,/blur/);assert.match(full.header,/blur/);assert.ok(full.samples.every(v=>v.includes('blur')));
    await choose('lite');
    const lite=await styles('waterdrop');
    assert.equal(lite.bubble,'none');assert.deepEqual(lite.samples,['none','none','none','none']);
    assert.equal(lite.header,full.header);assert.notEqual(lite.gradient,full.gradient);
    assert.deepEqual(await styles('classic'),classic);
    if(!old)await page.setViewportSize({width:1024,height:800});
    await page.reload();await page.waitForFunction(()=>window.Pipi?.getState());
    await openSkins();await page.waitForSelector('[data-action="glass-mode"]');
    assert.equal(await page.$eval('[data-action="glass-mode"]',n=>n.textContent.includes('流畅')),true);
    await choose('auto');
    console.log('PASS',engine,'classic unchanged, full/lite bubbles and all cards, fixed bar, setting selection and persistence');
  } finally {await browser.close();await app.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
