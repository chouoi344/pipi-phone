// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createApp}=require('../server.cjs'),State=require('../lib/state.cjs'),{sampleState}=require('../scripts/sample-data.cjs');

async function verify(browser,mode,skin,provider){
  const initial=sampleState(),[active,other]=initial.roles,dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-page-events-'));
  for(let i=0;i<151;i++)State.message(initial,active,'assistant','旧记录 '+i,'text');
  State.apply(initial,'settings.save',{providers:{chat:{mode:'custom',baseUrl:provider,model:'fixture',key:'local-fixture'}}});
  const app=createApp({dataDir:dir,host:'127.0.0.1',port:0,initialState:()=>initial,providerUrlAllowlist:[provider],mediaTimers:false});
  await app.listen();const page=await browser.newPage();page.setDefaultTimeout(20000);
  try{
    if(mode==='83')await page.setViewport({width:390,height:844});else await page.setViewportSize({width:390,height:844});
    await page.goto('http://127.0.0.1:'+app.server.address().port);
    await page.waitForSelector('#dismiss-notice');await page.click('#dismiss-notice');await page.waitForFunction(()=>!document.querySelector('.first-notice'));
    await page.evaluate(()=>{document.querySelector('[name=displayName]').value='分页验证';for(const f of document.querySelectorAll('[type=password]'))f.value='Page-Events-2026';document.querySelector('#auth-form [type=submit]').click();});
    await page.waitForSelector('[data-open-chat]');
    await page.evaluate(s=>{
      PipiSkins.configure({waterdropActivated:true});PipiSkins.select(s);
      window.probe={animations:[],oldRequests:0,visibleNotices:[],counts:[]};
      const animate=Element.prototype.animate;
      Element.prototype.animate=function(...args){if(this.matches('.message-row[data-message]'))probe.animations.push(this.dataset.message);return animate.apply(this,args);};
      new MutationObserver(()=>{
        const n=document.querySelector('.android-chat-notice');if(n)probe.visibleNotices.push(n.dataset.roleId);
        const count=document.querySelector('.chat-new-messages');if(count&&!count.hidden)probe.counts.push(count.textContent);
      }).observe(document.querySelector('.phone-shell'),{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
      const transport=PipiNetwork.request;
      PipiNetwork.request=async(url,options)=>{
        if(url.startsWith('/api/messages?')&&new URL(url,location.href).searchParams.has('beforeId')){
          probe.oldRequests++;
          if(probe.oldRequests===1){await new Promise(r=>setTimeout(r,100));throw Error('离线测试');}
        }
        return transport(url,options);
      };
    },skin);
    const chatSelector='#view [data-open-chat="'+active.id+'"]';
    await page.waitForSelector(chatSelector,{visible:true});await page.click(chatSelector);
    await page.waitForFunction(()=>document.querySelectorAll('#chat-messages [data-message]').length===60);
    // Double taps share one request. The actionable error belongs to this chat.
    await page.evaluate(()=>{const b=document.querySelector('[data-chat-older]');b.scrollIntoView();b.click();b.click();});
    await page.waitForSelector('[data-chat-page-retry]');assert.equal(await page.evaluate(()=>probe.oldRequests),1);
    await page.click('[data-chat-page-retry]');
    await page.waitForFunction(()=>document.querySelectorAll('#chat-messages [data-message]').length===120);
    const history=await page.evaluate(()=>({requests:probe.oldRequests,animations:probe.animations.slice(),counts:probe.counts.slice(),notices:probe.visibleNotices.slice()}));
    assert.deepEqual(history,{requests:2,animations:[],counts:[],notices:[]});
    await page.evaluate(()=>{const list=document.querySelector('#chat-messages');list.scrollTop=10;});
    const submit=async(roleId,text)=>page.evaluate(async data=>{
      const result=await Pipi.api('/api/chat',{...data,requestId:crypto.randomUUID()});if(result.state)Pipi.receiveState(result.state);
    },{roleId,text});
    await submit(active.id,'active-probe');
    await page.waitForFunction(()=>Pipi.getState().messages.some(m=>m.content==='同步测试回复 active-probe'));
    const activeReply=await page.evaluate(()=>Pipi.getState().messages.find(m=>m.content==='同步测试回复 active-probe').id);
    await page.waitForFunction(id=>probe.animations.includes(id),...(mode==='83'?[{},activeReply]:[activeReply]));
    assert.ok(await page.evaluate(()=>probe.counts.length>0));
    await submit(other.id,'other-probe');
    await page.waitForFunction(()=>document.querySelector('.android-chat-notice')?.textContent.includes('同步测试回复 other-probe'));
    const head=await page.evaluate(id=>({loaded:PipiStateSync.client.paging.info(id).loaded,messages:Pipi.getState().messages.filter(m=>m.roleId===id).map(m=>m.content),notice:document.querySelector('.android-chat-notice').dataset.roleId}),other.id);
    assert.deepEqual(head,{loaded:false,messages:['同步测试回复 other-probe'],notice:other.id});
    await page.evaluate(()=>Pipi.showView('chats'));
    assert.ok((await page.evaluate(id=>document.querySelector('[data-open-chat="'+id+'"] .conversation-preview').textContent,other.id)).includes('other-probe'));
    console.log('PASS',mode,skin,'retry, no historical animation/count/notification, live arrival animation/count and inactive notification/head');
  }finally{await page.close();await app.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:3});}
}

(async()=>{
  process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const model=http.createServer(async(req,res)=>{let data='';for await(const chunk of req)data+=chunk;const text=data.includes('other-probe')?'other-probe':'active-probe';res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'local-fixture',choices:[{message:{role:'assistant',content:'同步测试回复 '+text}}]}));});
  await new Promise(r=>model.listen(0,'127.0.0.1',r));const provider='http://127.0.0.1:'+model.address().port+'/v1';
  const mode=process.argv[2]||'chromium',driver=require(process.env[mode==='83'?'PIPI_BROWSER_DRIVER':'PIPI_PLAYWRIGHT_MODULE']||(mode==='83'?'puppeteer-core':'playwright'));
  const browser=await (mode==='83'?driver:driver[mode]).launch({headless:true,...(process.env.PIPI_BROWSER_EXECUTABLE?{executablePath:process.env.PIPI_BROWSER_EXECUTABLE}:{})});
  try{for(const skin of ['classic','waterdrop'])await verify(browser,mode,skin,provider);}finally{await browser.close();model.closeAllConnections();await new Promise(r=>model.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
