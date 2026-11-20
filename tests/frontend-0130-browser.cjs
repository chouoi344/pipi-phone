// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
// Optional browser test. Standard application tests do not depend on Playwright.
const {chromium}=require(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright');
const S=require('../lib/state.cjs');
const {createApp}=require('../server.cjs');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=';
const out=path.resolve(__dirname,'../.codex/validation/frontend-0130');
const results=[];let browser;
async function scenario(width,height){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-frontend-0130-'));
 const initial=S.initial();S.apply(initial,'role.save',{name:'前端隔离好友',avatar:image,momentsAutoEnabled:false});const roleId=initial.roles[0].id;
 initial.settings.modules.scheduler={minIntervalHours:6};
 initial.moments=[{id:S.id(),authorId:'me',content:'用于删除评论的隔离动态',images:[image],visibility:'all',likes:[],comments:[{id:S.id(),authorId:'me',content:'待删除的隔离评论',createdAt:Date.now()}],createdAt:Date.now()}];
 for(let i=0;i<65;i++)S.message(initial,initial.roles[0],i%2?'user':'assistant','浏览器隔离记录 '+i,'text');
 const quote=S.message(initial,initial.roles[0],'assistant','用于引用的隔离原文','text');
 S.message(initial,initial.roles[0],'user',image,'image');
 initial.stickers=[{id:'test-sticker',name:'测试表情',image}];
 initial.favorites=[{id:'favorite-mixed',type:'text',content:'图文收藏测试',meta:{image},createdAt:Date.now()}];
 initial.wallet.transactions=[{id:'payment-pending',roleId,type:'transfer',direction:'in',status:'pending',amountCents:123,createdAt:Date.now(),note:'隔离待领取'}];
 const app=createApp({host:'127.0.0.1',port:0,dataDir:path.join(temp,'data'),initialState:()=>initial});await app.listen();
 const base='http://127.0.0.1:'+app.server.address().port;
 const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(req.url().includes('/api/state'))requests.push(req.url());});
 const check=async(name,fn)=>{await fn();results.push({width,name,passed:true});console.log('PASS '+width+' '+name);};
 try{
 await page.goto(base);await page.locator('[name=displayName]').fill('隔离测试');await page.locator('[name=password]').fill('Only-Isolated-0130');await page.locator('[name=confirmPassword]').fill('Only-Isolated-0130');await page.locator('#auth-form [type=submit]').click();await page.locator('#view[data-route=chats]').waitFor();
 await page.evaluate(id=>window.Pipi.showView('chat',id),roleId);await page.locator('#compose-text').waitFor();await page.waitForTimeout(300);
 if(process.env.PIPI_FRONTEND_VISUAL_ONLY==='1'){
 await page.evaluate(()=>window.PipiFeatures.walletBills());await page.waitForTimeout(450);await page.screenshot({path:path.join(out,'wallet-'+width+'.png')});await page.evaluate(()=>window.Pipi.closeModal());await page.waitForTimeout(200);
 await page.evaluate(id=>window.Pipi.showView('role-reminders',id),roleId);await page.locator('[data-reminder-action=create]').waitFor();await page.locator('[data-reminder-action=create]').click();await page.locator('[name=repeat][value=interval]').check();await page.waitForTimeout(450);await page.screenshot({path:path.join(out,'reminder-'+width+'.png')});await page.evaluate(()=>window.Pipi.closeModal());await page.waitForTimeout(200);
 await page.evaluate(()=>window.Pipi.showView('settings'));await page.waitForTimeout(350);for(const skin of ['classic','waterdrop']){await page.evaluate(skin=>document.documentElement.dataset.skin=skin,skin);await page.waitForTimeout(350);await page.screenshot({path:path.join(out,skin+'-'+width+'.png')});}
 assert.deepEqual(errors,[]);return;
 }
 await check('F1 avatars load after inserting short-key nodes',async()=>{await page.waitForFunction(()=>document.querySelectorAll('img[data-avatar-key][src]').length>10);assert.equal(await page.locator('img[data-avatar-key]:not([src])').count(),0);});
 await check('F2 live state preserves draft, caret and scroll',async()=>{
 await page.locator('#compose-text').fill('输入中草稿');
 await page.evaluate(()=>{const input=document.querySelector('#compose-text');input.focus();input.setSelectionRange(2,4);const list=document.querySelector('#chat-messages');list.scrollTop=120;window.__beforeTop=list.scrollTop;const next=structuredClone(window.Pipi.getState());next.revision++;next.messages.push({id:'new-live',roleId:next.roles[0].id,sender:'assistant',type:'text',content:'刷新后的新消息',status:'sent',createdAt:Date.now()});window.Pipi.receiveState(next);});
 await page.waitForFunction(()=>!!document.querySelector('[data-message="new-live"]'));const current=await page.evaluate(()=>({text:document.querySelector('#compose-text').value,start:document.querySelector('#compose-text').selectionStart,end:document.querySelector('#compose-text').selectionEnd,top:document.querySelector('#chat-messages').scrollTop,before:window.__beforeTop}));assert.equal(current.text,'输入中草稿');assert.equal(current.start,2);assert.equal(current.end,4);assert.ok(Math.abs(current.top-current.before)<3,JSON.stringify(current));
 });
 await check('F2 IME postpones rendering and then displays updates',async()=>{
 await page.evaluate(()=>{const input=document.querySelector('#compose-text');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));const next=structuredClone(window.Pipi.getState());next.revision++;next.messages.push({id:'ime-live',roleId:next.roles[0].id,sender:'assistant',type:'text',content:'输入法期间新消息',status:'sent',createdAt:Date.now()});window.Pipi.receiveState(next);});assert.equal(await page.locator('[data-message="ime-live"]').count(),0);await page.locator('#compose-text').dispatchEvent('compositionend');await page.locator('[data-message="ime-live"]').waitFor();assert.equal(await page.locator('#compose-text').evaluate(input=>input.value),'输入中草稿');
 });
 await check('F5 drafts and quotes survive browser refresh',async()=>{
 await page.locator('[data-bubble=\"'+quote.id+'\"]').dispatchEvent('contextmenu');await page.getByRole('menuitem',{name:'引用',exact:true}).click();await page.locator('.composer-quote').waitFor();
 await page.reload();await page.locator('#compose-text').waitFor();assert.equal(await page.locator('#compose-text').evaluate(input=>input.value),'输入中草稿');await page.locator('.composer-quote').waitFor();
 });
 await check('F7 stickers send separately while text and quote remain',async()=>{
 let payload;await page.route('**/api/chat',async route=>{payload=route.request().postDataJSON();const state=await page.evaluate(()=>window.Pipi.getState());state.revision++;await route.fulfill({json:{state}});});
 await page.locator('[data-action=toggle-emoji]').click();await page.locator('[data-emoji-tab=favorites]').click();await page.locator('[data-sticker="test-sticker"]').click();await page.waitForFunction(()=>document.querySelector('#compose-text').value==='输入中草稿');await page.waitForTimeout(80);assert.equal(payload.text,'');assert.equal(payload.stickerId,'test-sticker');assert.equal(await page.locator('#compose-text').evaluate(input=>input.value),'输入中草稿');await page.locator('.composer-quote').waitFor();await page.unroute('**/api/chat');
 });
 await check('F8 removed quote disappears on state update',async()=>{await page.evaluate(id=>{const next=structuredClone(window.Pipi.getState());next.revision++;next.messages=next.messages.filter(m=>m.id!==id);window.Pipi.receiveState(next);},quote.id);assert.equal(await page.locator('.composer-quote').count(),0);});
 await check('F9 image base64 does not match a chat text search',async()=>{await page.evaluate(id=>window.Pipi.showView('chat-search',id),roleId);await page.locator('#chat-search').fill('iVBOR');assert.equal(await page.locator('.search-result').count(),0);await page.locator('#chat-search').fill('图片');await page.waitForFunction(()=>document.querySelectorAll('.search-result').length===1);assert.equal(await page.locator('.search-result').count(),1);});
 await check('F10 a pending long press is canceled when leaving the page',async()=>{await page.evaluate(id=>window.Pipi.showView('chat',id),roleId);await page.locator('[data-bubble]').first().dispatchEvent('pointerdown',{button:0,clientX:70,clientY:120});await page.evaluate(()=>window.Pipi.showView('contacts'));await page.waitForTimeout(600);assert.equal(await page.locator('#overlay [role=menu]').count(),0);});
 await check('F11 refresh discards stale overlay history before the next Back',async()=>{
 await page.evaluate(id=>{window.Pipi.showView('chats');window.Pipi.showView('chat',id);window.Pipi.openModal('刷新历史验证','<p>隔离弹窗</p>');},roleId);await page.reload();await page.locator('#view[data-route=chat]').waitFor();await page.waitForTimeout(200);await page.locator('#view [data-action=back]').click();await page.locator('#view[data-route=chats]').waitFor();
 });
 await check('F14 and F15 use revision-aware state reads',async()=>{await page.waitForTimeout(6700);assert.ok(requests.some(url=>url.includes('/api/state?since=')));});
 await check('F18 deleting a comment keeps its parent Moment detail open',async()=>{
 await page.evaluate(()=>window.Pipi.showView('moments',{roleId:'me'}));await page.locator('[data-album-moment]').first().click();await page.locator('.moment-detail').waitFor();
 await page.route('**/api/action',async route=>{const body=route.request().postDataJSON();if(body.type!=='moment.comment.delete')return route.continue();const state=await page.evaluate(()=>window.Pipi.getState());state.revision++;state.moments.find(m=>m.id===body.payload.id).comments=[];await route.fulfill({json:{state}});});
 await page.locator('.moment-detail .moment-comment').click();await page.getByRole('button',{name:'删除',exact:true}).click();await page.locator('#alert-confirm').click();await page.locator('#overlay > .page-editor .moment-detail').waitFor();assert.equal(await page.locator('.moment-detail .moment-comment').count(),0);await page.unroute('**/api/action');await page.evaluate(()=>window.Pipi.closeModal());await page.waitForTimeout(150);
 });
 await check('F20 a retained payment detail does not replace a newer dialog',async()=>{
 await page.evaluate(()=>{window.PipiFeatures.walletTransaction('payment-pending',undefined,{fromChat:true});window.Pipi.confirmDialog('钱包上层验证','保持这个弹窗',()=>{});const next=structuredClone(window.Pipi.getState());next.revision++;next.wallet.transactions[0].note='后台已更新';window.Pipi.receiveState(next);});await page.waitForTimeout(1250);assert.equal(await page.locator('#alert-title').count(),1,'钱包后台刷新覆盖了上层弹窗');assert.equal(await page.locator('#alert-title').textContent(),'钱包上层验证');await page.locator('.alert-actions [data-close]').click();await page.locator('#overlay > .page-editor .wallet-transaction-detail').waitFor();await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>history.state.overlayDepth||1),1);await page.evaluate(()=>window.Pipi.closeModal());await page.waitForTimeout(150);
 });
 await check('F20 and F21 transaction details and bills follow new local status',async()=>{
 await page.evaluate(()=>window.PipiFeatures.walletTransaction('payment-pending',undefined,{fromChat:true}));await page.locator('.wallet-detail-status').waitFor();assert.match(await page.locator('.wallet-detail-status').textContent(),/待领取/);
 await page.evaluate(()=>{const next=structuredClone(window.Pipi.getState());next.revision++;next.wallet.transactions[0].status='returned';next.wallet.transactions[0].updatedAt=Date.now();window.Pipi.receiveState(next);});await page.waitForFunction(()=>document.querySelector('.wallet-detail-status')?.textContent==='已退还');
 await page.locator('#payment-detail-bill').click();await page.locator('.wallet-transaction-detail').waitFor();await page.evaluate(()=>window.Pipi.closeModal());await page.waitForTimeout(150);
 await page.evaluate(()=>window.PipiFeatures.walletBills());await page.locator('[data-wallet-transaction]').waitFor();assert.match(await page.locator('[data-wallet-transaction]').textContent(),/已退还/);assert.equal(await page.locator('[data-wallet-transaction] .income').count(),0);
 await page.screenshot({path:path.join(out,'wallet-'+width+'.png')});await page.evaluate(()=>window.Pipi.closeModal());await page.waitForTimeout(150);
 });
 await check('F22 text and picture appear together in favorites',async()=>{await page.evaluate(()=>window.Pipi.showView('favorites'));await page.locator('.favorite-card').waitFor();assert.match(await page.locator('.favorite-card').textContent(),/图文收藏测试/);await page.locator('.favorite-card .favorite-image').waitFor();});
 await check('F23 configured minimum is used by the reminder editor',async()=>{await page.evaluate(id=>window.Pipi.showView('role-reminders',id),roleId);await page.locator('[data-reminder-action=create]').waitFor();await page.locator('[data-reminder-action=create]').click();await page.locator('[name=repeat][value=interval]').check();assert.equal(await page.locator('[name=hours]').inputValue(),'6');assert.equal(await page.locator('[name=hours]').getAttribute('min'),'6');await page.screenshot({path:path.join(out,'reminder-'+width+'.png')});await page.evaluate(()=>window.Pipi.closeModal());await page.waitForTimeout(150);});
 await check('F3 deleting a friend redirects its active detail to contacts',async()=>{await page.evaluate(id=>window.Pipi.showView('role',id),roleId);await page.evaluate(()=>{const next=structuredClone(window.Pipi.getState());next.revision++;next.roles=[];window.Pipi.receiveState(next);});await page.locator('#view[data-route=contacts]').waitFor();});
 await check('Classic and waterdrop retain their controls without horizontal overflow',async()=>{await page.evaluate(()=>window.Pipi.showView('settings'));for(const skin of ['classic','waterdrop']){await page.evaluate(skin=>{document.documentElement.dataset.skin=skin;},skin);await page.waitForTimeout(80);const sizes=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));assert.ok(sizes.page<=sizes.viewport+1);await page.screenshot({path:path.join(out,skin+'-'+width+'.png')});}});
 assert.deepEqual(errors,[]);
 }finally{await context.close();await app.close();await fs.writeFile(path.join(out,process.env.PIPI_FRONTEND_VISUAL_ONLY==='1'?'visual-results.json':'results.json'),JSON.stringify({results,errors},null,2));}
}
(async()=>{await fs.mkdir(out,{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE});for(const [w,h]of [[390,844],[1280,900]])await scenario(w,h);console.log(JSON.stringify({passed:results.length,out}));})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();});
