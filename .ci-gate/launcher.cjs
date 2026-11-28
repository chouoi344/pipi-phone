'use strict';
// Test-only launcher. The only substituted service is the unreleased release catalogue.
const {createApp}=require('/app/server.cjs'), State=require('/app/lib/state.cjs');
const fs=require('node:fs'), crypto=require('node:crypto');
const version=require('/app/package.json').version;
const root='/app/update-channel', repo='isolated/pipi-phone', candidate=process.env.GATE_DIGEST;
const old='0.14.4', next='0.14.5';
const read=()=>fs.readFileSync(root+'/feed','utf8').trim();
const fetchImpl=async raw=>{
  const url=new URL(raw);
  const selected=url.pathname.endsWith('/latest.json')?read():[old,next].find(v=>url.pathname.includes('/v'+v+'/')||url.pathname.endsWith('/v'+v+'.json'));
  if(!selected)throw new Error('unrecognized release fixture path: '+url.pathname);
  if(!['raw.githubusercontent.com','github.com'].includes(url.hostname)||!url.pathname.startsWith('/'+repo+'/'))throw new Error('unexpected fixture request: '+url);
  return Response.json({version:selected,publishedAt:'2026-11-01T00:00:00Z',notes:'隔离升级测试',image:'ghcr.io/'+repo+'@'+candidate});
};
function initialState(){
  if(version!==old)throw Error('candidate attempted to seed a new database');
  const state=State.initial();State.apply(state,'role.save',{name:'Gate Friend'});
  state.messages=[{id:crypto.randomUUID(),roleId:state.roles[0].id,sender:'assistant',type:'text',content:'Message before upgrade',status:'sent',createdAt:Date.now()-120000}];
  return state;
}
const app=createApp({initialState,updates:{repository:repo,fetchImpl}});
app.listen().catch(e=>{console.error(e);process.exitCode=1;});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.close().then(()=>process.exit(0),()=>process.exit(1)));
