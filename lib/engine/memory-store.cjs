// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

const connections=new Map();
const MAX_IMPORT_ENTRIES=20000;
const PROFILE_SECTIONS=['basic','preferences','status','relationship'];
const LIST_SECTIONS=new Set(['preferences','relationship']);
const STOP_WORDS=new Set(['的','了','是','在','我','你','他','她','它','们','和','与','就','也','都','很','还','又','不','没','没有','有','这','那','这个','那个','什么','怎么','为什么','可以','因为','所以','如果','虽然','但是','还是','或者','以及','一个','一下','一些','一样','一直','已经','然后','现在','时候','感觉','觉得','东西','事情','今天','昨天','明天']);

function dbFor(dataDir){
  if(!dataDir)return null;
  const resolved=path.resolve(dataDir);
  if(connections.has(resolved))return connections.get(resolved);
  fs.mkdirSync(resolved,{recursive:true});
  const dbPath=path.join(resolved,'livingmemory.sqlite');
  const db=new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS lm_memories (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      key_facts TEXT NOT NULL DEFAULT '[]',
      topics TEXT NOT NULL DEFAULT '[]',
      sentiment TEXT NOT NULL DEFAULT 'neutral',
      memory_type TEXT NOT NULL DEFAULT 'GENERAL',
      status TEXT NOT NULL DEFAULT 'active',
      importance REAL NOT NULL DEFAULT 0.5,
      locked INTEGER NOT NULL DEFAULT 0,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL DEFAULT 0,
      source_excerpt TEXT NOT NULL DEFAULT '',
      source_json TEXT NOT NULL DEFAULT '[]',
      vector_json TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'auto'
    );
    CREATE INDEX IF NOT EXISTS idx_lm_role_status ON lm_memories(role_id, status, importance DESC, updated_at DESC);
    CREATE TABLE IF NOT EXISTS lm_profiles (
      role_id TEXT PRIMARY KEY,
      basic_json TEXT NOT NULL DEFAULT '{}',
      preferences_json TEXT NOT NULL DEFAULT '{}',
      status_json TEXT NOT NULL DEFAULT '{}',
      relationship_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  connections.set(resolved,db);
  return db;
}

function close(dataDir){
  if(!dataDir){
    for(const [k,db]of connections){try{db.close();}catch{}connections.delete(k);}
    return;
  }
  const resolved=path.resolve(dataDir);
  const db=connections.get(resolved);
  if(db){try{db.close();}catch{}connections.delete(resolved);}
}

function emptyProfile(){
  return {basic:{},preferences:{},status:{},relationship:{},version:1,updatedAt:0};
}

function safeJsonParse(str,fallback){
  if(typeof str!=='string'||!str)return fallback;
  try{return JSON.parse(str);}catch{return fallback;}
}

function tokenize(text){
  const clean=String(text||'').toLowerCase(),tokens=new Set();
  for(const word of clean.match(/[a-z0-9_]{2,}/g)||[])if(!STOP_WORDS.has(word))tokens.add(word);
  const cjk=(clean.match(/[\p{Script=Han}]/gu)||[]).join('');
  for(let i=0;i<cjk.length;i++){
    if(!STOP_WORDS.has(cjk[i]))tokens.add(cjk[i]);
    if(i+1<cjk.length){
      const bg=cjk.slice(i,i+2);
      if(!STOP_WORDS.has(bg))tokens.add(bg);
    }
    if(i+2<cjk.length)tokens.add(cjk.slice(i,i+3));
  }
  return tokens;
}

function jaccard(a,b){
  if(!a.size||!b.size)return 0;
  let hits=0;
  for(const x of a)if(b.has(x))hits++;
  return hits/(a.size+b.size-hits);
}

function cosine(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!a.length)return 0;
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}
  const denom=Math.sqrt(na)*Math.sqrt(nb);
  return denom>0?dot/denom:0;
}

function clampImportance(v,def=0.5){
  const n=Number(v);
  if(!Number.isFinite(n))return def;
  const normalized=n>1&&n<=10?n/10:n;
  return Math.max(0.05,Math.min(1,Math.round(normalized*1000)/1000));
}

function rowToCard(row){
  return {
    id:row.id,
    roleId:row.role_id,
    content:row.content,
    summary:row.summary||row.content,
    keyFacts:safeJsonParse(row.key_facts,[]),
    topics:safeJsonParse(row.topics,[]),
    sentiment:row.sentiment||'neutral',
    memoryType:row.memory_type||'GENERAL',
    status:row.status||'active',
    importance:Number(row.importance??0.5),
    locked:Boolean(row.locked),
    accessCount:Number(row.access_count||0),
    createdAt:Number(row.created_at||0),
    updatedAt:Number(row.updated_at||0),
    lastAccessedAt:Number(row.last_accessed_at||0),
    sourceExcerpt:row.source_excerpt||'',
    origin:row.origin||'auto'
  };
}

