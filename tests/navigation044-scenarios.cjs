// SPDX-License-Identifier: MIT
'use strict';
// Isolated headless acceptance only. All tested exits use actual pointer/key or
// browser-history input; reads of Pipi state are the no-accidental-save oracle.
module.exports = async function navigation044(t) {
  const {assert,command,evaluate,wait,click,fill,capture,check,metrics}=t;
  const key=async name=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name});await command('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name});};
  const state=()=>evaluate('JSON.stringify({wallet:Pipi.getState().wallet,messages:Pipi.getState().messages,moments:Pipi.getState().moments,ledger:Pipi.getState().ledger})');
  const pageBack=async()=>{
    const {mode,label,text,width,height}=await evaluate(`(()=>{const p=document.querySelector('.page-editor'),b=p.querySelector('.modal-close'),r=b.getBoundingClientRect();return {mode:p.dataset.navigation,label:b.getAttribute('aria-label'),text:b.textContent.trim(),width:r.width,height:r.height};})()`);
    assert.deepEqual({mode,label,text},{mode:'back',label:'返回',text:''});
    assert.ok(width>=39.5&&height>=43.5,'back control remains usable');
  };
  const chat=async()=>{
    await evaluate("Pipi.showView('chats')");await wait('!!document.querySelector(".bottom-tabs") && !document.querySelector(".page-editor")');
    await click('[data-open-chat]');await wait('!!document.querySelector("#compose-text")');
  };
  const openPayment=async type=>{
    if(!await evaluate('!!document.querySelector("[data-action=chat-'+type+']")'))await click('[data-action=toggle-panel]');
    await click('[data-action=chat-'+type+']');await wait('!!document.querySelector(".wallet-pay-page")');await pageBack();
  };
  await check('navigation044 payment back arrow Escape and browser back retain the chat draft without sending',async()=>{
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:t.deviceScaleFactor,mobile:true});
    const before=await state();
    for(const type of ['redpacket','transfer'])for(const exit of ['arrow','Escape','history']){
      await chat();await fill('#compose-text','');await click('[data-action=toggle-panel]');
      const draft='NAV044 '+type+' '+exit+' draft';await fill('#compose-text',draft);await openPayment(type);await fill('[name=amount]','2.34');
      if(type==='redpacket')await fill('[name=note]','NAV044 unsent blessing');
      await capture('navigation044-'+type+'-'+exit);
      if(exit==='arrow')await click('.modal-back');else if(exit==='Escape')await key('Escape');else await evaluate('history.back()');
      await wait('document.querySelector("#view").dataset.route==="chat" && !document.querySelector(".page-editor")');
      assert.equal(await evaluate('document.querySelector("#compose-text").value'),draft);assert.equal(await state(),before);
    }
    await fill('#compose-text','');metrics.push({kind:'navigation044-payment-exits',types:2,exitModes:3,chatDraft:'retained',walletMessages:'unchanged'});
  });
  await check('navigation044 wallet recipient and detail back controls follow the original parent chain',async()=>{
    const before=await state();
    for(const type of ['redpacket','transfer'])for(const exit of ['arrow','Escape','history']){
      await evaluate("Pipi.showView('wallet')");await wait('!!document.querySelector("#wallet-balance") && !document.querySelector(".page-editor")');await click('#wallet-balance');await pageBack();
      await click('#wallet-'+type);await wait('!!document.querySelector(".wallet-recipients")');await pageBack();await click('.wallet-recipient');await wait('!!document.querySelector(".wallet-pay-page")');await pageBack();await fill('[name=amount]','1.23');
      if(exit==='arrow')await click('.modal-back');else if(exit==='Escape')await key('Escape');else await evaluate('history.back()');
      await wait('!!document.querySelector(".wallet-recipients")');await pageBack();
      if(exit==='arrow')await click('.modal-back');else if(exit==='Escape')await key('Escape');else await evaluate('history.back()');
      await wait('!!document.querySelector(".wallet-balance-page")');await pageBack();
      await click('#wallet-details');await wait('!!document.querySelector(".wallet-bills-page")');await pageBack();await key('Escape');await wait('!!document.querySelector(".wallet-balance-page")');
      await click('.modal-back');await wait('!document.querySelector(".page-editor")');assert.ok(await evaluate('!!document.querySelector("#wallet-balance")'));assert.equal(await state(),before);
    }
    metrics.push({kind:'navigation044-wallet-chain',types:2,path:'payment > recipient > balance; bills > balance > wallet',exitModes:['arrow','history','Escape']});
  });
  await check('navigation044 transfer-note Cancel and Escape stay inside the payment page and preserve confirmed data',async()=>{
    await chat();await openPayment('transfer');const before=await state();await fill('[name=amount]','3.21');
    await click('#transfer-note-editor');await fill('#transfer-note-draft','NAV044 confirmed note');await click('#transfer-note-save');
    for(const exit of ['cancel','Escape']){
      await click('#transfer-note-editor');await fill('#transfer-note-draft','NAV044 discarded '+exit);
      if(exit==='cancel')await click('[data-note-cancel]');else await key('Escape');
      await wait('!document.querySelector(".transfer-note-dialog").open');await pageBack();
      assert.equal(await evaluate('document.querySelector("[name=note]").value'),'NAV044 confirmed note');assert.equal(await evaluate('document.querySelector("[name=amount]").value'),'3.21');assert.equal(await state(),before);
    }
    await capture('navigation044-note-cancel-preserves-page');await click('.modal-back');await wait('document.querySelector("#view").dataset.route==="chat"');
  });
  await check('navigation044 transfer-note browser Back dismisses only the note and retains the payment draft',async()=>{
    await chat();await openPayment('transfer');const before=await state();await fill('[name=amount]','4.56');
    await click('#transfer-note-editor');await fill('#transfer-note-draft','NAV044 history confirmed');await click('#transfer-note-save');
    await click('#transfer-note-editor');await fill('#transfer-note-draft','NAV044 history discarded');
    await evaluate('history.back()');
    await wait('!!document.querySelector(".wallet-pay-page") && !document.querySelector(".transfer-note-dialog").open');
    await pageBack();assert.equal(await evaluate('document.querySelector("[name=amount]").value'),'4.56');
    assert.equal(await evaluate('document.querySelector("[name=note]").value'),'NAV044 history confirmed');assert.equal(await state(),before);
    await capture('navigation044-note-history-preserves-page');
    await click('.modal-back');await wait('document.querySelector("#view").dataset.route==="chat" && !document.querySelector(".page-editor")');
  });
  await check('navigation044 composition and management child keyboard and browser cancellation preserve their parents',async()=>{
    for(const exit of ['Escape','history']){
      await evaluate("Pipi.showView('moments')");await wait('!!document.querySelector("[data-action=compose-moment]")');const before=await state();
      await click('[data-action=compose-moment]');await fill('[name=content]','NAV044 unsaved '+exit);
      await evaluate('globalThis.nav044Form=document.querySelector(".modal-form");Pipi.confirmDialog("NAV044 nested history","Test-only confirmation",()=>{throw Error("must never confirm")})');
      if(exit==='Escape')await key('Escape');else await evaluate('history.back()');
      await wait('!!document.querySelector(".moment-compose") && !document.querySelector(".alert-dialog")');
      assert.equal(await evaluate('nav044Form===document.querySelector(".modal-form")'),true);
      assert.equal(await evaluate('document.querySelector("[name=content]").value'),'NAV044 unsaved '+exit);
      if(exit==='Escape')await key('Escape');else await evaluate('history.back()');
      await wait('!document.querySelector(".page-editor")');assert.equal(await state(),before);
      await evaluate('PipiFeatures.manageMoments()');await pageBack();await click('#moment-generate');
      assert.equal(await evaluate('document.querySelector(".page-editor").dataset.navigation'),'cancel');
      if(exit==='Escape')await key('Escape');else await evaluate('history.back()');
      await wait('!!document.querySelector(".moment-management")');await pageBack();assert.equal(await state(),before);
      await click('.modal-back');await wait('!document.querySelector(".page-editor")');
    }
  });
  await check('navigation044 nested menus and photo layers cancel back to the exact composition draft',async()=>{
    await evaluate("Pipi.showView('moments')");await wait('!!document.querySelector("[data-action=compose-moment]")');const before=await state();
    await click('[data-action=compose-moment]');await fill('[name=content]','NAV044 overlay draft');
    await evaluate('globalThis.nav044Form=document.querySelector(".modal-form")');
    for(const layer of ['menu','photo'])for(const exit of ['button','Escape','history']){
      if(layer==='menu')await evaluate('Pipi.actionSheet("NAV044",[{label:"Do not execute",run:()=>{throw Error("must never execute")}}])');
      else await evaluate('Pipi.openPhoto("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","NAV044 test pixel")');
      if(exit==='button')await click(layer==='menu'?'.sheet-actions [data-close]':'.lightbox button');else if(exit==='Escape')await key('Escape');else await evaluate('history.back()');
      await wait('!!document.querySelector(".moment-compose") && !document.querySelector(".sheet-actions,.lightbox")');
      assert.equal(await evaluate('nav044Form===document.querySelector(".modal-form")'),true);
      assert.equal(await evaluate('document.querySelector("[name=content]").value'),'NAV044 overlay draft');assert.equal(await state(),before);
    }
    await click('.modal-close');await wait('!document.querySelector(".page-editor")');
  });
  await check('navigation044 composition Cancel remains explicit and nested confirmation restores its exact draft',async()=>{
    await evaluate("Pipi.showView('moments')");await wait('!!document.querySelector("[data-action=compose-moment]")');const before=await state();await click('[data-action=compose-moment]');
    assert.equal(await evaluate('document.querySelector(".modal-close").textContent'),'取消');assert.equal(await evaluate('document.querySelector(".page-editor").dataset.navigation'),'cancel');await fill('[name=content]','NAV044 unsaved moment');
    await evaluate('globalThis.nav044Form=document.querySelector(".modal-form");Pipi.confirmDialog("NAV044 cancel test","Test-only confirmation",()=>{throw Error("must never confirm")})');
    await click('.alert-dialog [data-close]');await wait('!!document.querySelector(".moment-compose")');assert.equal(await evaluate('nav044Form===document.querySelector(".modal-form")'),true);assert.equal(await evaluate('document.querySelector("[name=content]").value'),'NAV044 unsaved moment');
    await capture('navigation044-compose-retains-cancel');await click('.modal-close');await wait('!document.querySelector(".page-editor")');assert.equal(await state(),before);
    await evaluate('PipiFeatures.manageMoments()');await pageBack();await click('#moment-generate');
    assert.equal(await evaluate('document.querySelector(".modal-close").textContent'),'取消');await click('.modal-close');await wait('!!document.querySelector(".moment-management")');await pageBack();
    await click('.modal-back');await wait('!document.querySelector(".page-editor")');
    await evaluate("Pipi.showView('ledger')");await wait('!!document.querySelector("#ledger-add")');await click('#ledger-add');assert.equal(await evaluate('document.querySelector(".modal-close").textContent'),'取消');await fill('[name=amount]','9.87');await click('.modal-close');await wait('!document.querySelector(".page-editor")');assert.equal(await state(),before);
    metrics.push({kind:'navigation044-cancel-semantics',forms:['moment','ledger'],nestedCancel:'same DOM and unsaved draft restored',management:'Back'});
  });
};
