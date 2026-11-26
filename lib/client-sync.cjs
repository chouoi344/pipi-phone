// SPDX-License-Identifier: MIT
'use strict';
const {randomUUID,createHash}=require('node:crypto');
const protocol=Object.freeze({name:'pipi-phone',version:1,features:Object.freeze(['state-v1','chat-progress-v1','sync-v1','messages-v1'])});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The journal retains identifiers and field names, never copies of the application document.
function capture(state,{messages=true}={}){return {revision:state.revision,messages:messages?new Map(state.messages.map(message=>[message.id,hash(message)])):null,fields:new Map(Object.keys(state).filter(key=>!['messages','revision'].includes(key)).map(key=>[key,hash(state[key])]))};}
function createJournal({revision=0,maxEntries=256,maxBytes=2*1024*1024}={}){
  let epoch,latest,minimum,entries,bytes;
  function reset(current){epoch=randomUUID();latest=current;minimum=current;entries=[];bytes=0;}
  reset(revision);
  function ensure(current){if(current!==latest)reset(current);}
  function commit(before,state){
    if(before.revision!==latest||state.revision!==before.revision+1){reset(state.revision);return;}
    const existing=new Set(),upsert=[],deleted=[],fields=[];let previousIndex=-1,reordered=false,seenNew=false;
    if(before.messages){
      const positions=new Map([...before.messages.keys()].map((id,index)=>[id,index]));
      for(const message of state.messages){existing.add(message.id);if(before.messages.get(message.id)!==hash(message))upsert.push(message.id);const index=positions.get(message.id);if(index===undefined)seenNew=true;else{if(index<previousIndex||seenNew)reordered=true;previousIndex=index;}}
      for(const id of before.messages.keys())if(!existing.has(id))deleted.push(id);
    }
    for(const key of new Set([...before.fields.keys(),...Object.keys(state)]))if(!['messages','revision'].includes(key)&&before.fields.get(key)!==(Object.hasOwn(state,key)?hash(state[key]):undefined))fields.push(key);
    const entry={revision:state.revision,upsert,deleted,fields},serialized=JSON.stringify(entry),size=Buffer.byteLength(serialized);
    if(reordered||size>maxBytes||[...before.fields.keys()].some(key=>!Object.hasOwn(state,key))){reset(state.revision);return;}
    latest=state.revision;entries.push({revision:entry.revision,body:Buffer.from(serialized)});bytes+=size;
    while(entries.length>maxEntries||bytes>maxBytes){const removed=entries.shift();bytes-=removed.body.length;minimum=removed.revision;}
  }
  function describe(cursor,current){
    ensure(current);let decoded,reason;
    if(!cursor)reason='initial';
    else{
      try{if(typeof cursor!=='string'||cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();decoded=JSON.parse(Buffer.from(cursor,'base64url').toString());if(!Array.isArray(decoded)||decoded.length!==2||typeof decoded[0]!=='string'||!Number.isSafeInteger(decoded[1])||decoded[1]<0)throw Error();}
      catch{reason='invalid';}
      if(!reason){if(decoded[0]!==epoch)reason='epoch';else if(decoded[1]>latest)reason='ahead';else if(decoded[1]<minimum)reason='expired';}
    }
    const base={schema:1,epoch,revision:latest,cursor:Buffer.from(JSON.stringify([epoch,latest])).toString('base64url')};
    if(reason)return {...base,mode:'reset',reason};
    const ids=new Set(),fields=new Set();for(const stored of entries)if(stored.revision>decoded[1]){const entry=JSON.parse(stored.body.toString('utf8'));for(const id of entry.upsert)ids.add(id);for(const id of entry.deleted)ids.add(id);for(const field of entry.fields)fields.add(field);}
    return {...base,mode:'delta',fromRevision:decoded[1],ids,fields};
  }
  const stats=()=>({entries:entries.length,descriptorBytes:bytes,maxEntries,maxDescriptorBytes:maxBytes,minimumRevision:minimum,revision:latest});
  return {capture,commit,reset,describe,stats};
}
// json_each pages the existing JSON document without materialising a second complete message history in JS.
function createReader({db,parse,state:S,journal}){
  db.function('pipi_sync_lower',{deterministic:true},value=>String(value??'').toLowerCase());
  db.function('pipi_sync_link',{deterministic:true},value=>/(?:https?:\/\/|www\.)[^\s]+/i.test(value)?1:0);
  const source="json_each((SELECT json FROM app WHERE id=1),'$.messages')";
  const readMeta=()=>parse(db.prepare("SELECT json_set(json,'$.messages',json('[]')) AS json FROM app WHERE id=1").get().json);
  const currentRevision=()=>db.prepare("SELECT json_extract(json,'$.revision') AS revision FROM app WHERE id=1").get().revision;
  function sanitize(rows){
    const messages=rows.map(row=>JSON.parse(row.value)),byRole=new Map(),candidates=new Map();
    for(const message of messages){
      const texts=[];if(message.sender==='assistant'&&['text','voice'].includes(message.type)){texts.push(message.content);if(message.meta?.transcript)texts.push(message.meta.transcript);}if(message.meta?.quote?.sender==='assistant')texts.push(message.meta.quote.content);
      const ids=candidates.get(message.roleId)||new Set();for(const text of texts)for(const match of text.matchAll(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi))ids.add(match[0].toLowerCase());candidates.set(message.roleId,ids);
    }
    // Most pages contain no leaked message IDs. Only query membership for actual candidates,
    // instead of allocating every historical ID for each small page or role preview.
    for(const [roleId,ids] of candidates)byRole.set(roleId,ids.size?new Set(db.prepare(`SELECT lower(json_extract(value,'$.id')) AS id FROM ${source} WHERE json_extract(value,'$.roleId')=? AND lower(json_extract(value,'$.id')) IN (SELECT value FROM json_each(?))`).all(roleId,JSON.stringify([...ids])).map(row=>row.id)):new Set());
    return S.publicMessages(messages,byRole);
  }
  function view(cursor){
    const {ids,fields,...envelope}=journal.describe(cursor,currentRevision());
    if(envelope.mode==='reset'){
      const meta=S.publicState(readMeta()),heads=db.prepare(`SELECT value FROM (SELECT value,CAST(key AS INTEGER) AS position,row_number() OVER (PARTITION BY json_extract(value,'$.roleId') ORDER BY CAST(key AS INTEGER) DESC) AS rank FROM ${source}) WHERE rank=1 ORDER BY position`).all();
      meta.messages=sanitize(heads);return {...envelope,messageCoverage:'heads',state:meta};
    }
    const selected=ids.size?db.prepare(`SELECT value FROM ${source} WHERE json_extract(value,'$.id') IN (SELECT value FROM json_each(?)) ORDER BY CAST(key AS INTEGER)`).all(JSON.stringify([...ids])):[],upsertMessages=sanitize(selected),present=new Set(upsertMessages.map(message=>message.id)),replace={};
    if(fields.size){const meta=S.publicState(readMeta());for(const field of fields)if(!['messages','revision'].includes(field)&&Object.hasOwn(meta,field))replace[field]=meta[field];}
    return {...envelope,changes:{upsertMessages,deleteMessageIds:[...ids].filter(id=>!present.has(id)),replace}};
  }
  function role(roleId){S.role(readMeta(),roleId);}
  function before(roleId,beforeId){if(!beforeId)return Infinity;const row=db.prepare(`SELECT CAST(key AS INTEGER) AS position FROM ${source} WHERE json_extract(value,'$.id')=? AND json_extract(value,'$.roleId')=?`).get(beforeId,roleId);if(!row)S.fail('这条分页定位消息已删除，请重新载入最近消息',409,'MESSAGE_ANCHOR_GONE');return row.position;}
  function page({roleId,limit,beforeId,query='',type='all',from,to}){
    role(roleId);const position=before(roleId,beforeId),params=[roleId],filters=["json_extract(value,'$.roleId')=?"];
    if(Number.isFinite(position)){filters.push('CAST(key AS INTEGER)<?');params.push(position);}
    if(query){filters.push("instr(pipi_sync_lower(CASE WHEN json_extract(value,'$.type')='image' THEN '[图片]' ELSE coalesce(nullif(json_extract(value,'$.meta.transcript'),''),json_extract(value,'$.content')) END),?)>0");params.push(query.toLowerCase());}
    if(type==='image')filters.push("(json_extract(value,'$.type')='image' OR coalesce(json_extract(value,'$.meta.image'),'')<>'')");
    else if(type==='payment')filters.push("json_extract(value,'$.type') IN ('transfer','redpacket')");
    else if(['voice','forward'].includes(type)){filters.push("json_extract(value,'$.type')=?");params.push(type);}
    else if(type==='link')filters.push("json_extract(value,'$.type')='text' AND pipi_sync_link(json_extract(value,'$.content'))");
    if(from!==undefined){filters.push("json_extract(value,'$.createdAt')>=?");params.push(from);}if(to!==undefined){filters.push("json_extract(value,'$.createdAt')<?");params.push(to);}
    const rows=db.prepare(`SELECT value FROM ${source} WHERE ${filters.join(' AND ')} ORDER BY CAST(key AS INTEGER) DESC LIMIT ?`).all(...params,limit+1),hasMore=rows.length>limit;if(hasMore)rows.pop();rows.reverse();const messages=sanitize(rows);
    return {schema:1,epoch:journal.describe(undefined,currentRevision()).epoch,revision:currentRevision(),roleId,messages,hasMore,nextBeforeId:hasMore?messages[0].id:null};
  }
  function byIds(roleId,ids){role(roleId);const rows=db.prepare(`SELECT value FROM ${source} WHERE json_extract(value,'$.roleId')=? AND json_extract(value,'$.id') IN (SELECT value FROM json_each(?)) ORDER BY CAST(key AS INTEGER)`).all(roleId,JSON.stringify(ids)),messages=sanitize(rows),present=new Set(messages.map(message=>message.id));return {schema:1,epoch:journal.describe(undefined,currentRevision()).epoch,revision:currentRevision(),roleId,messages,missingIds:ids.filter(id=>!present.has(id))};}
  return {view,page,byIds};
}
module.exports={protocol,createJournal,createReader,capture};