function ensureMemoryBucket(state){
  state.engine??={};state.engine.data??={};
  const d=state.engine.data.memory??={};
  d.lastExtracted??={};
  d.vectors??={};
  d.profiles??={};
  d.meta??={};
  return d;
}

function getProfile(dataDir,state,roleId){
  const db=dbFor(dataDir);
  if(db){
    const row=db.prepare('SELECT * FROM lm_profiles WHERE role_id=?').get(roleId);
    if(!row)return emptyProfile();
    return {
      basic:safeJsonParse(row.basic_json,{}),
      preferences:safeJsonParse(row.preferences_json,{}),
      status:safeJsonParse(row.status_json,{}),
      relationship:safeJsonParse(row.relationship_json,{}),
      version:Number(row.version||1),
      updatedAt:Number(row.updated_at||0)
    };
  }
  const d=state.engine?.data?.memory;
  return structuredClone(d?.profiles?.[roleId]||emptyProfile());
}

function saveProfile(dataDir,state,roleId,profile,now=Date.now()){
  const clean=emptyProfile();
  for(const sec of PROFILE_SECTIONS){
    const raw=profile?.[sec];
    if(!raw||typeof raw!=='object')continue;
    for(const [k,v]of Object.entries(raw)){
      const field=String(k||'').replace(/\s+/g,' ').trim().slice(0,40);
      if(!field)continue;
      if(LIST_SECTIONS.has(sec)){
        const items=(Array.isArray(v)?v:[v]).map(x=>String(x||'').replace(/\s+/g,' ').trim().slice(0,200)).filter(Boolean);
        if(items.length)clean[sec][field]=[...new Set(items)].slice(0,30);
      }else{
        const val=String(v||'').replace(/\s+/g,' ').trim().slice(0,200);
        if(val)clean[sec][field]=val;
      }
    }
  }
  clean.version=Math.max(1,(Number(profile?.version)||0)+1);
  clean.updatedAt=now;
  const db=dbFor(dataDir);
  if(db){
    db.prepare(`
      INSERT INTO lm_profiles(role_id,basic_json,preferences_json,status_json,relationship_json,version,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(role_id) DO UPDATE SET
        basic_json=excluded.basic_json,
        preferences_json=excluded.preferences_json,
        status_json=excluded.status_json,
        relationship_json=excluded.relationship_json,
        version=excluded.version,
        updated_at=excluded.updated_at
    `).run(roleId,JSON.stringify(clean.basic),JSON.stringify(clean.preferences),JSON.stringify(clean.status),JSON.stringify(clean.relationship),clean.version,now);
  }else if(state){
    ensureMemoryBucket(state).profiles[roleId]=clean;
  }
  return clean;
}

function applyProfileUpdates(dataDir,state,roleId,updates,now=Date.now()){
  if(!Array.isArray(updates)||!updates.length)return getProfile(dataDir,state,roleId);
  const current=getProfile(dataDir,state,roleId);
  let changed=false;
  for(const item of updates){
    if(!item||typeof item!=='object')continue;
    const section=String(item.section||'').toLowerCase().trim();
    if(!PROFILE_SECTIONS.includes(section))continue;
    const confidence=Number(item.confidence??0.7);
    if(Number.isFinite(confidence)&&confidence<0.6)continue;
    const op=String(item.operation||'set').toLowerCase().trim();
    const field=String(item.field||'').replace(/\s+/g,' ').trim().slice(0,40);
    const value=String(item.value||'').replace(/\s+/g,' ').trim().slice(0,200);
    if(!field||!value)continue;
    if(LIST_SECTIONS.has(section)){
      const arr=Array.isArray(current[section][field])?[...current[section][field]]:[];
      if(op==='remove'){
        const next=arr.filter(x=>x!==value);
        if(next.length!==arr.length){if(next.length)current[section][field]=next;else delete current[section][field];changed=true;}
      }else if(op==='set'){
        current[section][field]=[value];changed=true;
      }else if(!arr.includes(value)){
        arr.push(value);current[section][field]=arr.slice(-30);changed=true;
      }
    }else{
      if(op==='remove'){
        if(field in current[section]){delete current[section][field];changed=true;}
      }else if(current[section][field]!==value){
        current[section][field]=value;changed=true;
      }
    }
  }
  return changed?saveProfile(dataDir,state,roleId,current,now):current;
}

function formatProfileText(profile,maxChars=320){
  if(!profile)return '';
  const labels={basic:'基本情况',preferences:'喜好习惯',status:'近期状态',relationship:'相处点滴'};
  const lines=[];
  for(const sec of PROFILE_SECTIONS){
    const obj=profile[sec];
    if(!obj||typeof obj!=='object')continue;
    const pairs=[];
    for(const [k,v]of Object.entries(obj)){
      const txt=Array.isArray(v)?v.join('、'):String(v||'');
      if(txt)pairs.push(`${k}：${txt}`);
    }
    if(pairs.length)lines.push(`${labels[sec]}：${pairs.join('；')}`);
  }
  return lines.join('\n').slice(0,maxChars);
}

