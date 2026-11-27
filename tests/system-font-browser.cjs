// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../server.cjs');
const {sampleState}=require('../scripts/sample-data.cjs');
const State=require('../lib/state.cjs');

async function verify(page,mode,skin,scope,selectors){
  for(const size of [{width:320,height:640},{width:390,height:844},{width:1280,height:900}]){
    if(mode==='83')await page.setViewport(size);else await page.setViewportSize(size);
    const result=await page.evaluate(async items=>{
      await document.fonts.ready;
      await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      const failures=[];
      for(const selector of items){
        const elements=[...document.querySelectorAll(selector)].filter(e=>e.textContent.trim()&&e.getClientRects().length);
        if(!elements.length)failures.push('missing '+selector);
        for(const el of elements){
          const box=el.getBoundingClientRect(),range=document.createRange();
          range.selectNodeContents(el);
          const text=range.getBoundingClientRect();
          if(text.left<box.left-2||text.right>box.right+2||text.top<box.top-3||text.bottom>box.bottom+3)failures.push([selector,el.textContent,Math.round(box.width),Math.round(text.width),Math.round(box.height),Math.round(text.height)]);
        }
      }
      return {skin:document.documentElement.dataset.skin,font:getComputedStyle(document.body).fontFamily,networkFonts:document.fonts.size,failures};
    },selectors);
    if(process.env.UI_ARTIFACT_DIR&&mode==='chromium'&&(size.width===390||scope==='钱包')){
      await fs.mkdir(process.env.UI_ARTIFACT_DIR,{recursive:true});
      await page.screenshot({path:path.join(process.env.UI_ARTIFACT_DIR,skin+'-'+scope+'-'+size.width+'.png')});
    }
    assert.equal(result.skin,skin);
    assert.match(result.font,/PingFang SC/i);
    assert.doesNotMatch(result.font,/\bInter\b|Noto Sans SC/i);
    assert.equal(result.networkFonts,0);
    assert.deepEqual(result.failures,[],[mode,skin,scope,size.width,JSON.stringify(result.failures)].join(' '));
  }
}
async function run(){
  const mode=process.argv[2]||'chromium',driver=require(process.env[mode==='83'?'PIPI_BROWSER_DRIVER':'PIPI_PLAYWRIGHT_MODULE']||(mode==='83'?'puppeteer-core':'playwright'));
  const browser=await (mode==='83'?driver:driver[mode]).launch({headless:true,...(process.env.PIPI_BROWSER_EXECUTABLE?{executablePath:process.env.PIPI_BROWSER_EXECUTABLE}:{})});
  try{for(const skin of ['classic','waterdrop']){
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-font-layout-')),data=sampleState(),role=data.roles[0];
    data.wallet.balanceCents=1234567890;
    for(const type of ['redpacket','transfer'])State.apply(data,'wallet.transfer',{roleId:role.id,type,requestId:'font-qa-'+type,amountCents:type==='transfer'?1234567:888,note:type==='redpacket'?'恭喜发财':'周末聚餐'});
    role.unread=123;
    const app=createApp({dataDir:dir,host:'127.0.0.1',port:0,initialState:()=>data,mediaTimers:false,providerUrlAllowlist:[]});
    await app.listen();
    const page=await browser.newPage(),fontRequests=[],errors=[];
    page.setDefaultTimeout(10000);
    page.on('request',r=>{if(r.resourceType()==='font'||/\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(r.url()))fontRequests.push(r.url());});
    page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.goto('http://127.0.0.1:'+app.server.address().port);
      await page.waitForSelector('#dismiss-notice');
      await page.click('#dismiss-notice');
      await page.waitForFunction(()=>!document.querySelector('.first-notice'));
      await page.evaluate(()=>{document.querySelector('[name=displayName]').value='字体测试';for(const input of document.querySelectorAll('[type=password]'))input.value='Local-Font-2026';document.querySelector('#auth-form [type=submit]').click();});
      await page.waitForSelector('[data-open-chat]');
      await page.evaluate(s=>{PipiSkins.configure({waterdropActivated:true});PipiSkins.select(s);},skin);
      await verify(page,mode,skin,'会话列表',['.tab-label','.unread-badge','.conversation-time']);
      await page.click('[data-open-chat="'+role.id+'"]');
      await page.waitForSelector('.payment-transfer');
      await verify(page,mode,skin,'聊天卡片',['.message-date','.payment-transfer .payment-title','.payment-redpacket .payment-title','.payment-footer-state']);
      await page.evaluate(()=>Pipi.showView('wallet'));await page.waitForSelector('#wallet-balance');await page.click('#wallet-balance');
      await page.waitForSelector('.wallet-balance');
      await verify(page,mode,skin,'钱包',['.wallet-balance','.wallet-actions button']);
      await page.evaluate(()=>{Pipi.closeModal();Pipi.showView('engine-home');});
      await page.waitForSelector('[data-model-pref=triggerRatio]');
      await page.evaluate(()=>{document.querySelector('.model-context-details').open=true;});
      await verify(page,mode,skin,'模型设置',['[data-model-pref=triggerRatio] .preference-value','[data-model-pref=dropTurns] .preference-value']);
      assert.deepEqual(fontRequests,[]);assert.deepEqual(errors,[]);
      console.log('PASS',mode,skin,'320/390/1280px, 4 pages, 0 font requests');
    }finally{await page.close();await app.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:3});}
  }}finally{await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
