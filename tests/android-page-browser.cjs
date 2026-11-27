// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright');
const {createApp}=require('../server.cjs'),State=require('../lib/state.cjs');
const output=path.resolve(process.env.PIPI_ANDROID_PAGE_OUTPUT||path.join(__dirname,'../test-results/android-page')),password='Isolated-Android-Page-Only';
async function run(browser,width,deep){
  const dataDir=await fs.mkdtemp(path.join(output,'data-')),initial=State.initial();
  for(let i=0;i<28;i++)State.apply(initial,'role.save',{name:'隔离好友'+String(i+1).padStart(2,'0')});
  for(const friend of initial.roles)for(let i=0;i<132;i++)State.message(initial,friend,'assistant',`隔离文字 ${i+1}，用于检查重启后的阅读位置。`,'text');
  initial.settings.modules.outreach={quietHoursEnabled:false};
  const app=createApp({dataDir,host:'127.0.0.1',port:0,initialState:()=>initial,mediaTimers:false,providerUrlAllowlist:[]});await app.listen();
  const origin='http://127.0.0.1:'+app.server.address().port,errors=[];
  const options={viewport:{width,height:844},userAgent:'Mozilla/5.0 Chrome/140.0 PipiPhoneAndroid/1.0',reducedMotion:'reduce'};
  let context=await browser.newContext(options),page=await context.newPage();
  const watch=page=>page.on('pageerror',error=>errors.push(error.message));watch(page);
  try{
    await page.goto(origin);await page.locator('#dismiss-notice').click();await page.locator('.first-notice').waitFor({state:'detached'});
    await page.locator('[name=displayName]').fill('Android隔离验收');await page.locator('[name=password]').fill(password);await page.locator('[name=confirmPassword]').fill(password);await page.locator('#auth-form [type=submit]').click();await page.locator('#view[data-route=chats]').waitFor();
    await page.evaluate(()=>{document.documentElement.style.setProperty('--pipi-system-top','24px');document.documentElement.style.setProperty('--pipi-system-bottom','18px');PipiPhoneFrame.refresh();});
    assert.equal(await page.locator('.phone-shell').evaluate(node=>getComputedStyle(node).getPropertyValue('--safe-top').trim()),'24px');
    const content=page.locator('#view>.content');await content.evaluate(node=>node.scrollTop=610);
    const target=await page.locator('[data-open-chat]').evaluateAll(nodes=>{const node=nodes.find(node=>{const box=node.getBoundingClientRect();return box.top>160&&box.bottom<700;});return node.dataset.openChat;});
    const listTop=await content.evaluate(node=>node.scrollTop);await page.locator(`[data-open-chat="${target}"]`).click();await page.locator('#chat-messages[data-scroll-ready=true]').waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('#chat-messages [data-message]').length===60);
    if(deep){await page.locator('[data-chat-older]').click();await page.waitForFunction(()=>document.querySelectorAll('#chat-messages [data-message]').length===120);}
    await page.locator('#compose-text').fill('重启后保留的文字草稿');
    await page.locator('#chat-messages').evaluate(node=>node.scrollTop=1140);
    const reading=await page.locator('#chat-messages').evaluate(node=>{const top=node.getBoundingClientRect().top,row=[...node.querySelectorAll('[data-message]')].find(row=>row.getBoundingClientRect().bottom>top);return {id:row.dataset.message,offset:row.getBoundingClientRect().top-top,top:node.scrollTop};});
    if(deep)assert.ok(initial.messages.filter(message=>message.roleId===target).slice(0,-60).some(message=>message.id===reading.id),'the checkpoint must be outside the newest page');
    await page.evaluate(()=>PipiAndroidPage.checkpoint());
    assert.equal(await page.evaluate(()=>PipiAndroidPage.back('start',0,'left')),true);await page.evaluate(()=>PipiAndroidPage.back('progress',.45,'left'));assert.equal(await page.locator('.android-back-preview').count(),1);
    await page.screenshot({path:path.join(output,`gesture-${width}-${deep?'history':'recent'}.png`)});await page.evaluate(()=>PipiAndroidPage.back('cancel'));assert.equal(await page.locator('#compose-text').innerText(),'重启后保留的文字草稿');assert.equal(await page.locator('#chat-messages').evaluate(node=>node.scrollTop),reading.top);
    await page.evaluate(()=>PipiAndroidPage.back('commit'));await page.locator('#view[data-route=chats]').waitFor();assert.ok(Math.abs(await content.evaluate(node=>node.scrollTop)-listTop)<=2,'gesture returns to the original list position');
    await page.locator(`[data-open-chat="${target}"]`).click();await page.locator('#chat-messages[data-scroll-ready=true]').waitFor();await page.evaluate(()=>PipiAndroidPage.checkpoint());
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pipi.android-page.v1')));assert.equal(stored.drafts.find(draft=>draft.roleId===target).text,'重启后保留的文字草稿');assert.equal(stored.chats.find(chat=>chat.roleId===target).anchor,reading.id);
    const state=await context.storageState();await context.close();
    context=await browser.newContext({...options,storageState:state});page=await context.newPage();watch(page);await page.goto(origin);await page.locator('#chat-messages[data-scroll-ready=true]').waitFor();
    assert.equal(await page.locator('#view').getAttribute('data-chat-role'),target);assert.equal(await page.locator('#compose-text').innerText(),'重启后保留的文字草稿');
    await page.waitForFunction(id=>document.querySelector('[data-message="'+CSS.escape(id)+'"]')&&document.querySelector('#chat-messages')?.dataset.scrollReady==='true',reading.id);
    const offset=await page.locator(`[data-message="${reading.id}"]`).evaluate(node=>node.getBoundingClientRect().top-node.closest('#chat-messages').getBoundingClientRect().top);assert.ok(Math.abs(offset-reading.offset)<=3,'cold recreation restores the visible message anchor');
    await page.screenshot({path:path.join(output,`restored-${width}-${deep?'history':'recent'}.png`)});
    await page.evaluate(()=>PipiAndroidPage.back('commit'));await page.locator('#view[data-route=chats]').waitFor();assert.ok(Math.abs(await page.locator('#view>.content').evaluate(node=>node.scrollTop)-listTop)<=2,'cold restoration reconstructs a working Back entry');
    await page.locator(`[data-open-chat="${target}"]`).click();await page.locator('#chat-messages[data-scroll-ready=true]').waitFor();
    const other=initial.roles.find(role=>role.id!==target).id;
    await page.evaluate(roleId=>{const previous=Pipi.getState(),next=structuredClone(previous);next.revision++;next.roles.find(role=>role.id===roleId).unread++;next.messages.push({id:'android-browser-notice',roleId,sender:'assistant',status:'sent',type:'text',content:'隔离测试的新消息',createdAt:Date.now()});Pipi.receiveState(next);},other);
    await page.locator('.android-chat-notice').waitFor();await page.screenshot({path:path.join(output,`notification-${width}-${deep?'history':'recent'}.png`)});await page.locator('.android-chat-notice').click();await page.locator(`#view[data-chat-role="${other}"]`).waitFor();assert.equal(await page.locator('.android-chat-notice').count(),0);
    await page.evaluate(()=>{Pipi.showView('settings');});assert.equal(await page.getByRole('button',{name:'App 连接设置',exact:true}).count(),1);
    await page.evaluate(()=>Pipi.showView('chat',Pipi.getState().roles[0].id));await page.locator('#chat-messages[data-scroll-ready=true]').waitFor();await page.locator('#compose-text').fill('离线仍保留的草稿');await page.evaluate(()=>PipiAndroidPage.checkpoint());
    const offlineState=await context.storageState();await context.close();context=await browser.newContext({...options,storageState:offlineState});page=await context.newPage();watch(page);await page.route('**/api/**',route=>route.abort('internetdisconnected'));await page.goto(origin);await page.getByRole('heading',{name:'离线聊天'}).waitFor();await page.locator('.android-offline-chat').first().click();assert.equal(await page.getByRole('textbox',{name:'尚未发送的文字草稿'}).isEditable(),true);await page.screenshot({path:path.join(output,`offline-${width}-${deep?'history':'recent'}.png`)});
    await page.unroute('**/api/**');await page.getByRole('button',{name:'重新连接',exact:true}).click();await page.locator('#chat-messages[data-scroll-ready=true]').waitFor();assert.equal(await page.locator('#compose-text').innerText(),'离线仍保留的草稿');
    await context.clearCookies();await page.evaluate(()=>Pipi.api('/api/state').catch(()=>{}));await page.locator('#auth-form').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('pipi.android-page.v1')),null);
    assert.deepEqual(errors,[]);return {width,deep,offsetBefore:reading.offset,offsetAfter:offset,gestureCancel:true,listPosition:true,coldDraft:true,coldAnchor:true,foregroundNotice:true,offlineDraft:true,unauthorizedCleanup:true,errors,dataDir};
  }finally{await context.close();await app.close();}
}
async function main(){await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,channel:'chrome'});try{const results=[];for(const width of [390,1280])for(const deep of [false,true])results.push(await run(browser,width,deep));await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS Android page browser',JSON.stringify(results));}finally{await browser.close();}}
if(process.argv.includes('--check-tools'))console.log('PASS Android page browser entry',JSON.stringify({output,chromiumAvailable:typeof chromium.launch==='function'}));
else main().catch(error=>{console.error(error);process.exitCode=1;});
