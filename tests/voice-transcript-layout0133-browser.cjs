// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright'),S=require('../lib/state.cjs'),{createApp}=require('../server.cjs');
const out=path.resolve(process.env.PIPI_VALIDATION_DIR||path.join(__dirname,'../../.codex/validation/voice-transcript-layout')),results=[];
fs.mkdirSync(out,{recursive:true});
const wav=Buffer.alloc(364);wav.write('RIFF');wav.writeUInt32LE(356,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(320,40);
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE});try{
for(const width of [320,375,1280])for(const skin of ['classic','waterdrop']){
 const initial=S.initial();S.apply(initial,'role.save',{name:'语音布局隔离好友',momentsAutoEnabled:false});const role=initial.roles[0],cases=[];
 for(const sender of ['assistant','user'])for(const kind of ['short','long','request']){const meta={durationMs:3000,audio:'data:audio/wav;base64,'+wav.toString('base64')};if(kind!=='request')meta.transcript=kind==='short'?'好的。':'这是一段用于隔离布局检查的较长语音文字，展开后应在同一条语音下面自然换行，头像始终对齐语音气泡。LongWrappedWord'.repeat(5);const m=S.message(initial,role,sender,'语音','voice',{meta});m.status='sent';cases.push({id:m.id,sender,kind});}
 const app=createApp({host:'127.0.0.1',port:0,dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'pipi-voice-layout-')),initialState:()=>initial});await app.listen();
 const ctx=await browser.newContext({viewport:{width,height:950}}),p=await ctx.newPage(),errors=[];p.setDefaultTimeout(9000);p.on('pageerror',e=>errors.push(e.message));
 await ctx.route('**/*',r=>/^https?:/.test(r.request().url())&&new URL(r.request().url()).hostname!=='127.0.0.1'?r.abort():r.continue());
 const row=id=>p.locator('[data-message="'+id+'"]');
 const measure=id=>row(id).evaluate(el=>{const a=el.querySelector('.message-avatar').getBoundingClientRect(),b=el.querySelector('.message-bubble').getBoundingClientRect(),t=el.querySelector('.voice-transcript')?.getBoundingClientRect();return {avatarOffset:a.y-b.y,avatarHeight:a.height,bubbleHeight:b.height,bubbleWidth:b.width,avatarX:a.x,bubbleX:b.x,transcript:t?{top:t.y-b.bottom,left:t.x,right:t.right,height:t.height}:null};});
 const toggle=async(id,label)=>{await row(id).locator('[data-bubble]').scrollIntoViewIfNeeded();await row(id).locator('[data-bubble]').dispatchEvent('contextmenu');await p.getByRole('menuitem',{name:label,exact:true}).click();};
 const check=(before,after,label)=>{results.push({width,skin,label,before,after});assert.ok(Math.abs(after.avatarOffset-before.avatarOffset)<.1,'avatar moved: '+JSON.stringify({width,skin,label,before,after}));assert.equal(after.avatarX,before.avatarX);assert.equal(after.bubbleX,before.bubbleX);assert.equal(after.bubbleWidth,before.bubbleWidth);assert.equal(after.bubbleHeight,before.bubbleHeight);if(after.transcript)assert.ok(after.transcript.top>=4,'transcript must be under its own bubble');};
 try{
 await p.goto('http://127.0.0.1:'+app.server.address().port);await p.locator('[name=displayName]').fill('语音布局验收');await p.locator('[name=password]').fill('Voice-layout-test-0133!');await p.locator('[name=confirmPassword]').fill('Voice-layout-test-0133!');await p.locator('#auth-form [type=submit]').click();await p.locator('[data-open-chat]').click();await p.evaluate(s=>{document.documentElement.dataset.skin=s;PipiEngine.serviceReady=()=>true;},skin);
 await p.waitForFunction(()=>!document.querySelector('.navigation-snapshot'));await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(300);for(const item of cases){const before=await measure(item.id);assert.equal(before.avatarHeight,36);assert.equal(before.bubbleHeight,40);assert.equal(before.avatarOffset,2,'collapsed voice alignment must retain its original 2px offset');
 if(item.kind==='request'){
 let release;const blocked=new Promise(r=>release=r);await p.route('**/api/voice/transcribe',async r=>{await blocked;await r.fulfill({status:503,json:{error:'隔离识别失败，请重新尝试'}});});await toggle(item.id,'转文字');await row(item.id).locator('.transcript-progress').waitFor();check(before,await measure(item.id),item.sender+' loading');release();await row(item.id).locator('.transcript-error').waitFor();check(before,await measure(item.id),item.sender+' error');await p.unroute('**/api/voice/transcribe');
 }else{await toggle(item.id,'转文字');await row(item.id).locator('.transcript-text').waitFor();check(before,await measure(item.id),item.sender+' '+item.kind);if(item.kind==='long'){await row(item.id).locator('[data-bubble]').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,skin+'-'+width+'-'+item.sender+'-long.png')});}}
 await toggle(item.id,'收起文字');await row(item.id).locator('.voice-transcript').waitFor({state:'detached'});check(before,await measure(item.id),item.sender+' '+item.kind+' collapsed');
 }
 assert.deepEqual(errors,[]);console.log('PASS voice transcript layout',width,skin);
 }catch(error){await p.screenshot({path:path.join(out,'failure-'+skin+'-'+width+'.png')});throw error;}finally{await ctx.close();await app.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({method:'isolated source/data/Chrome; saved transcript via real context menu; loading/error use local intercepted response and isolated client readiness gate',results,errors},null,2));}
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
