// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../../state.cjs');
const defaultModels=require('../models.cjs');
const MemoryStore=require('../memory-store.cjs');
const {visibleText}=require('../response.cjs');
const {createHash}=require('node:crypto');

const lifecycleChecked=new Map();
const extracting=new Set();

function ensureData(state){
  state.engine??={};state.engine.data??={};
  const d=state.engine.data.memory??={};
  d.lastExtracted??={};
  d.cursors??={};
  d.vectors??={};
  d.meta??={};
  d.profiles??={};
  return d;
}

function limitsFor(settings){
  const preset=settings.detailPreset||'balanced';
  const defaultInject=preset==='light'?5:preset==='deep'?12:8;
  const defaultRounds=preset==='light'?8:preset==='deep'?4:6;
  return {
    maxInjectCount:Math.max(1,Math.min(30,Number.isFinite(settings.maxInjectCount)?settings.maxInjectCount:defaultInject)),
    extractEveryRounds:Math.max(1,Math.min(50,Number.isFinite(settings.extractEveryRounds)?settings.extractEveryRounds:defaultRounds)),
    idleReflectMinutes:Math.max(5,Math.min(1440,Number(settings.idleReflectMinutes)||60)),
    enableDecay:settings.enableDecay!==false,
    useEmbedding:settings.useEmbedding!==false,
    summaryModelId:String(settings.summaryModelId||'').trim()
  };
}

function listMergedCards(state,roleId,{dataDir,status='active',limit=null}={}){
  const cards=MemoryStore.listCards(dataDir,state,roleId,{status,limit});
  if(!dataDir||!state.memories?.some(m=>m.roleId===roleId))return cards;
  const stored=MemoryStore.storedIds(dataDir,roleId);
  const legacy=MemoryStore.listCards(null,state,roleId,{status,limit:null}).filter(c=>!stored.has(c.id));
  const combined=cards.concat(legacy);
  return limit===null?combined:combined.slice(0,limit);
}

function scoreCards(cards,queryText,vectors={},queryVector=null,rerankScores=null){
  const qRaw=String(queryText||'').trim().toLowerCase();
  const qTokens=MemoryStore.tokenize(qRaw);
  const total=Math.max(1,cards.length);
  return cards.map((card,index)=>{
    const hay=`${card.content}\n${(card.topics||[]).join(' ')}\n${(card.keyFacts||[]).join(' ')}`.toLowerCase();
    const cTokens=MemoryStore.tokenize(hay);
    let lexical=0;
    for(const t of qTokens){
      if(cTokens.has(t))lexical+=t.length>1?2.0:0.45;
    }
    if(qRaw.length>=2&&hay.includes(qRaw.slice(0,24)))lexical+=2.5;
    const vecScore=(queryVector&&vectors[card.id])?Math.max(0,MemoryStore.cosine(queryVector,vectors[card.id]))*5.5:0;
    const rScore=rerankScores?.has(card.id)?rerankScores.get(card.id)*6.0:0;
    const importance=(card.importance||0.5)*1.4+(card.locked?0.5:0);
    const accessBoost=Math.log1p(card.accessCount||0)*0.22;
    const recency=((total-index)/total)*0.35;
    return {card,index,lexical,score:lexical+vecScore+rScore+importance+accessBoost+recency};
  });
}

function selectForPrompt(state,roleId,queryText='',{dataDir,limitOverride}={}){
  const R=require('../registry.cjs');
  if(!R.isEnabled(state,'memory'))return [];
  const cards=listMergedCards(state,roleId,{dataDir});
  const settings=R.values(state,'memory');
  const limit=limitOverride||limitsFor(settings).maxInjectCount;
  if(cards.length<=limit)return cards;
  const qVec=state.engine?.data?.memory?.vectors?.['query:'+roleId];
  const vectors=qVec?MemoryStore.getVectors(dataDir,state,cards.map(c=>c.id)):{};
  const scored=scoreCards(cards,queryText,vectors,qVec,null);
  return scored.sort((a,b)=>b.score-a.score).slice(0,limit).sort((a,b)=>a.index-b.index).map(x=>x.card);
}

function recordArchivedMentions(state,roleId,query,{dataDir,mutate,now=Date.now()}={}){
  const cards=listMergedCards(state,roleId,{dataDir,status:'archived'});
  const ids=scoreCards(cards,query).filter(item=>item.lexical>=2).map(item=>item.card.id);
  if(!ids.length)return;
  if(mutate)mutate(latest=>MemoryStore.markMentioned(dataDir,latest,roleId,ids,now));
  else if(dataDir)MemoryStore.markMentioned(dataDir,state,roleId,ids,now);
}

