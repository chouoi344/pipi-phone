// SPDX-License-Identifier: MIT
'use strict';
// Supplemental 0.4.3 acceptance: original 69 remain in headless-ui.cjs.
// This independent account executes only setup, new core/feature cases and guards.
// Zero-dependency acceptance harness. Launches a separate headless Chrome profile;
// never attaches to the user's browser and never uses the production data folder.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createHash} = require('node:crypto');
const {createApp} = require('../scripts/sample-data.cjs');
const delay = ms => new Promise(r => setTimeout(r, ms));
const deviceScaleFactor=Number(process.env.UI_DPR||3);
const widths = [[320,700],[375,812],[390,844],[430,932],[1440,1000]];
const out = process.env.UI_ARTIFACT_DIR || process.argv.find(a=>a.startsWith('--out='))?.slice(6) || path.join(os.tmpdir(), 'pipi-ui-v043-clear');
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const checks = [], failures = [], errors = [];
let app, chrome, ws, temp, serial = 0, session, browserVersion;
const sourceHashes = {};
const snapshotFiles=['server.cjs','lib/state.cjs','lib/providers.cjs','public/app.js','public/styles.css','public/status.css','public/features.js','public/features.css','public/index.html','public/emoji.js','public/vendor/fake-world/emoji-sprite.png','public/vendor/fake-world/selfie-expression.png','tests/native-scenarios.cjs','tests/ios8080-scenarios.cjs','tests/responsive-scenarios.cjs','tests/headless-ui.cjs','tests/deep043-scenarios.cjs','tests/frame043-scenarios.cjs','public/phone-frame.js','public/phone-frame.css'];
const metrics = [], fonts = [];
const pending = new Map();
const cdpListeners=new Map();
const onCDP=(method,listener)=>{if(!cdpListeners.has(method))cdpListeners.set(method,new Set());cdpListeners.get(method).add(listener);return()=>cdpListeners.get(method)?.delete(listener);};
function command(method, params = {}, target = session) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {pending.delete(id); reject(new Error('CDP timeout: '+method));}, 12000);
    pending.set(id, {resolve, reject, timer});
    ws.send(JSON.stringify({id, method, params, ...(target ? {sessionId:target} : {})}));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression, timeout = 10000) {
  const until = Date.now()+timeout;
  while (Date.now()<until) {if (await evaluate(expression)) return; await delay(60);}
  throw new Error('Wait failed: '+expression);
}
async function click(selector) {
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
  await wait(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';})()`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);await delay(240);
  const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!hit||!(hit===e||e.contains(hit)))throw Error('Control obscured: '+${JSON.stringify(selector)});return {x,y};})()`);
  await command('Input.dispatchMouseEvent', {type:'mousePressed',...p,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent', {type:'mouseReleased',...p,button:'left',clickCount:1});
}
async function fill(selector, value) {
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function capture(label) {
  await wait('!document.querySelector("#toast")?.classList.contains("visible")',4500);await delay(120);
  const {data} = await command('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
  await fs.writeFile(path.join(out,label+'.png'),Buffer.from(data,'base64'));
}
async function check(name, task) {
  const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7)||'race043,loaded static assets,no uncaught browser,tested source';if(only&&name!=='setup form creates isolated account'&&!only.split(',').some(term=>name.includes(term)))return;
  try {await task(); checks.push(name); console.log('PASS '+name);}
  catch(error) {failures.push({name,error:String(error.stack||error)}); console.log('FAIL '+name+': '+error.message);try{await capture('FAIL-'+failures.length);await fs.writeFile(path.join(out,'FAIL-'+failures.length+'.json'),JSON.stringify(await evaluate('({route:document.querySelector("#view").dataset.route,text:document.body.innerText,html:document.querySelector("#overlay").innerHTML})'),null,2));}catch{}} 
}
async function noOverflow(label) {
  const geometry = await evaluate(`(()=>{const s=document.querySelector('.phone-shell'),v=document.querySelector('#view');return {vw:innerWidth,doc:document.documentElement.scrollWidth,body:document.body.scrollWidth,shell:{width:s.clientWidth,scroll:s.scrollWidth},view:{width:v.clientWidth,scroll:v.scrollWidth}};})()`);
  assert.ok(geometry.doc<=geometry.vw+1 && geometry.body<=geometry.vw+1 && geometry.shell.scroll<=geometry.shell.width+1 && geometry.view.scroll<=geometry.view.width+1,label+': '+JSON.stringify(geometry));
}
(async()=>{
  snapshotFiles.push('tests/headless-ui-emoji-race043.cjs','tests/emoji-race043-scenarios.cjs','package.json','tests/headless-ui-extra043.cjs','tests/core043-extra-scenarios.cjs','tests/features043-extra-scenarios.cjs');
  for(const entry of await fs.readdir(path.join(__dirname,'../public/vendor/native-icons'),{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.svg'))snapshotFiles.push('public/vendor/native-icons/'+entry.name);
  for(const name of snapshotFiles)sourceHashes[name]=createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',name))).digest('hex');
  await fs.mkdir(out,{recursive:true}); temp=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-headless-'));
  app=createApp({dataDir:path.join(temp,'data'),host:'127.0.0.1',port:0});await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;
  chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0','--user-data-dir='+path.join(temp,'chrome'),'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--disable-gpu','about:blank'],{windowsHide:true,stdio:'ignore'});
  chrome.on('error',e=>errors.push('Chrome launch: '+e.message));
  let portFile;
  for(let i=0;i<120;i++){try{portFile=await fs.readFile(path.join(temp,'chrome','DevToolsActivePort'),'utf8');break;}catch{}await delay(100);}
  assert.ok(portFile,'Headless Chrome did not expose DevToolsActivePort');
  const [port,endpoint]=portFile.trim().split(/\r?\n/);
  ws=new WebSocket('ws://127.0.0.1:'+port+endpoint);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);if(p){pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(JSON.stringify(data.error))):p.resolve(data.result);}}else {if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);for(const listener of cdpListeners.get(data.method)||[])Promise.resolve(listener(data.params)).catch(e=>errors.push('CDP listener: '+e.message));}};
  const target=await command('Target.createTarget',{url:'about:blank'},null);
  browserVersion=await command('Browser.getVersion',{},null);
  session=(await command('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await command('Page.enable');await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor,mobile:true});
  await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await command('Page.navigate',{url:base});await wait('!!document.querySelector("#auth-form")');
  await capture('390-setup');
  await require('./native-scenarios.cjs')({assert,command,evaluate,wait,click,fill,capture,check,noOverflow,delay,metrics,widths,fonts,deviceScaleFactor});
  await require('./emoji-race043-scenarios.cjs')({assert,command,evaluate,wait,click,fill,capture,check,noOverflow,delay,metrics,widths,fonts,deviceScaleFactor,onCDP,out});
  await command('DOM.enable');await command('CSS.enable');const doc=await command('DOM.getDocument');for(const selector of ['.topbar h2','.conversation-name','.conversation-preview']){const {nodeId}=await command('DOM.querySelector',{nodeId:doc.root.nodeId,selector});if(!nodeId)continue;fonts.push({selector,...await command('CSS.getPlatformFontsForNode',{nodeId})});}
  await check('loaded static assets have no HTTP errors',async()=>{const failed=await evaluate('performance.getEntriesByType("resource").filter(r=>!new URL(r.name).pathname.startsWith("/api/")&&r.responseStatus>=400).map(r=>({url:r.name,status:r.responseStatus}))');assert.deepEqual(failed,[]);});
  await check('no uncaught browser exceptions',async()=>assert.deepEqual(errors,[]));
  await check('tested source files remain unchanged throughout execution',async()=>{for(const name of snapshotFiles)assert.equal(createHash('sha256').update(await fs.readFile(path.join(__dirname,'..',name))).digest('hex'),sourceHashes[name],name+' changed during verification');});
})().catch(error=>{failures.push({name:'harness',error:String(error.stack||error)});console.error(error);}).finally(async()=>{
  try{if(ws?.readyState===1)await command('Browser.close',{},null);}catch{}ws?.close();chrome?.kill();
  if(app)await app.close();
  await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'results.json'),JSON.stringify({date:new Date().toISOString(),deviceScaleFactor,browserVersion,sourceHashes,metrics,fonts,checks,failures,errors,screenshots:out},null,2));
  if(temp)await fs.rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:100}).catch(()=>{});
  console.log(JSON.stringify({passed:checks.length,failed:failures.length,artifacts:out}));process.exitCode=failures.length?1:0;
});