function storedIds(dataDir,roleId){
  return new Set(dbFor(dataDir).prepare('SELECT id FROM lm_memories WHERE role_id=?').all(roleId).map(m=>m.id));
}
function syncMirrorMemories(dataDir,state,roleId){
  const db=dbFor(dataDir);
  if(!db||!state?.memories)return;
  const top=db.prepare('SELECT id,role_id,content,created_at FROM lm_memories WHERE role_id=? AND status=? ORDER BY locked DESC, importance DESC, updated_at DESC LIMIT 50').all(roleId,'active');
  const stored=storedIds(dataDir,roleId);
  const others=state.memories.filter(m=>m.roleId!==roleId||!stored.has(m.id));
  const mirrored=top.map(r=>({id:r.id,roleId:r.role_id,content:r.content,createdAt:Number(r.created_at)||Date.now()}));
  const merged=[...others,...mirrored];
  if(merged.length<=2800){state.memories=merged;return;}
  // Only SQLite-backed copies are disposable; legacy records may have no other copy.
  const persisted=new Set(db.prepare('SELECT id FROM lm_memories').all().map(row=>row.id));
  const legacy=merged.filter(m=>!persisted.has(m.id));
  const room=Math.max(0,2800-legacy.length);
  state.memories=legacy.concat(room?merged.filter(m=>persisted.has(m.id)).slice(-room):[]);
}

function listCards(dataDir,state,roleId,{status='active',query='',limit=200}={}){
  const db=dbFor(dataDir);
  let rows;
  if(db){
    const args=[roleId];
    let sql='SELECT id,role_id,content,summary,key_facts,topics,sentiment,memory_type,status,importance,locked,access_count,created_at,updated_at,last_accessed_at,source_excerpt,origin FROM lm_memories WHERE role_id=?';
    if(status==='archived')sql+=" AND status IN ('archived','forgotten')";
    else if(status!=='all'){sql+=' AND status=?';args.push(status);}
    sql+=' ORDER BY locked DESC, importance DESC, updated_at DESC,id ASC';
    if(limit!==null&&!query){sql+=' LIMIT ?';args.push(limit);}
    rows=db.prepare(sql).all(...args).map(rowToCard);
  }else{
    const d=state?.engine?.data?.memory?.meta||{};
    rows=(state?.memories||[]).filter(m=>m.roleId===roleId).map(m=>{
      const mMeta=d[m.id]||{};
      return {
        id:m.id,roleId:m.roleId,content:m.content,summary:mMeta.summary||m.content,
        keyFacts:mMeta.keyFacts||[],topics:mMeta.topics||[],sentiment:mMeta.sentiment||'neutral',
        memoryType:mMeta.memoryType||'GENERAL',status:mMeta.status||'active',
        importance:clampImportance(mMeta.importance,0.6),locked:Boolean(mMeta.locked),
        accessCount:Number(mMeta.accessCount||0),createdAt:Number(m.createdAt||0),
        updatedAt:Number(mMeta.updatedAt||m.createdAt||0),lastAccessedAt:Number(mMeta.lastAccessedAt||0),
        sourceExcerpt:mMeta.sourceExcerpt||'',origin:mMeta.origin||'auto'
      };
    }).filter(c=>status==='all'||c.status===status||(status==='archived'&&c.status==='forgotten'));
  }
  const q=String(query||'').trim().toLowerCase();
  if(q){
    rows=rows.filter(c=>c.content.toLowerCase().includes(q)||c.topics.some(t=>t.toLowerCase().includes(q))||c.keyFacts.some(f=>f.toLowerCase().includes(q)));
  }
  return limit===null?rows:rows.slice(0,limit);
}

function getCard(dataDir,state,roleId,id){
  const db=dbFor(dataDir),row=db?.prepare('SELECT * FROM lm_memories WHERE role_id=? AND id=?').get(roleId,id);
  if(row)return rowToCard(row);
  const legacy=state?.memories?.find(m=>m.roleId===roleId&&m.id===id);
  return legacy?listCards(null,{engine:state.engine,memories:[legacy]},roleId,{status:'all',limit:1})[0]:null;
}

function getVectors(dataDir,state,ids){
  const out={};
  const db=dbFor(dataDir);
  if(db&&ids.length){
    for(let i=0;i<ids.length;i+=500){
      const batch=ids.slice(i,i+500);
      const rows=db.prepare("SELECT id,vector_json FROM lm_memories WHERE vector_json!='' AND id IN ("+batch.map(()=>'?').join(',')+")").all(...batch);
      for(const row of rows){const vector=safeJsonParse(row.vector_json,null);if(vector)out[row.id]=vector;}
    }
    return out;
  }
  const vectors=state?.engine?.data?.memory?.vectors||{};
  for(const id of ids)if(vectors[id])out[id]=vectors[id];
  return out;
}

