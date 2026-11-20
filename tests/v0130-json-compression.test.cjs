// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),zlib=require('node:zlib'),vm=require('node:vm');
const JsonResponse=require('../lib/json-response.cjs'),S=require('../lib/state.cjs'),{createApp}=require('../server.cjs');
test('JSON coding negotiation respects q values, identity and explicit exclusions',()=>{
  const encoding=value=>JsonResponse.negotiate(value).encoding;
  assert.equal(encoding('gzip;q=0.4, br;q=0.9'),'br');assert.equal(encoding('br;q=0.2,gzip;q=0.8'),'gzip');assert.equal(encoding('gzip,br'),'br');
  assert.equal(encoding('br;q=0,*;q=0.8'),'gzip');assert.equal(encoding('gzip;q=0,br;q=0'),null);assert.equal(encoding('br;q=0.5,identity;q=0.8'),null);
  assert.equal(encoding('gzip;q=broken,br;q=0.3'),'br');assert.equal(encoding('x-gzip'),null);assert.equal(encoding(''),null);
  assert.deepEqual(JsonResponse.negotiate('*;q=0'),{encoding:null,identityAllowed:false});assert.equal(JsonResponse.negotiate('identity;q=0,gzip').identityAllowed,false);
  assert.equal(JsonResponse.vary('Origin, accept-encoding'),'Origin, accept-encoding');assert.equal(JsonResponse.vary('Origin'),'Origin, Accept-Encoding');assert.equal(JsonResponse.vary('*'),'*');
});
test('JSON encoding begins above 1024 bytes, with exact Content-Length and no encoding for short responses',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../server.cjs'),'utf8');
  const body=source.slice(source.indexOf('  function json('),source.indexOf('  function backupPayload('));
  const scope=vm.createContext({Buffer,JsonResponse});vm.runInContext(body+';globalThis.send=json;',scope);
  function response(accept){const headers={};return {req:{headers:{'accept-encoding':accept}},headers,setHeader(k,v){headers[k.toLowerCase()]=v;},getHeader(k){return headers[k.toLowerCase()];},writeHead(status,values){this.status=status;for(const[k,v]of Object.entries(values))this.setHeader(k,v);},end(bytes){this.bytes=bytes;}};}
  for(const count of [1022,1023]){
    const res=response('gzip');await scope.send(res,200,'x'.repeat(count));assert.equal(res.headers['content-encoding'],count===1022?undefined:'gzip');
    const decoded=res.headers['content-encoding']?zlib.gunzipSync(res.bytes):res.bytes;assert.equal(decoded.length,count+2);assert.equal(Number(res.headers['content-length']),res.bytes.length);assert.equal(res.headers.vary,'Accept-Encoding');
  }
  const short=response('*;q=0');await scope.send(short,200,{ok:true});assert.equal(short.status,406);
});
async function fixture(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-compression-0130-'));
  const app=createApp({dataDir,host:'127.0.0.1',port:0,trustProxy:'',resetPassword:false,initialState:()=>{const state=S.initial();state.profile.bio='中文与文字压缩验证'.repeat(400);return state;}});await app.listen();
  t.after(async()=>{await app.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  const origin='http://127.0.0.1:'+app.server.address().port;
  const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'Compression-test-password'})});assert.equal(setup.status,200);
  const cookie=setup.headers.get('set-cookie').split(';')[0];await setup.arrayBuffer();
  function raw(route,encoding,authenticated=true){return new Promise((resolve,reject)=>{const req=http.get(origin+route,{headers:{Connection:'close',...(authenticated?{Cookie:cookie}:{}),...(encoding===undefined?{}:{'Accept-Encoding':encoding})}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));});req.on('error',reject);});}
  return {raw};
}
test('real HTTP state replies use Brotli/gzip by preference and preserve exact JSON bytes',async t=>{
  const f=await fixture(t),plain=await f.raw('/api/state');assert.equal(plain.status,200);assert.equal(plain.headers['content-encoding'],undefined);assert.equal(Number(plain.headers['content-length']),plain.bytes.length);
  for(const [accept,coding]of [['gzip','gzip'],['br','br'],['br;q=0.4,gzip;q=0.9','gzip'],['gzip;q=0.4,br;q=0.9','br'],['br;q=0,*;q=0.6','gzip']]){
    const response=await f.raw('/api/state',accept);assert.equal(response.status,200);assert.equal(response.headers['content-encoding'],coding);assert.equal(Number(response.headers['content-length']),response.bytes.length);assert.equal(response.headers.vary,'Accept-Encoding');
    assert.deepEqual(coding==='br'?zlib.brotliDecompressSync(response.bytes):zlib.gunzipSync(response.bytes),plain.bytes);assert.ok(response.bytes.length<plain.bytes.length/2);
  }
  for(const accept of ['br;q=0,gzip;q=0','identity','br;q=0.3,identity;q=1'])assert.deepEqual((await f.raw('/api/state',accept)).bytes,plain.bytes);
  const revision=JSON.parse(plain.bytes).revision,unchanged=await f.raw('/api/state?since='+revision,'br,gzip');assert.deepEqual(JSON.parse(unchanged.bytes),{revision,unchanged:true});assert.equal(unchanged.headers['content-encoding'],undefined);assert.equal(unchanged.headers.vary,'Accept-Encoding');
  const denied=await f.raw('/api/state','br,gzip',false);assert.equal(denied.status,401);assert.equal(JSON.parse(denied.bytes).code,'AUTH_REQUIRED');assert.equal(denied.headers.vary,'Accept-Encoding');
});
