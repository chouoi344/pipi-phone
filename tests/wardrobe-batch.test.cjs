'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const Wardrobe=require('../lib/engine/schedule-wardrobe.cjs');
const {createApp}=require('../scripts/sample-data.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwCsj7DwADmAHwphbYCgAAAABJRU5ErkJggg==';
const second=Buffer.from(png.split(',')[1],'base64');second[second.length-5]^=1;
const anotherPng='data:image/png;base64,'+second.toString('base64');
const outfit=(image=png)=>({description:'白色衬衫与长裤',category:'外出',seasons:['春','秋'],image});
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-wardrobe-batch-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}

test('batch validates every image and field before media writes',t=>{
  const dataDir=directory(t);
  for(const invalid of [[],Array(21).fill(outfit()),[outfit(),{...outfit(),seasons:[]}],[outfit(),{...outfit(),image:'https://example.invalid/photo.png'}]]){
    assert.throws(()=>Wardrobe.importItems([],invalid,{dataDir}),{code:'VALIDATION'});
    assert.equal(fs.existsSync(path.join(dataDir,'media')),false);
  }
  const large=Buffer.alloc(512*1024+1);Buffer.from(png.split(',')[1],'base64').copy(large);
  assert.throws(()=>Wardrobe.importItems([],[outfit(),outfit('data:image/png;base64,'+large.toString('base64'))],{dataDir}),{code:'VALIDATION'});
  assert.equal(fs.existsSync(path.join(dataDir,'media')),false);
});

test('batch deduplicates images within the role and retains distinct photos with the same description',t=>{
  const dataDir=directory(t),result=Wardrobe.importItems([],[outfit(),outfit(),outfit(anotherPng)],{dataDir});
  assert.deepEqual({added:result.added,duplicates:result.duplicates},{added:2,duplicates:1});
  assert.equal(new Set(result.items.map(item=>item.image)).size,2);
  assert.equal(new Set(result.items.map(item=>item.id)).size,2);
  assert.ok(result.items.every(item=>Number.isSafeInteger(item.createdAt)));
  assert.equal(fs.readdirSync(path.join(dataDir,'media')).length,2);
  const updated=Wardrobe.upsertItem(result.items,{...result.items[0],category:'居家'},{dataDir});
  assert.equal(updated.item.category,'居家');assert.equal(updated.items.length,2);
  const retry=Wardrobe.importItems(result.items,[outfit(),outfit(anotherPng)],{dataDir});
  assert.deepEqual({added:retry.added,duplicates:retry.duplicates},{added:0,duplicates:2});
  assert.deepEqual(retry.items,result.items);
  assert.equal(Wardrobe.importItems([],[outfit()],{dataDir}).added,1);
});

test('API recognition returns an unsaved draft and confirmation imports once for its own role',async t=>{
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;process.env.ALLOW_PRIVATE_PROVIDERS='1';
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-wardrobe-batch-api-')),calls=[];
  const model=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const payload=JSON.parse(raw);calls.push(payload);
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify({description:'白色衬衫与长裤',category:'外出',seasons:['春','秋']})}}],usage:{prompt_tokens:3,completion_tokens:5}}));
  });
  let app;
  t.after(async()=>{
    try{await app?.close();}finally{
      const closed=new Promise(resolve=>model.close(resolve));model.closeAllConnections();await closed;
      fs.rmSync(dataDir,{recursive:true,force:true});if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;
    }
  });
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  const provider='http://127.0.0.1:'+model.address().port+'/v1';
  app=createApp({dataDir,host:'127.0.0.1',port:0,demoModel:true,providerUrlAllowlist:[provider]});
  await app.listen();const base='http://127.0.0.1:'+app.server.address().port;
  let cookie='',csrf='';
  async function request(route,body){
    const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-CSRF-Token':csrf})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
    return {status:response.status,...value};
  }
  const setup=await request('/api/setup',{password:'Wardrobe-batch-isolated_2026!',displayName:'衣柜隔离验证'});assert.equal(setup.status,200);
  const [first,other]=setup.state.roles.map(role=>role.id),ai=setup.state.settings.ai;
  ai.sources.push({id:'vision',name:'隔离识图',baseUrl:provider,key:'ISOLATED_TEST_ONLY',builtin:false});
  ai.models=[{id:'vision',sourceId:'vision',model:'vision',kind:'chat',capabilities:['text','image'],maxContextTokens:128000,temperature:null,maxTokens:null,timeoutSeconds:2,extraBody:{}}];
  Object.assign(ai.assign,{chat:'vision',caption:'vision',chatSelections:['vision'],chatFallbacks:[]});
  assert.equal((await request('/api/engine/models',{ai})).status,200);
  const endpoint='/api/engine/schedule',draft=await request(endpoint,{roleId:first,action:'identifyWardrobe',image:png});
  assert.equal(draft.status,200,JSON.stringify(draft));
  assert.deepEqual(draft.item,{description:'白色衬衫与长裤',category:'外出',seasons:['春','秋']});
  assert.deepEqual(draft.view.wardrobe,[]);assert.equal(calls.length,1);
  const mediaDir=path.join(dataDir,'media'),draftFiles=fs.readdirSync(mediaDir);
  assert.equal(draftFiles.length,1);
  assert.deepEqual(fs.readFileSync(path.join(mediaDir,draftFiles[0])),Buffer.from(png.split(',')[1],'base64'));
  const revision=draft.state.revision;
  const invalid=await request(endpoint,{roleId:first,action:'importWardrobe',items:[outfit(),{...outfit(),category:'错误'}]});
  assert.equal(invalid.status,400);assert.deepEqual(fs.readdirSync(mediaDir),draftFiles);
  const afterInvalid=await request(endpoint+'?roleId='+first);
  assert.deepEqual(afterInvalid.view.wardrobe,[]);
  assert.equal((await request('/api/state')).revision,revision);
  const confirmed=await request(endpoint,{roleId:first,action:'importWardrobe',items:[outfit(),outfit(),outfit(anotherPng)]});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed));assert.deepEqual(confirmed.result,{added:2,duplicates:1});assert.equal(confirmed.state.revision,revision+1);
  assert.equal(confirmed.view.wardrobe.length,2);
  assert.deepEqual((await request(endpoint+'?roleId='+other)).view.wardrobe,[]);
  const repeated=await request(endpoint,{roleId:first,action:'importWardrobe',items:[outfit(),outfit(anotherPng)]});
  assert.deepEqual(repeated.result,{added:0,duplicates:2});assert.equal(repeated.view.wardrobe.length,2);
  assert.equal(calls.length,1);
});