function upsertCard(dataDir,state,roleId,card,{vector=null,sourceMessages=null,skipMirrorSync=false}={}){
  const now=Date.now();
  const id=card.id||crypto.randomUUID();
  const content=String(card.content||card.summary||'').trim().slice(0,12000);
  if(!content)return null;
  const summary=String(card.summary||content).trim().slice(0,2000);
  const keyFacts=Array.isArray(card.keyFacts)?card.keyFacts.map(x=>String(x).trim()).filter(Boolean).slice(0,8):[];
  const topics=Array.isArray(card.topics)?card.topics.map(x=>String(x).trim()).filter(Boolean).slice(0,8):[];
  const importance=clampImportance(card.importance,0.6);
  const locked=card.locked?1:0;
  const status=['active','archived','forgotten'].includes(card.status)?card.status:'active';
  const createdAt=Number.isFinite(Number(card.createdAt))&&Number(card.createdAt)>0?Math.trunc(Number(card.createdAt)):now;
  const updatedAt=Number.isFinite(Number(card.updatedAt))&&Number(card.updatedAt)>0?Math.trunc(Number(card.updatedAt)):now;
  const sourceExcerpt=String(card.sourceExcerpt||'').trim().slice(0,1200);
  const origin=String(card.origin||'auto').slice(0,40);
  const srcJson=Array.isArray(sourceMessages)?JSON.stringify(sourceMessages.slice(-24)).slice(0,16384):'[]';
  const db=dbFor(dataDir);
  if(db){
    db.prepare(`
      INSERT INTO lm_memories(id,role_id,content,summary,key_facts,topics,sentiment,memory_type,status,importance,locked,access_count,created_at,updated_at,last_accessed_at,source_excerpt,source_json,vector_json,origin)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        content=excluded.content,summary=excluded.summary,key_facts=excluded.key_facts,topics=excluded.topics,
        sentiment=excluded.sentiment,memory_type=excluded.memory_type,status=excluded.status,importance=excluded.importance,
        locked=excluded.locked,updated_at=excluded.updated_at,
        source_excerpt=CASE WHEN excluded.source_excerpt!='' THEN excluded.source_excerpt ELSE lm_memories.source_excerpt END,
        vector_json=CASE WHEN excluded.vector_json!='' THEN excluded.vector_json ELSE lm_memories.vector_json END
    `).run(id,roleId,content,summary,JSON.stringify(keyFacts),JSON.stringify(topics),String(card.sentiment||'neutral'),String(card.memoryType||'GENERAL').toUpperCase(),status,importance,locked,Number(card.accessCount||0),createdAt,updatedAt,Number(card.lastAccessedAt||0),sourceExcerpt,srcJson,vector?JSON.stringify(vector):'',origin);
    if(!skipMirrorSync)syncMirrorMemories(dataDir,state,roleId);
  }else if(state){
    state.memories??=[];
    const existing=state.memories.find(m=>m.id===id);
    if(existing){existing.content=content;}
    else state.memories.push({id,roleId,content,createdAt});
    const meta=ensureMemoryBucket(state).meta;
    meta[id]={summary,keyFacts,topics,sentiment:String(card.sentiment||'neutral'),memoryType:String(card.memoryType||'GENERAL').toUpperCase(),status,importance,locked:Boolean(locked),accessCount:Number(card.accessCount||0),updatedAt,lastAccessedAt:Number(card.lastAccessedAt||0),sourceExcerpt,origin};
    if(vector)ensureMemoryBucket(state).vectors[id]=vector;
  }
  return {id,roleId,content,summary,keyFacts,topics,importance,locked:Boolean(locked),status,createdAt,updatedAt,sourceExcerpt,origin};
}

function setCardVector(dataDir,state,id,vector){
  if(!Array.isArray(vector)||!vector.length)return;
  const db=dbFor(dataDir);
  if(db){db.prepare('UPDATE lm_memories SET vector_json=? WHERE id=?').run(JSON.stringify(vector),id);}
  else if(state){ensureMemoryBucket(state).vectors[id]=vector;}
}

