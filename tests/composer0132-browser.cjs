// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Optional real Chromium geometry/Selection check; no application data is used.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const css=[...index.matchAll(/href="\/([^"?]+\.css)[^"]*"/g)].map(m=>fs.readFileSync(path.join(root,'public',m[1]),'utf8')).join('\n');
const functions=source.slice(source.indexOf('  function richText('),source.indexOf('  function rememberComposerEdit('));
const resize=source.slice(source.indexOf('  function resizeComposeInput('),source.indexOf('  let stopComposerDeleteHold='));
const deleteText=source.slice(source.indexOf('  function deleteComposerText('),source.indexOf('  function scrollChat('));
const hold=source.slice(source.indexOf('    const removeEmoji=view.querySelector'),source.indexOf('    const emojiScroll=view.querySelector',source.indexOf('    const removeEmoji=view.querySelector')));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PIPI_BROWSER_EXECUTABLE||undefined,headless:true});
 try{for(const width of [390,1280])for(const skin of ['classic','waterdrop']){
  const page=await browser.newPage({viewport:{width,height:844}});
  await page.setContent(`<html data-skin="${skin}"><style>${css}</style><body class="wechat-classic"><div class="phone-shell"><div id="view" class="view" data-route="chat"><div class="chat-composer"><div class="compose-row classic-compose-row"><div class="compose-field"><div id="compose-text" class="compose-input" contenteditable="true"></div><button class="classic-inline-more">＋</button></div></div></div></div></div></body></html>`);
  await page.addScriptTag({content:`let composeText='',composerSelection={start:0,end:0};const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;'),compiledEmoji=()=>({map:new Map([['[笑]',{}]]),expression:/(\\[笑\\])/g}),emojiSprite=()=>'<span class="wechat-emoji inline-emoji"></span>',captureChatLayout=()=>null,restoreChatLayout=()=>{};${functions}\n${resize}\nwindow.editTest={composerDOM,setComposerSelection,readComposerSelection,richText,resizeComposeInput};`});
  const result=await page.evaluate(()=>{
   const input=document.querySelector('#compose-text'),button=document.querySelector('.classic-inline-more'),t=window.editTest,checks=[];input.focus();
   for(const value of ['[笑]'.repeat(6),'[笑]'.repeat(80),'中文长文'.repeat(100),'第一行\n第二行[笑]']){
    input.innerHTML=t.richText(value,true);t.setComposerSelection(input,value.length);t.resizeComposeInput(input);
    const caret=getSelection().getRangeAt(0).getBoundingClientRect(),box=input.getBoundingClientRect(),more=button.getBoundingClientRect();
    checks.push({text:t.composerDOM(input).text===value,selection:t.readComposerSelection(input).start===value.length,inside:caret.height>0&&caret.top>=box.top-1&&caret.bottom<=box.bottom+1,separate:box.right<=more.left+1,height:box.height});
    for(const position of [0,Math.floor(value.length/2),value.length]){t.setComposerSelection(input,position);const actual=t.readComposerSelection(input).start;if(actual!==position&&!value.includes('[笑]'))throw Error('text selection moved');}
   }
   return checks;
  });
  for(const check of result){assert.equal(check.text,true);assert.equal(check.selection,true);assert.equal(check.inside,true,JSON.stringify({width,skin,check}));assert.equal(check.separate,true);assert.ok(check.height<=112);}
  console.log('PASS composer geometry/selection',width,skin);
  await page.evaluate(()=>{const b=document.createElement('button');b.dataset.action='emoji-delete';b.textContent='删除';document.body.append(b);});
  await page.addScriptTag({content:`const view=document,input=document.querySelector('#compose-text');let route={},panel='emoji',stopComposerDeleteHold=()=>{},composeComposing=false,sending=false;const emojiEntries=()=>[{token:'[笑]'}],rememberComposerEdit=()=>{},syncComposerDraft=()=>{paintComposer(input);setComposerSelection(input,composerSelection.start);resizeComposeInput(input);};${deleteText}\n${hold}\nwindow.holdTest={reset:()=>{composeText='[笑]'.repeat(30);composerSelection={start:composeText.length,end:composeText.length};syncComposerDraft();},read:()=>composeText};`});
  const remove=page.locator('[data-action=emoji-delete]');
  await page.evaluate(()=>holdTest.reset());await remove.click();assert.equal((await page.evaluate(()=>holdTest.read())).length,29*3,'short click deletes once');
  await page.evaluate(()=>holdTest.reset());await remove.hover();await page.mouse.down();await page.waitForTimeout(660);await page.mouse.up();
  const released=await page.evaluate(()=>holdTest.read());assert.ok(released.length<29*3&&released.length>0,'hold deletes repeatedly, not all');await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>holdTest.read()),released,'release stops');
  await page.evaluate(()=>holdTest.reset());await remove.hover();await page.mouse.down();await page.mouse.move(0,0);await page.waitForTimeout(600);await page.mouse.up();assert.equal((await page.evaluate(()=>holdTest.read())).length,29*3,'leaving stops repeat');
  await page.evaluate(()=>holdTest.reset());await remove.dispatchEvent('pointerdown',{button:0});await remove.dispatchEvent('pointercancel');await page.waitForTimeout(500);assert.equal((await page.evaluate(()=>holdTest.read())).length,29*3,'cancel stops repeat');
  console.log('PASS short/held/released/leave/cancel delete',width,skin);await page.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
