// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{setTimeout:wait}=require('node:timers/promises');
const {createApp}=require('../server.cjs'),S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs');
async function until(check){const end=Date.now()+3000;while(Date.now()<end){if(check())return;await wait(2);}throw Error('备份清理探针未到达预期阶段');}
test('download completion waits for actual snapshot cleanup; next bad restore preserves state and leaves no prepare directory',async t=>{
  const output=path.resolve(__dirname,'../outputs/integrated-optimization/backup-cleanup');fs.mkdirSync(output,{recursive:true});const dataDir=fs.mkdtempSync(path.join(output,'fixture-'));
  const initialState=()=>{const state=S.initial();for(const module of R.modules)if(module.settings.some(field=>field.key==='enabled'))state.settings.modules[module.id]={...R.values(state,module.id),enabled:false};return state;};
  const app=createApp({dataDir,initialState,host:'127.0.0.1',port:0,mediaTimers:false,providerUrlAllowlist:[],updates:{updateDir:''},fcm:{credentialFile:''}});let release;const gate=new Promise(resolve=>{release=resolve;});t.after(async()=>{release();await app.close();});await app.listen();const base='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
  function request(route,body){return new Promise((resolve,reject)=>{const payload=body===undefined?undefined:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body)),req=http.request(base+route,{method:payload?'POST':'GET',headers:{Cookie:cookie,Connection:'close',...(payload?{Origin:base,'X-CSRF-Token':csrf,'Content-Type':Buffer.isBuffer(body)?'application/x-tar':'application/json','Content-Length':payload.length}:{})}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.once('error',reject);res.once('end',()=>{const bytes=Buffer.concat(chunks),value=String(res.headers['content-type']).includes('application/json')?JSON.parse(bytes):bytes;if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];if(value.csrfToken)csrf=value.csrfToken;resolve({status:res.statusCode,value});});});req.once('error',reject);req.end(payload);});}
  assert.equal((await request('/api/setup',{password:'Synthetic-cleanup-only-2026!'})).status,200);const prepared=await request('/api/backup/prepare',{includeKeys:false,includeMedia:false});assert.equal(prepared.status,200);
  const rm=fs.promises.rm;let cleanupEntered=false;
  t.mock.method(fs.promises,'rm',async(directory,options)=>{if(path.dirname(directory)===path.join(dataDir,'.streaming-backup')&&path.basename(directory).startsWith('prepare-')){cleanupEntered=true;await gate;}return rm(directory,options);});
  let finished=false;const downloading=request('/api/backup/download?token='+prepared.value.token).then(value=>{finished=true;return value;});await until(()=>cleanupEntered);await wait(15);
  assert.equal(finished,false,'Content-Length must not declare a complete download before the snapshot directory is removed');
  const before=app.db.prepare('SELECT json FROM app WHERE id=1').get().json;
  const busy=await request('/api/restore/tar',Buffer.alloc(1024));assert.equal(busy.status,409);assert.equal(busy.value.code,'BUSY');
  release();const downloaded=await downloading;assert.equal(downloaded.status,200);assert.equal(downloaded.value.length,prepared.value.estimatedBytes);assert.deepEqual(fs.readdirSync(path.join(dataDir,'.streaming-backup')),[]);
  assert.equal((await request('/api/backup/download?token='+prepared.value.token)).status,403);
  const invalid=await request('/api/restore/tar',Buffer.alloc(1024));assert.equal(invalid.status,400);assert.equal(app.db.prepare('SELECT json FROM app WHERE id=1').get().json,before);assert.deepEqual(fs.readdirSync(path.join(dataDir,'.streaming-backup')),[]);
});
