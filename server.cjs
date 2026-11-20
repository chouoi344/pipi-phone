// SPDX-License-Identifier: MIT
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {
  promisify
} =require('node:util'),{
  DatabaseSync
} =require('node:sqlite');
const S=require('./lib/state.cjs'),AI=require('./lib/providers.cjs'),Media=require('./lib/media-store.cjs');
const Models=require('./lib/engine/models.cjs'),Registry=require('./lib/engine/registry.cjs'),Jobs=require('./lib/engine/scheduler.cjs'),Time=require('./lib/engine/time.cjs'),Runtime=require('./lib/engine/runtime.cjs');
const Stickers=require('./lib/engine/stickers.cjs');
const {createUpdateService}=require('./lib/updates.cjs');
const scrypt=promisify(crypto.scrypt),VERSION=require('./package.json').version;
const MAX_BACKUP_BYTES=88*1024*1024;
const UPDATE_MAINTENANCE_PHASES=new Set(['backing-up','installing','verifying','rolling-back']);
const safeEqual=(a,b)=>{
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
};
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const loopback=ip=>ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1';
function createApp(options={}){
  const updateDir=options.updates?.updateDir??process.env.PIPI_UPDATE_DIR;
  const updates=createUpdateService({
    repository:process.env.PIPI_UPDATE_REPOSITORY,
    currentVersion:VERSION,
    ...options.updates,
    updateDir
  });
  const updateMaintenance=()=>updateDir
    ? updates.status().then(status=>UPDATE_MAINTENANCE_PHASES.has(status.job?.phase),()=>false)
    : false;
  const sourceUrlValue=(process.env.SOURCE_URL||'').trim();
  let sourceUrl='';
  if(sourceUrlValue){
    const url=URL.parse(sourceUrlValue);
    if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('SOURCE_URL 必须是有效的 HTTP(S) 源码地址，且不能包含用户名或密码');
    sourceUrl=url.href;
  }
  const dataDir=path.resolve(options.dataDir||process.env.DATA_DIR||path.join(__dirname,'data'));
  fs.mkdirSync(dataDir,{
    recursive:true,mode:0o700
  });
  const db=new DatabaseSync(path.join(dataDir,'pipi.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS app (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, roleId TEXT NOT NULL, signature TEXT NOT NULL, messageId TEXT NOT NULL);');
  const getMeta=k=>db.prepare('SELECT value FROM meta WHERE key=?').get(k)?.value;
  const setMeta=(k,v)=>db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,v);
  if(!db.prepare('SELECT id FROM app WHERE id=1').get()){
    const initialState=options.initialState||S.initial;
    db.prepare('INSERT INTO app(id,json) VALUES(1,?)').run(JSON.stringify(initialState()));
  }
  const parse=json=>{
    const state=JSON.parse(json);
    state.profile.cover??='';
    state.stickers??=[];
    state.emojiRecents??=[];
    for(const r of state.roles){
      r.muted??=false;
      r.tags??=[];
      r.description??='';
      r.phone??='';
    }
    const defaults=S.defaults(state);
    Object.defineProperty(defaults,Symbol.for('pipi.mediaDir'),{value:dataDir});
    if(options.lifePreview)Object.defineProperty(defaults,Symbol.for('pipi.lifePreview'),{value:true});
    return defaults;
  };
  const storedJson=()=>db.prepare('SELECT json FROM app WHERE id=1').get().json;
  const read=()=>parse(storedJson());
  const clients=new Set();let runtime,stickerQueue;
  const migrated=read();Jobs.recover(migrated);
  const migratedJson=JSON.stringify(migrated);
  if(migratedJson!==db.prepare('SELECT json FROM app WHERE id=1').get().json)db.prepare('UPDATE app SET json=? WHERE id=1').run(migratedJson);
  const providerUrls=options.providerUrlAllowlist&&new Set(options.providerUrlAllowlist);
  function checkProviderUrls(state){
    if(!providerUrls)return;
    for(const provider of Models.effectiveSources(state.settings.ai)){
      const url=provider.baseUrl;
      // Built-in presets without a credential cannot make provider requests.
      if(url&&(!provider.builtin||provider.key)&&!providerUrls.has(url))S.fail('本地演示仅允许连接当前本机模拟服务',422,'PROVIDER_LOCAL_ONLY');
    }
  }
  try{checkProviderUrls(read());}catch(error){db.close();throw error;}
  // The chat model a background reply would use, in the same order as Models.resolveChat but without its network capacity lookup.
  function chatModel(state,role){
    const ai=Models.migrate(state),ids=ai.assign.chat?[...new Set([ai.assign.chat,...(ai.assign.chatFallbacks||[])])].filter(Boolean):[undefined];
    let last;
    for(const modelId of ids){
      try{return Models.resolve(state,'chat',{role,modelId});}
      catch(error){if(!['PROVIDER_UNCONFIGURED','PROVIDER_PROTOCOL_UNSUPPORTED'].includes(error.code))throw error;last=error;}
    }
    throw last;
  }
  function transaction(fn){
    db.exec('BEGIN IMMEDIATE');
    try{
      const result=fn();
      db.exec('COMMIT');
      return result;
    }
    catch(e){
      db.exec('ROLLBACK');
      throw e;
    }
  }
  function mutate(fn){
    const result=transaction(()=>{
      const json=storedJson(),state=S.limitBaseline(parse(json),Buffer.byteLength(json));
      const previous=Media.mediaSnapshot(state),value=fn(state);
      Media.externalize(dataDir,state,{previous});
      checkProviderUrls(state);
      S.limit(state);
      state.revision++;
      db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
      return {
        state,value
      };
    });
    publish('revision',{revision:result.state.revision});
    return result;
  }
  // An interrupted upstream call is recoverable rather than left permanently pending.
  // A failure here (for example a full data store) is logged and must not stop the service from starting.
  try{
    if(read().messages.some(m=>m.status==='pending'))mutate(s=>{
      for(const m of s.messages)if(m.status==='pending'){
        m.status='error';
        m.error='服务重启中断了请求，请重试';
      }
    });
  }catch(error){console.error('Unable to mark interrupted messages as failed during startup:',error?.stack||String(error));}
  let setupToken=getMeta('setupToken');
  if(!setupToken&&!getMeta('password')){
    setupToken=crypto.randomBytes(24).toString('hex');
    setMeta('setupToken',setupToken);
    fs.writeFileSync(path.join(dataDir,'setup-token.txt'),setupToken+'\n',{
      mode:0o600
    });
  }
  const host=options.host||process.env.HOST||'127.0.0.1',port=options.port??Number(process.env.PORT||18766);
  const allowedHosts=new Set(['localhost','127.0.0.1','[::1]',host,...String(process.env.ALLOWED_HOSTS||'').split(',').map(x=>x.trim()).filter(Boolean)]);
  const buckets=new Map();
  let inFlight=0,closed=false;
  function rate(key,max=15,window=60000){
    const now=Date.now();
    if(buckets.size>5000){
      for(const [k,v]of buckets)if(v.until<now)buckets.delete(k);
      // Many distinct sources must not lock everyone out: drop the windows that started first.
      for(const k of buckets.keys()){if(buckets.size<=5000)break;buckets.delete(k);}
    }
    const item=buckets.get(key);
    if(!item||item.until<now){
      // Re-insert so the map stays ordered by window start.
      buckets.delete(key);
      buckets.set(key,{
        n:1,until:now+window
      });
      return;
    }
    if(++item.n>max)S.fail('请求过多，请稍后重试',429,'RATE_LIMIT');
  }
  function session(req){
    const cookie=String(req.headers.cookie||'');
    const match=cookie.match(/(?:^|;\s*)pipi_session=([a-f0-9]{64})(?:;|$)/);
    if(!match)return null;
    const hash=digest(match[1]);
    const row=db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash,Date.now());
    return row?{
      ...row,hash
    }:null;
  }
  function security(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control','no-store');
    const raw=req.headers.host;
    if(typeof raw!=='string'||/[\s/@\\]/.test(raw))S.fail('无效 Host',400,'HOST');
    let u;
    try{
      u=new URL('http://'+raw);
    }
    catch{
      S.fail('无效 Host',400,'HOST');
    }
    const cleanHost=u.hostname.replace(/^\[|\]$/g,'');
    const ipAllowed=(host==='0.0.0.0'||host==='::')&&net.isIP(cleanHost)>0;
    if(u.pathname!=='/'||u.search||u.hash||(!allowedHosts.has(u.hostname)&&!ipAllowed))S.fail('Host 未在允许列表中',403,'HOST');
    if(req.headers.origin!==undefined){
      let origin;
      try{
        origin=new URL(req.headers.origin);
      }
      catch{
        S.fail('Origin 无效',403,'ORIGIN');
      }
      if(!['http:','https:'].includes(origin.protocol)||origin.host!==u.host||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)S.fail('跨站请求已拒绝',403,'ORIGIN');
    }
  }
  function json(res,status,value){
    if(res.destroyed||res.writableEnded)return;
    // A failure after streaming started cannot change the status; end the partial response instead of throwing again.
    if(res.headersSent){res.end();return;}
    res.writeHead(status,{
      'Content-Type':'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(value));
  }
  function downloadBackup(res,includeModelKeys=false){
    const Media=require('./lib/media-store.cjs'),MemoryStore=require('./lib/engine/memory-store.cjs');
    const current=read(),state=S.backupState(current);
    const payload={format:'pipi-phone',version:1,exportedAt:new Date().toISOString(),state,livingMemory:MemoryStore.exportBackup(dataDir,current)};
    if(includeModelKeys)payload.modelKeys=Models.backupKeys(current.settings.ai);
    const remaining=MAX_BACKUP_BYTES-Buffer.byteLength(JSON.stringify({backup:payload,confirm:true}))-10;
    if(remaining<2)S.fail('备份资料超过大小限制',413);
    payload.media=Media.backupImages(dataDir,state,remaining);
    res.setHeader('Content-Disposition',`attachment; filename="pipi-backup-${payload.exportedAt.slice(0,10)}.json"`);
    return json(res,200,payload);
  }
  async function rawBody(req,max=128*1024*1024){
    const ct=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    if(ct&&!['application/json','text/csv','text/plain','application/octet-stream','application/vnd.ms-excel'].includes(ct))S.fail('不支持的上传文件格式',415);
    const n=Number(req.headers['content-length']||0);
    if(n>max)S.fail('上传文件过大（上限 128 MB）',413);
    let count=0;
    const chunks=[];
    for await(const chunk of req){
      count+=chunk.length;
      if(count>max)S.fail('上传文件过大（上限 128 MB）',413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function body(req,max=20*1024*1024){
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))S.fail('需要 application/json 请求',415);
    const n=Number(req.headers['content-length']||0);
    if(n>max)S.fail('请求数据过大',413);
    let count=0;
    const chunks=[];
    for await(const chunk of req){
      count+=chunk.length;
      if(count>max)S.fail('请求数据过大',413);
      chunks.push(chunk);
    }
    let value;
    try{
      value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch{
      S.fail('JSON 格式无效');
    }
    if(!S.obj(value))S.fail('请求须为 JSON 对象');
    return value;
  }
  function authorized(req,mutating=false){
    const auth=session(req);
    if(!auth)S.fail('请先登录',401,'AUTH_REQUIRED');
    if(mutating){
      if(!req.headers.origin)S.fail('写入请求必须携带同源 Origin',403,'ORIGIN');
      if(!safeEqual(req.headers['x-csrf-token'],auth.csrf))S.fail('CSRF 校验失败，请刷新后重试',403,'CSRF');
    }
    return auth;
  }
  async function passwordHash(password,salt){
    return (await scrypt(password,salt,64,{
      N:16384,r:8,p:1,maxmem:64*1024*1024
    })).toString('hex');
  }
  function makeSession(req,res){
    const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions(hash,csrf,expires) VALUES(?,?,?)').run(digest(token),csrf,Date.now()+7*86400000);
    res.setHeader('Set-Cookie',`pipi_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${req.socket.encrypted||process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
    return csrf;
  }
  function publish(event,data){
    for(const client of clients){
      if(client.expires<=Date.now()||client.res.destroyed){client.res.end();clients.delete(client);continue;}
      if(!client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)){client.res.end();clients.delete(client);}
    }
  }
  function eventStream(req,res,auth){
    if(clients.size>=32)S.fail('实时连接过多，请关闭多余页面',429,'RATE_LIMIT');
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
    const client={res,hash:auth.hash,expires:auth.expires};clients.add(client);
    res.write(`event: revision\ndata: ${JSON.stringify({revision:read().revision})}\n\n`);
    for(const value of runtime.typingState())res.write(`event: typing\ndata: ${JSON.stringify(value)}\n\n`);
    const heartbeat=setInterval(()=>{
      if(!db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(auth.hash,Date.now())){res.end();return;}
      res.write(': heartbeat\n\n');
    },15000);heartbeat.unref();
    res.on('close',()=>{clearInterval(heartbeat);clients.delete(client);});
  }
  async function route(req,res){
    security(req,res);
    let u;
    try{
      u=new URL(req.url,'http://'+req.headers.host);
    }
    catch{
      S.fail('URL 无效');
    }
    const p=u.pathname;
    if(!p.startsWith('/api/'))return staticFile(req,res,p);
    if(req.method==='GET'&&p==='/api/status'){
      const auth=session(req);
      return json(res,200,{
        setupRequired:!getMeta('password'),authenticated:!!auth,...(auth?{
          csrfToken:auth.csrf
        }:{}),version:VERSION,sourceUrl,rolePanel:true,softwareUpdates:true,binaryMedia:true
      });
    }
    if(req.method==='POST'&&(p==='/api/setup'||p==='/api/login')){
      rate('auth:'+req.socket.remoteAddress,10,15*60000);
      const b=await body(req,65536);
      const password=S.text(b.password,256);
      if(p==='/api/setup'){
        if(getMeta('password'))S.fail('已完成初始化',409,'SETUP_DONE');
        const directLocal=loopback(req.socket.remoteAddress)&&!req.headers.forwarded&&!req.headers['x-forwarded-for']&&!req.headers['x-real-ip']&&process.env.REQUIRE_SETUP_TOKEN!=='1';
        // An empty token (already used, or the password row removed while running) never authorizes remote setup.
        if(!directLocal&&(!setupToken||!safeEqual(b.setupToken,setupToken)))S.fail('远程初始化需要 setupToken，请从服务器数据目录读取',403,'SETUP_TOKEN');
        if(password.length<8)S.fail('密码至少需要 8 个字符');
        const salt=crypto.randomBytes(24).toString('hex'),hash=await passwordHash(password,salt);
        transaction(()=>{
          if(getMeta('password'))S.fail('已完成初始化',409);
          setMeta('password',JSON.stringify({
            salt,hash
          }));
          setMeta('setupToken','');
          const s=read();
          s.profile.name=S.text(b.displayName,80,'我');
          s.revision++;
          db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(s));
        });
        setupToken='';
        try{
          fs.unlinkSync(path.join(dataDir,'setup-token.txt'));
        }
        catch{}
        return json(res,200,{
          csrfToken:makeSession(req,res),state:S.publicState(read())
        });
      }
      const stored=getMeta('password');
      if(!stored)S.fail('请先初始化',409,'SETUP_REQUIRED');
      const {
        salt,hash
      }       =JSON.parse(stored);
      if(!safeEqual(await passwordHash(password,salt),hash))S.fail('密码错误',401,'INVALID_PASSWORD');
      return json(res,200,{
        csrfToken:makeSession(req,res),state:S.publicState(read())
      });
    }
    const mutating=!['GET','HEAD'].includes(req.method),auth=authorized(req,mutating);
    if(req.method==='GET'&&p==='/api/updates/status')return json(res,200,await updates.status());
    if(req.method==='GET'&&p==='/api/updates/check'){
      rate('update-check:'+auth.hash,15);
      return json(res,200,await updates.check({force:u.searchParams.get('refresh')==='1'}));
    }
    if(req.method==='POST'&&p==='/api/updates/install'){
      rate('update-install:'+auth.hash,6);
      return json(res,202,await updates.request(await body(req,4096)));
    }
    if(mutating&&p!=='/api/logout'&&await updateMaintenance())S.fail('小手机正在更新，请稍后再试',503,'UPDATE_IN_PROGRESS');
    if(req.method==='GET'&&p==='/api/state'){
      // Background refresh sends the revision it already has; an unchanged revision skips re-sending the whole state.
      const since=u.searchParams.get('since');
      if(since!==null){
        const revision=db.prepare("SELECT json_extract(json,'$.revision') AS revision FROM app WHERE id=1").get()?.revision;
        if(revision!==null&&revision!==undefined&&String(revision)===since)return json(res,200,{revision,unchanged:true});
      }
      return json(res,200,S.publicState(read()));
    }
    if(req.method==='GET'&&p==='/api/engine/chat-progress'){
      const role=S.role(read(),S.text(u.searchParams.get('roleId'),100));
      return json(res,200,runtime.chatProgress(role.id));
    }
    if(req.method==='GET'&&p==='/api/engine/life'){
      return json(res,200,require('./lib/engine/life-panel.cjs').view(read(),S.text(u.searchParams.get('roleId'),100),{preview:options.lifePreview}));
    }
    if(req.method==='GET'&&['/api/engine/life/album','/api/engine/life/moments'].includes(p)){
      const roleId=S.text(u.searchParams.get('roleId'),100),month=u.searchParams.get('month')||'',day=u.searchParams.get('day')||'';
      const page=S.integer(Number(u.searchParams.get('page')??1),1,Number.MAX_SAFE_INTEGER);
      if(month&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||day&&!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day))S.fail('日期无效');
      const panel=require('./lib/engine/life-panel.cjs'),s=read();
      return json(res,200,p.endsWith('/album')?panel.album(s,roleId,{month,day,page}):panel.momentPage(s,roleId,{month,page}));
    }
    if(req.method==='GET'&&p==='/api/events')return eventStream(req,res,auth);
    if(req.method==='GET'&&p==='/api/engine/usage')return json(res,200,require('./lib/engine/usage.cjs').report(read(),{range:u.searchParams.get('range')||'all'}));
    if(req.method==='GET'&&p==='/api/engine/schedule'){
      const s=read(),roleId=S.role(s,S.text(u.searchParams.get('roleId'),100)).id;
      const day=u.searchParams.get('day')||'';
      if(day&&!/^\d{4}-\d{2}-\d{2}$/.test(day))S.fail('查看日期无效');
      return json(res,200,{view:require('./lib/engine/modules/schedule.cjs').view(s,roleId,Date.now(),{day})});
    }
    if(req.method==='GET'&&p==='/api/engine/config'){
      const s=read(),ai=Models.sanitize(s.settings.ai);return json(res,200,{ai,builtinModels:require('./lib/engine/builtin-source.cjs').builtinModels(ai.sources),catalog:require('./lib/engine/model-catalog.cjs').catalog,modules:Registry.list(),settings:Object.fromEntries(Registry.modules.map(m=>[m.id,Registry.values(s,m.id)])),moduleErrors:Object.fromEntries(Registry.modules.map(m=>[m.id,s.engine.data[m.data]?.lastError||null])),schedule:s.engine.data.schedule||{days:{}},timezone:s.settings.timezone,usage:Runtime.usage(s)});
    }
    if(req.method==='GET'&&p==='/api/engine/jobs'){
      const s=read(),roleId=S.role(s,S.text(u.searchParams.get('roleId'),100)).id;
      return json(res,200,{jobs:Jobs.list(s,roleId,{includeHistory:u.searchParams.get('includeHistory')==='1'})});
    }
    if(req.method==='GET'&&p==='/api/engine/jobs/overview')return json(res,200,{friends:Jobs.overview(read())});
    if(['GET','HEAD'].includes(req.method)&&p.startsWith('/api/media/')){
      const file=Media.describeMediaFile(dataDir,p.slice('/api/media/'.length));
      if(!file)S.fail('媒体文件不存在',404,'NOT_FOUND');
      const headers={'Content-Type':file.mime,'Cache-Control':'private, max-age=604800, immutable','X-Content-Type-Options':'nosniff','ETag':file.etag,'Accept-Ranges':'bytes'};
      if(req.headers['if-none-match']===file.etag){res.writeHead(304,headers);res.end();return;}
      let start=0,end=file.size-1,status=200;
      const range=req.headers.range;
      if(range&&(!req.headers['if-range']||req.headers['if-range']===file.etag)){
        const match=range.match(/^bytes=(\d*)-(\d*)$/);
        if(match&&(match[1]||match[2])){
          if(match[1]){start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
          else start=Math.max(0,file.size-Number(match[2]));
        }
        if(!match||!match[1]&&!match[2]||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=file.size||!match[1]&&Number(match[2])===0){
          res.writeHead(416,{...headers,'Content-Range':`bytes */${file.size}`,'Content-Length':0});res.end();return;
        }
        status=206;headers['Content-Range']=`bytes ${start}-${end}/${file.size}`;
      }
      res.writeHead(status,{...headers,'Content-Length':end-start+1});
      if(req.method==='HEAD'){res.end();return;}
      const stream=fs.createReadStream(file.path,{start,end});
      res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return;
    }
    if(req.method==='GET'&&p==='/api/engine/memory/state'){
      const s=read(),roleId=S.role(s,S.text(u.searchParams.get('roleId'),100)).id;
      const MS=require('./lib/engine/memory-store.cjs'),Mem=require('./lib/engine/modules/memory.cjs');
      const status=S.enumOf(u.searchParams.get('status')||'active',['active','archived','all']);
      const query=S.text(u.searchParams.get('q')||'',200);
      const grouped=u.searchParams.has('group')&&S.enumOf(u.searchParams.get('group'),['month'])==='month';
      const requestedMonth=grouped?S.text(u.searchParams.get('month')||'',7):'';
      const limit=u.searchParams.has('limit')?S.integer(Number(u.searchParams.get('limit')),1,100):null;
      const offset=u.searchParams.has('offset')?S.integer(Number(u.searchParams.get('offset')),0,Number.MAX_SAFE_INTEGER):0;
      let cards=Mem.listMergedCards(s,roleId,{dataDir,status});
      if(!grouped&&query.trim()){
        const q=query.trim().toLowerCase();
        cards=cards.filter(c=>[c.content,...c.topics,...c.keyFacts].some(value=>value.toLowerCase().includes(q)));
      }
      const profile=MS.getProfile(dataDir,s,roleId);
      if(grouped){
        const timezone=s.settings.timezone||'UTC',time=require('./lib/engine/time.cjs');
        const monthById=new Map(),counts=new Map();
        for(const card of cards){
          const month=card.createdAt>0&&card.createdAt<=8.64e15?time.dayKey(card.createdAt,timezone).slice(0,7):'unknown';
          monthById.set(card.id,month);
          counts.set(month,(counts.get(month)||0)+1);
        }
        const months=[...counts].sort(([a],[b])=>a==='unknown'?1:b==='unknown'?-1:b.localeCompare(a)).map(([month,count])=>({month,count}));
        const q=query.trim().toLowerCase(),month=q?null:counts.has(requestedMonth)?requestedMonth:months[0]?.month||null;
        cards=cards.filter(card=>q?(card.content.toLowerCase().includes(q)||card.topics.some(t=>t.toLowerCase().includes(q))||card.keyFacts.some(f=>f.toLowerCase().includes(q))):monthById.get(card.id)===month);
        cards.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
        const total=cards.length,page=cards.slice(offset,offset+(limit??300)),nextOffset=offset+page.length<total?offset+page.length:null;
        return json(res,200,{cards:page,profile,total,nextOffset,months,month});
      }
      if(limit===null)return json(res,200,{cards:cards.slice(0,300),profile});
      const total=cards.length,page=cards.slice(offset,offset+limit),nextOffset=offset+page.length<total?offset+page.length:null;
      return json(res,200,{cards:page,profile,total,nextOffset});
    }
    if(req.method==='GET'&&p==='/api/engine/memory/export'){
      const s=read(),r=S.role(s,S.text(u.searchParams.get('roleId'),100));
      const payload=require('./lib/engine/memory-store.cjs').exportLivingMemoryJson(dataDir,s,r.id,r.name);
      res.setHeader('Content-Disposition',`attachment; filename="livingmemory-${r.id.slice(0,8)}-${new Date().toISOString().slice(0,10)}.json"`);
      return json(res,200,payload);
    }
    if(req.method==='GET'&&p==='/api/backup')return downloadBackup(res);
    if(req.method==='POST'&&p==='/api/engine/memory/import'){
      rate('api:'+auth.hash,30,60000);
      const raw=await rawBody(req,128*1024*1024);
      const mode=S.enumOf(u.searchParams.get('mode')||'preview',['preview','execute']);
      const format=S.enumOf(u.searchParams.get('format')||'json',['json','csv']);
      const MS=require('./lib/engine/memory-store.cjs');
      const rawText=raw.toString('utf8');
      if(mode==='preview'){
        return json(res,200,{preview:MS.previewImport(rawText,format)});
      }
      const roleId=S.role(read(),S.text(u.searchParams.get('roleId'),100)).id;
      const includeArchived=u.searchParams.get('includeArchived')==='1';
      const duplicateStrategy=S.enumOf(u.searchParams.get('duplicateStrategy')||'skip',['skip','keep']);
      const rawScopes=u.searchParams.get('scopes')||'';
      let selectedScopes=null;
      if(rawScopes.trim()){
        try{selectedScopes=JSON.parse(rawScopes);}catch{selectedScopes=rawScopes.split(',').map(x=>decodeURIComponent(x)).filter(Boolean);}
      }
      const resImport=mutate(s=>MS.executeImport(dataDir,s,{roleId,rawInput:rawText,format,selectedScopes,includeArchived,duplicateStrategy}));
      return json(res,200,{result:resImport.value,state:S.publicState(resImport.state)});
    }
    if(req.method!=='POST')S.fail('接口不存在',404,'NOT_FOUND');
    if(p==='/api/media/upload'&&!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')){
      rate('api:'+auth.hash,180,60000);
      return json(res,200,{url:await Media.receiveUpload(dataDir,req)});
    }
    const b=await body(req,p==='/api/restore'?MAX_BACKUP_BYTES:(p==='/api/action'?64:32)*1024*1024);
    if(p!=='/api/restore')Media.externalize(dataDir,b,{image:(value,field)=>S.image(value,false,field==='avatar'?'头像':field==='cover'?'朋友圈背景图':'')});
    rate('api:'+auth.hash,180,60000);
    switch(p){
      case '/api/backup':{
        if(typeof b.includeModelKeys!=='boolean')S.fail('是否包含模型密钥必须明确指定');
        return downloadBackup(res,b.includeModelKeys);
      }
      case '/api/stickers/analyze':{
        stickerQueue.enqueue(b);
        return json(res,200,{state:S.publicState(read())});
      }
      case '/api/logout':db.prepare('DELETE FROM sessions WHERE hash=?').run(auth.hash);
      for(const client of clients)if(client.hash===auth.hash){client.res.end();clients.delete(client);}
      res.setHeader('Set-Cookie','pipi_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      return json(res,200,{
        ok:true
      });
      case '/api/media/upload':{
        const validated=S.image(b.image,false);
        if(!validated)S.fail('图片不能为空');
        const url=validated;
        return json(res,200,{url});
      }
      case '/api/action':{
        const type=S.text(b.type,100);
        if(type==='settings.save'&&req.headers['sec-fetch-site']&&(b.payload?.providers!==undefined||b.payload?.preset!==undefined))S.fail('模型页面已更新，请刷新后到模型页面保存服务商',409,'PROVIDER_CONFIG_CHANGED');
        const paymentReplay=type==='wallet.transfer'&&read().wallet.transactions.some(t=>t.requestId===b.payload?.requestId);
        const targetRole=type==='role.delete'?b.payload?.id:b.payload?.roleId;
        if(['role.delete','conversation.clear','conversation.delete'].includes(type))runtime.cancel(targetRole);
        if(['message.delete','message.deleteMany','message.recall'].includes(type)){
          const roleId=type==='message.deleteMany'?b.payload?.roleId:read().messages.find(m=>m.id===b.payload?.id)?.roleId;
          if(roleId&&runtime.isBusy(roleId))S.fail('正在生成中，请稍后删除消息',409,'CHAT_BUSY');
        }
        const result=mutate(s=>S.apply(s,type,b.payload===undefined?{}:b.payload));
        if(['rolePersona.bind','rolePersona.save','rolePersona.delete','role.save'].includes(type))runtime.checkChatPersonas(result.state);
        if(type==='role.delete')require('./lib/engine/memory-store.cjs').removeRole(dataDir,null,b.payload?.id);
        if(type==='role.save'&&result.state.roles.find(r=>r.id===b.payload?.id)?.permissions.blocked)runtime.cancel(b.payload.id);
        if(type==='wallet.transfer'&&!paymentReplay){
          const s=result.state,r=S.role(s,b.payload.roleId),model=s.settings.ai.models.find(m=>m.id===s.settings.ai.assign.chat),source=model&&Models.effectiveSources(s.settings.ai).find(x=>x.id===model.sourceId);
          if(source?.key&&source.baseUrl){
            const payment=s.wallet.transactions.find(t=>t.requestId===b.payload.requestId),message=s.messages.find(m=>m.meta?.transactionId===payment.id);
            runtime.enqueue(r.id,message.id);
          }
        }
        return json(res,200,{
          state:S.publicState(read())
        });
      }
      case '/api/chat/send':
      case '/api/chat':{
        rate('ai:'+auth.hash,40);
        const roleId=S.text(b.roleId,100),text=S.text(b.text,16000),img=S.image(b.image);
        S.chatAllowed(S.role(read(),roleId));
        const audio=b.audio===undefined?'':S.audio(b.audio);
        if(audio&&(text||img))S.fail('语音不能与文字或图片同时发送');
        if(!audio&&b.durationMs!==undefined)S.fail('录音时长仅用于语音消息');
        const durationMs=audio?S.integer(b.durationMs,1,600000):undefined;
        if(!text.trim()&&!img&&!audio)S.fail('请输入文字、图片或语音');
        const quoteId=b.quoteId===undefined?'':S.text(b.quoteId,100);
        if(b.quoteId!==undefined&&!quoteId)S.fail('引用消息标识无效');
        const requestId=S.text(b.requestId,100);
        if(!/^[\w-]{8,100}$/.test(requestId))S.fail('请提供有效 requestId');
        const stickerId=b.stickerId===undefined?undefined:S.text(b.stickerId,100);
        if(stickerId!==undefined&&(!stickerId||!img||audio))S.fail('表情消息须提供有效表情和图片');
        const signature=digest(JSON.stringify({
          roleId,text,img,...(stickerId===undefined?{}:{stickerId}),...(audio?{audio,durationMs}:{}),...(quoteId?{quoteId}:{})
        }));
        const existing=db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
        if(existing){
          if(existing.roleId!==roleId||existing.signature!==signature)S.fail('requestId 已用于其他消息',409,'REQUEST_REUSED');
          return json(res,200,{
            state:S.publicState(read())
          });
        }
        let messageId;
        mutate(s=>{
          const r=S.role(s,roleId),meta={};
          if(stickerId!==undefined){
            const sticker=S.find(s.stickers,stickerId,'收藏表情');
            const media=require('./lib/media-store.cjs');
            if(sticker.image!==img){
              const source=media.resolveImageBytes(dataDir,sticker.image),sent=media.resolveImageBytes(dataDir,img);
              if(!source||!sent||!source.buffer.equals(sent.buffer))S.fail('发送图片与收藏表情不一致');
            }
            meta.stickerId=stickerId;
            const semantic=Stickers.get(s,sticker.image);
            if(semantic?.status==='ready'){
              const {meaning,tags,usage}=semantic;
              meta.stickerSemantic={meaning,tags:[...tags],usage};
              for(const field of ['description','visibleText'])if(semantic[field]!==undefined)meta.stickerSemantic[field]=semantic[field];
              meta.caption=Stickers.describe(s,sticker.image);
            }
          }
          if(audio)Object.assign(meta,{audio,durationMs});
          if(img&&text)meta.image=img;
          if(quoteId)meta.quote=S.quote(s,roleId,quoteId);
          const m=S.message(s,r,'user',audio?'':img&&!text?img:text,audio?'voice':img&&!text?'image':'text',{
            status:'pending',...(Object.keys(meta).length?{meta}:{})
          });
          messageId=m.id;
          db.prepare('INSERT INTO requests(id,roleId,signature,messageId) VALUES(?,?,?,?)').run(requestId,roleId,signature,m.id);
        });
        runtime.enqueue(roleId,messageId);
        return json(res,200,{accepted:true,messageId,state:S.publicState(read())});
      }
      case '/api/chat/retry':{
        rate('ai:'+auth.hash,40);
        const m=S.find(read().messages,b.messageId,'消息');
        S.chatAllowed(S.role(read(),m.roleId));
        if(m.sender!=='user'||m.status!=='error')S.fail('只有失败的用户消息可以重试');
        mutate(s=>{
          const m=S.find(s.messages,b.messageId);
          m.status='pending';
          delete m.error;
          if(s.engine.summaries[m.roleId]?.coveredUntil>=m.createdAt)delete s.engine.summaries[m.roleId];
        });
        runtime.enqueue(m.roleId,m.id);
        return json(res,200,{accepted:true,messageId:m.id,state:S.publicState(read())});
      }
      case '/api/moments/generate':{
        rate('ai:'+auth.hash,40);const s=read(),r=S.role(s,S.text(b.roleId,100));S.momentAllowed(r);
        // Reject here what the background run would reject, so the page is never told an impossible post was accepted.
        require('./lib/engine/modules/life-moments.cjs').eligible(s,r.id);chatModel(s,r);
        if(!runtime.initiate(r.id,{kind:'moment',instruction:'以你的角色身份写一条简短自然的朋友圈动态。只输出正文。'}))S.fail('该好友正在回复，请稍后再试',409,'CHAT_BUSY');
        return json(res,200,{accepted:true,state:S.publicState(read())});
      }
      case '/api/engine/models':{
        if(req.headers['sec-fetch-site']&&req.headers['x-pipi-model-page']!=='card-save')S.fail('模型页面已更新，请刷新页面后再保存',409,'PROVIDER_CONFIG_CHANGED');
        const result=mutate(s=>Models.save(s,b.ai,{stationPreset:b.stationPreset===true,checkSubmittedKeys:true}));return json(res,200,{state:S.publicState(result.state)});
      }
      case '/api/engine/models/card':{
        const result=mutate(s=>Models.saveCard(s,b));return json(res,200,{state:S.publicState(result.state)});
      }
      case '/api/engine/models/assign':{
        const result=mutate(s=>Models.saveAssignments(s,b.assign));return json(res,200,{state:S.publicState(result.state)});
      }
      case '/api/engine/models/station':{
        const unconfiguredGroups=[];
        const result=mutate(s=>Models.configureStation(s,b.keys,{unconfiguredGroups,expectedKeyRevisions:b.expectedKeyRevisions??{}}));return json(res,200,{state:S.publicState(result.state),unconfiguredGroups});
      }
      case '/api/engine/models/source/delete':{
        const result=mutate(s=>Models.removeSource(s,b.sourceId,{expectedKeyRevisions:{[b.sourceId]:b.expectedKeyRevision}}));return json(res,200,{state:S.publicState(result.state)});
      }
      case '/api/engine/models/list':{
        rate('ai:'+auth.hash,40);
        return json(res,200,{models:await Models.list(read(),b,providerUrls)});
      }
      case '/api/engine/models/metadata':{
        const name=S.text(b.model,200),sourceId=S.text(b.sourceId,100),source=Models.effectiveSources(read().settings.ai).find(source=>source.id===sourceId);
        if(!source&&b.baseUrl===undefined)S.fail('找不到服务商',404,'NOT_FOUND');
        const baseUrl=source?.builtin||b.baseUrl===undefined?source.baseUrl:Models.providerBaseUrl(b.baseUrl);
        const kind=b.kind??'chat';
        const template=source?.builtin?source.template:b.template??source?.template;
        const timeoutSeconds=Models.defaultTimeoutSeconds({kind,model:name,protocol:b.protocol},{template});
        if(kind!=='chat'||!name.trim())return json(res,200,{timeoutSeconds});
        const maxContextTokens=b.maxContextTokens??0;
        if(!Number.isSafeInteger(maxContextTokens)||maxContextTokens<0||maxContextTokens>100000000)S.fail('对话容量超出允许范围');
        const info=await require('./lib/engine/model-catalog.cjs').metadata(name,{baseUrl,maxContextTokens});
        return json(res,200,{...info,timeoutSeconds});
      }
      case '/api/engine/models/test':{
        rate('ai:'+auth.hash,40);
        const draft=read();
        if(b.source!==undefined||b.model!==undefined){
          const {source,model}=b;
          if(!S.obj(source)||!S.obj(model)||model.sourceId!==source.id||model.id!==b.modelId)S.fail('待测试的模型和服务商不匹配');
          const ai=Models.sanitize(draft.settings.ai);
          const sources=[...ai.sources.filter(item=>item.id!==source.id),source];
          const models=[...ai.models.filter(item=>item.id!==model.id),model];
          Models.save(draft,{...ai,sources,models});
          checkProviderUrls(draft);
        }
        return json(res,200,await require('./lib/engine/model-test.cjs').testConnection(draft,b.modelId,{onUsage:runtime.onUsage}));
      }
      case '/api/engine/modules':{
        const id=S.text(b.id,100);
        const result=mutate(s=>{
          if(id==='voice'&&b.tts!==undefined)Models.saveAssignments(s,{tts:S.text(b.tts,100)});
          Registry.apply(s,id,b.values);
        });
        return json(res,200,{state:S.publicState(result.state)});
      }
      case '/api/engine/voices':{
        rate('ai:'+auth.hash,40);
        const voiceType=S.enumOf(b.voiceType||'all',['all','personal','default']);
        const search=S.text(b.search||'',100);
        return json(res,200,await AI.listSpeechVoices(read(),{voiceType,search}));
      }
      case '/api/engine/life':{
        const panel=require('./lib/engine/life-panel.cjs'),ctx={getState:read,mutate,runtime,dataDir,preview:options.lifePreview};
        if(!options.lifePreview||['saveInteraction','saveMoments'].includes(b.action))return json(res,200,await panel.act(b,ctx));
        rate('ai:'+auth.hash,40);
        if(inFlight+runtime.active>=8)S.fail('模型服务正忙，请稍后再试',429,'PROVIDER_BUSY');
        inFlight++;
        try{return json(res,200,await panel.act(b,ctx));}
        finally{inFlight--;}
      }
      case '/api/engine/schedule':{
        const roleId=S.role(read(),S.text(b.roleId,100)).id;
        const action=S.enumOf(b.action||'generate',['generate','generateProfile','describeOutfit','identifyWardrobe','refreshWeather','save','saveProfile','restoreProfileBackup','saveSettings','addWardrobe','updateWardrobe','importWardrobe','removeWardrobe','collectOutfit','savePromise','completePromise','cancelPromise','saveUserEvent','completeUserEvent','removeUserEvent','saveEvent','completeEvent','cancelEvent']);
        const sched=require('./lib/engine/modules/schedule.cjs');
        if(!['generate','generateProfile','describeOutfit','identifyWardrobe','refreshWeather'].includes(action)){
          const result=mutate(s=>{
            switch(action){
              case 'save':{
                if(!Array.isArray(b.slots)||!b.slots.every(S.obj))S.fail('日程时段列表无效');
                const slots=b.slots.map(({startAt,endAt,outfitSnapshot,...slot})=>slot);
                return sched.saveForRole(s,roleId,{outfit:b.outfit,mood:b.mood,slots});
              }
              case 'saveProfile':return sched.saveProfile(s,roleId,b.profile);
              case 'restoreProfileBackup':return sched.restoreProfileBackup(s,roleId,S.integer(b.index,0,10000));
              case 'saveSettings':{
                if(!S.obj(b.settings))S.fail('日程设置格式无效');
                return sched.saveSettings(s,roleId,b.settings);
              }
              case 'addWardrobe':case 'updateWardrobe':{
                if(!S.obj(b.item))S.fail('穿搭资料格式无效');
                return sched.addWardrobeItem(s,roleId,{...b.item,...(action==='updateWardrobe'?{id:S.text(b.itemId,100)}:{})},{dataDir});
              }
              case 'importWardrobe':return sched.importWardrobe(s,roleId,b.items,{dataDir});
              case 'removeWardrobe':return sched.removeWardrobeItem(s,roleId,S.text(b.itemId,100));
              case 'collectOutfit':return sched.collectTodayOutfit(s,roleId,S.enumOf(b.kind||'outdoor',['outdoor','home','sleepwear']));
              case 'savePromise':if(!S.obj(b.promise))S.fail('约定格式无效');return sched.savePromise(s,roleId,b.promise);
              case 'completePromise':case 'cancelPromise':return sched.markPromiseStatus(s,roleId,S.text(b.id,100),action==='completePromise'?'done':'cancelled');
              case 'saveUserEvent':if(!S.obj(b.event))S.fail('事项格式无效');return sched.saveUserEvent(s,roleId,b.event);
              case 'completeUserEvent':return sched.markUserEventStatus(s,roleId,S.text(b.id,100),'done');
              case 'removeUserEvent':return sched.removeUserEvent(s,roleId,S.text(b.id,100));
              case 'saveEvent':if(!S.obj(b.event))S.fail('事件格式无效');return sched.saveEvent(s,roleId,b.event);
              case 'completeEvent':case 'cancelEvent':{
                const event=s.engine.data.schedule.events?.[roleId]?.find(x=>x.id===S.text(b.id,100));
                if(!event)S.fail('事件不存在',404,'NOT_FOUND');
                return sched.saveEvent(s,roleId,{...event,status:action==='completeEvent'?'done':'cancelled'});
              }
            }
          });
          return json(res,200,{result:result.value,view:sched.view(result.state,roleId),state:S.publicState(result.state)});
        }
        rate('ai:'+auth.hash,40);S.chatAllowed(S.role(read(),roleId));
        if(inFlight+runtime.active>=8)S.fail('模型服务正忙，请稍后再试',429,'PROVIDER_BUSY');
        inFlight++;
        try{
          const opts={mutate,getState:read,roleId,onUsage:runtime.onUsage,scope:dataDir};
          let value;
          if(action==='generate')value=await sched.generateForRole(read(),{...opts,force:true,extra:S.text(b.extra||'',2000),outfitId:S.text(b.outfitId||'',100)});
          if(action==='generateProfile')value=await sched.generateProfile(read(),opts);
          if(action==='refreshWeather')value=await sched.refreshWeather(read(),opts);
          if(action==='describeOutfit')value=await require('./lib/engine/schedule-wardrobe.cjs').identifyImage(read(),{...opts,dataUri:b.image,dataDir});
          if(action==='identifyWardrobe')value=await require('./lib/engine/schedule-wardrobe.cjs').identifyImage(read(),{...opts,dataUri:b.image,dataDir,persistImage:false});
          const current=read();
          return json(res,200,{[['describeOutfit','identifyWardrobe'].includes(action)?'item':'result']:value,view:sched.view(current,roleId),state:S.publicState(current)});
        }finally{inFlight--;}
      }
      case '/api/engine/memory':{
        const roleId=S.role(read(),S.text(b.roleId,100)).id;
        const action=S.enumOf(b.action||'recall',['add','update','toggleLock','restore','delete','saveProfile','recall','consolidate']);
        const MS=require('./lib/engine/memory-store.cjs'),Mem=require('./lib/engine/modules/memory.cjs');
        if(action==='add'){
          const content=S.text(b.content,2000).trim();if(!content)S.fail('记忆内容不能为空');
          const result=mutate(s=>MS.upsertCard(dataDir,s,roleId,{content,memoryType:S.text(b.memoryType||'FACT',40),importance:MS.clampImportance(b.importance,0.7),locked:Boolean(b.locked),origin:'manual'}));
          return json(res,200,{card:result.value,state:S.publicState(result.state)});
        }
        if(action==='update'){
          const id=S.text(b.id,100),content=S.text(b.content,2000).trim();if(!content)S.fail('记忆内容不能为空');
          const result=mutate(s=>{
            const card=MS.getCard(dataDir,s,roleId,id);if(!card)S.fail('记忆不存在',404,'NOT_FOUND');
            return MS.upsertCard(dataDir,s,roleId,{...card,content,summary:content,memoryType:b.memoryType??card.memoryType,updatedAt:Date.now()});
          });
          return json(res,200,{card:result.value,state:S.publicState(result.state)});
        }
        if(action==='restore'){
          const id=S.text(b.id,100);
          const result=mutate(s=>{const card=MS.setCardStatus(dataDir,s,roleId,id,{status:'active'});if(!card)S.fail('记忆不存在',404,'NOT_FOUND');return card;});
          return json(res,200,{card:result.value,state:S.publicState(result.state)});
        }
        if(action==='toggleLock'){
          const id=S.text(b.id,100);
          const cur=MS.getCard(dataDir,read(),roleId,id);
          const result=mutate(s=>MS.setCardStatus(dataDir,s,roleId,id,{locked:cur?!cur.locked:Boolean(b.locked)}));
          return json(res,200,{card:result.value,state:S.publicState(result.state)});
        }
        if(action==='delete'){
          const id=S.text(b.id,100);
          const result=mutate(s=>b.archive?MS.setCardStatus(dataDir,s,roleId,id,{status:'archived'}):MS.deleteCard(dataDir,s,roleId,id));
          return json(res,200,{deleted:result.value,state:S.publicState(result.state)});
        }
        if(action==='saveProfile'){
          const result=mutate(s=>MS.saveProfile(dataDir,s,roleId,b.profile));
          return json(res,200,{profile:result.value,state:S.publicState(result.state)});
        }
        if(action==='recall'){
          const out=await Mem.recallForPrompt(read(),roleId,S.text(b.query||'',300),{dataDir,getState:read});
          return json(res,200,{cards:out.cards,profile:out.profile});
        }
        if(action==='consolidate'){
          const result=mutate(s=>Mem.consolidateAndDecay(s,roleId,{dataDir}));
          return json(res,200,{archivedCount:result.value,state:S.publicState(result.state)});
        }
      }
      case '/api/engine/memory/extract':{
        rate('ai:'+auth.hash,40);
        const roleId=S.text(b.roleId,100);S.chatAllowed(S.role(read(),roleId));
        if(inFlight+runtime.active>=8)S.fail('模型服务正忙，请稍后再试',429,'PROVIDER_BUSY');
        inFlight++;
        try{
          const added=await require('./lib/engine/modules/memory.cjs').extractForRole({getState:read,mutate,roleId,dataDir,onUsage:runtime.onUsage,manual:true});
          return json(res,200,{added,state:S.publicState(read())});
        }finally{inFlight--;}
      }
      case '/api/engine/timezone':{
        const timezone=Time.validateTimezone(b.timezone),result=mutate(s=>{s.settings.timezone=timezone;Jobs.rescheduleTimezone(s);});
        return json(res,200,{state:S.publicState(result.state)});
      }
      case '/api/engine/jobs/save':{
        const roleId=S.text(b.roleId,100),id=b.id===undefined?null:S.text(b.id,100);
        const result=mutate(s=>{
          S.chatAllowed(S.role(s,roleId));
          const reminder={note:b.note,schedule:b.schedule};
          return id===null?Jobs.add(s,roleId,{...reminder,userRequested:true}):Jobs.edit(s,roleId,id,reminder);
        });
        return json(res,200,{job:result.value,state:S.publicState(result.state)});
      }
      case '/api/engine/jobs/delete':{
        const roleId=S.text(b.roleId,100),id=S.text(b.id,100),result=mutate(s=>Jobs.remove(s,roleId,id));runtime.cancelJob(id);
        return json(res,200,{state:S.publicState(read())});
      }
      case '/api/engine/typing':{
        const r=S.role(read(),S.text(b.roleId,100));S.chatAllowed(r);
        if(b.active===false)runtime.userStoppedTyping(r.id);else runtime.userTyping(r.id);
        return json(res,200,{ok:true});
      }
      case '/api/engine/chat-cancel':{
        const role=S.role(read(),S.text(b.roleId,100));
        const cancelled=runtime.cancelSlowChat(role.id);
        return json(res,200,{cancelled,state:S.publicState(read())});
      }
      case '/api/providers/test':rate('ai:'+auth.hash,40);
      return json(res,200,await AI.test(read(),b.capability,{onUsage:runtime.onUsage}));
      case '/api/providers/models':rate('ai:'+auth.hash,40);
      return json(res,200,{
        models:await AI.models(read(),b.capability)
      });
      case '/api/ledger/recognize':rate('ai:'+auth.hash,40);
      return json(res,200,{
        drafts:await AI.recognize(read(),S.image(b.image,false),{onUsage:runtime.onUsage,dataDir})
      });
      case '/api/voice/transcribe':{
        rate('ai:'+auth.hash,40);
        if(inFlight+runtime.active>=8)S.fail('模型服务正忙，请稍后再试',429,'PROVIDER_BUSY');
        inFlight++;
        try{
        const s=read();
        if(b.messageId===undefined){
          if(b.roleId!==undefined)S.chatAllowed(S.role(s,S.text(b.roleId,100)));
          return json(res,200,{text:await AI.transcribe(s,S.audio(b.audio),{onUsage:runtime.onUsage,dataDir}),...(options.demoModel?{demo:true}:{})});
        }
        if(b.audio!==undefined)S.fail('消息转文字不能另传音频');
        const m=S.find(s.messages,S.text(b.messageId,100),'语音消息');
        S.chatAllowed(S.role(s,m.roleId));
        if(m.type!=='voice'||!m.meta?.audio)S.fail('只有语音消息可以转文字');
        if(m.meta.transcript?.trim())return json(res,200,{text:m.meta.transcript,state:S.publicState(s),...(m.meta.transcriptSource==='demo'?{demo:true}:{})});
        const understanding=await AI.understandVoice(s,m.meta.audio,{onUsage:runtime.onUsage,dataDir});
        const transcript=understanding.text.trim();
        if(!transcript)S.fail('语音未识别出文字，请重试',502,'PROVIDER_RESPONSE');
        const result=mutate(latest=>{
          S.chatAllowed(S.role(latest,m.roleId));
          const current=S.find(latest.messages,m.id,'语音消息');
          if(current.type!=='voice'||current.meta?.audio!==m.meta.audio)S.fail('语音消息已更改，请重试',409,'CONFLICT');
          Object.assign(current.meta,{transcript,contentEmotion:understanding.contentEmotion,voiceEmotion:understanding.voiceEmotion});
          current.meta.transcriptSource=options.demoModel?'demo':'provider';
        });
        return json(res,200,{text:transcript,state:S.publicState(result.state),...(options.demoModel?{demo:true}:{})});
        }finally{inFlight--;}
      }
      case '/api/voice/speak':{
        rate('ai:'+auth.hash,40);
        if(inFlight+runtime.active>=8)S.fail('模型服务正忙，请稍后再试',429,'PROVIDER_BUSY');
        inFlight++;
        try{
        const s=read(),m=S.find(s.messages,b.messageId),r=S.role(s,m.roleId);
        S.chatAllowed(r);
        if(m.sender==='system')S.fail('系统提示不能朗读');
        if(m.type!=='text'||!m.content.trim())S.fail('只有文本消息可朗读');
        const voiceMod=require('./lib/engine/modules/voice.cjs');
        const spokenText=voiceMod.cleanSpeechText(m.content);
        const audio=await AI.speak(s,spokenText,{onUsage:runtime.onUsage,voice:m.sender==='assistant'?voiceMod.resolveVoice(s,r):undefined,demoModel:options.demoModel,dataDir});
        const result=mutate(latest=>{
          S.chatAllowed(S.role(latest,m.roleId));
          const message=latest.messages.find(x=>x.id===m.id);
          if(message){
            if(message.content!==m.content||message.type!==m.type)S.fail('消息在朗读期间已更改，请重试',409,'CONFLICT');
            message.meta={
              ...(message.meta||{}),audio
            };
          }
        });
        return json(res,200,{
          audio,state:S.publicState(result.state)
        });
        }finally{inFlight--;}
      }
      case '/api/restore':{
        if(b.confirm!==true)S.fail('恢复需要 confirm: true');
        if(inFlight||runtime.typingState().length)S.fail('模型请求进行中，请完成后再恢复',409,'BUSY');
        const current=read(),restored=S.validateBackup(b.backup,current);
        const modelKeyCounts=Models.restoreBackupKeys(restored.settings.ai,b.backup.modelKeys);
        checkProviderUrls(restored);
        const MemoryStore=require('./lib/engine/memory-store.cjs');
        const living=MemoryStore.validateBackup(b.backup.livingMemory,restored);
        if(b.backup.media!==undefined)require('./lib/media-store.cjs').restoreImages(dataDir,restored,b.backup.media);
        Media.externalize(dataDir,restored);
        Object.defineProperty(restored,Symbol.for('pipi.mediaDir'),{value:dataDir});
        S.limit(restored);
        const detach=living?MemoryStore.attachBackup(db,dataDir):null;
        try{
          transaction(()=>{
            if(living)MemoryStore.restoreAttached(db,living,restored);
            restored.revision=current.revision+1;
            db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(restored));
            db.exec('DELETE FROM requests');
          });
        }finally{detach?.();}
        publish('revision',{revision:restored.revision});
        // Restored stickers still waiting for analysis continue without a restart; the restore itself has already succeeded.
        try{stickerQueue.recover();stickerQueue.idle().catch(error=>console.error('Sticker analysis failed after restore:',error?.stack||String(error)));}
        catch(error){console.error('Unable to resume sticker analysis after restore:',error?.stack||String(error));}
        const previousAI=Models.sanitize(current.settings.ai),state=S.publicState(restored);
        const clearedModelKeys=state.settings.ai.sources.some(source=>
          !source.keySet&&previousAI.sources.some(previous=>previous.id===source.id&&previous.keySet));
        return json(res,200,{state,clearedModelKeys,...modelKeyCounts});
      }
      default:S.fail('接口不存在',404,'NOT_FOUND');
    }
  }
  function staticFile(req,res,pathname){
    if(pathname==='/life-preview.html'&&!options.lifePreview)S.fail('独立验收页仅在隔离实例开放',404,'NOT_FOUND');
    if(!['GET','HEAD'].includes(req.method))S.fail('页面不存在',404);
    let decoded;
    try{
      decoded=decodeURIComponent(pathname);
    }
    catch{
      S.fail('路径无效');
    }
    if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').some(x=>x.startsWith('.')&&x!==''))S.fail('页面不存在',404);
    const root=path.resolve(__dirname,'public'),file=path.resolve(root,'.'+decoded+(decoded.endsWith('/')?'index.html':''));
    if(!file.startsWith(root+path.sep))S.fail('页面不存在',404);
    let stat;
    try{
      const real=fs.realpathSync(file);
      if(!real.startsWith(fs.realpathSync(root)+path.sep))S.fail('页面不存在',404);
      stat=fs.statSync(real);
      if(!stat.isFile())S.fail('页面不存在',404);
    }
    catch(e){
      if(e.status)throw e;
      S.fail('页面不存在',404);
    }
    const types={
      '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.webmanifest':'application/manifest+json','.woff2':'font/woff2'
    };
    const contentType=types[path.extname(file)];
    if(!contentType)S.fail('文件类型不允许',404);
    if(['.woff2','.svg','.css','.js'].includes(path.extname(file))){
      const etag=`"${stat.size}-${Math.trunc(stat.mtimeMs)}"`;
      res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
      res.setHeader('ETag',etag);
      if(req.headers['if-none-match']===etag){res.writeHead(304);res.end();return;}
    }
    res.writeHead(200,{
      'Content-Type':contentType,'Content-Length':stat.size
    });
    if(req.method==='HEAD')res.end();
    else fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }
  const server=http.createServer((req,res)=>{
    route(req,res).catch(e=>{
      // Expected failures carry a status; anything else is a server bug that must leave a trace in the log.
      if(!e?.status)console.error('Unexpected server error:',req.method,String(req.url||'').split('?')[0],e);
      json(res,e?.status||500,{
        error:e?.status?e.message:'服务器处理失败',code:e?.code||'SERVER_ERROR',...(e?.keyRevisions?{keyRevisions:e.keyRevisions}:{}),...(e?.includeState&&!closed?{
          state:S.publicState(read())
        }:{})
      });
    });
  });
  // Large backups and memory imports can take minutes to upload; headersTimeout still limits slow request headers.
  server.requestTimeout=15*60*1000;
  server.headersTimeout=15000;
  server.keepAliveTimeout=5000;
  runtime=Runtime.create({getState:read,mutate,publish,isInitialized:async()=>Boolean(getMeta('password'))&&!await updateMaintenance(),externalBusy:()=>inFlight,demoModel:options.demoModel,dataDir});
  stickerQueue=Stickers.create({getState:read,mutate,dataDir,onUsage:runtime.onUsage});
  try{stickerQueue.recover();}catch(error){console.error('Unable to resume sticker analysis during startup:',error?.stack||String(error));}
  return {
    server,db,dataDir,listen(listenPort=port,listenHost=host){
      return new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(listenPort,listenHost,()=>{
          server.removeListener('error',reject);
          resolve(server.address());
        });
      });
    },async close(){
      closed=true;
      await stickerQueue.close();
      for(const client of clients)client.res.end();clients.clear();
      await runtime.close();
      if(server.listening)await new Promise(resolve=>{
        server.close(resolve);
        server.closeIdleConnections();
      });
      require('./lib/engine/memory-store.cjs').close(dataDir);
      db.close();
    }
  };
}
module.exports={
  createApp
};
if(require.main===module){
  // A failed background task is logged; it must not take the whole service down.
  process.on('unhandledRejection',error=>console.error('Unhandled background error:',error?.stack||String(error)));
  const app=createApp();
  app.listen().then(address=>console.log(`Pipi Phone ${VERSION} listening on ${address.address}:${address.port}`)).catch(error=>{
    if(error?.code==='EADDRINUSE')console.error(`Port ${error.port??''} is already in use by another program.`);
    else{console.error('Unable to start Pipi Phone. Check port and data directory.');if(error)console.error(String(error.message||error));}
    process.exitCode=1;
  });
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
    app.close().then(()=>process.exit(0));
  });
}
