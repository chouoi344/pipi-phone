// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createApp}=require('../server.cjs');
const uiSource=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');

function configuredApp(sourceUrl,dataDir){
  const previous=process.env.SOURCE_URL;
  if(sourceUrl===undefined)delete process.env.SOURCE_URL;else process.env.SOURCE_URL=sourceUrl;
  try{return createApp({dataDir,host:'127.0.0.1',port:0});}
  finally{if(previous===undefined)delete process.env.SOURCE_URL;else process.env.SOURCE_URL=previous;}
}
async function fixture(t,sourceUrl){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-source-url-'));
  const app=configuredApp(sourceUrl,path.join(dir,'data'));
  t.after(async()=>{
    await app.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('pipi-source-url-'));
    fs.rmSync(dir,{recursive:true,force:true});
  });
  await app.listen();
  const base='http://127.0.0.1:'+app.server.address().port;
  return {app,base,status:async()=>{
    const response=await fetch(base+'/api/status');
    assert.equal(response.status,200);
    return response.json();
  }};
}
function productFunction(name){
  const start=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(uiSource);
  assert.ok(start,name);
  const from=start.index,end=uiSource.indexOf('\n  }',from);
  assert.ok(end>from,name+' boundary');
  return uiSource.slice(from,end+4);
}
async function renderFromStatus(status){
  const calls=[],scope=vm.createContext({status,calls});
  vm.runInContext(`let sourceUrl='',state=null,binaryMedia=false,imageVariants=false,storageMaintenance=false,streamingBackup=false,accountSecurity=false,setupTokenRequired=false,momentExclusions=false,rolePanelAvailable=false;
    const window={PipiSkins:{configure(){}},PipiHistorySearch:{configure(){}}};async function restoreBrowserPage(){}
    const icons={chat:'',chevron:''};
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function header(){return '';}
    async function api(route){calls.push(route);return route==='/api/status'?status:{revision:0};}
    function setState(next){state=next;}function refresh(){}function renderAuth(setup,error){if(error)throw new Error(error);}
    ${productFunction('configureMediaLimits')}
    ${productFunction('renderAbout')}
    ${productFunction('boot')}
    globalThis.ui={boot,renderAbout};`,scope);
  await scope.ui.boot();
  return {html:scope.ui.renderAbout(),calls};
}

test('source URL: deployment metadata reaches the About link across setup and authenticated reload, without entering stored state or backup',async t=>{
  const source='https://github.com/example/pipi-phone/tree/deployed?tab=readme&x="<tag>"';
  const f=await fixture(t,source),status=await f.status(),expected=new URL(source).href;
  assert.equal(status.setupRequired,true);assert.equal(status.authenticated,false);
  assert.equal(status.sourceUrl,expected);
  const rendered=await renderFromStatus(status);
  assert.deepEqual(rendered.calls,['/api/status']);
  assert.ok(rendered.html.includes('href="'+expected.replaceAll('&','&amp;')+'"'));
  assert.match(rendered.html,/<a class="cell plain-cell"[^>]+target="_blank" rel="noopener noreferrer"/);
  assert.match(rendered.html,/源代码/);assert.doesNotMatch(rendered.html,/随安装包提供/);
  const aboutText=rendered.html.replace(/<[^>]+>/g,'');
  assert.match(aboutText,/整体采用 AGPL-3\.0-only 许可证发布/);
  assert.match(aboutText,/LiangNiang\/fake-world GPL-3\.0-only/);
  assert.ok(rendered.html.includes('v'+require('../package.json').version));
  const setup=await fetch(f.base+'/api/setup',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify({password:'Source-url-isolated-test_2026!',displayName:'Source URL QA'})});
  assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie').split(';')[0];
  const authenticated=await (await fetch(f.base+'/api/status',{headers:{Cookie:cookie}})).json();
  const reloaded=await renderFromStatus(authenticated);
  assert.deepEqual(reloaded.calls,['/api/status','/api/state']);
  assert.ok(reloaded.html.includes('href="'+expected.replaceAll('&','&amp;')+'"'));
  const backupResponse=await fetch(f.base+'/api/backup',{headers:{Cookie:cookie}});
  assert.equal(backupResponse.status,200);
  const backup=await backupResponse.json(),stored=f.app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  assert.equal('sourceUrl' in backup.state,false);
  for(const serialized of [JSON.stringify(backup),stored])assert.ok(!serialized.includes('github.com/example/pipi-phone'));
  assert.equal(typeof status.setupTokenRequired,'boolean');
  assert.equal(Object.hasOwn(status,'setupToken'),false);assert.equal(Object.hasOwn(status,'token'),false);
  assert.doesNotMatch(JSON.stringify(status),/Source-url-isolated-test_2026|"setupToken"\s*:|password|apiKey/);
});

test('source URL: missing configuration shows installation-package wording and no inactive link',async t=>{
  const f=await fixture(t),status=await f.status();
  assert.equal(status.sourceUrl,'');
  const {html}=await renderFromStatus(status);
  assert.match(html,/源代码/);assert.match(html,/随安装包提供/);assert.doesNotMatch(html,/<a\b/);
});

test('source URL: ordinary HTTP links are accepted and normalized once at startup',async t=>{
  const f=await fixture(t,'  http://localhost:18766/source  ');
  assert.equal((await f.status()).sourceUrl,'http://localhost:18766/source');
  assert.equal((await f.status()).sourceUrl,'http://localhost:18766/source','restoring the environment does not change a running deployment');
});

test('source URL: malformed, executable and credential-bearing addresses fail before touching data',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-source-url-')),dataDir=path.join(dir,'must-not-exist');
  t.after(()=>{
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('pipi-source-url-'));
    fs.rmSync(dir,{recursive:true,force:true});
  });
  for(const source of ['not a URL','/local/source','javascript:alert(1)','data:text/html,<script>alert(1)</script>','file:///tmp/source','ftp://example.com/source','https://secret-user:secret-password@example.com/source','http://[broken']){
    assert.throws(()=>configuredApp(source,dataDir),error=>{
      assert.match(error.message,/SOURCE_URL.*HTTP\(S\)/);
      assert.ok(!error.message.includes(source));
      assert.doesNotMatch(error.message,/secret-user|secret-password/);
      return true;
    });
    assert.equal(fs.existsSync(dataDir),false);
  }
});
