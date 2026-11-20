// SPDX-License-Identifier: MIT
'use strict';
// Supplemental UI coverage on the harness's disposable server/profile only.
// Provider success is an explicit intercepted UI-contract response, not AI output.
module.exports = async function features043Extra(t) {
  const {assert,command,evaluate,wait,click,fill,capture,check,delay,metrics,deviceScaleFactor,onCDP,out}=t;
  const fs=require('node:fs/promises'),path=require('node:path');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor,mobile:true});
  await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const key=async key=>{const n=key==='Escape'?27:13;await command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:n});await command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:n});await delay(120);};
  const route=()=>evaluate('document.querySelector("#view").dataset.route');
  const settle=async()=>{await evaluate('Promise.all([...document.querySelectorAll(".page-editor")].flatMap(e=>e.getAnimations()).map(a=>a.finished.catch(()=>{})))');await delay(100);};
  const root=async(tab='me')=>{
    for(let i=0;i<8&&await evaluate('!!document.querySelector("#overlay").children.length');i++)await key('Escape');
    for(let i=0;i<30&&!await evaluate('!!document.querySelector(".bottom-tabs")');i++){await click('[data-action=back]');await delay(100);}
    await click('[data-nav='+tab+']');await delay(100);
  };
  const close=async()=>{await click('.page-editor [data-close]');await delay(160);};
  const back=async()=>{await click('[data-action=back]');await delay(130);};
  const manage=async()=>{await root();await click('[data-action=settings]');await click('[data-action=moments-settings]');await wait('!!document.querySelector("#moment-role-filter")');await settle();};
  const restore=async backup=>{await evaluate(`(async()=>{const r=await Pipi.api('/api/restore',{backup:${JSON.stringify(backup)},confirm:true});Pipi.setState(r.state);Pipi.refresh();})()`);};
  const guarded=async(name,task,cleanup=async()=>{})=>{try{await task();}catch(error){await capture('feature043-'+name+'-failure').catch(()=>{});throw error;}finally{await cleanup();}};
  const fixtureCase=async(name,task)=>{const original=await evaluate('Pipi.api("/api/backup")');await guarded(name,()=>task(original),async()=>{await root();await restore(original);await root();});};
  const fulfill=(id,status,body)=>command('Fetch.fulfillRequest',{requestId:id,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
  const visibleMomentIds=()=>evaluate('[...document.querySelectorAll("article[data-moment-id]")].map(e=>e.dataset.momentId).sort()');
  const placeholderResults=[];
  const placeholder=async(selector,expectedRoute)=>{
    const before=await evaluate('Pipi.getState().revision');
    // Clear stale feedback so each individual click must cause a new toast.
    await evaluate('document.querySelector("#toast").classList.remove("visible");document.querySelector("#toast").textContent=""');
    const label=await evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent.trim()`);
    await click(selector);await wait('document.querySelector("#toast").classList.contains("visible")');
    const text=await evaluate('document.querySelector("#toast").textContent');
    assert.match(text,/尚未|未开放|未接入/,'specific click must report its unavailable state: '+label);
    assert.equal(await route(),expectedRoute,'placeholder must retain the current route: '+label);
    assert.equal(await evaluate('Pipi.getState().revision'),before,'placeholder must not mutate account data: '+label);
    placeholderResults.push({route:expectedRoute,selector,label,text});
  };
  const actions=async(names,expectedRoute)=>{for(const action of names)await placeholder('[data-action="'+action+'"]',expectedRoute);};

  await check('feature043 moments management selects actual role visibility and restores all view',async()=>fixtureCase('moment-perspective',async original=>{
    const b=structuredClone(original),[a,c]=b.state.roles;assert.ok(a&&c,'isolated fixture needs two roles');
    const stamp=Date.now();
    b.state.moments=[
      ['fextra-own-all','me','all'],['fextra-own-self','me',[]],['fextra-own-a','me',[a.id]],['fextra-own-b','me',[c.id]],['fextra-author-a',a.id,'all'],['fextra-author-b',c.id,'all']
    ].map(([id,authorId,visibility],i)=>({id,authorId,visibility,content:'FEATURE043 '+id,image:'',likes:[],comments:[],createdAt:stamp+i}));
    await restore(b);await manage();await fill('#moment-role-filter',a.id);await wait('document.querySelector("#view").dataset.route==="moments"&&!document.querySelector(".page-editor")');
    assert.deepEqual(await visibleMomentIds(),['fextra-author-a','fextra-own-a','fextra-own-all'].sort());await capture('feature043-perspective-a');
    await manage();assert.equal(await evaluate('document.querySelector("#moment-role-filter").value'),a.id);await fill('#moment-role-filter',c.id);await wait('document.querySelector("#view").dataset.route==="moments"&&!document.querySelector(".page-editor")');
    assert.deepEqual(await visibleMomentIds(),['fextra-author-b','fextra-own-b','fextra-own-all'].sort());
    await manage();await fill('#moment-role-filter','all');await wait('document.querySelector("#view").dataset.route==="moments"&&!document.querySelector(".page-editor")');assert.equal((await visibleMomentIds()).length,6);await capture('feature043-perspective-all');
  }));

  await check('feature043 moment generation reports missing configuration and renders explicit local mock',async()=>fixtureCase('moment-generation',async original=>{
    const b=structuredClone(original);b.state.settings.providers.chat={...b.state.settings.providers.chat,mode:'custom',baseUrl:'',model:'',key:''};await restore(b);
    await manage();await click('#moment-generate');await wait('!!document.querySelector("select[name=roleId]")');const roleId=await evaluate('document.querySelector("select[name=roleId]").value');
    const count=await evaluate('Pipi.getState().moments.length');await click('.modal-submit');await wait('!!document.querySelector(".modal-error").textContent');assert.match(await evaluate('document.querySelector(".modal-error").textContent'),/配置|模型|地址|Key/i);assert.equal(await evaluate('Pipi.getState().moments.length'),count);await capture('feature043-generation-unconfigured');await close();
    await manage();await click('#moment-generate');let request;const unsubscribe=onCDP('Fetch.requestPaused',p=>{request=p;});await command('Fetch.enable',{patterns:[{urlPattern:'*/api/moments/generate',requestStage:'Request'}]});
    try{
      await click('.modal-submit');for(let i=0;i<80&&!request;i++)await delay(25);assert.ok(request,'UI must issue the generate request');assert.equal(JSON.parse(request.request.postData).roleId,roleId);
      const state=await evaluate('structuredClone(Pipi.getState())');state.moments.push({id:'fextra-generated-mock',authorId:roleId,content:'FEATURE043 EXPLICIT LOCAL MOCK RESPONSE',image:'',visibility:'all',likes:[],comments:[],createdAt:Date.now()});
      await fulfill(request.requestId,200,{state});await wait('!document.querySelector(".page-editor")&&Pipi.getState().moments.some(m=>m.id==="fextra-generated-mock")');
      await root('discover');await click('[data-action=moments]');await wait('!!document.querySelector("[data-moment-id=fextra-generated-mock]")');assert.ok(await evaluate('document.querySelector(".moment-list").textContent.includes("FEATURE043 EXPLICIT LOCAL MOCK RESPONSE")'));await capture('feature043-generation-mock-result');
      await manage();await click('#moment-generate');request=null;await click('.modal-submit');for(let i=0;i<80&&!request;i++)await delay(25);assert.ok(request,'second generation must reach the held local mock');
      await close();await root();await click('[data-nav=profile]');await click('[data-action=profile-name]');await fill('[name=name]','FEATURE043_UNSAVED_NAME_DRAFT');const newTitle=await evaluate('document.querySelector(".modal-header h3").textContent'),savedName=await evaluate('Pipi.getState().profile.name');
      const lateState=await evaluate('structuredClone(Pipi.getState())');lateState.moments.push({id:'fextra-generated-late',authorId:roleId,content:'FEATURE043 EXPLICIT LATE LOCAL MOCK',image:'',visibility:'all',likes:[],comments:[],createdAt:Date.now()});await fulfill(request.requestId,200,{state:lateState});await wait('Pipi.getState().moments.some(m=>m.id==="fextra-generated-late")');await delay(180);
      assert.equal(await route(),'profile');assert.equal(await evaluate('document.querySelector(".modal-header h3")?.textContent'),newTitle);assert.equal(await evaluate('document.querySelector(".page-editor [name=name]")?.value'),'FEATURE043_UNSAVED_NAME_DRAFT');assert.equal(await evaluate('Pipi.getState().profile.name'),savedName);await capture('feature043-generation-late-keeps-new-editor');await close();
      metrics.push({kind:'feature043-generation',unconfigured:'actual local backend rejection',success:'intercepted response only; no supplier call or persistence claim',roleId});
    }finally{await command('Fetch.disable');unsubscribe();}
  }));

  await check('feature043 cover chooser cancellation keeps prior photo and FileReader save survives reload',async()=>fixtureCase('moment-cover',async()=>{
    const file=path.join(out,'feature043-cover.png');
    const before=await evaluate('Pipi.getState().profile.cover');
    // Original synthetic color fixture, selected to differ from any prior cover.
    // The image still enters through the real chooser/FileReader/profile.save.
    const png=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=24;c.height=24;const x=c.getContext('2d');const draw=color=>{x.fillStyle=color;x.fillRect(0,0,24,24);x.fillStyle='#fff';x.fillRect(10,3,4,18);x.fillRect(3,10,18,4);return c.toDataURL('image/png');};const first=draw('#07c160');return first===${JSON.stringify(before)}?draw('#1485e5'):first;})()`);
    assert.notEqual(png,before,'new cover fixture must differ from the prior photo');await fs.writeFile(file,Buffer.from(png.split(',')[1],'base64'));
    let chooser;const unsubscribe=onCDP('Page.fileChooserOpened',p=>{chooser=p;});await command('Page.setInterceptFileChooserDialog',{enabled:true});
    const choose=async()=>{chooser=null;await click('#moment-change-cover');for(let i=0;i<80&&!chooser;i++)await delay(25);assert.ok(chooser?.backendNodeId,'real UI action must open the cover file chooser');return chooser.backendNodeId;};
    try{
      await manage();const cancelled=await choose();await command('DOM.setFileInputFiles',{files:[],backendNodeId:cancelled});await delay(180);assert.equal(await evaluate('Pipi.getState().profile.cover'),before);assert.ok(await evaluate('!!document.querySelector("#moment-change-cover")'));await capture('feature043-cover-cancel');
      const selected=await choose();await command('DOM.setFileInputFiles',{files:[file],backendNodeId:selected});await wait('Pipi.getState().profile.cover!=='+JSON.stringify(before));const saved=await evaluate('Pipi.getState().profile.cover');assert.match(saved,/^data:image\/png;base64,/);await close();assert.equal(await route(),'settings');
      await root('discover');await click('[data-action=moments]');await wait('!!document.querySelector(".moments-cover-photo img")');assert.equal(await evaluate('document.querySelector(".moments-cover-photo img").getAttribute("src")'),saved);await capture('feature043-cover-saved');
      await command('Page.reload');await wait('!!document.querySelector(".bottom-tabs")');assert.equal(await evaluate('Pipi.getState().profile.cover'),saved);await root('discover');await click('[data-action=moments]');assert.equal(await evaluate('document.querySelector(".moments-cover-photo img").getAttribute("src")'),saved);metrics.push({kind:'feature043-cover',cancel:'no state change',save:'actual FileReader and profile.save; survived reload'});
    }finally{await command('Page.setInterceptFileChooserDialog',{enabled:false});unsubscribe();}
  }));

  await check('feature043 discover contacts and add-friend placeholders give feedback without navigation',async()=>guarded('root-placeholders',async()=>{
    await root('discover');await actions(['coming-scan','coming-shake','coming-news','coming-search','coming-nearby','coming-shopping','coming-games','coming-mini'],'discover');await capture('feature043-discover-placeholders');
    await root('contacts');await actions(['coming-group','coming-official','coming-service-account'],'contacts');await click('[data-action=add-friend]');assert.equal(await route(),'add-friend');await actions(['coming-radar','coming-group','coming-scan','coming-phone-contacts','coming-official','coming-work-contacts','coming-profile-qr'],'add-friend');await capture('feature043-add-friend-placeholders');await back();assert.equal(await route(),'contacts');
  },()=>root()));

  await check('Me opens the skin picker and returns to Me',async()=>{
    await root();
    await click('[data-action=skins]');
    assert.equal(await route(),'skins');
    assert.equal(await evaluate('document.querySelector(".skin-picker input:checked").value'),await evaluate('document.documentElement.dataset.skin'));
    await back();
    assert.equal(await route(),'me');
  });

  await check('feature043 friend chat-info service and wallet placeholders preserve their return chain',async()=>guarded('nested-placeholders',async()=>{
    const id=await evaluate('Pipi.getState().roles[0].id');await root('contacts');await click('[data-nav=role][data-arg="'+id+'"]');await actions(['coming-permissions','coming-call'],'role');await click('[data-action=role-menu]');assert.equal(await route(),'contact-settings');await actions(['coming-contact-card','coming-block','coming-report'],'contact-settings');await capture('feature043-contact-settings-placeholders');await back();assert.equal(await route(),'role');await back();assert.equal(await route(),'contacts');
    await root('chats');await click('[data-open-chat="'+id+'"]');await click('[data-action=chat-details]');assert.equal(await route(),'chat-info');await actions(['coming-group','coming-strong-alert','coming-chat-background','coming-report'],'chat-info');await capture('feature043-chat-info-placeholders');await back();assert.equal(await route(),'chat');
    await root();await click('[data-action=services]');const serviceCount=await evaluate('(()=>{const a=[...document.querySelectorAll(".services-page [data-coming]")];a.forEach((e,i)=>e.dataset.fextraPending=i);return a.length;})()');assert.equal(serviceCount,6,'receive/pay plus five pending service entries');for(let i=0;i<serviceCount;i++)await placeholder('[data-fextra-pending="'+i+'"]','services');await capture('feature043-service-placeholders');
    await click('[data-feature-view=wallet]');assert.equal(await route(),'wallet');const walletCount=await evaluate('(()=>{const a=[...document.querySelectorAll(".wallet-index-page [data-coming]")];a.forEach((e,i)=>e.dataset.fextraPending=i);return a.length;})()');assert.equal(walletCount,3,'mini fund, bank cards and relative cards');for(let i=0;i<walletCount;i++)await placeholder('[data-fextra-pending="'+i+'"]','wallet');await capture('feature043-wallet-placeholders');await back();assert.equal(await route(),'services');await back();assert.equal(await route(),'me');
  },()=>root()));
  metrics.push({kind:'feature043-placeholder-clicks',entries:placeholderResults});
};
