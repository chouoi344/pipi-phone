// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),State=require('../lib/state.cjs');
async function checkImageFlow(page,mode,dir){
  const file=path.join(dir,'camera.jpg');
  await require('sharp')({create:{width:6000,height:4000,channels:3,background:'#557799'}}).jpeg().toFile(file);
  const pick=async()=>{if(mode==='83')await(await page.$('#chat-image-file')).uploadFile(file);else await page.locator('#chat-image-file').setInputFiles(file);};
  await page.evaluate(()=>{
    const role=document.querySelector('#view').dataset.chatRole,real=PipiNetwork.request;
    // Chat replies below are synthetic and are never written by this test server.
    const client=PipiStateSync.client,accept=client.accept.bind(client);
    client.accept=result=>result.uiTestReply?Promise.resolve(result):accept(result);
    window.photoTest={role,requests:[],delay:5000,fail:false,uploads:0};
    const picker=document.querySelector('.chat-composer');
    picker.addEventListener('change',()=>{photoTest.selectedAt=performance.now();},true);
    new MutationObserver(()=>{if(!Object.hasOwn(photoTest,'previewMs')&&document.querySelector('.compose-image-preview')?.textContent.includes('处理中'))photoTest.previewMs=performance.now()-photoTest.selectedAt;}).observe(document.querySelector('.chat-composer'),{childList:true,subtree:true});
    PipiNetwork.request=async(path,options)=>{
      if(path==='/api/media/upload'){
        photoTest.uploads++;
        if(photoTest.delay){const delay=photoTest.delay;photoTest.delay=0;await new Promise(r=>setTimeout(r,delay));}
        if(photoTest.fail)throw new Error('断网');
      }
      if(path==='/api/chat'){
        const body=JSON.parse(options.body);photoTest.requests.push(body);const s=Pipi.getState(),m={id:crypto.randomUUID(),roleId:role,sender:'user',type:'image',status:'sent',content:body.image,createdAt:Date.now()};
        return {ok:true,status:200,json:async()=>({uiTestReply:true,state:Object.assign({},s,{revision:s.revision+1,messages:s.messages.concat(m)})})};
      }
      return real(path,options);
    };
  });
  await pick();
  assert.equal(await page.evaluate(()=>document.querySelector('.compose-image-preview')?.textContent.includes('处理中')),true);
  const ms=await page.evaluate(()=>photoTest.previewMs);assert.ok(ms>=0&&ms<200,'图片预览延迟 '+ms+' ms');
  await page.evaluate(()=>Pipi.showView('chat',photoTest.role));
  await page.waitForFunction(()=>photoTest.requests.length===1);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#chat-messages .message-image')).some(img=>img.src.includes('/api/media/')));
  await page.evaluate(()=>{document.querySelector('#compose-text').focus();document.querySelector('#compose-text').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
  await pick();await page.waitForFunction(()=>document.querySelector('.compose-image-preview')?.textContent.includes('已选择'));
  assert.equal(await page.evaluate(()=>photoTest.requests.length),1);
  await page.evaluate(()=>{document.querySelector('#compose-text').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));document.querySelector('#compose-form [type=submit]').click();});
  await page.waitForFunction(()=>photoTest.requests.length===2);
  await page.evaluate(()=>{const el=document.querySelector('#compose-text');el.dispatchEvent(new PointerEvent('pointerdown',{pointerId:19,bubbles:true}));});
  await pick();await page.waitForFunction(()=>photoTest.requests.length===3);
  await page.evaluate(()=>{document.dispatchEvent(new PointerEvent('pointerup',{pointerId:19}));photoTest.delay=600;});
  await pick();await page.evaluate(()=>Pipi.showView('chat',Pipi.getState().roles.find(r=>r.id!==photoTest.role).id));
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('没有发送'));
  assert.equal(await page.evaluate(()=>photoTest.requests.length),3);
  await page.evaluate(()=>{Pipi.showView('chat',photoTest.role);photoTest.fail=true;});await pick();
  await page.waitForFunction(()=>!document.querySelector('.compose-image-preview')&&document.querySelector('#toast').textContent.includes('网络'));
}
async function run(){
  const mode=process.argv[2]||'chromium',driver=require(process.env[mode==='83'?'PIPI_BROWSER_DRIVER':'PIPI_PLAYWRIGHT_MODULE']||(mode==='83'?'puppeteer-core':'playwright'));
  const browser=await (mode==='83'?driver:driver[mode]).launch({headless:true,...(process.env.PIPI_BROWSER_EXECUTABLE?{executablePath:process.env.PIPI_BROWSER_EXECUTABLE}:{})});
  try{for(const skin of ['classic','waterdrop']){
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-chat-dom-')),initial=State.initial();
    State.apply(initial,'role.save',{name:'聊天测试'});const role=initial.roles[0];
    for(let i=0;i<45;i++)State.message(initial,role,'assistant','初始消息 '+i,'text');
    State.apply(initial,'role.save',{name:'第二个好友'});
    const app=createApp({dataDir:dir,host:'127.0.0.1',port:0,initialState:()=>initial,mediaTimers:false,providerUrlAllowlist:[]});await app.listen();
    const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    try{
      if(mode==='83')await page.setViewport({width:390,height:840});else await page.setViewportSize({width:390,height:840});
      await page.goto('http://127.0.0.1:'+app.server.address().port);
      await page.waitForSelector('#auth-form [name=displayName]');
      await page.evaluate(()=>{localStorage.setItem('pipi.first-use-notice.seen','1');document.querySelector('[name=displayName]').value='测试';for(const i of document.querySelectorAll('[type=password]'))i.value='Local-Chat-2026';document.querySelector('#auth-form [type=submit]').click();});
      await page.waitForSelector('[data-open-chat]');
      await page.evaluate(skin=>{document.documentElement.dataset.skin=skin;document.querySelector('[data-open-chat]').click();},skin);
      await page.waitForSelector('#chat-messages[data-scroll-ready=true] [data-message]');
      await page.evaluate(()=>{
        const list=document.querySelector('#chat-messages'),input=document.querySelector('#compose-text');
        window.fixture={list,input,header:document.querySelector('#view > .topbar'),footer:document.querySelector('.chat-composer'),row:list.querySelector('[data-message]')};
        input.focus();
        fixture.append=()=>{const s=Pipi.getState(),m=Object.assign({},s.messages[s.messages.length-1],{id:crypto.randomUUID(),sender:'assistant',type:'text',content:'对方新消息',createdAt:Date.now()});Pipi.receiveState(Object.assign({},s,{revision:s.revision+1,messages:s.messages.concat(m)}));};
      });
      const result=await page.evaluate(async()=>{
        const {list,input,header,footer,row}=fixture,frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        let mutations=0;const observer=new MutationObserver(records=>{for(const m of records)if(m.removedNodes.length)mutations++;});observer.observe(input,{childList:true});
        for(let i=0;i<50;i++){if(!input.firstChild)input.appendChild(document.createTextNode(''));input.firstChild.appendData('文');input.dispatchEvent(new Event('input',{bubbles:true}));}
        let jumped=false;for(let i=0;i<5;i++){fixture.append();if(list.scrollTop===0)jumped=true;}await frame();observer.disconnect();
        const stable=input===document.querySelector('#compose-text')&&list===document.querySelector('#chat-messages')&&header===document.querySelector('#view > .topbar')&&footer===document.querySelector('.chat-composer')&&row===list.querySelector('[data-message]')&&document.activeElement===input;
        const last=list.lastElementChild,block=document.createElement('div');block.style.height='150px';last.append(block);await frame();
        const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<=2;
        list.scrollTop=Math.floor(list.scrollHeight/2);await frame();const anchor=Array.from(list.children).find(n=>n.getBoundingClientRect().bottom>list.getBoundingClientRect().top),y=anchor.getBoundingClientRect().top;fixture.append();await frame();
        return {stable,mutations,length:input.textContent.length,jumped,bottom,anchor:Math.abs(y-anchor.getBoundingClientRect().top)<2,notice:!document.querySelector('.chat-new-messages').hidden};
      });
      assert.deepEqual(result,{stable:true,mutations:0,length:50,jumped:false,bottom:true,anchor:true,notice:true});
      await page.evaluate(()=>{document.querySelector('.chat-new-messages').click();});
      for(const height of [530,840]){
        if(mode==='83')await page.setViewport({width:390,height});else await page.setViewportSize({width:390,height});
        await page.waitForFunction(()=>fixture.list.scrollHeight-fixture.list.scrollTop-fixture.list.clientHeight<=2);
      }
      if(skin==='waterdrop'){
        await page.evaluate(()=>{
          WaterdropChat.setConnected(true);const s=Pipi.getState(),m=Object.assign({},s.messages[0],{id:crypto.randomUUID(),roleId:document.querySelector('#view').dataset.chatRole,sender:'user',type:'text',status:'pending',content:'等待回复测量',createdAt:Date.now()});
          fixture.waitId=m.id;Pipi.receiveState(Object.assign({},s,{revision:s.revision+1,messages:s.messages.concat(m)}));
        });
        await page.waitForFunction(()=>document.querySelector('.waterdrop-waiting')&&fixture.list.scrollHeight-fixture.list.scrollTop-fixture.list.clientHeight<=2);
        const unchanged=await page.evaluate(()=>{
          const label=document.querySelector('.waterdrop-waiting');const s=Pipi.getState();Pipi.receiveState(Object.assign({},s,{revision:s.revision+1}));return document.querySelector('.waterdrop-waiting')===label;
        });assert.equal(unchanged,true);
        await page.evaluate(()=>{const s=Pipi.getState();Pipi.receiveState(Object.assign({},s,{revision:s.revision+1,messages:s.messages.map(m=>m.id===fixture.waitId?Object.assign({},m,{status:'sent'}):m)}));});
        await page.waitForFunction(()=>!document.querySelector('.waterdrop-waiting')&&fixture.list.scrollHeight-fixture.list.scrollTop-fixture.list.clientHeight<=2);
      }
      const sending=await page.evaluate(async()=>{
        const {input,list,header,footer}=fixture,request=PipiNetwork.request;let count=0,finish;
        PipiNetwork.request=async(path,options)=>{
          if(path!=='/api/chat')return request(path,options);
          count++;const body=JSON.parse(options.body);await new Promise(r=>finish=r);
          const s=Pipi.getState(),m=Object.assign({},s.messages[0],{id:crypto.randomUUID(),sender:'user',type:'text',content:body.text,createdAt:Date.now()});
          return {ok:true,status:200,json:async()=>({state:Object.assign({},s,{revision:s.revision+1,messages:s.messages.concat(m)})})};
        };
        input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
        const footerButton=footer.querySelector('[type=submit]');for(let n=0;n<5;n++)footerButton.click();
        const pending=list.querySelectorAll('[data-pending-id]').length,cleared=input.textContent==='';
        await new Promise(r=>setTimeout(r,3000));finish();await new Promise(r=>setTimeout(r,60));fixture.append();PipiNetwork.request=request;
        return {pending,cleared,count,remaining:list.querySelectorAll('[data-pending-id]').length,focus:input===document.activeElement,stable:list===document.querySelector('#chat-messages')&&header===document.querySelector('#view > .topbar')&&input===document.querySelector('#compose-text')&&footer===document.querySelector('.chat-composer')};
      });
      assert.deepEqual(sending,{pending:1,cleared:true,count:1,remaining:0,focus:true,stable:true});await checkImageFlow(page,mode,dir);
      assert.deepEqual(errors,[]);console.log('PASS',mode,skin);
    }catch(error){console.error('chat scenario',mode,skin,errors,await page.evaluate(()=>({uploads:window.photoTest?.uploads,requests:window.photoTest?.requests.length,toast:document.querySelector('#toast')?.textContent,preview:document.querySelector('.compose-image-preview')?.textContent,text:document.querySelector('#compose-text')?.textContent})));throw error;}finally{await page.close();await app.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:3});}
  }}finally{await browser.close();}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
