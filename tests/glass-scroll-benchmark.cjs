// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const root = path.resolve(process.env.PIPI_BENCH_ROOT || path.join(__dirname,'..'));
const State = require(path.join(root,'lib/state.cjs'));
const {createApp} = require(path.join(root,'server.cjs'));
const {chromium} = require(process.env.PIPI_PLAYWRIGHT_MODULE || 'playwright');
const sharp = require('sharp');

function percentile(samples, fraction) {
  return Number(samples[Math.ceil(samples.length * fraction) - 1].toFixed(1));
}

async function measure(page) {
  return page.evaluate(async () => {
    const list = document.getElementById('chat-messages');
    const samples = [], range = list.scrollHeight - list.clientHeight;
    const next = () => new Promise(resolve => requestAnimationFrame(resolve));
    list.scrollTop = 0;
    let previous = await next();
    // Two full sweeps. Exclude the first ten frames for initial layer allocation.
    for (let i = 0; i < 130; i++) {
      list.scrollTop = range * (1 - Math.cos(2 * Math.PI * i / 65)) / 2;
      const now = await next();
      if (i >= 10) samples.push(now - previous);
      previous = now;
    }
    return samples;
  });
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'pipi-scroll-meter-'));
  const state = State.initial();
  State.apply(state,'role.save',{name:'滚动测试'});
  const role = state.roles[0];
  for (let i=0;i<120;i++) State.message(state,role,i % 2 ? 'user' : 'assistant',
    '第 ' + (i+1) + ' 条。' + ['我们出发吧。','刚才那段聊天再讲一次，我想记下来。','路边的樱花开了。'][i%3]);
  // Generate a reproducible detailed wallpaper, also usable when running offline.
  const width=390, height=844, pixels=Buffer.alloc(width*height*3);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const n=3*(y*width+x);pixels[n]=(x*2+y)%256;pixels[n+1]=(x+y*3)%256;pixels[n+2]=((x>>4)^(y>>3))%2?90:190;
  }
  const wallpaper='data:image/jpeg;base64,'+(await sharp(pixels,{raw:{width,height,channels:3}}).jpeg().toBuffer()).toString('base64');
  const app=createApp({dataDir:dir,host:'127.0.0.1',port:0,initialState:()=>state,mediaTimers:false});
  await app.listen();
  const browser=await chromium.launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE});
  try {
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:2.75,isMobile:true,hasTouch:true});
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.goto('http://127.0.0.1:'+app.server.address().port);
    await page.waitForSelector('#auth-form [name=displayName]');
    await page.evaluate(()=>{document.querySelector('[name=displayName]').value='Scroll';for(const input of document.querySelectorAll('[type=password]')) input.value='Isolated-Benchmark';document.querySelector('#auth-form [type=submit]').click();});
    await page.waitForSelector('[data-open-chat]');
    await page.evaluate(()=>document.querySelector('[data-open-chat]').click());
    await page.waitForFunction(()=>document.querySelectorAll('#chat-messages [data-message]').length>1);
    if(await page.locator('#chat-messages [data-message]').count()<120) {
      await page.locator('[data-chat-older]').click();
    }
    await page.waitForFunction(()=>document.querySelectorAll('#chat-messages [data-message]').length===120);
    console.log('Browser',browser.version(),'390x844 @2.75x, CPU 4x; 3 x 120 measured frames per scenario');
    const withModes=await page.evaluate(()=>typeof PipiSkins.selectGlass==='function');
    const setups=[['classic',false,'full'],['waterdrop',false,'full'],['waterdrop',true,'full']];
    if(withModes) setups.push(['waterdrop',false,'lite'],['waterdrop',true,'lite']);
    const scores=setups.map(()=>[]);
    for(let round=0;round<3;round++) {
      for(let j=0;j<setups.length;j++) {
        const i=(j+round)%setups.length, [skin,custom,glass]=setups[i];
        await page.evaluate(({skin,glass,wallpaper})=>{
          PipiSkins.configure({waterdropActivated:true});PipiSkins.select(skin);
          if(PipiSkins.selectGlass) PipiSkins.selectGlass(glass);
          const s=Pipi.getState(),id=document.getElementById('view').dataset.chatRole;
          Pipi.receiveState({...s,revision:s.revision+1,roles:s.roles.map(r=>r.id===id?{...r,chatBackground:wallpaper}:r)});
        },{skin,glass,wallpaper:custom?wallpaper:''});
        await page.waitForFunction(custom=>document.getElementById('view').classList.contains('has-custom-wallpaper')===custom,custom);
        await page.evaluate(()=>document.fonts.ready.then(()=>true));
        await page.waitForTimeout(300);
        const frames=await measure(page);
        const measured=await page.evaluate(()=>{
          const view=document.getElementById('view'),style=getComputedStyle(view.querySelector('.message-bubble'));
          return {skin:document.documentElement.dataset.skin,custom:view.classList.contains('has-custom-wallpaper'),
            glass:document.documentElement.dataset.glass,rows:view.querySelectorAll('[data-message]').length,
            filter:style.backdropFilter||style.webkitBackdropFilter||'none'};
        });
        assert.equal(measured.rows,120);assert.equal(measured.skin,skin);assert.equal(measured.custom,custom);
        if(withModes) assert.equal(measured.glass,glass);
        if(skin==='waterdrop') assert.equal(measured.filter.includes('blur'),glass==='full');
        scores[i].push(...frames);
      }
    }
    for(let i=0;i<scores.length;i++){
      const values=scores[i].sort((a,b)=>a-b);
      assert.equal(values.length,360);
      console.log(JSON.stringify({skin:setups[i][0],custom:setups[i][1],mode:setups[i][2],frames:values.length,median:percentile(values,.5),p95:percentile(values,.95)}));
    }
  } finally {await browser.close();await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
