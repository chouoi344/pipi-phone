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
const ModelImages=require('./lib/engine/model-images.cjs');
const {Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const requestDeadline=Symbol('pipi.requestDeadline');
const {createUpdateService}=require('./lib/updates.cjs');
const {createAndroidUpdateService}=require('./lib/android-updates.cjs');
const JsonResponse=require('./lib/json-response.cjs');
const RequestLimits=require('./lib/request-limits.cjs');
const ClientSync=require('./lib/client-sync.cjs');
const Waterdrop=require('./lib/waterdrop-activation.cjs');
const scrypt=promisify(crypto.scrypt),VERSION=require('./package.json').version;
// Server-only releases keep the cache key shipped in the current web and Android UI.
const ICON_VERSION='0.13.13';
const MAX_BACKUP_BYTES=88*1024*1024;
const zlib=require('node:zlib');
const compressibleStatic=new Set(['.html','.js','.css','.svg','.webmanifest']),staticCache=new Map();
const brotliAsync=promisify(zlib.brotliCompress),gzipAsync=promisify(zlib.gzip);
// Static files never change while running, so spend more CPU once (quality 9) and serve the cached bytes afterwards.
const staticCompress=(bytes,encoding)=>encoding==='br'?brotliAsync(bytes,{params:{[zlib.constants.BROTLI_PARAM_QUALITY]:9,[zlib.constants.BROTLI_PARAM_SIZE_HINT]:bytes.length}}):gzipAsync(bytes,{level:9});
const UPDATE_MAINTENANCE_PHASES=new Set(['backing-up','installing','verifying','rolling-back']);
const safeEqual=(a,b)=>{
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length===y.length&&crypto.timingSafeEqual(x,y);
};
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
// Limit concurrent scrypt operations to prevent DoS on low-memory systems
const scryptSemaphore={count:0,max:2,queue:[]};
function acquireScryptSlot(){
  return new Promise(resolve=>{
    if(scryptSemaphore.count<scryptSemaphore.max){scryptSemaphore.count++;resolve();}
    else scryptSemaphore.queue.push(resolve);
  });
}
function releaseScryptSlot(){
  scryptSemaphore.count--;
  const next=scryptSemaphore.queue.shift();
  if(next){scryptSemaphore.count++;next();}
}
function createApp(options={}){
  const proxy=require('./lib/trusted-proxy.cjs').create(options.trustProxy??process.env.TRUST_PROXY??'');
  const updateDir=options.updates?.updateDir??process.env.PIPI_UPDATE_DIR;
  const updates=createUpdateService({
    repository:process.env.PIPI_UPDATE_REPOSITORY,
    currentVersion:VERSION,
    ...options.updates,
    updateDir
  });
  const androidUpdates=createAndroidUpdateService(options.androidUpdates);
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
  db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('installationId',crypto.randomUUID());
  const installationId=getMeta('installationId');
  const publicKeyInput=options.waterdropPublicKey||fs.readFileSync(path.join(__dirname,'lib','waterdrop-public.pem'));
  const waterdropPublicKey=publicKeyInput instanceof crypto.KeyObject?publicKeyInput:crypto.createPublicKey(publicKeyInput);
  if(waterdropPublicKey.asymmetricKeyType!=='ed25519')throw new Error('水滴激活公钥必须为 Ed25519');
  const appearance=()=>({installationId,waterdropActivated:Waterdrop.verifyCode(installationId,getMeta('waterdropCode'),waterdropPublicKey)});
  if(!db.prepare('SELECT id FROM app WHERE id=1').get()){
    const initialState=options.initialState||S.initial;
    db.prepare('INSERT OR IGNORE INTO app(id,json) VALUES(1,?)').run(JSON.stringify(initialState()));
  }
  try{require('./lib/password-reset.cjs').apply({requested:options.resetPassword??process.env.RESET_PASSWORD==='1',dataDir,getMeta,setMeta,db,transaction});}
  catch(error){db.close();throw error;}
  // Older stored settings can predate timezone validation. Check once per changed value.
  let previousZone, storedZone;
  const parse=(json,beforeDefaults)=>{
    const state=JSON.parse(json);
    // Capture stored values before time-dependent defaults (for example status expiry) change them.
    beforeDefaults?.(state);
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
    if(defaults.settings.timezone){
      const zone=defaults.settings.timezone;
      if(zone!==previousZone){
        try{storedZone=Time.validateTimezone(zone);}
        catch(error){if(error.code!=='VALIDATION')throw error;storedZone='UTC';}
        previousZone=zone;
      }
      defaults.settings.timezone=storedZone;
    }
    Object.defineProperty(defaults,Symbol.for('pipi.mediaDir'),{value:dataDir});
    if(options.lifePreview)Object.defineProperty(defaults,Symbol.for('pipi.lifePreview'),{value:true});
    return defaults;
  };
  const storedJson=()=>db.prepare('SELECT json FROM app WHERE id=1').get().json;
  const read=()=>parse(storedJson());
  const syncJournal=ClientSync.createJournal({revision:read().revision,...options.clientSync});
  const clientSync=ClientSync.createReader({db,parse,state:S,journal:syncJournal});
  const stateResponse=(req,state,extra={})=>req.headers['x-pipi-state-mode']==='delta'?{...extra,sync:clientSync.view(req.headers['x-pipi-sync-cursor'])}:{...extra,state:S.publicState(typeof state==='function'?state():state)};
  const androidFcm=require('./lib/android-fcm.cjs').create({
    credentialFile:process.env.PIPI_FCM_SERVICE_ACCOUNT_FILE,...options.fcm,getMeta,setMeta,getState:read,
    sessionValid:hash=>Boolean(db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash,Date.now())),
    sessionScope:androidSessionScope
  });
  const clients=new Set();let runtime,stickerQueue;
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
  function mutate(fn,{messages=true}={}){
    let notificationSnapshot,syncBefore;
    const result=transaction(()=>{
      const json=storedJson(),state=S.limitBaseline(parse(json,stored=>{syncBefore=syncJournal.capture(stored,{messages});}),Buffer.byteLength(json));
      notificationSnapshot=androidFcm.snapshot(state);
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
    syncJournal.commit(syncBefore,result.state);
    publish('revision',{revision:result.state.revision});
    androidFcm.publish(notificationSnapshot,result.state);
    return result;
  }
  const {migrateLegacy,diskSpace,prepareLargeLegacyBackup}=require('./lib/media-migration.cjs');
  const migrationKey='mediaMigration',retentionStartKey='mediaRetentionStartedAt';
  const readMigration=()=>JSON.parse(getMeta(migrationKey)||'null');
  migrateLegacy({
    dataDir,state:read(),previous:readMigration(),readSpace:options.mediaMigrationSpace,
    now:options.mediaMigrationClock,saveImage:Media.saveImage,saveAudio:Media.saveAudio,
    makeLargeBackup:state=>prepareLargeLegacyBackup(dataDir,backupPayload(state,true),VERSION),
    makeBackup(state){
      try{return buildLegacyBackup(state,true);}
      catch(error){
        if(error?.status===413)error.userMessage='旧格式升级备份超过大小限制，已保留原资料。';
        throw error;
      }
    },
    saveProgress:result=>setMeta(migrationKey,JSON.stringify(result)),
    complete(state,result,changed){
      transaction(()=>{
        if(changed){
          state.revision++;
          db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(state));
        }
        setMeta(migrationKey,JSON.stringify(result));
        if(!getMeta(retentionStartKey))setMeta(retentionStartKey,String(result.completedAt));
      });
    }
  });
  const migrated=read();Jobs.recover(migrated);
  const migratedJson=JSON.stringify(migrated);
  if(migratedJson!==storedJson())db.prepare('UPDATE app SET json=? WHERE id=1').run(migratedJson);
  const Retention=require('./lib/media-retention.cjs'),mediaClock=options.mediaClock||Date.now;
  const mediaSpace=options.mediaDiskSpace||diskSpace;
  const cleanupKey='lastMediaCleanup',pressureKey='lastEarlyMediaCleanup';
  const lastCleanup=key=>JSON.parse(getMeta(key)||'null');
  const retentionStartedAt=()=>getMeta(retentionStartKey)===undefined?Infinity:Number(getMeta(retentionStartKey));
  let mediaTimer,storageOperation=null,storageUsage=null,usageAt=0,measuring=null;
  const disk=()=>mediaSpace(dataDir);
  const memoryMedia=state=>require('./lib/engine/memory-store.cjs').exportBackup(dataDir,state);
  const mediaFile=ref=>{const name=Retention.storedFilename(ref);return name?Media.describeMediaFile(dataDir,name):null;};
  const mediaBytes=ref=>mediaFile(ref)?.size||0;
  function measureStorage(){
    if(measuring||(storageUsage&&mediaClock()-usageAt<30000))return;
    measuring=Retention.mediaUsage(dataDir).then(mediaBytes=>{
      if(closed)return;
      const space=disk(),textBytes=db.prepare('SELECT length(CAST(json AS BLOB)) AS size FROM app WHERE id=1').get().size;
      storageUsage={mediaBytes,textBytes,diskFreeBytes:space.available,diskTotalBytes:space.size};
      usageAt=mediaClock();
    }).catch(error=>console.error('读取存储空间失败',error)).finally(()=>{measuring=null;});
  }
  function storageView(state=read()){
    measureStorage();
    const {status,detail,startedAt,completedAt,beforeBytes,afterBytes,migratedCount,backupName}=readMigration()||{};
    return {
      retention:state.settings.mediaRetentionDays,usage:storageUsage,calculating:Boolean(measuring),
      lastCleanup:lastCleanup(cleanupKey),lastEarlyCleanup:lastCleanup(pressureKey),
      migration:{status,detail,startedAt,completedAt,beforeBytes,afterBytes,migratedCount,backupName}
    };
  }
  function scanOrphans(state,at){
    const removed=Retention.cleanOrphans(dataDir,Retention.mediaReferences(state,memoryMedia(state)),at);
    if(removed.count)usageAt=-Infinity;
    return removed;
  }
  function expireMedia(state,items,days,at,pressure){
    const ids=Retention.expire(state,items,at);
    const cutoff=pressure||days==='forever'?-Infinity:at-days*Retention.day;
    if(pressure||retentionStartedAt()<=cutoff)Retention.pruneRoleMedia(state,cutoff,ids);
  }
  function recordCleanup(key,items,state,at){
    const affected=Retention.affected(items,mediaBytes),removed=scanOrphans(state,at);
    setMeta(key,JSON.stringify({at,...affected,files:removed.count,releasedBytes:removed.bytes}));
    usageAt=-Infinity;
  }
  function requireMediaSpace(bytes){
    const enough=()=>{const space=disk();return space.available>=space.reserve+bytes;};
    if(enough())return;
    if(!storageOperation&&!db.isTransaction&&!closed){
      const at=mediaClock(),state=read(),extra=memoryMedia(state);
      scanOrphans(state,at);
      if(enough())return;
      const space=disk(),items=Retention.candidates(state,{days:7,startedAt:retentionStartedAt(),now:at,pressure:true});
      const selected=Retention.pressuredCandidates(state,extra,items,ref=>{
        const file=mediaFile(ref);
        return file&&file.mtimeMs<=at-Retention.day?file.size:0;
      },space.reserve+bytes-space.available);
      if(selected.length){
        const next=mutate(s=>expireMedia(s,selected,s.settings.mediaRetentionDays,at,true)).state;
        recordCleanup(pressureKey,selected,next,at);
      }
      if(enough())return;
    }
    S.fail('服务器硬盘空间不足，请清理服务器上的其他文件，或在设置里缩短图片保存时长',507,'DISK_SPACE');
  }
  const removeSpaceCheck=Media.installSpaceCheck(dataDir,requireMediaSpace);
  const streamingBackup=require('./lib/streaming-backup.cjs').create({dataDir,version:VERSION,now:options.backupClock||Date.now,checkSpace:requireMediaSpace});
  const transfers=new Set();
  function storageLock(kind){
    if(storageOperation)S.fail('资料正在备份或恢复，请稍后重试',409,'BUSY');
    const operation=kind==='restore'?'restore':Symbol(kind);storageOperation=operation;
    return ()=>{if(storageOperation===operation)storageOperation=null;};
  }
  function assertWritable(){
    if(closed)S.fail('服务器正在关闭，请稍后重试',503,'SERVER_CLOSING');
    if(storageOperation==='restore')S.fail('资料正在恢复，请稍后重试',409,'BUSY');
  }
  function restoreBusy(){
    return inFlight||activeUploads||runtime.active||runtime.backgroundBusy||runtime.typingState().length||Object.values(read().stickerSemantics||{}).some(item=>['queued','analyzing'].includes(item.status));
  }
  async function transfer(req,res,operation,{idle=false}={}){
    const controller=new AbortController(),item={controller};transfers.add(item);
    const abort=message=>{if(!controller.signal.aborted)controller.abort(Object.assign(new Error(message),{status:408,code:'BACKUP_INTERRUPTED'}));};
    const canceled=()=>{if(!res.writableFinished)abort('备份传输已中断，请重试');},timeout=()=>abort('备份传输超过两分钟没有数据，请重试');
    const destroy=()=>{if(!req.readableEnded)req.destroy(controller.signal.reason);if(!res.destroyed)res.destroy(controller.signal.reason);};
    controller.signal.addEventListener('abort',destroy,{once:true});
    req.once('aborted',canceled);res.once('close',canceled);
    if(idle){req[requestDeadline]?.('streaming');req.socket.setTimeout(options.backupInactivityMs??120000,timeout);}
    item.done=(async()=>{
      try{return await operation(controller.signal);}
      catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw error;}
      finally{req.off('aborted',canceled);res.off('close',canceled);controller.signal.removeEventListener('abort',destroy);if(idle){req.socket.off('timeout',timeout);req.socket.setTimeout(res.writableEnded?server.keepAliveTimeout:0);}transfers.delete(item);}
    })();
    return item.done;
  }

  async function periodicMediaCleanup(){
    try{
      if(closed||storageOperation||await updateMaintenance()||closed||storageOperation)return;
      const state=read(),days=state.settings.mediaRetentionDays,at=mediaClock();
      const items=Retention.candidates(state,{days,startedAt:retentionStartedAt(),now:at});
      const oldRoleMedia=days!=='forever'&&retentionStartedAt()<=at-days*Retention.day&&state.engine.data.actions?.roleMedia?.some(item=>item.createdAt<=at-days*Retention.day);
      const next=items.length||oldRoleMedia?mutate(s=>expireMedia(s,items,days,at,false)).state:state;
      if(items.length||oldRoleMedia||at-(lastCleanup(cleanupKey)?.at||0)>=Retention.day)recordCleanup(cleanupKey,items,next,at);
    }catch(error){console.error('清理聊天媒体失败',error);}
    finally{if(!closed){mediaTimer=setTimeout(periodicMediaCleanup,3600000);mediaTimer.unref();}}
  }
  if(options.mediaTimers!==false){mediaTimer=setTimeout(periodicMediaCleanup,120000);mediaTimer.unref();}
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
  let setupAllowed=!getMeta('password');
  const requireSetupToken=options.requireSetupToken??process.env.REQUIRE_SETUP_TOKEN==='1';
  const setupTokenRequired=()=>getMeta('passwordResetPending')==='1'||requireSetupToken;
  let setupToken=getMeta('setupToken');
  if(!setupToken&&setupAllowed&&setupTokenRequired()){
    setupToken=crypto.randomBytes(24).toString('hex');
    setMeta('setupToken',setupToken);
  }
  const tokenFile=path.join(dataDir,'setup-token.txt');
  if(setupToken&&setupAllowed&&setupTokenRequired()&&(!fs.existsSync(tokenFile)||fs.readFileSync(tokenFile,'utf8').trim()!==setupToken))fs.writeFileSync(tokenFile,setupToken+'\n',{mode:0o600});
  const host=options.host||process.env.HOST||'127.0.0.1',port=options.port??Number(process.env.PORT||18766);
  const allowedHosts=new Set(['localhost','127.0.0.1','[::1]',host,...String(process.env.ALLOWED_HOSTS||'').split(',').map(x=>x.trim()).filter(Boolean)]);
  const limits=RequestLimits.create(),rate=limits.consume;
  let inFlight=0,activeUploads=0,closed=false;
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
  // Static files revalidate with ETag, so a return visit reuses the cached page instead of reloading it.
  // Everything else (API responses, backups, the issuer page) carries private data and must never be cached.
  function cacheControl(pathname,method){
    if(method!=='GET'&&method!=='HEAD')return 'no-store';
    let decoded;
    try{decoded=decodeURIComponent(pathname);}catch{return 'no-store';}
    const file=decoded.endsWith('/')?decoded+'index.html':decoded;
    const ext=path.extname(file);
    if(ext&&ext!=='.html'&&ext!=='.webmanifest')return 'no-store';
    if(file!=='/index.html'&&file!=='/life-preview.html')return 'no-store';
    return 'public, max-age=0, must-revalidate';
  }
  function security(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control',cacheControl(String(req.url||'').split('?')[0],req.method));
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
    const bytes=Buffer.from(JSON.stringify(value)),accepted=JsonResponse.negotiate(res.req?.headers['accept-encoding']);
    res.setHeader('Vary',JsonResponse.vary(res.getHeader('Vary')));
    const send=(payload,encoding)=>{
      if(res.destroyed||res.writableEnded)return;
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':payload.length,...(encoding?{'Content-Encoding':encoding}:{})});
      res.end(payload);
    };
    if(bytes.length>1024&&accepted.encoding)return JsonResponse.compress(bytes,accepted.encoding).then(payload=>send(payload,accepted.encoding));
    if(!accepted.identityAllowed){res.writeHead(406,{'Content-Length':0});res.end();return;}
    return send(bytes);
  }
  function backupPayload(current,includeModelKeys){
    const MemoryStore=require('./lib/engine/memory-store.cjs');
    const state=S.backupState(current);
    const payload={format:'pipi-phone',version:1,exportedAt:new Date().toISOString(),state,livingMemory:MemoryStore.exportBackup(dataDir,current)};
    if(includeModelKeys)payload.modelKeys=Models.backupKeys(current.settings.ai);
    return payload;
  }
  function buildLegacyBackup(current,includeModelKeys){
    const payload=backupPayload(current,includeModelKeys);
    const remaining=MAX_BACKUP_BYTES-Buffer.byteLength(JSON.stringify({backup:payload,confirm:true}))-10;
    if(remaining<2)S.fail('备份资料超过大小限制',413);
    payload.media=Media.backupImages(dataDir,payload.state,remaining);
    return payload;
  }
  function downloadBackup(res,includeModelKeys=false){
    if(storageOperation)S.fail('资料正在备份或恢复，请稍后重试',409,'BUSY');
    const operation=Symbol('backup');
    storageOperation=operation;
    const unlock=()=>{if(storageOperation===operation)storageOperation=null;};
    try{
      const payload=buildLegacyBackup(read(),includeModelKeys);
      res.once('finish',unlock);
      res.once('close',unlock);
      res.setHeader('Content-Disposition',`attachment; filename="pipi-backup-${payload.exportedAt.slice(0,10)}.json"`);
      return json(res,200,payload);
    }catch(error){unlock();throw error;}
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
    req[requestDeadline]?.('authenticated');
    return auth;
  }
  async function passwordHash(password,salt){
    await acquireScryptSlot();
    try{
      return (await scrypt(password,salt,64,{
        N:16384,r:8,p:1,maxmem:64*1024*1024
      })).toString('hex');
    }finally{releaseScryptSlot();}
  }
  function makeSession(req,res){
    const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions(hash,csrf,expires) VALUES(?,?,?)').run(digest(token),csrf,Date.now()+7*86400000);
    res.setHeader('Set-Cookie',`pipi_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${proxy.context(req).secure||process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
    return {csrfToken:csrf,appSessionScope:androidSessionScope(digest(token))};
  }
  function androidSessionScope(hash){return digest('pipi-android-cache-v1:'+hash);}
  function account(auth){
    const sessionCount=Number(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires>?').get(Date.now()).count);
    return {sessionCount,otherSessionCount:sessionCount-(db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(auth.hash,Date.now())?1:0)};
  }
  function revokeOthers(auth){
    db.prepare('DELETE FROM sessions WHERE hash<>?').run(auth.hash);
    androidFcm.prune();
    for(const client of clients)if(client.hash!==auth.hash){client.res.end();clients.delete(client);}
  }
  function publish(event,data){
    const frame=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for(const client of clients){
      if(client.expires<=Date.now()||client.res.destroyed||client.res.writableEnded){client.res.end();clients.delete(client);continue;}
      if((client.res.writableLength||0)>256*1024){client.res.end();clients.delete(client);continue;}
      client.res.write(frame);
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
    const clientAddress=proxy.context(req).client;
    let u;
    try{
      u=new URL(req.url,'http://'+req.headers.host);
    }
    catch{
      S.fail('URL 无效');
    }
    const p=u.pathname;
    if(!p.startsWith('/api/'))return staticFile(req,res,p,u.searchParams);
    if(req.method==='GET'&&p==='/api/android-shell-manifest')return json(res,200,{...await require('./lib/android-assets.cjs').manifest(),clientProtocol:ClientSync.protocol});
    if(req.method==='GET'&&p==='/api/status'){
      const auth=session(req);
      return json(res,200,{
        setupRequired:!getMeta('password'),authenticated:!!auth,...(auth?{
          csrfToken:auth.csrf,appSessionScope:androidSessionScope(auth.hash),appearance:appearance()
        }:{}),version:VERSION,clientProtocol:ClientSync.protocol,sourceUrl,rolePanel:true,softwareUpdates:true,binaryMedia:true,mediaLimits:{imageBytes:Media.MAX_IMAGE_BYTES,animatedImageBytes:Media.MAX_ANIMATED_BYTES,audioBytes:Media.MAX_AUDIO_BYTES,profileImageBytes:20*1024*1024},imageVariants:true,storageMaintenance:true,streamingBackup:true,accountSecurity:true,setupTokenRequired:setupTokenRequired(),messageLimit:50000,momentExclusions:true
      });
    }
    if(req.method==='POST'&&(p==='/api/setup'||p==='/api/login')){
      const address=RequestLimits.clientKey(clientAddress),failureKey='password:'+address;
      if(p==='/api/setup')rate('setup:'+address,10,15*60000);
      else rate('login:'+address,60,60000);
      const b=await body(req,65536);
      const password=S.text(b.password,256);
      if(p==='/api/setup'){
        if(getMeta('password'))S.fail('已完成初始化',409,'SETUP_DONE');
        if(!setupAllowed)S.fail('账号状态已变化，请由服务器管理员重置密码',403,'SETUP_TOKEN');
        if(setupTokenRequired()&&(!setupToken||!safeEqual(b.setupToken,setupToken)))S.fail('请输入服务器提供的设置令牌',403,'SETUP_TOKEN');
        if(password.length<8)S.fail('密码至少需要 8 个字符');
        const salt=crypto.randomBytes(24).toString('hex'),hash=await passwordHash(password,salt);
        assertWritable();
        transaction(()=>{
          if(getMeta('password'))S.fail('已完成初始化',409);
          setMeta('password',JSON.stringify({
            salt,hash
          }));
          setMeta('setupToken','');
          if(getMeta('passwordResetPending')!=='1'){
            const s=read();s.profile.name=S.text(b.displayName,80,'我');s.revision++;
            db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(s));
          }
          db.prepare("DELETE FROM meta WHERE key='passwordResetPending'").run();
        });
        setupAllowed=false;setupToken='';
        try{
          fs.unlinkSync(path.join(dataDir,'setup-token.txt'));
        }
        catch{}
        return json(res,200,{
          ...makeSession(req,res),state:S.publicState(read()),appearance:appearance()
        });
      }
      return limits.attempt(failureKey,10,async()=>{
        const stored=getMeta('password');
        if(!stored)S.fail('请先初始化',409,'SETUP_REQUIRED');
        const {salt,hash}=JSON.parse(stored);
        if(!safeEqual(await passwordHash(password,salt),hash)){limits.record(failureKey,15*60000);S.fail('密码错误',401,'INVALID_PASSWORD');}
        if(closed)S.fail('服务器正在关闭',503,'CLOSING');
        if(getMeta('password')!==stored)S.fail('密码已更新，请重新登录',401,'INVALID_PASSWORD');
        limits.clear(failureKey);
        return json(res,200,{
          ...makeSession(req,res),state:S.publicState(read()),appearance:appearance()
        });
      });
    }
    const mutating=!['GET','HEAD'].includes(req.method),auth=authorized(req,mutating);
    if(req.method==='GET'&&p==='/api/account')return json(res,200,account(auth));
    if(mutating&&p!=='/api/logout')assertWritable();
    if(req.method==='GET'&&p==='/api/android-updates/latest'){
      rate('android-update-check:'+clientAddress,15);
      const release=await androidUpdates.latest();authorized(req);
      return json(res,200,release);
    }
    if(req.method==='GET'&&p.startsWith('/api/android-updates/apk/')){
      rate('android-update-download:'+clientAddress,6);
      const asset=await androidUpdates.open(p.slice('/api/android-updates/apk/'.length));
      try{
        authorized(req);
        if(res.destroyed)return;
        res.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Length':asset.release.size,'Content-Disposition':'attachment; filename="'+asset.release.name+'"'});
        try{await pipeline(asset.stream,res);}
        catch(error){if(error.code==='ERR_STREAM_PREMATURE_CLOSE'&&(res.destroyed||closed))return;throw error;}
      }finally{asset.stream.destroy();}
      return;
    }
    if(req.method==='GET'&&p==='/api/updates/status')return json(res,200,await updates.status());
    if(req.method==='GET'&&p==='/api/updates/check'){
      rate('update-check:'+clientAddress,15);
      return json(res,200,await updates.check({force:u.searchParams.get('refresh')==='1'}));
    }
    if(req.method==='POST'&&p==='/api/updates/install'){
      rate('update-install:'+clientAddress,6);
      const input=await body(req,4096);authorized(req,true);assertWritable();
      return json(res,202,await updates.request(input));
    }
    if(mutating&&p!=='/api/logout'&&await updateMaintenance())S.fail('小手机正在更新，请稍后再试',503,'UPDATE_IN_PROGRESS');
    if(mutating&&p!=='/api/logout'&&storageOperation==='restore')S.fail('资料正在恢复，请稍后重试',409,'BUSY');
    if(req.method==='POST'&&['/api/android/fcm/register','/api/android/fcm/unregister'].includes(p)){
      rate('android-fcm:'+auth.hash,60,60000);
      const input=await body(req,8192),currentAuth=authorized(req,true);assertWritable();
      const origin=new URL(req.headers.origin||`${proxy.context(req).secure?'https':'http'}://${req.headers.host}`).origin;
      return json(res,200,p.endsWith('/register')?androidFcm.register(currentAuth,input,origin):androidFcm.unregister(currentAuth,input));
    }
    if(req.method==='GET'&&p==='/api/appearance')return json(res,200,appearance());
    if(req.method==='POST'&&p==='/api/appearance/waterdrop'){
      const input=await body(req,4096);authorized(req,true);assertWritable();
      if(typeof input.code!=='string'||!input.code.trim())S.fail('请填写水滴激活码',400,'WATERDROP_CODE_REQUIRED');
      const code=input.code.trim();
      if(!/^PIPI-W1-[A-Za-z0-9_-]{86}$/.test(code))S.fail('水滴激活码格式无效，请检查是否完整复制',400,'WATERDROP_CODE_INVALID');
      if(!Waterdrop.verifyCode(installationId,code,waterdropPublicKey))S.fail('水滴激活码与当前安装不匹配，请核对安装编号',400,'WATERDROP_CODE_MISMATCH');
      setMeta('waterdropCode',code);
      return json(res,200,appearance());
    }
    if(req.method==='GET'&&p==='/api/backup/download'){
      const unlock=storageLock('download');
      let snapshot;
      try{snapshot=streamingBackup.take(S.text(u.searchParams.get('token'),100),auth.hash);}catch(error){unlock();throw error;}
      return await transfer(req,res,async signal=>{
        let disposing;
        const dispose=()=>disposing??=snapshot.dispose();
        const archive=(async function*(){
          let last;
          for await(const chunk of streamingBackup.pack(snapshot.entries)){if(last)yield last;last=chunk;}
          // Hold the final TAR padding until cleanup finishes: clients can complete a
          // Content-Length response before pipeline's finally has otherwise run.
          await dispose();unlock();
          yield last;
        })();
        try{
          res.writeHead(200,{'Content-Type':'application/x-tar','Content-Disposition':`attachment; filename="${snapshot.filename}"`,'Content-Length':snapshot.estimatedBytes});
          await pipeline(Readable.from(archive),res,{signal});
        }finally{try{await dispose();}finally{unlock();}}
      },{idle:true});
    }
    if(req.method==='POST'&&p==='/api/restore/tar'){
      const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
      if(!['application/x-tar','application/octet-stream'].includes(type))S.fail('请选择 TAR 备份文件',415);
      if(restoreBusy())S.fail('后台任务进行中，请完成后再恢复',409,'BUSY');
      const unlock=storageLock('restore');
      return await transfer(req,res,async signal=>{
        let received,rollback;
        try{
          received=await streamingBackup.receive({readable:req.iterator({destroyOnReturn:false}),signal});
          authorized(req,true);
          if(restoreBusy())S.fail('后台任务进行中，请完成后再恢复',409,'BUSY');
          const current=read(),payload=received.payload,restored=S.validateBackup(payload,current);
          const modelKeyCounts=Models.restoreBackupKeys(restored.settings.ai,payload.modelKeys);checkProviderUrls(restored);
          const MemoryStore=require('./lib/engine/memory-store.cjs'),living=MemoryStore.validateBackup(payload.livingMemory,restored);
          const available=ref=>{if(!Media.isMediaUrl(ref)&&!Media.isAudioMediaUrl(ref))return false;const name=ref.slice('/api/media/'.length);return received.files.has(name)||Boolean(Media.describeMediaFile(dataDir,name));};
          if(!received.manifest.includeMedia)streamingBackup.missingMedia(restored,available,mediaClock());
          else for(const name of Media.backupReferences(restored))if(!received.files.has(name)&&!Media.describeMediaFile(dataDir,name))S.fail('完整备份缺少已引用的媒体',400,'BACKUP_MEDIA');
          rollback=await streamingBackup.merge(received,{state:restored,livingMemory:payload.livingMemory});
          Object.defineProperty(restored,Symbol.for('pipi.mediaDir'),{value:dataDir});S.limit(restored);signal.throwIfAborted();
          if(closed||storageOperation!=='restore')S.fail('恢复已中断，原资料已保留',503,'SERVER_CLOSING');
          authorized(req,true);
          if(restoreBusy())S.fail('后台任务进行中，请完成后再恢复',409,'BUSY');
          const commit=()=>{transaction(()=>{if(living)MemoryStore.restoreAttached(db,living,restored);restored.revision=current.revision+1;db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(restored));db.exec('DELETE FROM requests');});rollback=null;};
          if(living)MemoryStore.withRestoreJournal(db,dataDir,commit);else commit();
          syncJournal.reset(restored.revision);
          publish('revision',{revision:restored.revision});
          try{stickerQueue.recover();stickerQueue.idle().catch(error=>console.error('恢复后表情识别失败',error));}catch(error){console.error('恢复后无法继续表情识别',error);}
          const previousAI=Models.sanitize(current.settings.ai),state=S.publicState(restored),clearedModelKeys=state.settings.ai.sources.some(source=>!source.keySet&&previousAI.sources.some(previous=>previous.id===source.id&&previous.keySet));
          await received.dispose();received=null;
          return json(res,200,{state,clearedModelKeys,...modelKeyCounts});
        }finally{try{if(rollback)await rollback();}finally{unlock();if(received)await received.dispose();}}
      },{idle:true});
    }

    if(req.method==='GET'&&p==='/api/storage'){
      return json(res,200,storageView());
    }
    if(req.method==='GET'&&p==='/api/android/notifications'){
      return json(res,200,require('./lib/android-notifications.cjs').view(read(),u.searchParams.get('cursor')));
    }
    if(req.method==='GET'&&p==='/api/android/fcm'){
      return json(res,200,{...androidFcm.status(auth),appSessionScope:androidSessionScope(auth.hash),csrfToken:auth.csrf});
    }
    if(req.method==='GET'&&p==='/api/state'){
      // Background refresh sends the revision it already has; an unchanged revision skips re-sending the whole state.
      const since=u.searchParams.get('since');
      if(since!==null){
        const revision=db.prepare("SELECT json_extract(json,'$.revision') AS revision FROM app WHERE id=1").get()?.revision;
        if(revision!==null&&revision!==undefined&&String(revision)===since)return json(res,200,{revision,unchanged:true});
      }
      return json(res,200,S.publicState(read()));
    }
    if(req.method==='GET'&&p==='/api/sync')return json(res,200,clientSync.view(u.searchParams.get('cursor')));
    if(req.method==='GET'&&['/api/messages','/api/messages/search','/api/messages/by-id'].includes(p)){
      const roleId=S.text(u.searchParams.get('roleId'),100);if(!roleId)S.fail('请选择会话');
      if(p==='/api/messages/by-id'){
        const ids=(u.searchParams.get('ids')||'').split(',');
        if(ids.length>100||!ids.every(id=>id&&id.length<=100)||new Set(ids).size!==ids.length)S.fail('请选择 1 到 100 条不同的消息');
        return json(res,200,clientSync.byIds(roleId,ids));
      }
      const limit=S.integer(Number(u.searchParams.get('limit')??50),1,100),beforeId=S.text(u.searchParams.get('beforeId')??undefined,100),query=S.text(u.searchParams.get('q')??undefined,1000).trim(),type=S.enumOf(u.searchParams.get('type')??'all',['all','image','payment','voice','forward','link']);
      const timestamp=key=>{const value=u.searchParams.get(key);if(value===null)return undefined;return S.integer(Number(value),0,8640000000000000);},from=timestamp('from'),to=timestamp('to');if(from!==undefined&&to!==undefined&&from>=to)S.fail('筛选时间范围无效');
      return json(res,200,clientSync.page({roleId,limit,beforeId,...(p==='/api/messages/search'?{query,type,from,to}:{})}));
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
      const byRecent=(a,b)=>(b.lastMentionedAt||0)-(a.lastMentionedAt||0)||b.createdAt-a.createdAt||a.id.localeCompare(b.id);
      if(status==='archived')cards.sort(byRecent);
      if(!grouped&&query.trim()){
        const q=query.trim().toLowerCase();
        cards=cards.filter(c=>[c.content,...c.topics,...c.keyFacts].some(value=>value.toLowerCase().includes(q)));
      }
      const profile=MS.getProfile(dataDir,s,roleId);
      if(grouped){
        const timezone=s.settings.timezone||'UTC',time=require('./lib/engine/time.cjs');
        const monthById=new Map(),counts=new Map();
        for(const card of cards){
          const month=status==='archived'&&card.lastMentionedAt>0?'recent':card.createdAt>0&&card.createdAt<=8.64e15?time.dayKey(card.createdAt,timezone).slice(0,7):'unknown';
          monthById.set(card.id,month);
          counts.set(month,(counts.get(month)||0)+1);
        }
        const months=[...counts].sort(([a],[b])=>a==='recent'?-1:b==='recent'?1:a==='unknown'?1:b==='unknown'?-1:b.localeCompare(a)).map(([month,count])=>({month,count,...(month==='recent'?{label:'最近聊到过'}:{})}));
        const q=query.trim().toLowerCase(),month=q?null:counts.has(requestedMonth)?requestedMonth:months[0]?.month||null;
        cards=cards.filter(card=>q?(card.content.toLowerCase().includes(q)||card.topics.some(t=>t.toLowerCase().includes(q))||card.keyFacts.some(f=>f.toLowerCase().includes(q))):monthById.get(card.id)===month);
        cards.sort(status==='archived'?byRecent:(a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
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
      rate('api:'+clientAddress,30,60000);
      const raw=await rawBody(req,128*1024*1024);
      authorized(req,true);assertWritable();
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
      return json(res,200,stateResponse(req,resImport.state,{result:resImport.value}));
    }
    if(req.method!=='POST')S.fail('接口不存在',404,'NOT_FOUND');
    if(p==='/api/media/upload'&&!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')){
      rate('api:'+clientAddress,180,60000);
      activeUploads++;
      try{const url=await Media.receiveUpload(dataDir,req);authorized(req,true);assertWritable();return json(res,200,{url});}finally{activeUploads--;}
    }
    const b=await body(req,p==='/api/restore'?MAX_BACKUP_BYTES:(p==='/api/action'?64:32)*1024*1024);
    authorized(req,true);
    if(p!=='/api/logout')assertWritable();
    const chatRequest=p==='/api/chat'||p==='/api/chat/send';
    const originalChatMedia=chatRequest?{image:b.image,audio:b.audio}:null;
    if(p!=='/api/restore'){
      const allowed=chatRequest?['thumb','modelImage']:p==='/api/chat/media/thumbnail'?['thumb']:[];
      const pending=[b];
      while(pending.length){
        const value=pending.pop();
        for(const [key,item] of Object.entries(value)){
          if(['thumb','modelImage'].includes(key)&&(value!==b||!allowed.includes(key)))S.fail('缩略图和模型副本只用于聊天图片');
          if(item&&typeof item==='object')pending.push(item);
        }
      }
    }
    if(p!=='/api/restore')Media.externalize(dataDir,b,{image:(value,field)=>S.image(value,false,field==='avatar'?'头像':field==='cover'?'朋友圈背景图':'')});
    rate('api:'+clientAddress,180,60000);
    switch(p){
      case '/api/account/password':{
        const address=RequestLimits.clientKey(clientAddress),failureKey='password:'+address;
        rate('login:'+address,60,60000);
        const currentPassword=S.text(b.currentPassword,256),newPassword=S.text(b.newPassword,256),confirmPassword=S.text(b.confirmPassword,256);
        if(newPassword.length<8)S.fail('新密码至少需要 8 个字符');
        if(newPassword!==confirmPassword)S.fail('两次输入的新密码不一致');
        return limits.attempt(failureKey,10,async()=>{
          const stored=getMeta('password'),current=JSON.parse(stored);
          if(!safeEqual(await passwordHash(currentPassword,current.salt),current.hash)){limits.record(failureKey,15*60000);S.fail('当前密码错误',401,'INVALID_PASSWORD');}
          const salt=crypto.randomBytes(24).toString('hex'),hash=await passwordHash(newPassword,salt);
          authorized(req,true);assertWritable();
          transaction(()=>{
            if(getMeta('password')!==stored)S.fail('密码已更新，请重新输入当前密码',409,'PASSWORD_CHANGED');
            setMeta('password',JSON.stringify({salt,hash}));revokeOthers(auth);
          });
          limits.clear(failureKey);
          return json(res,200,{ok:true,...account(auth),message:'密码已修改，其他设备需要重新登录'});
        });
      }
      case '/api/account/sessions/revoke':
        revokeOthers(auth);
        return json(res,200,{ok:true,...account(auth),message:'已退出其他设备'});
      case '/api/storage/retention':{
        const retention=b.retention;
        if(!Retention.retentionChoices.includes(retention))S.fail('请选择有效的保存时长');
        if(storageOperation)S.fail('资料正在备份或恢复，请稍后重试',409,'BUSY');
        const current=read(),before=current.settings.mediaRetentionDays,at=mediaClock();
        const shorter=retention!=='forever'&&(before==='forever'||retention<before);
        const items=shorter?Retention.candidates(current,{days:retention,startedAt:retentionStartedAt(),now:at}):[];
        const confirmationToken=shorter?digest(JSON.stringify([auth.hash,before,retention,items.map(item=>item.id)])):undefined;
        if(b.preview===true||shorter&&b.confirmationToken!==confirmationToken){
          return json(res,200,{requiresConfirmation:shorter,affected:Retention.affected(items,mediaBytes),confirmationToken});
        }
        const next=before===retention?current:mutate(state=>{
          state.settings.mediaRetentionDays=retention;
          if(shorter)expireMedia(state,items,retention,at,false);
        }).state;
        if(shorter)recordCleanup(cleanupKey,items,next,at);
        return json(res,200,stateResponse(req,next,{storage:storageView(next)}));
      }
      case '/api/backup/prepare':{
        if(typeof b.includeKeys!=='boolean'||typeof b.includeMedia!=='boolean')S.fail('请明确选择是否包含密钥和媒体');
        const unlock=storageLock('prepare');
        try{return await transfer(req,res,async signal=>json(res,200,await streamingBackup.prepare(backupPayload(read(),b.includeKeys),{session:auth.hash,includeKeys:b.includeKeys,includeMedia:b.includeMedia,signal})));}
        finally{unlock();}
      }
      case '/api/backup':{
        if(typeof b.includeModelKeys!=='boolean')S.fail('是否包含模型密钥必须明确指定');
        return downloadBackup(res,b.includeModelKeys);
      }
      case '/api/stickers/analyze':{
        stickerQueue.enqueue(b);
        return json(res,200,stateResponse(req,read));
      }
      case '/api/logout':db.prepare('DELETE FROM sessions WHERE hash=?').run(auth.hash);
      androidFcm.removeSession(auth.hash);
      for(const client of clients)if(client.hash===auth.hash){client.res.end();clients.delete(client);}
      res.setHeader('Set-Cookie',`pipi_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${proxy.context(req).secure||process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
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
        const result=mutate(s=>{
          if(type==='memory.delete'){
            const memory=S.find(s.memories,S.text(b.payload?.id,100),'记忆');
            return require('./lib/engine/memory-store.cjs').deleteCard(dataDir,s,memory.roleId,memory.id);
          }
          return S.apply(s,type,b.payload===undefined?{}:b.payload);
        },{messages:!['profile.save','settings.save'].includes(type)});
        if(['rolePersona.bind','rolePersona.save','rolePersona.delete','role.save'].includes(type))runtime.checkChatPersonas(result.state);
        if(type==='role.delete')require('./lib/engine/memory-store.cjs').removeRole(dataDir,null,b.payload?.id);
        if(type==='role.save'&&result.state.roles.find(r=>r.id===b.payload?.id)?.permissions.blocked)runtime.cancel(b.payload.id);
        if(type==='wallet.transfer'&&!paymentReplay){
          const s=result.state,r=S.role(s,b.payload.roleId);
          if(Models.hasReadyChatModel(s)){
            const payment=s.wallet.transactions.find(t=>t.requestId===b.payload.requestId),message=s.messages.find(m=>m.meta?.transactionId===payment.id);
            runtime.enqueue(r.id,message.id);
          }
        }
        return json(res,200,stateResponse(req,read));
      }
      case '/api/chat/media/thumbnail':{
        const messageId=S.text(b.messageId,100),thumb=S.image(b.thumb,false);
        const expected=b.originalImage===undefined?undefined:S.image(b.originalImage,false);
        const target=state=>{
          const message=S.find(state.messages,messageId,'消息');
          const original=message.type==='image'?message.content:message.type==='text'?message.meta?.image:'';
          if(!original||!Media.resolveImageBytes(dataDir,original))S.fail('原图已不可用，未补充缩略图',409,'IMAGE_UNAVAILABLE');
          if(expected!==undefined&&expected!==original)S.fail('原图已变更，未补充缩略图',409,'IMAGE_CHANGED');
          return message;
        };
        const current=read();
        if(target(current).meta?.thumb)return json(res,200,stateResponse(req,current));
        const result=mutate(state=>{const message=target(state);message.meta??={};if(!message.meta.thumb)message.meta.thumb=thumb;});
        return json(res,200,stateResponse(req,result.state));
      }
      case '/api/chat/send':
      case '/api/chat':{
        rate('ai:'+clientAddress,40);
        const roleId=S.text(b.roleId,100),text=S.text(b.text,16000),img=S.image(b.image);
        const variants=S.imageVariants(b,Boolean(img));
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
        const signatureBody={
          roleId,text,img,...(stickerId===undefined?{}:{stickerId}),...(audio?{audio,durationMs}:{}),...(quoteId?{quoteId}:{}),...variants
        },signature=digest(JSON.stringify(signatureBody));
        let existing=db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
        let modelImage;
        if(img&&!existing){
          modelImage=await ModelImages.prepare(dataDir,img);
          authorized(req,true);assertWritable();
          existing=db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
        }
        if(existing){
          // Older clients signed the media text before it was moved to a file.
          let matches=existing.signature===signature;
          if(!matches&&(originalChatMedia.image!==b.image||originalChatMedia.audio!==b.audio)){
            const original={...signatureBody,img:S.image(originalChatMedia.image),...(audio?{audio:S.audio(originalChatMedia.audio)}:{})};
            matches=existing.signature===digest(JSON.stringify(original));
          }
          if(existing.roleId!==roleId||!matches)S.fail('requestId 已用于其他消息',409,'REQUEST_REUSED');
          return json(res,200,stateResponse(req,read));
        }
        let messageId;
        mutate(s=>{
          const r=S.role(s,roleId),meta={...variants};
          S.chatAllowed(r);
          if(modelImage)meta.modelImage=modelImage.url;
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
        return json(res,200,stateResponse(req,read,{accepted:true,messageId}));
      }
      case '/api/chat/retry':{
        rate('ai:'+clientAddress,40);
        const m=S.find(read().messages,b.messageId,'消息');
        if(m.meta?.expired)S.fail('聊天媒体已过期，请重新发送',409,'MEDIA_EXPIRED');
        S.chatAllowed(S.role(read(),m.roleId));
        if(m.sender!=='user'||m.status!=='error')S.fail('只有失败的用户消息可以重试');
        mutate(s=>{
          const m=S.find(s.messages,b.messageId);
          m.status='pending';
          delete m.error;
          if(s.engine.summaries[m.roleId]?.coveredUntil>=m.createdAt)delete s.engine.summaries[m.roleId];
        });
        runtime.enqueue(m.roleId,m.id);
        return json(res,200,stateResponse(req,read,{accepted:true,messageId:m.id}));
      }
      case '/api/moments/generate':{
        rate('ai:'+clientAddress,40);const s=read(),r=S.role(s,S.text(b.roleId,100));S.momentAllowed(r);
        // Reject here what the background run would reject, so the page is never told an impossible post was accepted.
        require('./lib/engine/modules/life-moments.cjs').eligible(s,r.id);chatModel(s,r);
        if(!runtime.initiate(r.id,{kind:'moment',instruction:'以你的角色身份写一条简短自然的朋友圈动态。只输出正文。'}))S.fail('该好友正在回复，请稍后再试',409,'CHAT_BUSY');
        return json(res,200,stateResponse(req,read,{accepted:true}));
      }
      case '/api/engine/models':{
        if(req.headers['sec-fetch-site']&&req.headers['x-pipi-model-page']!=='card-save')S.fail('模型页面已更新，请刷新页面后再保存',409,'PROVIDER_CONFIG_CHANGED');
        const result=mutate(s=>Models.save(s,b.ai,{stationPreset:b.stationPreset===true,checkSubmittedKeys:true}));return json(res,200,stateResponse(req,result.state));
      }
      case '/api/engine/models/card':{
        const result=mutate(s=>Models.saveCard(s,b));return json(res,200,stateResponse(req,result.state));
      }
      case '/api/engine/models/assign':{
        const result=mutate(s=>Models.saveAssignments(s,b.assign));return json(res,200,stateResponse(req,result.state));
      }
      case '/api/engine/models/station':{
        const unconfiguredGroups=[];
        const result=mutate(s=>Models.configureStation(s,b.keys,{unconfiguredGroups,expectedKeyRevisions:b.expectedKeyRevisions??{}}));return json(res,200,stateResponse(req,result.state,{unconfiguredGroups}));
      }
      case '/api/engine/models/source/delete':{
        const result=mutate(s=>Models.removeSource(s,b.sourceId,{expectedKeyRevisions:{[b.sourceId]:b.expectedKeyRevision}}));return json(res,200,stateResponse(req,result.state));
      }
      case '/api/engine/models/list':{
        rate('ai:'+clientAddress,40);
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
        rate('ai:'+clientAddress,40);
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
        return json(res,200,stateResponse(req,result.state));
      }
      case '/api/engine/voices':{
        rate('ai:'+clientAddress,40);
        const voiceType=S.enumOf(b.voiceType||'all',['all','personal','default']);
        const search=S.text(b.search||'',100);
        return json(res,200,await AI.listSpeechVoices(read(),{voiceType,search}));
      }
      case '/api/engine/life':{
        const panel=require('./lib/engine/life-panel.cjs'),ctx={getState:read,mutate,runtime,dataDir,preview:options.lifePreview};
        if(!options.lifePreview||['saveInteraction','saveMoments'].includes(b.action))return json(res,200,await panel.act(b,ctx));
        rate('ai:'+clientAddress,40);
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
          return json(res,200,stateResponse(req,result.state,{result:result.value,view:sched.view(result.state,roleId)}));
        }
        rate('ai:'+clientAddress,40);S.chatAllowed(S.role(read(),roleId));
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
          return json(res,200,stateResponse(req,current,{[['describeOutfit','identifyWardrobe'].includes(action)?'item':'result']:value,view:sched.view(current,roleId)}));
        }finally{inFlight--;}
      }
      case '/api/engine/memory':{
        const roleId=S.role(read(),S.text(b.roleId,100)).id;
        const action=S.enumOf(b.action||'recall',['add','update','toggleLock','restore','delete','saveProfile','recall','consolidate']);
        const MS=require('./lib/engine/memory-store.cjs'),Mem=require('./lib/engine/modules/memory.cjs');
        if(action==='add'){
          const content=S.text(b.content,2000).trim();if(!content)S.fail('记忆内容不能为空');
          const result=mutate(s=>MS.upsertCard(dataDir,s,roleId,{content,memoryType:S.text(b.memoryType||'FACT',40),importance:MS.clampImportance(b.importance,0.7),locked:Boolean(b.locked),origin:'manual'}));
          return json(res,200,stateResponse(req,result.state,{card:result.value}));
        }
        if(action==='update'){
          const id=S.text(b.id,100),content=S.text(b.content,2000).trim();if(!content)S.fail('记忆内容不能为空');
          const result=mutate(s=>{
            const card=MS.getCard(dataDir,s,roleId,id);if(!card)S.fail('记忆不存在',404,'NOT_FOUND');
            return MS.upsertCard(dataDir,s,roleId,{...card,content,summary:content,memoryType:b.memoryType??card.memoryType,updatedAt:Date.now()});
          });
          return json(res,200,stateResponse(req,result.state,{card:result.value}));
        }
        if(action==='restore'){
          const id=S.text(b.id,100);
          const result=mutate(s=>{const card=MS.setCardStatus(dataDir,s,roleId,id,{status:'active'});if(!card)S.fail('记忆不存在',404,'NOT_FOUND');return card;});
          return json(res,200,stateResponse(req,result.state,{card:result.value}));
        }
        if(action==='toggleLock'){
          const id=S.text(b.id,100);
          const cur=MS.getCard(dataDir,read(),roleId,id);
          const result=mutate(s=>MS.setCardStatus(dataDir,s,roleId,id,{locked:cur?!cur.locked:Boolean(b.locked)}));
          return json(res,200,stateResponse(req,result.state,{card:result.value}));
        }
        if(action==='delete'){
          const id=S.text(b.id,100);
          const result=mutate(s=>b.archive?MS.setCardStatus(dataDir,s,roleId,id,{status:'archived'}):MS.deleteCard(dataDir,s,roleId,id));
          return json(res,200,stateResponse(req,result.state,{deleted:result.value}));
        }
        if(action==='saveProfile'){
          const result=mutate(s=>MS.saveProfile(dataDir,s,roleId,b.profile));
          return json(res,200,stateResponse(req,result.state,{profile:result.value}));
        }
        if(action==='recall'){
          const out=await Mem.recallForPrompt(read(),roleId,S.text(b.query||'',300),{dataDir,getState:read,onUsage:runtime.onUsage});
          return json(res,200,{cards:out.cards,profile:out.profile});
        }
        if(action==='consolidate'){
          const result=mutate(s=>Mem.consolidateAndDecay(s,roleId,{dataDir}));
          return json(res,200,stateResponse(req,result.state,{archivedCount:result.value}));
        }
      }
      case '/api/engine/memory/extract':{
        rate('ai:'+clientAddress,40);
        const roleId=S.text(b.roleId,100);S.chatAllowed(S.role(read(),roleId));
        if(inFlight+runtime.active>=8)S.fail('模型服务正忙，请稍后再试',429,'PROVIDER_BUSY');
        inFlight++;
        try{
          const added=await require('./lib/engine/modules/memory.cjs').extractForRole({getState:read,mutate,roleId,dataDir,onUsage:runtime.onUsage,manual:true});
          return json(res,200,stateResponse(req,read,{added}));
        }finally{inFlight--;}
      }
      case '/api/engine/timezone':{
        const timezone=Time.validateTimezone(b.timezone),result=mutate(s=>{s.settings.timezone=timezone;Jobs.rescheduleTimezone(s);});
        return json(res,200,stateResponse(req,result.state));
      }
      case '/api/engine/jobs/save':{
        const roleId=S.text(b.roleId,100),id=b.id===undefined?null:S.text(b.id,100);
        const result=mutate(s=>{
          S.chatAllowed(S.role(s,roleId));
          const reminder={note:b.note,schedule:b.schedule};
          return id===null?Jobs.add(s,roleId,{...reminder,userRequested:true}):Jobs.edit(s,roleId,id,reminder);
        });
        return json(res,200,stateResponse(req,result.state,{job:result.value}));
      }
      case '/api/engine/jobs/delete':{
        const roleId=S.text(b.roleId,100),id=S.text(b.id,100),result=mutate(s=>Jobs.remove(s,roleId,id));runtime.cancelJob(id);
        return json(res,200,stateResponse(req,read));
      }
      case '/api/engine/typing':{
        const r=S.role(read(),S.text(b.roleId,100));S.chatAllowed(r);
        if(b.active===false)runtime.userStoppedTyping(r.id);else runtime.userTyping(r.id);
        return json(res,200,{ok:true});
      }
      case '/api/engine/chat-cancel':{
        const role=S.role(read(),S.text(b.roleId,100));
        const cancelled=runtime.cancelSlowChat(role.id);
        return json(res,200,stateResponse(req,read,{cancelled}));
      }
      case '/api/providers/test':rate('ai:'+clientAddress,40);
      return json(res,200,await AI.test(read(),b.capability,{onUsage:runtime.onUsage}));
      case '/api/providers/models':rate('ai:'+clientAddress,40);
      return json(res,200,{
        models:await AI.models(read(),b.capability)
      });
      case '/api/ledger/recognize':rate('ai:'+clientAddress,40);
      return json(res,200,{
        drafts:await AI.recognize(read(),S.image(b.image,false),{onUsage:runtime.onUsage,dataDir})
      });
      case '/api/voice/transcribe':{
        rate('ai:'+clientAddress,40);
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
        if(m.meta?.expired)S.fail('语音已过期，无法转文字',409,'MEDIA_EXPIRED');
        if(m.type!=='voice'||!m.meta?.audio)S.fail('只有语音消息可以转文字');
        if(m.meta.transcript?.trim())return json(res,200,stateResponse(req,s,{text:m.meta.transcript,...(m.meta.transcriptSource==='demo'?{demo:true}:{})}));
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
        return json(res,200,stateResponse(req,result.state,{text:transcript,...(options.demoModel?{demo:true}:{})}));
        }finally{inFlight--;}
      }
      case '/api/voice/speak':{
        rate('ai:'+clientAddress,40);
        if(inFlight+runtime.active>=8)S.fail('模型服务正忙，请稍后再试',429,'PROVIDER_BUSY');
        inFlight++;
        try{
        const s=read(),m=S.find(s.messages,b.messageId),r=S.role(s,m.roleId);
        S.chatAllowed(r);
        if(m.meta?.expired?.kind==='voice')S.fail('语音已过期，无法播放',409,'MEDIA_EXPIRED');
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
            if(message.meta?.expired?.kind==='voice')S.fail('语音已过期，无法播放',409,'MEDIA_EXPIRED');
            message.meta={
              ...(message.meta||{}),audio
            };
          }
        });
        return json(res,200,stateResponse(req,result.state,{audio}));
        }finally{inFlight--;}
      }
      case '/api/restore':{
        if(b.confirm!==true)S.fail('恢复需要 confirm: true');
        if(storageOperation)S.fail('资料正在备份或恢复，请稍后重试',409,'BUSY');
        if(restoreBusy())S.fail('后台任务进行中，请完成后再恢复',409,'BUSY');
        storageOperation='restore';
        try{
        const current=read(),restored=S.validateBackup(b.backup,current);
        const modelKeyCounts=Models.restoreBackupKeys(restored.settings.ai,b.backup.modelKeys);
        checkProviderUrls(restored);
        const MemoryStore=require('./lib/engine/memory-store.cjs');
        const living=MemoryStore.validateBackup(b.backup.livingMemory,restored);
        if(b.backup.media!==undefined)require('./lib/media-store.cjs').restoreImages(dataDir,restored,b.backup.media);
        Media.externalize(dataDir,restored);
        Object.defineProperty(restored,Symbol.for('pipi.mediaDir'),{value:dataDir});
        S.limit(restored);
        const commit=()=>transaction(()=>{
          if(living)MemoryStore.restoreAttached(db,living,restored);
          restored.revision=current.revision+1;
          db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(restored));
          db.exec('DELETE FROM requests');
        });
        if(living)MemoryStore.withRestoreJournal(db,dataDir,commit);else commit();
        syncJournal.reset(restored.revision);
        publish('revision',{revision:restored.revision});
        // Restored stickers still waiting for analysis continue without a restart; the restore itself has already succeeded.
        try{stickerQueue.recover();stickerQueue.idle().catch(error=>console.error('Sticker analysis failed after restore:',error?.stack||String(error)));}
        catch(error){console.error('Unable to resume sticker analysis after restore:',error?.stack||String(error));}
        const previousAI=Models.sanitize(current.settings.ai),state=S.publicState(restored);
        const clearedModelKeys=state.settings.ai.sources.some(source=>
          !source.keySet&&previousAI.sources.some(previous=>previous.id===source.id&&previous.keySet));
        return json(res,200,{state,clearedModelKeys,...modelKeyCounts});
        }finally{storageOperation=null;}
      }
      default:S.fail('接口不存在',404,'NOT_FOUND');
    }
  }
  function staticFile(req,res,pathname,searchParams){
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
    const ext=path.extname(file),baseTag=`${stat.size}-${Math.trunc(stat.mtimeMs)}`;
    // Text assets are compressed once per file version and kept in memory; on a small server this cuts the first load from ~1.5MB to a few hundred KB.
    const encoding=compressibleStatic.has(ext)&&stat.size>1024?JsonResponse.negotiate(req.headers['accept-encoding']).encoding:null;
    if(compressibleStatic.has(ext))res.setHeader('Vary','Accept-Encoding');
    if(['.woff2','.svg','.css','.js'].includes(ext)){
      const etag=`"${baseTag}${encoding?'-'+encoding:''}"`;
      const versionedIcon=/^\/vendor\/(?:fake-world\/(?:icons|masks)|native-icons)\/[^/]+\.svg$/.test(pathname)&&searchParams.get('v')===ICON_VERSION;
      res.setHeader('Cache-Control',versionedIcon?'public, max-age=604800, immutable':'public, max-age=0, must-revalidate');
      res.setHeader('ETag',etag);
      if(req.headers['if-none-match']===etag){res.writeHead(304);res.end();return;}
    }
    if(encoding)return compressedStatic(file,baseTag,encoding).then(payload=>{
      if(res.destroyed||res.writableEnded)return;
      res.writeHead(200,{'Content-Type':contentType,'Content-Length':payload.length,'Content-Encoding':encoding});
      res.end(req.method==='HEAD'?undefined:payload);
    });
    res.writeHead(200,{
      'Content-Type':contentType,'Content-Length':stat.size
    });
    if(req.method==='HEAD')res.end();
    else fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }
  function compressedStatic(file,tag,encoding){
    const key=file+'|'+encoding,hit=staticCache.get(key);
    if(hit?.tag===tag)return hit.payload;
    const payload=fs.promises.readFile(file).then(bytes=>staticCompress(bytes,encoding));
    staticCache.set(key,{tag,payload});
    payload.catch(()=>{if(staticCache.get(key)?.payload===payload)staticCache.delete(key);});
    return payload;
  }
  const server=http.createServer((req,res)=>{
    let deadline;
    const clearDeadline=()=>clearTimeout(deadline);
    req[requestDeadline]=mode=>{clearDeadline();if(mode!=='streaming'&&!req.readableEnded){deadline=setTimeout(()=>req.destroy(Object.assign(new Error('请求上传超时'),{status:408})),mode==='authenticated'?15*60*1000:60000);deadline.unref();}};
    req[requestDeadline]('anonymous');req.once('end',clearDeadline);req.once('close',clearDeadline);
    route(req,res).catch(e=>{
      if(e?.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));
      // Expected failures carry a status; anything else is a server bug that must leave a trace in the log.
      if(!e?.status)console.error('Unexpected server error:',req.method,String(req.url||'').split('?')[0],e);
      return json(res,e?.status||500,{
        error:e?.status?e.message:'服务器处理失败',code:e?.code||'SERVER_ERROR',...(e?.retryAfter?{retryAfter:e.retryAfter}:{}),...(e?.keyRevisions?{keyRevisions:e.keyRevisions}:{}),...(e?.includeState&&!closed?{
          state:S.publicState(read())
        }:{})
      });
    });
  });
  // Large backups and memory imports can take minutes to upload; headersTimeout still limits slow request headers.
  server.requestTimeout=0;
  server.headersTimeout=15000;
  server.keepAliveTimeout=5000;
  const revisionQuery=db.prepare('SELECT total_changes() AS revision');
  runtime=Runtime.create({getState:read,getRevision:()=>revisionQuery.get().revision,mutate,publish,isInitialized:async()=>Boolean(getMeta('password'))&&storageOperation!=='restore'&&!await updateMaintenance()&&storageOperation!=='restore',externalBusy:()=>inFlight,demoModel:options.demoModel,dataDir});
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
      clearTimeout(mediaTimer);
      removeSpaceCheck();
      for(const item of transfers)item.controller.abort(Object.assign(new Error('服务器正在关闭'),{status:503}));
      await Promise.allSettled([...transfers].map(item=>item.done));
      await streamingBackup.close();
      await stickerQueue.close();
      for(const client of clients)client.res.end();clients.clear();
      await runtime.close();
      await androidFcm.close();
      await androidUpdates.close();
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