function setCardStatus(dataDir,state,roleId,id,{status,locked}={}){
  const db=dbFor(dataDir);
  const now=Date.now();
  if(db){
    let cur=db.prepare('SELECT * FROM lm_memories WHERE id=? AND role_id=?').get(id,roleId);
    if(!cur){const legacy=getCard(null,state,roleId,id);if(legacy){upsertCard(dataDir,state,roleId,legacy,{skipMirrorSync:true});cur=db.prepare('SELECT * FROM lm_memories WHERE id=? AND role_id=?').get(id,roleId);}}
    if(!cur)return null;
    const nextStatus=status??cur.status,nextLocked=locked===undefined?cur.locked:(locked?1:0);
    db.prepare('UPDATE lm_memories SET status=?, locked=?, updated_at=? WHERE id=?').run(nextStatus,nextLocked,now,id);
    syncMirrorMemories(dataDir,state,roleId);
    return rowToCard({...cur,status:nextStatus,locked:nextLocked,updated_at:now});
  }
  const m=state?.memories?.find(x=>x.id===id&&x.roleId===roleId);
  if(!m)return null;
  const meta=ensureMemoryBucket(state).meta;
  meta[id]??={importance:0.6,status:'active',locked:false};
  if(status!==undefined)meta[id].status=status;
  if(locked!==undefined)meta[id].locked=Boolean(locked);
  meta[id].updatedAt=now;
  return {...m,...meta[id]};
}

function deleteCard(dataDir,state,roleId,id){
  const db=dbFor(dataDir);
  if(db){
    const info=db.prepare('DELETE FROM lm_memories WHERE id=? AND role_id=?').run(id,roleId);
    if(state?.memories)state.memories=state.memories.filter(m=>!(m.id===id&&m.roleId===roleId));
    return info.changes>0;
  }
  const before=state?.memories?.length||0;
  if(state?.memories)state.memories=state.memories.filter(m=>!(m.id===id&&m.roleId===roleId));
  if(state?.engine?.data?.memory?.meta)delete state.engine.data.memory.meta[id];
  if(state?.engine?.data?.memory?.vectors)delete state.engine.data.memory.vectors[id];
  return (state?.memories?.length||0)<before;
}

function removeRole(dataDir,state,roleId){
  const db=dbFor(dataDir);
  if(db){
    db.prepare('DELETE FROM lm_memories WHERE role_id=?').run(roleId);
    db.prepare('DELETE FROM lm_profiles WHERE role_id=?').run(roleId);
  }
  if(state?.engine?.data?.memory){
    const d=state.engine.data.memory;
    delete d.lastExtracted?.[roleId];
    delete d.lastExtractedAt?.[roleId];
    delete d.profiles?.[roleId];
    delete d.cursors?.[roleId];
    delete d.lastLifecycleDay?.[roleId];
    delete d.vectors?.['query:'+roleId];
  }
}

function reinforceAccess(dataDir,state,ids,now=Date.now()){
  if(!ids.length)return;
  const db=dbFor(dataDir);
  if(db){
    const stmt=db.prepare('UPDATE lm_memories SET access_count=access_count+1, last_accessed_at=?, importance=MIN(1.0, importance+0.02) WHERE id=?');
    for(const id of ids)stmt.run(now,id);
    return;
  }
  const meta=state?.engine?.data?.memory?.meta;
  if(!meta)return;
  for(const id of ids){
    meta[id]??={importance:0.5,accessCount:0};
    meta[id].accessCount=(meta[id].accessCount||0)+1;
    meta[id].lastAccessedAt=now;
    meta[id].importance=Math.min(1,(meta[id].importance||0.5)+0.02);
  }
}

function readSource(dataDir,id){
  const db=dbFor(dataDir);
  if(!db)return [];
  const row=db.prepare('SELECT source_json, source_excerpt FROM lm_memories WHERE id=?').get(id);
  if(!row)return [];
  const parsed=safeJsonParse(row.source_json,[]);
  return Array.isArray(parsed)&&parsed.length?parsed:(row.source_excerpt?[row.source_excerpt]:[]);
}

function parseCsvRows(rawText){
  const text=String(rawText||'').replace(/^\uFEFF/,'');
  const rows=[];let row=[],field='',inQuote=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(inQuote){
      if(ch==='"'&&next==='"'){field+='"';i++;}
      else if(ch==='"')inQuote=false;
      else field+=ch;
    }else if(ch==='"'){inQuote=true;}
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\r'||ch==='\n'){
      if(ch==='\r'&&next==='\n')i++;
      row.push(field);field='';
      if(row.some(c=>c!==''))rows.push(row);
      row=[];
    }else field+=ch;
  }
  if(field!==''||row.length){row.push(field);if(row.some(c=>c!==''))rows.push(row);}
  if(rows.length<2)return [];
  const headers=rows[0].map(h=>h.trim());
  const unescapeFormula=v=>typeof v==='string'&&v.length>=2&&v[0]==="'"&&'=+-@\t\r'.includes(v[1])?v.slice(1):v;
  return rows.slice(1).map(cols=>{
    const obj={};
    headers.forEach((h,idx)=>{if(h)obj[h]=unescapeFormula(cols[idx]??'');});
    return obj;
  });
}