async function recallForPrompt(state,roleId,queryText,{dataDir,signal,onUsage,mutate,modelApi=defaultModels,getState=()=>state}={}){
  const R=require('../registry.cjs');
  const empty={cards:[],profile:null,profileText:''};
  if(!R.isEnabled(state,'memory'))return empty;
  const settings=R.values(state,'memory'),limits=limitsFor(settings);
  // When every card fits, all of them are injected anyway; skip the embedding and rerank calls.
  const cards=listMergedCards(state,roleId,{dataDir}),small=cards.length<=limits.maxInjectCount;
  const recentUser=(state.messages||[]).filter(m=>m.roleId===roleId&&m.sender==='user'&&['text','voice'].includes(m.type)).slice(-2).map(m=>m.meta?.transcript||m.content).join('\n');
  const expandedQuery=[recentUser,queryText].filter(Boolean).join('\n').trim().slice(0,1000);
  let queryVec=null;
  if(!small&&limits.useEmbedding&&expandedQuery&&state.settings?.ai?.assign?.embedding&&cards.length){
    try{
      queryVec=await modelApi.embed(state,expandedQuery,{signal,onUsage});
    }catch{}
  }
  const afterEmbedding=getState();
  if(!R.isEnabled(afterEmbedding,'memory'))return empty;
  const vectors=queryVec?MemoryStore.getVectors(dataDir,state,cards.map(c=>c.id)):{};
  const firstPass=scoreCards(cards,expandedQuery,vectors,queryVec,null).sort((a,b)=>b.score-a.score).slice(0,Math.max(16,limits.maxInjectCount));
  let rerankMap=null;
  if(!small&&expandedQuery&&firstPass.length>3&&state.settings?.ai?.assign?.rerank&&typeof modelApi.rerank==='function'){
    try{
      const candidates=firstPass.map(x=>MemoryStore.getCard(dataDir,afterEmbedding,roleId,x.card.id)).filter(c=>c?.status==='active');
      const ranked=candidates.length?await modelApi.rerank(afterEmbedding,expandedQuery,candidates.map(c=>c.content),{topN:limits.maxInjectCount,signal,onUsage}):[];
      if(Array.isArray(ranked)&&ranked.length){
        rerankMap=new Map();
        for(const r of ranked){
          const item=candidates[r.index];
          if(item)rerankMap.set(item.id,r.score);
        }
      }
    }catch{}
  }
  const finalScored=rerankMap?scoreCards(firstPass.map(x=>x.card),expandedQuery,vectors,queryVec,rerankMap).sort((a,b)=>b.score-a.score):firstPass;
  const afterRanking=getState();
  if(!R.isEnabled(afterRanking,'memory'))return empty;
  recordArchivedMentions(afterRanking,roleId,expandedQuery,{dataDir,mutate});
  const picked=finalScored.map(x=>MemoryStore.getCard(dataDir,afterRanking,roleId,x.card.id)).filter(c=>c?.status==='active').slice(0,limits.maxInjectCount);
  if(picked.length&&mutate)mutate(st=>MemoryStore.reinforceAccess(dataDir,st,picked.map(c=>c.id)));
  else if(picked.length&&dataDir)MemoryStore.reinforceAccess(dataDir,null,picked.map(c=>c.id));
  const profile=profileForAI(dataDir,afterRanking,roleId);
  return {
    cards:picked,
    profile,
    profileText:MemoryStore.formatProfileText(profile)
  };
}

