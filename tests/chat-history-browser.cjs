// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path');
const root=path.resolve(process.env.PIPI_BENCH_ROOT||path.join(__dirname,'..'));
const State=require(path.join(root,'lib/state.cjs')),{createApp}=require(path.join(root,'server.cjs'));
const engine=process.argv[2]||'chromium',old=engine==='83';
const target=15000,roleIndex=(target-1)%5,needle='跨年早期测试15000';
function seed(){
  const s=State.initial();
  for(let i=0;i<5;i++)State.apply(s,'role.save',{name:'历史好友'+i});
  s.messages=Array.from({length:20000},(_,i)=>({id:'history-'+(i+1),roleId:s.roles[i%5].id,sender:i%2?'user':'assistant',type:'text',
    content:i+1===target?needle:'第'+(i+1)+'条消息。'+'今天我们聊起了以前一起看过的风景。'.repeat(4),
    status:'sent',createdAt:1680000000000+i*1000}));
  s.messages[19999].meta={quote:{roleId:s.roles[4].id,messageId:'history-5',type:'text',sender:'assistant',senderName:'历史好友4',content:'最早的消息'}};
  return s;
}
async function run(){
  const state=seed(),dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-history-browser-'));
  const app=createApp({host:'127.0.0.1',port:0,dataDir,initialState:()=>state,mediaTimers:false,providerUrlAllowlist:[]});
  await app.listen();const origin='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({displayName:'历史用户',password:'HistoryFixture2026'})});
  assert.equal(setup.status,200);await setup.arrayBuffer();
  const cookie=setup.headers.get('set-cookie').split(';')[0],split=cookie.indexOf('=');
  const driver=require((old?process.env.PIPI_BROWSER_DRIVER:process.env.PIPI_PLAYWRIGHT_MODULE)||(old?'puppeteer-core':'playwright'));
  const browser=await (old?driver:driver[engine]).launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE});
  const page=await browser.newPage(); page.setDefaultTimeout(20000);
  try{
    const sessionCookie={url:origin,name:cookie.slice(0,split),value:cookie.slice(split+1)};
    if(old){await page.setViewport({width:390,height:844});await page.setCookie(sessionCookie);}
    else{await page.setViewportSize({width:390,height:844});await page.context().addCookies([sessionCookie]);}
    const startup=[],pending=[],paths=[];let counting=true;
    page.on('request',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/api/'))paths.push(url.pathname+url.search);});
    page.on('response',r=>{
      if(!counting)return;const url=new URL(r.url()),headers=r.headers();
      if(!url.pathname.startsWith('/api/')||!headers['content-type']?.includes('application/json'))return;
      pending.push((old?r.buffer():r.body()).then(b=>startup.push({path:url.pathname,bytes:b.length})));
    });
    const start=performance.now();await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelectorAll('#view[data-route="chats"] [data-open-chat]').length===5);
    const ms=Math.round(performance.now()-start);counting=false;await Promise.all(pending);
    const bytes=startup.reduce((n,r)=>n+r.bytes,0);
    console.log(JSON.stringify({engine,ms,bytes,responses:startup}));
    if(process.env.PIPI_BASELINE)return;
    assert.ok(bytes<300000,'Startup JSON '+bytes);assert.ok(!paths.some(p=>p==='/api/state'));
    const role=state.roles[roleIndex].id;
    async function wait(fn,arg){
      if(old)await page.waitForFunction(fn,{},arg);else await page.waitForFunction(fn,arg);
    }
    const click=async selector=>{await page.waitForSelector(selector,{visible:true});await page.click(selector);};
    const found=async id=>{
      await wait(id=>{const n=document.querySelector('.message-found[data-message="'+id+'"]'),list=document.getElementById('chat-messages');
        if(!n||!list)return false;const a=n.getBoundingClientRect(),b=list.getBoundingClientRect();return a.bottom>b.top&&a.top<b.bottom;},id);
    };
    async function typeIn(selector,value){
      await page.waitForSelector(selector);
      await page.evaluate(({selector,value})=>{const n=document.querySelector(selector);n.focus();n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));},{selector,value});
    }
    await page.evaluate(()=>document.getElementById('dismiss-notice')?.click());
    const openChat=()=>page.evaluate(id=>Pipi.showView('chat',id),role);
    await openChat();
    await wait(()=>document.querySelectorAll('#chat-messages [data-message]').length>=50);
    assert.equal(paths.filter(p=>new URL(p,origin).pathname==='/api/messages').length,1,'entry takes one page');
    await click('[data-quote-message="history-5"]');await found('history-5');
    console.log('PASS',engine,'deep quote');
    await page.evaluate(()=>Pipi.showView('chats'));
    await click('[data-action="global-search"]');await typeIn('#list-search',needle);
    await click('[data-global-message="history-15000"]');await found('history-15000');
    assert.ok(paths.some(p=>p.startsWith('/api/messages/global-search?')));
    await page.evaluate(id=>Pipi.showView('chat-search',id),role);await typeIn('#chat-search',needle);
    await click('[data-search-message="history-15000"]');await found('history-15000');
    assert.ok(paths.some(p=>p.startsWith('/api/messages/search?')));
    console.log('PASS',engine,'global and role search target 15000');
    // Start a fresh document so search and quote pages cannot populate the pagination case.
    await page.evaluate(()=>Pipi.showView('chats'));await page.reload();
    await wait(()=>document.querySelectorAll('[data-open-chat]').length===5);
    const requestStart=paths.length;
    await openChat();await wait(()=>!!document.querySelector('[data-chat-older]'));
    let pages=1,maxDelta=0;
    while(!await page.$('[data-message="history-5"]')) {
      const anchor=await page.evaluate(async()=>{
        const list=document.getElementById('chat-messages'),first=list.querySelector('[data-message]');
        first.scrollIntoView({block:'start'});await new Promise(r=>requestAnimationFrame(r));
        const result={id:first.dataset.message,top:first.getBoundingClientRect().top};
        document.querySelector('[data-chat-older]')?.click();
        return result;
      });
      await wait(id=>{const list=document.getElementById('chat-messages');return list.querySelector('[data-message]')?.dataset.message!==id&&!list.querySelector('[aria-busy=true]');},anchor.id);
      const delta=await page.evaluate(({id,top})=>{const n=document.querySelector('[data-message="'+id+'"]');return n?Math.abs(n.getBoundingClientRect().top-top):null;},anchor);
      assert.notEqual(delta,null,'previous first row retained');maxDelta=Math.max(maxDelta,delta);
      assert.ok(delta<=3,'reading anchor drift '+delta+'px');assert.ok(++pages<=100);
    }
    assert.equal(paths.slice(requestStart).filter(p=>new URL(p,origin).pathname==='/api/messages').length,pages);
    assert.ok(pages>=40);assert.equal(await page.$('[data-chat-older]'),null);
    assert.ok(await page.evaluate(()=>document.querySelectorAll('#chat-messages [data-message]').length<=120));
    console.log('PASS',engine,'oldest of 4000',pages,'pages; max anchor change',maxDelta,'px');
    // Only the advertised features are changed. Every message request still reaches the real server.
    const omitFeatures=()=>{
      const fetchOriginal=window.fetch;
      window.fetch=async(...args)=>{
        const res=await fetchOriginal.apply(window,args);
        const omit=localStorage.getItem('pipi.test.omitFeatures');
        if(!omit||new URL(res.url).pathname!=='/api/status')return res;
        const value=await res.json();
        value.clientProtocol.features=value.clientProtocol.features.filter(feature=>!omit.split(',').includes(feature));
        return new Response(JSON.stringify(value),{status:res.status,headers:{'Content-Type':'application/json'}});
      };
    };
    if(old)await page.evaluateOnNewDocument(omitFeatures);else await page.addInitScript(omitFeatures);
    async function reloadWithout(features){
      await page.evaluate(f=>{Pipi.showView('chats');localStorage.setItem('pipi.test.omitFeatures',f);},features);
      const start=paths.length;await page.reload();await wait(()=>document.querySelectorAll('[data-open-chat]').length===5);return start;
    }
    await reloadWithout('');
    if(old)await page.setOfflineMode(true);else await page.context().setOffline(true);
    await click('[data-action="global-search"]');await typeIn('#list-search','第20000条消息');
    await page.waitForSelector('[data-global-message="history-20000"]');
    assert.ok(await page.$eval('[data-history-results]',area=>area.textContent.includes('仅搜索已加载')));
    if(old)await page.setOfflineMode(false);else await page.context().setOffline(false);
    console.log('PASS',engine,'offline loaded message search');
    let mark=await reloadWithout('messages-global-search-v1');
    await click('[data-action="global-search"]');await typeIn('#list-search',needle);
    await wait(()=>document.querySelector('[data-history-results]')?.textContent.includes('仅搜索已加载'));
    assert.equal(await page.$('[data-global-message="history-15000"]'),null);
    await typeIn('#list-search','第20000条消息');await page.waitForSelector('[data-global-message="history-20000"]');
    assert.ok(!paths.slice(mark).some(p=>p.startsWith('/api/messages/global-search')));
    mark=await reloadWithout('messages-v1,messages-global-search-v1');
    assert.ok(paths.slice(mark).includes('/api/state'));
    await click('[data-action="global-search"]');await typeIn('#list-search',needle);
    await page.waitForSelector('[data-global-message="history-15000"]');
    assert.ok(!paths.slice(mark).some(p=>p.startsWith('/api/messages/global-search')));
    console.log('PASS',engine,'older messages-v1 server searches loaded data; legacy server loads full state');
  }finally{await browser.close();await app.close();}
}
run().catch(e=>{console.error(e);process.exit(1);});