function normalizeTransferEntry(raw){
  if(typeof raw==='string')return raw.trim()?{content:raw.trim(),importance:0.5,topics:[],keyFacts:[],sentiment:'neutral',memoryType:'GENERAL',status:'active',sessionId:'',personaId:'',createdAt:Date.now(),sourceExcerpt:'',sourceMessages:[]}:null;
  if(!raw||typeof raw!=='object')return null;
  const meta=typeof raw.metadata==='string'?safeJsonParse(raw.metadata,{}):(raw.metadata&&typeof raw.metadata==='object'?raw.metadata:{});
  const contentKey=['content','text','summary','memory','value'].find(k=>typeof raw[k]==='string'&&raw[k].trim());
  let content=contentKey?raw[contentKey].trim():'';
  const rawSources=raw.source_messages||raw.messages||raw.conversation||raw.dialogue;
  const parsedSources=typeof rawSources==='string'?safeJsonParse(rawSources,[]):rawSources;
  const sourceMessages=Array.isArray(parsedSources)?parsedSources.filter(m=>m&&typeof m==='object'&&(m.content||m.text)).map(m=>({role:String(m.role||m.sender||'user'),content:String(m.content||m.text).slice(0,800),timestamp:m.timestamp||0})).slice(0,24):[];
  if(!content&&sourceMessages.length){
    content=sourceMessages.map(m=>`${m.role==='assistant'?'角色':'用户'}：${m.content}`).join('；').slice(0,400);
  }
  if(!content)return null;
  const parseList=v=>{
    const x=typeof v==='string'?safeJsonParse(v,v.split(/[,，\n]/)):v;
    return Array.isArray(x)?x.map(i=>String(i||'').trim()).filter(Boolean).slice(0,8):[];
  };
  const topics=parseList(raw.topics??meta.topics);
  const keyFacts=parseList(raw.key_facts??raw.keyFacts??meta.key_facts);
  const rawTime=raw.created_at??meta.create_time??meta.created_at;
  let createdAt=Date.now();
  if(typeof rawTime==='number'&&Number.isFinite(rawTime)&&rawTime>0)createdAt=rawTime<1e12?Math.round(rawTime*1000):Math.round(rawTime);
  else if(typeof rawTime==='string'&&rawTime.trim()){const t=Date.parse(rawTime);if(Number.isFinite(t))createdAt=t;}
  const sessionId=String(raw.session_id??raw.session??meta.session_id??'').trim();
  const personaId=String(raw.persona_id??raw.persona??meta.persona_id??'').trim();
  const statusRaw=String(raw.status??meta.status??'active').toLowerCase();
  const status=['active','archived','forgotten'].includes(statusRaw)?statusRaw:'active';
  const sourceExcerpt=sourceMessages.slice(0,3).map(m=>`${m.role==='assistant'?'TA':'我'}：${m.content.slice(0,120)}`).join('\n');
  return {
    content:content.slice(0,12000),
    summary:String(meta.persona_summary||content).trim().slice(0,2000),
    importance:clampImportance(raw.importance??meta.importance,0.5),
    topics,keyFacts,
    sentiment:String(raw.sentiment||meta.sentiment||'neutral'),
    memoryType:String(raw.memory_type||raw.type||meta.memory_type||'GENERAL').toUpperCase(),
    status,sessionId,personaId,createdAt,sourceExcerpt,sourceMessages
  };
}

function parseLivingMemoryTransfer(rawInput,format='json'){
  const text=Buffer.isBuffer(rawInput)?rawInput.toString('utf8'):String(rawInput||'');
  if(!text.trim())throw Object.assign(new Error('导入文件内容不能为空'),{status:400,code:'VALIDATION'});
  const fmt=String(format||'json').toLowerCase().trim();
  let rawEntries=[];
  if(fmt==='csv'){
    rawEntries=parseCsvRows(text);
  }else{
    let payload;
    try{payload=JSON.parse(text.replace(/^\uFEFF/,''));}
    catch{throw Object.assign(new Error('JSON 文件解析失败，请确认这是有效的记忆导出文件'),{status:400,code:'VALIDATION'});}
    if(Array.isArray(payload))rawEntries=payload;
    else if(payload&&typeof payload==='object'){
      const col=['memories','long_term_memories','longTermMemories','data'].find(k=>Array.isArray(payload[k]));
      if(col)rawEntries=payload[col];
      else if(payload.memories&&typeof payload.memories==='object')rawEntries=Object.values(payload.memories);
      else rawEntries=[payload];
    }
  }
  if(rawEntries.length>MAX_IMPORT_ENTRIES)throw Object.assign(new Error(`单次最多导入 ${MAX_IMPORT_ENTRIES} 条记忆`),{status:413,code:'LIMIT'});
  const entries=[];
  let skippedInvalid=0;
  for(const raw of rawEntries){
    const item=normalizeTransferEntry(raw);
    if(item)entries.push(item);else skippedInvalid++;
  }
  return {entries,skippedInvalid};
}

function scopeKeyOf(entry){
  return `${entry.personaId||'默认人设'}::${entry.sessionId||'默认会话'}`;
}