function parseReflection(raw){
  const cleaned=visibleText(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=cleaned.indexOf('{');
  let parsed;
  try{parsed=JSON.parse(start>=0&&!cleaned.startsWith('[')?cleaned.slice(start):cleaned);}
  catch{return {memories:[],profileUpdates:[]};}
  const rawList=Array.isArray(parsed)?parsed:Array.isArray(parsed?.memories)?parsed.memories:[];
  const memories=[];
  for(const item of rawList){
    if(typeof item==='string'&&item.trim()){
      memories.push({content:item.trim().slice(0,500),summary:item.trim().slice(0,500),memoryType:'FACT',importance:0.65,topics:[],keyFacts:[],sentiment:'neutral'});
    }else if(item&&typeof item==='object'&&typeof item.content==='string'&&item.content.trim()){
      memories.push({
        content:item.content.trim().slice(0,800),
        summary:String(item.summary||item.content).trim().slice(0,500),
        memoryType:String(item.memoryType||item.memory_type||'FACT').toUpperCase(),
        importance:MemoryStore.clampImportance(item.importance,0.65),
        topics:Array.isArray(item.topics)?item.topics.map(String).slice(0,6):[],
        keyFacts:Array.isArray(item.keyFacts||item.key_facts)?(item.keyFacts||item.key_facts).map(String).slice(0,6):[],
        sentiment:String(item.sentiment||'neutral')
      });
    }
    if(memories.length>=8)break;
  }
  const profileUpdates=Array.isArray(parsed?.profileUpdates||parsed?.profile_updates)?(parsed.profileUpdates||parsed.profile_updates).filter(item=>item&&typeof item==='object'&&!Array.isArray(item)).slice(0,12):[];
  return {memories,profileUpdates};
}

function isDuplicate(candidate,existing){
  const norm=s=>String(s||'').toLowerCase().replace(/[\s，。！？、；："'‘’“”.,!?]/g,'');
  const cNorm=norm(candidate);
  if(!cNorm)return true;
  const cTok=MemoryStore.tokenize(candidate);
  return existing.some(item=>{
    const eNorm=norm(item.content);
    return eNorm.includes(cNorm)||cNorm.includes(eNorm)||MemoryStore.jaccard(cTok,MemoryStore.tokenize(item.content))>=0.78;
  });
}

function profileForAI(dataDir,state,roleId){
  const profile=MemoryStore.getProfile(dataDir,state,roleId);
  if(!MemoryStore.formatProfileText(profile))return profile;
  const archived=listMergedCards(state,roleId,{dataDir,status:'archived'});
  if(!archived.length)return profile;
  for(const section of MemoryStore.PROFILE_SECTIONS){
    for(const [field,value] of Object.entries(profile[section]||{})){
      const keep=term=>!isDuplicate(term,archived)&&!isDuplicate(field+term,archived);
      if(Array.isArray(value)){
        profile[section][field]=value.filter(keep);
        if(!profile[section][field].length)delete profile[section][field];
      }else if(!keep(value))delete profile[section][field];
    }
  }
  return profile;
}

function toolResultForAI(name,result,state,roleId,dataDir){
  if(!require('../registry.cjs').isEnabled(state,'memory'))return {error:'长期记忆已关闭'};
  if(!result||result.error)return result;
  if(name==='recall_memory'){
    const memories=(result.memories||[]).map(m=>MemoryStore.getCard(dataDir,state,roleId,m.id)).filter(c=>c?.status==='active').map(c=>({id:c.id,type:c.memoryType,content:c.content}));
    return {count:memories.length,memories};
  }
  const {content,...receipt}=result;
  return receipt;
}
function isMemoryTool(name){return ['recall_memory','memorize_memory','forget_memory'].includes(name);}

function digest(text){return createHash('sha256').update(text).digest('hex');}
function createReadStamp(state,roleId,cards,profileText='',profile){
  if(!cards.length&&!profileText)return null;
  const fields=[];
  if(profileText&&profile){
    let offset=0;
    for(const section of MemoryStore.PROFILE_SECTIONS){
      for(const [field,value] of Object.entries(profile[section])){
        const start=profileText.indexOf(field+'：',offset);
        if(start<0)continue;
        offset=start+field.length+1;
        for(const term of [].concat(value)){
          const length=Math.min(term.length,profileText.length-offset);
          if(length>0)fields.push([section,field,length,digest(term.slice(0,length))]);
          offset+=term.length+1;
        }
      }
    }
  }
  return {revision:state.engine?.data?.memory?.readRevision||0,cards:[...new Map(cards.map(c=>[c.id,digest(c.content)])).entries()],fields};
}
function readStampValid(state,roleId,stamp,dataDir){
  if(!stamp)return true;
  if(!require('../registry.cjs').isEnabled(state,'memory')||stamp.revision!==(state.engine?.data?.memory?.readRevision||0))return false;
  for(const [id,hash] of stamp.cards){
    const card=MemoryStore.getCard(dataDir,state,roleId,id);
    if(card?.status!=='active'||digest(card.content)!==hash)return false;
  }
  if(stamp.fields?.length){
    const profile=profileForAI(dataDir,state,roleId);
    for(const [section,field,length,hash] of stamp.fields){
      if(![].concat(profile[section]?.[field]||[]).some(term=>digest(term.slice(0,length))===hash))return false;
    }
  }
  return true;
}
function assertReadStamp(state,roleId,stamp,dataDir){
  if(!readStampValid(state,roleId,stamp,dataDir))throw Object.assign(new Error('共同记忆已变更，旧回复已停止。可重新发送。'),{name:'AbortError',code:'MEMORY_CHANGED'});
}

function splitConversationWindows(msgs){
  if(!msgs.length)return [];
  const windows=[[]];
  for(const m of msgs){
    const cur=windows.at(-1);
    if(cur.length&&m.createdAt-cur.at(-1).createdAt>4*3600000)windows.push([]);
    windows.at(-1).push(m);
  }
  return windows.slice(-2);
}

async function extractForRole({getState,mutate,roleId,dataDir,signal,onUsage,modelApi=defaultModels,now=Date.now,manual=false}){
  const s=getState(),R=require('../registry.cjs'),settings=R.values(s,'memory'),limits=limitsFor(settings);
  if(!settings.enabled||(!manual&&!settings.autoExtract))return [];
  const role=S.role(s,roleId);S.chatAllowed(role);
  const d=s.engine?.data?.memory||{},lastCount=d.lastExtracted?.[roleId]||0,lastAt=d.lastExtractedAt?.[roleId];
  const revision=d.settingsRevision||0,forgetRevision=d.forgetRevisions?.[roleId]||0,personaId=role.rolePersonaId;
  const stillAllowed=latest=>{
    const current=latest.roles.find(r=>r.id===roleId);
    return current&&!current.deleted&&!current.permissions?.blocked&&personaId===current.rolePersonaId
      &&R.isEnabled(latest,'memory')&&(manual||R.values(latest,'memory').autoExtract)
      &&(latest.engine?.data?.memory?.settingsRevision||0)===revision&&(latest.engine?.data?.memory?.forgetRevisions?.[roleId]||0)===forgetRevision;
  };
  const recentMsgs=s.messages.filter(m=>m.roleId===roleId&&m.status==='sent'&&(m.type==='text'||m.type==='voice')&&['user','assistant'].includes(m.sender))
    .map(m=>({...m,text:m.type==='voice'?(m.meta?.transcript||m.content||''):(m.content||'')}))
    .filter(m=>m.text.trim());
  const cursor=d.cursors?.[roleId];
  const roundGate=manual?0:limits.extractEveryRounds*2;
  // Count by message time when known, so clearing or deleting chat does not freeze the round counter.
  const fresh=Number.isFinite(lastAt)?recentMsgs.filter(m=>m.createdAt>lastAt).length:recentMsgs.length-lastCount;
  if(!manual&&fresh<roundGate&&!(cursor?.idlePending)){
    return [];
  }
  const windows=splitConversationWindows(recentMsgs.slice(-24));
  const snippet=windows.map(w=>w.map(m=>(m.sender==='user'?'用户':role.name)+(m.id?'[消息ID：'+m.id+']':'')+'：'+m.text).join('\n')).join('\n---\n');
  if(!snippet.trim()){
    if(cursor?.idlePending)mutate(st=>{ensureData(st).cursors[roleId]={lastTurnAt:cursor.lastTurnAt,roundsSinceExtract:0,idlePending:false};});
    return [];
  }
  const existing=listMergedCards(s,roleId,{dataDir,status:'active',limit:60});
  const profileText=MemoryStore.formatProfileText(profileForAI(dataDir,s,roleId));
  const messages=[
    {
      role:'system',
      content:`你是长期记忆提炼器（LivingMemory）。请从下面对话中提炼值得长期记住的【具体原子事实与人物印象】：
1. memories 数组：每条为对象 {"content":"客观明确的一条事实","memoryType":"FACT|PREFERENCE|EVENT|RELATIONSHIP|PLAN","importance":0.3~0.95,"topics":["关键词"],"sentiment":"positive|neutral|negative"}，或简短字符串。跳过纯寒暄（你好、在干嘛）。
2. profileUpdates 数组（可选）：对用户稳定画像的增量更新 {"section":"basic|preferences|status|relationship","field":"字段名如忌口/职业/近况/相处称呼","op":"add|set|remove","value":"具体内容","sourceMessageIds":["来源消息ID"]}，来源只选下面实际给出的消息ID。
只输出严格 JSON：{"memories":[...],"profileUpdates":[...]}`
    },
    {
      role:'user',
      content:`已有重点记忆（勿重复提取）：\n${existing.slice(0,25).map(m=>'- '+m.content).join('\n')||'无'}\n\n已有用户画像：\n${profileText||'无'}\n\n近期对话：\n${snippet}`
    }
  ];
  const summaryModel=limits.summaryModelId&&s.settings?.ai?.models?.some(m=>m.id===limits.summaryModelId&&m.kind==='chat')?limits.summaryModelId:undefined;
  const res=await modelApi.call(s,{purpose:'chat',modelId:summaryModel,role,messages,signal,onUsage});
  const parsed=parseReflection(res.message);
  const added=[];
  const at=now();
  const latestMessage=recentMsgs.at(-1);
  const sourceExcerpt=recentMsgs.slice(-4).map(m=>`${m.sender==='user'?'用户':role.name}：${m.text.slice(0,80)}`).join(' / ').slice(0,400);
  mutate(latest=>{
    if(!stillAllowed(latest)||!latest.messages.some(message=>message.id===latestMessage.id&&message.roleId===roleId&&message.status==='sent'))return;
    const data=ensureData(latest);
    if(data.lastError?.roleId===roleId)delete data.lastError;
    data.lastExtracted[roleId]=recentMsgs.length;
    (data.lastExtractedAt??={})[roleId]=recentMsgs.reduce((latest,message)=>Math.max(latest,message.createdAt),lastAt||0);
    const pending=data.cursors[roleId];
    data.cursors[roleId]={lastTurnAt:pending?.lastTurnAt||at,roundsSinceExtract:Math.max(0,(pending?.roundsSinceExtract||0)-(cursor?.roundsSinceExtract||0)),idlePending:false};
    const owned=listMergedCards(latest,roleId,{dataDir,status:'all'});
    for(const item of parsed.memories){
      if(!dataDir&&(latest.memories?.length||0)>=3000)break;
      if(isDuplicate(item.content,[...owned,...added]))continue;
      const rec=MemoryStore.upsertCard(dataDir,latest,roleId,{
        content:item.content,
        summary:item.summary,
        memoryType:item.memoryType,
        importance:item.importance,
        topics:item.topics,
        keyFacts:item.keyFacts,
        sentiment:item.sentiment,
        locked:item.importance>=0.9,
        createdAt:at,
        updatedAt:at,
        sourceExcerpt,
        origin:'auto'
      },{sourceMessages:recentMsgs.slice(-24).map(message=>({id:message.id,role:message.sender,content:message.text.slice(0,300),timestamp:message.createdAt}))});
      if(rec)added.push(rec);
    }
    if(parsed.profileUpdates.length){
      const updates=parsed.profileUpdates.map(item=>{
        const value=String(item.value||''),matching=[...owned,...added].filter(card=>isDuplicate(value,[card]));
        const ids=new Set(recentMsgs.map(message=>message.id).filter(Boolean));
        const requested=Array.isArray(item.sourceMessageIds)?item.sourceMessageIds.filter(id=>ids.has(id)):[];
        const related=recentMsgs.filter(message=>isDuplicate(value,[{content:message.text}])).map(message=>message.id).filter(Boolean);
        return {...item,memoryIds:matching.map(card=>card.id),messageIds:requested.length?requested:related.length?related:recentMsgs.filter(message=>message.sender==='user'&&message.id).slice(-1).map(message=>message.id)};
      });
      MemoryStore.applyProfileUpdates(dataDir,latest,roleId,updates,at);
    }
  });
  if(added.length&&stillAllowed(getState())&&limits.useEmbedding&&s.settings?.ai?.assign?.embedding){
    try{
      const vecs=await modelApi.embed(getState(),added.map(a=>a.content),{signal,onUsage});
      mutate(latest=>{
        if(!stillAllowed(latest))return;
        added.forEach((a,i)=>{if(vecs[i]&&MemoryStore.getCard(dataDir,latest,roleId,a.id)?.status==='active')MemoryStore.setCardVector(dataDir,latest,a.id,vecs[i]);});
      });
    }catch{}
  }
  return added;
}

async function autoExtract(options){
  const {getState,mutate,roleId,dataDir,now=Date.now}=options;
  const key=(dataDir||'')+':'+roleId,state=getState(),cursor=state.engine?.data?.memory?.cursors?.[roleId];
  if(extracting.has(key)||cursor?.retryAt>now())return;
  extracting.add(key);
  try{await extractForRole(options);}
  catch(error){
    // Recording the failure must not turn into an unhandled rejection (this runs fire-and-forget).
    try{mutate(st=>{
      if(!require('../registry.cjs').values(st,'memory').autoExtract||!require('../registry.cjs').isEnabled(st,'memory')||!st.roles.some(r=>r.id===roleId)||(st.engine?.data?.memory?.settingsRevision||0)!==(state.engine?.data?.memory?.settingsRevision||0))return;
      const data=ensureData(st),cur=data.cursors[roleId]??={};
      cur.failures=(cur.failures||0)+1;
      cur.retryAt=now()+Math.min(3600000,300000*2**Math.min(cur.failures-1,4));
      data.lastError={roleId,at:now(),message:String(error?.message||error).slice(0,500)};
    });}catch(writeError){console.error('记忆整理错误无法记录',writeError);}
  }finally{extracting.delete(key);}
}

function consolidateAndDecay(state,roleId,{dataDir,now=Date.now()}={}){
  const cards=listMergedCards(state,roleId,{dataDir,status:'active',limit:400});
  let archivedCount=0;
  // 1. Consolidate near-duplicate active cards (keep locked or higher importance)
  const sorted=[...cards].sort((a,b)=>(Number(b.locked)-Number(a.locked))||(b.importance-a.importance)||(b.updatedAt-a.updatedAt));
  const keptTokens=[];
  for(const c of sorted){
    const tok=MemoryStore.tokenize(c.content);
    const dup=keptTokens.find(k=>MemoryStore.jaccard(tok,k)>=0.82);
    if(dup&&!c.locked){
      MemoryStore.setCardStatus(dataDir,state,roleId,c.id,{status:'archived'});
      archivedCount++;
      continue;
    }
    keptTokens.push(tok);
    // 2. Gentle Ebbinghaus decay only on unlocked, low-importance, unaccessed old cards (>21d)
    if(!c.locked&&c.importance<0.8&&(c.accessCount||0)===0&&c.createdAt>0){
      // Never-recalled cards normally have no last-access time; imported cards carry their import time there.
      const ageDays=(now-Math.max(c.createdAt,c.lastAccessedAt||0))/86400000;
      if(ageDays>21){
        const strength=c.importance*Math.exp(-ageDays/45);
        if(strength<0.18){
          MemoryStore.setCardStatus(dataDir,state,roleId,c.id,{status:'archived'});
          archivedCount++;
        }
      }
    }
  }
  return archivedCount;
}

const memoryTools=[
  {
    type:'function',
    function:{
      name:'memorize_memory',
      description:'把对方刚提到的重要偏好、约定、忌口、生日或个人事实马上记入长期记忆卡片。',
      parameters:{
        type:'object',
        properties:{
          content:{type:'string',description:'清晰简练的一条事实记忆'},
          memoryType:{type:'string',enum:['FACT','PREFERENCE','EVENT','RELATIONSHIP','PLAN'],description:'记忆分类'},
          importance:{type:'number',description:'重要程度 0.4~1.0，特别重要的纪念日/忌口填 0.9'},
          locked:{type:'boolean',description:'是否锁定为永久核心记忆（不会被淡忘）'}
        },
        required:['content'],
        additionalProperties:false
      }
    }
  },
  {
    type:'function',
    function:{
      name:'recall_memory',
      description:'按关键词查找当前有效的共同记忆，包含较早保存的记录。',
      parameters:{
        type:'object',
        properties:{
          query:{type:'string',description:'想回忆的关键词、事件或人物名字'}
        },
        required:['query'],
        additionalProperties:false
      }
    }
  },
  {
    type:'function',
    function:{
      name:'forget_memory',
      description:'当用户明确要求“忘掉这件事”或发现某条旧记忆已失效时，归档移除对应未锁定的记忆卡片。',
      parameters:{
        type:'object',
        properties:{
          memoryId:{type:'string',description:'要忘掉的记忆编号'},
          keyword:{type:'string',description:'若不知编号，可填关键词匹配'}
        },
        required:[],
        additionalProperties:false
      }
    }
  }
];

module.exports={
  id:'memory',
  name:'长期记忆',
  isolated:true,
  description:'搭载 SQLite 记忆卡片库、四维人物画像、6轮/闲置1小时自动沉淀与混合语义召回，并支持导入 LivingMemory 迁移备份。',
  settings:[
    {key:'enabled',label:'开启长期记忆',type:'boolean',default:true},
    {key:'detailPreset',label:'记忆细致度',type:'select',default:'balanced',options:[
      {value:'light',label:'精简省流（带入核心 5 条）'},
      {value:'balanced',label:'均衡推荐（带入相关 8 条）'},
      {value:'deep',label:'细腻详尽（带入相关 12 条）'}
    ]},
    {key:'autoExtract',label:'聊完自动整理新记忆与对你的印象',type:'boolean',default:true},
    {key:'extractEveryRounds',label:'每隔几轮对话自动提炼一次',type:'number',default:6,min:1,max:50,integer:true,advanced:true},
    {key:'idleReflectMinutes',label:'停聊多久后补提炼（分钟）',type:'number',default:60,min:5,max:1440,integer:true,advanced:true},
    {key:'maxInjectCount',label:'每次聊天最多注入回忆条数',type:'number',default:8,min:1,max:30,integer:true,advanced:true},
    {key:'summaryModelId',label:'独立记忆提炼模型 ID（留空跟随聊天）',type:'text',default:'',maxLength:100,advanced:true},
    {key:'useEmbedding',label:'配置嵌入模型时自动建向量索引',type:'boolean',default:true,advanced:true},
    {key:'enableDecay',label:'温和淡忘久未提及的非重要小事',type:'boolean',default:true,advanced:true}
  ],
  hooks:{
    async beforeAssemble(ctx){
      const s=ctx.getState?.();if(!s||!ctx.roleId)return;
      if(!require('../registry.cjs').isEnabled(s,'memory'))return;
      const items=s.messages?.filter(m=>m.roleId===ctx.roleId&&m.status==='sent')||[];
      const last=items.findLast(m=>m.sender==='user'),q=last?.meta?.transcript||last?.content||'';
      const recalled=await recallForPrompt(s,ctx.roleId,q,{
        dataDir:ctx.dataDir,
        getState:ctx.getState,
        modelApi:ctx.modelApi,
        signal:ctx.signal,
        onUsage:ctx.onUsage,
        mutate:ctx.mutate
      });
      ctx.recalledMemories=recalled.cards;
    },
    afterDeliver(ctx){
      if(ctx.kind==='moment'||ctx.finalTurn===false)return;
      const s=ctx.getState?.();if(!s)return;
      const now=Date.now();
      ctx.mutate(st=>{
        const d=ensureData(st);
        const cur=d.cursors[ctx.roleId]||{lastTurnAt:0,roundsSinceExtract:0};
        d.cursors[ctx.roleId]={...cur,lastTurnAt:now,roundsSinceExtract:(cur.roundsSinceExtract||0)+1,idlePending:false};
      });
      const role=s.roles?.find(r=>r.id===ctx.roleId);
      if(!role||!defaultModels.hasReadyChatModel(s,{skipMock:true}))return;
      const extract=()=>autoExtract({getState:ctx.getState,mutate:ctx.mutate,roleId:ctx.roleId,dataDir:ctx.dataDir,onUsage:ctx.onUsage,modelApi:ctx.modelApi});
      if(ctx.runBackground)ctx.runBackground(extract);
      else setImmediate(()=>extract().catch(error=>console.error('记忆整理启动失败',error)));
    }
  },
  tools:[{
    definitions:(state,role,config,catalog)=>{
      if(catalog)return memoryTools;
      const R=require('../registry.cjs');
      if(!R.isEnabled(state,'memory'))return [];
      return memoryTools;
    },
    async execute(name,args,ctx){
      const {getState,mutate,roleId,dataDir}=ctx;
      const s=getState(),actor=S.role(s,roleId);S.chatAllowed(actor);
      if(!require('../registry.cjs').isEnabled(s,'memory'))S.fail('长期记忆已关闭');
      if(!S.obj(args))S.fail('记忆工具参数格式无效');
      if(name==='memorize_memory'){
        const content=S.text(String(args.content||''),800).trim();
        if(!content)S.fail('记忆内容不能为空');
        return mutate(st=>{
          const existing=listMergedCards(st,roleId,{dataDir,status:'all'});
          if(isDuplicate(content,existing)){
            // Be honest when the match is only in the archive: it is not recalled until the user restores it.
            if(!isDuplicate(content,existing.filter(c=>c.status==='active')))return {saved:false,duplicate:true,archived:true,message:'这条在已归档记忆中，当前不会被回忆；需要用户在“记忆 → 已归档”里恢复后才会重新生效'};
            return {saved:false,duplicate:true,message:'这条记忆已经记过了'};
          }
          const rec=MemoryStore.upsertCard(dataDir,st,roleId,{
            content,
            summary:content,
            memoryType:args.memoryType||'FACT',
            importance:MemoryStore.clampImportance(args.importance,0.8),
            locked:Boolean(args.locked),
            origin:'tool'
          });
          return {saved:true,memoryId:rec?.id,content};
        }).value;
      }
      if(name==='recall_memory'){
        const query=S.text(String(args.query||''),200).trim();
        recordArchivedMentions(s,roleId,query,{dataDir,mutate});
        const all=listMergedCards(s,roleId,{dataDir});
        const scored=scoreCards(all,query).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.card);
        if(scored.length)mutate(st=>MemoryStore.reinforceAccess(dataDir,st,scored.map(c=>c.id)));
        return {count:scored.length,memories:scored.map(c=>({id:c.id,type:c.memoryType,status:c.status,content:c.content}))};
      }
      if(name==='forget_memory'){
        const id=String(args.memoryId||'').trim(),kw=String(args.keyword||'').trim().toLowerCase();
        if(!id&&!kw)S.fail('请指定记忆编号或关键词');
        return mutate(st=>{
          const active=listMergedCards(st,roleId,{dataDir});
          const hit=id?active.find(c=>c.id===id):active.find(c=>c.content.toLowerCase().includes(kw));
          if(!hit)return {forgotten:false,message:'没有找到匹配的记忆'};
          if(hit.locked)return {forgotten:false,locked:true,message:'这条记忆已被用户锁定保护，无法忘掉'};
          MemoryStore.setCardStatus(dataDir,st,roleId,hit.id,{status:'forgotten'});
          return {forgotten:true,memoryId:hit.id};
        }).value;
      }
      S.fail('未知记忆工具');
    }
  }],
  jobs:[{
    id:'memory-lifecycle',
    async run({getState,mutate,isBusy,now,dataDir,demoModel,modelApi}){
      const s=getState(),R=require('../registry.cjs'),settings=R.values(s,'memory'),limits=limitsFor(settings);
      if(!settings.enabled)return;
      const ai=s.settings?.ai,tz=s.settings?.timezone||'UTC',today=require('../time.cjs').dayKey(now,tz);
      for(const role of s.roles||[]){
        if(role.deleted||role.permissions?.blocked)continue;
        // 1. 1h idle catch-up reflection
        const cursor=s.engine?.data?.memory?.cursors?.[role.id];
        if(settings.autoExtract&&!demoModel&&cursor&&!(cursor.retryAt>now)&&!extracting.has((dataDir||'')+':'+role.id)&&cursor.roundsSinceExtract>=1&&cursor.lastTurnAt&&now-cursor.lastTurnAt>=limits.idleReflectMinutes*60000&&!isBusy(role.id)){
          if(defaultModels.hasReadyChatModel(s,{skipMock:true})){
            mutate(st=>{const d=ensureData(st);d.cursors[role.id]={...d.cursors[role.id],idlePending:true};});
            await autoExtract({getState,mutate,roleId:role.id,dataDir,now:()=>now,modelApi});
            return;
          }
        }
        // 2. Daily decay & duplicate consolidation (never mutate untouched states when nothing needs archiving)
        const checkKey=`${dataDir||''}:${role.id}`;
        const d=s.engine?.data?.memory;
        if(limits.enableDecay&&lifecycleChecked.get(checkKey)!==today&&d?.lastLifecycleDay?.[role.id]!==today){
          lifecycleChecked.set(checkKey,today);
          const cards=listMergedCards(s,role.id,{dataDir,status:'active',limit:400});
          if(cards.length){
            const simCount=consolidateAndDecay(structuredClone(s),role.id,{dataDir:null,now});
            if(simCount>0||dataDir){
              // Run cleanly inside mutate only when changes are actually possible
              let changed=0;
              mutate(st=>{
                changed=consolidateAndDecay(st,role.id,{dataDir,now});
                if(changed>0){
                  const mem=ensureData(st);
                  mem.lastLifecycleDay??={};
                  mem.lastLifecycleDay[role.id]=today;
                }
              });
            }
          }
        }
      }
    }
  }],
  data:'memory',
  page:'memory',
  limitsFor,
  selectForPrompt,
  listMergedCards,
  profileForAI,isMemoryTool,toolResultForAI,
  createReadStamp,readStampValid,assertReadStamp,
  recallForPrompt,
  extractForRole,
  consolidateAndDecay,
  removeRole(state,roleId,dataDir){
    for(const k of [...lifecycleChecked.keys()])if(k.endsWith(':'+roleId))lifecycleChecked.delete(k);
    MemoryStore.removeRole(dataDir,state,roleId);
  }
};