function previewImport(rawInput,format='json'){
  const {entries,skippedInvalid}=parseLivingMemoryTransfer(rawInput,format);
  const groupMap=new Map();
  for(const entry of entries){
    const key=scopeKeyOf(entry);
    let g=groupMap.get(key);
    if(!g){
      g={scopeKey:key,personaId:entry.personaId||'默认人设',sessionId:entry.sessionId||'默认会话',count:0,activeCount:0,sample:entry.content.slice(0,80)};
      groupMap.set(key,g);
    }
    g.count++;
    if(entry.status==='active')g.activeCount++;
  }
  return {
    total:entries.length+skippedInvalid,
    validCount:entries.length,
    invalidCount:skippedInvalid,
    groups:[...groupMap.values()].sort((a,b)=>b.count-a.count)
  };
}

function dedupeKey(content){
  return String(content||'').toLowerCase().replace(/[\s，。！？、；："'‘’“”.,!?]/g,'').slice(0,180);
}

function executeImport(dataDir,state,{roleId,rawInput,format='json',selectedScopes=null,includeArchived=false,duplicateStrategy='skip'}){
  const {entries,skippedInvalid}=parseLivingMemoryTransfer(rawInput,format);
  const scopeSet=Array.isArray(selectedScopes)&&selectedScopes.length?new Set(selectedScopes):null;
  const existing=listCards(dataDir,state,roleId,{status:'all',limit:MAX_IMPORT_ENTRIES});
  const seen=new Set(existing.map(c=>dedupeKey(c.content)));
  let importedCount=0,skippedDuplicateCount=0,skippedFilterCount=0;
  // Keep the original creation time, but start the gentle-forgetting clock at import time.
  const importedAt=Date.now();
  const db=dbFor(dataDir);
  if(db)db.exec('BEGIN');
  try{
    for(const entry of entries){
      if(scopeSet&&!scopeSet.has(scopeKeyOf(entry))){skippedFilterCount++;continue;}
      if(!includeArchived&&entry.status!=='active'){skippedFilterCount++;continue;}
      const dk=dedupeKey(entry.content);
      if(!dk||(duplicateStrategy==='skip'&&seen.has(dk))){skippedDuplicateCount++;continue;}
      seen.add(dk);
      upsertCard(dataDir,state,roleId,{
        content:entry.content,summary:entry.summary,keyFacts:entry.keyFacts,topics:entry.topics,
        sentiment:entry.sentiment,memoryType:entry.memoryType,status:entry.status,
        importance:entry.importance,locked:entry.importance>=0.85,createdAt:entry.createdAt,
        updatedAt:entry.createdAt,lastAccessedAt:importedAt,sourceExcerpt:entry.sourceExcerpt,origin:'livingmemory_import'
      },{sourceMessages:entry.sourceMessages,skipMirrorSync:true});
      importedCount++;
    }
    if(db)db.exec('COMMIT');
  }catch(e){
    if(db)try{db.exec('ROLLBACK');}catch{}
    throw e;
  }
  if(db)syncMirrorMemories(dataDir,state,roleId);
  return {importedCount,skippedDuplicateCount,skippedFilterCount,invalidCount:skippedInvalid};
}

function exportLivingMemoryJson(dataDir,state,roleId,roleName=''){
  const cards=listCards(dataDir,state,roleId,{status:'all',limit:MAX_IMPORT_ENTRIES});
  const records=cards.map(c=>({
    original_id:c.id,
    content:c.content,
    importance:c.importance,
    session_id:`pipi:${roleId}`,
    persona_id:roleName||roleId,
    metadata:{
      memory_type:c.memoryType,
      status:c.status,
      topics:c.topics,
      key_facts:c.keyFacts,
      sentiment:c.sentiment,
      create_time:c.createdAt/1000,
      persona_summary:c.summary
    },
    source_messages:readSource(dataDir,c.id)
  }));
  return {
    format:'livingmemory',
    schema_version:1,
    exported_at:new Date().toISOString(),
    memory_count:records.length,
    memories:records
  };
}

const backupCardColumns=[
  'id','role_id','content','summary','key_facts','topics','sentiment','memory_type','status','importance','locked',
  'access_count','created_at','updated_at','last_accessed_at','source_excerpt','source_json','vector_json','origin'
];
const backupProfileColumns=['role_id','basic_json','preferences_json','status_json','relationship_json','version','updated_at'];

function exportBackup(dataDir,state){
  const db=dbFor(dataDir),roles=new Set(state.roles.map(role=>role.id));
  const read=(table,columns,order)=>db.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY ${order}`).all().filter(row=>roles.has(row.role_id));
  return {version:1,cards:read('lm_memories',backupCardColumns,'id'),profiles:read('lm_profiles',backupProfileColumns,'role_id')};
}

function validateBackup(input,state){
  if(input===undefined)return null;
  const {fail,obj}=require('../state.cjs');
  const invalid=()=>fail('长期记忆备份格式无效');
  if(!obj(input)||input.version!==1||!Array.isArray(input.cards)||!Array.isArray(input.profiles))invalid();
  const roles=new Set(state.roles.map(role=>role.id)),mirrorRoles=new Map(state.memories.map(item=>[item.id,item.roleId]));
  const ids=new Set(),profiles=new Set();
  const string=(value,max,required=false)=>{
    if(typeof value!=='string'||value.length>max||required&&!value.trim())invalid();
    return value;
  };
  const whole=(value,min=0)=>{
    if(!Number.isSafeInteger(value)||value<min)invalid();
    return value;
  };
  const serialized=(value,predicate)=>{
    const raw=string(value,1024*1024,true);
    if(!predicate(safeJsonParse(raw,null)))invalid();
    return raw;
  };
  const strings=value=>Array.isArray(value)&&value.every(item=>typeof item==='string');
  const cards=input.cards.map(row=>{
    if(!obj(row)||!roles.has(row.role_id)||ids.has(row.id)||!['active','archived','forgotten'].includes(row.status))invalid();
    const id=string(row.id,100,true),mirrorRole=mirrorRoles.get(id);
    if(['__proto__','constructor','prototype'].includes(id))invalid();
    if(mirrorRole!==undefined&&mirrorRole!==row.role_id)invalid();
    ids.add(id);
    if(![0,1].includes(row.locked)||typeof row.importance!=='number'||!Number.isFinite(row.importance)||row.importance<0||row.importance>1)invalid();
    return {
      id,role_id:row.role_id,content:string(row.content,12000,true),summary:string(row.summary,12000),
      key_facts:serialized(row.key_facts,strings),topics:serialized(row.topics,strings),
      sentiment:string(row.sentiment,200),memory_type:string(row.memory_type,200),status:row.status,importance:row.importance,locked:row.locked,
      access_count:whole(row.access_count),created_at:whole(row.created_at),updated_at:whole(row.updated_at),last_accessed_at:whole(row.last_accessed_at),
      source_excerpt:string(row.source_excerpt,1200),source_json:string(row.source_json,16384),
      vector_json:row.vector_json===''?'':serialized(row.vector_json,value=>Array.isArray(value)&&value.every(n=>typeof n==='number'&&Number.isFinite(n))),
      origin:string(row.origin,40)
    };
  });
  const people=input.profiles.map(row=>{
    if(!obj(row)||!roles.has(row.role_id)||profiles.has(row.role_id))invalid();
    profiles.add(row.role_id);
    const profile={role_id:row.role_id,version:whole(row.version,1),updated_at:whole(row.updated_at)};
    for(const section of PROFILE_SECTIONS){
      const key=section+'_json',items=LIST_SECTIONS.has(section)?strings:value=>typeof value==='string';
      profile[key]=serialized(row[key],value=>obj(value)&&Object.values(value).every(items));
    }
    return profile;
  });
  return {cards,profiles:people};
}

function attachBackup(db,dataDir){
  dbFor(dataDir);
  db.prepare('ATTACH DATABASE ? AS memory_backup').run(path.join(path.resolve(dataDir),'livingmemory.sqlite'));
  return ()=>db.exec('DETACH DATABASE memory_backup');
}

function restoreAttached(db,snapshot,state){
  const replace=(table,columns,rows)=>{
    db.exec(`DELETE FROM memory_backup.${table}`);
    const insert=db.prepare(`INSERT INTO memory_backup.${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`);
    for(const row of rows)insert.run(...columns.map(column=>row[column]));
  };
  replace('lm_memories',backupCardColumns,snapshot.cards);
  replace('lm_profiles',backupProfileColumns,snapshot.profiles);
  const sideIds=new Set(snapshot.cards.map(row=>row.id));
  const mirrored=db.prepare("SELECT id,role_id,content,created_at FROM memory_backup.lm_memories WHERE role_id=? AND status='active' ORDER BY locked DESC, importance DESC, updated_at DESC, id LIMIT 50");
  const retained=state.memories.filter(item=>!sideIds.has(item.id));
  const copies=[];
  for(const role of state.roles)for(const row of mirrored.all(role.id))copies.push({id:row.id,roleId:row.role_id,content:row.content,createdAt:row.created_at});
  const room=Math.max(0,2800-retained.length);
  state.memories=retained.concat(room?copies.slice(-room):[]);
}

module.exports={
  MAX_IMPORT_ENTRIES,PROFILE_SECTIONS,close,emptyProfile,tokenize,jaccard,cosine,clampImportance,
  getProfile,saveProfile,applyProfileUpdates,formatProfileText,listCards,getCard,getVectors,storedIds,upsertCard,
  setCardVector,setCardStatus,deleteCard,removeRole,reinforceAccess,readSource,
  parseLivingMemoryTransfer,previewImport,executeImport,exportLivingMemoryJson,
  exportBackup,validateBackup,attachBackup,restoreAttached
};
