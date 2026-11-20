// SPDX-License-Identifier: MIT
'use strict';
const {
  randomUUID
} =require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const id=()=>randomUUID();
const Stickers=require('./engine/stickers.cjs');
const Media=require('./media-store.cjs');
// Read the same static JSON tokens used by the picker; never evaluate browser code.
const emojiData=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/emoji.js'),'utf8').match(/window\.PipiEmoji\s*=\s*Object\.freeze\((\[[\s\S]*?\])\);/);
if(!emojiData)throw new Error('Emoji token data is missing');
const emojiTokens=new Set(JSON.parse(emojiData[1]).map(entry=>entry.token));
const cropConfig={
  carrot:{
    seedCost:1,durationMs:300000,reward:20
  },tomato:{
    seedCost:1,durationMs:600000,reward:35
  }
};
const fail=(message,status=400,code='VALIDATION')=>{
  const e=new Error(message);
  e.status=status;
  e.code=code;
  throw e;
};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function text(x,max=200,def=''){
  if(x===undefined)return def;
  if(typeof x!=='string'||x.length>max)fail(`文本须在 ${max} 字以内`);
  return x;
}
function checkWechatId(value,previous){
  if(typeof value==='string'&&value!==previous&&/\p{Script=Han}/u.test(value))fail('微信号不能包含中文');
}
function integer(x,min=0,max=1000000000){
  if(!Number.isSafeInteger(x)||x<min||x>max)fail('数值超出允许范围');
  return x;
}
function bool(x,def=false){
  if(x===undefined)return def;
  if(typeof x!=='boolean')fail('布尔值格式错误');
  return x;
}
function enumOf(x,values,def){
  if(x===undefined&&def!==undefined)return def;
  if(!values.includes(x))fail('选项无效');
  return x;
}
function tags(x,def=[]){
  if(x===undefined)return [...def];
  if(!Array.isArray(x)||x.length>10||!x.every(value=>typeof value==='string'))fail('标签必须是最多 10 项的文字列表');
  return [...new Set(x.map(value=>text(value,30).trim()).filter(Boolean))];
}
function emojiToken(x){
  const token=text(x,50);
  if(!emojiTokens.has(token))fail('表情不在支持列表中');
  return token;
}
function emojiRecents(x){
  if(x===undefined)return [];
  if(!Array.isArray(x)||x.length>24)fail('最近表情列表最多 24 项');
  return [...new Set(x.map(emojiToken))];
}
function dataBytes(value,pattern,maxBytes,label){
  const match=value.match(pattern);
  if(!match)fail(label+'格式无效');
  const encoded=match[2],bytes=Buffer.from(encoded,'base64');
  if(!bytes.length||bytes.length>maxBytes||bytes.toString('base64')!==encoded)fail(label+'内容为空、过大或 Base64 无效');
  return {mime:match[1],bytes};
}
function image(x,empty=true,profileField=''){
  x=text(x,28*1024*1024);
  if(!x&&empty)return '';
  if(Media.isMediaUrl(x))return x.trim();
  const {mime,bytes:b}=dataBytes(x,/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/,20*1024*1024,profileField||'图片');
  if(profileField){
    // Older forms can submit a browser-provided MIME type or JPEG metadata after EOI.
    let bytes=b;
    if(b[0]===255&&b[1]===216){
      const end=b.lastIndexOf(Buffer.from([255,217]));
      if(end>1&&end+2<b.length)bytes=b.subarray(0,end+2);
    }
    const actual=Media.sniffImage(bytes);
    if(!actual)fail(`${profileField}无法读取（提交格式 ${mime.toUpperCase()}），请重新选图`);
    return actual===mime&&bytes===b?x:`data:image/${actual};base64,${bytes.toString('base64')}`;
  }
  const valid=mime==='png'?b.length>=24&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR':mime==='jpeg'?b.length>=4&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217:mime==='gif'?b.length>=13&&['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)):b.length>=16&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
  if(!valid)fail('图片内容与格式不符');
  return x;
}
function imageRefs(x,old=[],max=3){
  if(x===undefined)return [...(old||[])];
  if(!Array.isArray(x)||x.length>max)fail(`参考图最多 ${max} 张`);
  return x.map(v=>image(v,false));
}
function redpacketSticker(value,type){
  if(value===undefined)return '';
  if(type!=='redpacket')fail('只有红包支持添加表情');
  return image(value);
}
function audio(x){
  x=text(x,12*1024*1024);
  if(Media.isAudioMediaUrl(x))return x.trim();
  dataBytes(x,/^data:audio\/(webm|wav|mpeg|mp3|ogg|m4a|mp4|x-wav|aac|flac)(?:;codecs=[a-z\d.,-]+)?;base64,([A-Za-z0-9+/]+={0,2})$/,8*1024*1024,'音频');
  return x;
}
function voiceMeta(input,{required=false,expired=false}={}){
  if(!obj(input))fail('语音元数据无效');
  const result={};
  if(input.audio!==undefined&&!(expired&&input.audio===''))result.audio=audio(input.audio);
  if(input.durationMs!==undefined)result.durationMs=integer(input.durationMs,1,600000);
  if(input.transcript!==undefined)result.transcript=text(input.transcript,100000);
  for(const key of ['contentEmotion','voiceEmotion'])if(input[key]!==undefined)result[key]=text(input[key],200);
  if(required&&!result.audio&&!expired)fail('语音消息缺少音频');
  return result;
}
function expiredMedia(input,type,{content,snapshot=false}={}){
  if(input?.expired===undefined)return;
  const marker=input.expired;
  if(!obj(marker))fail('媒体过期标记无效');
  const kind=enumOf(marker.kind,['image','voice']),at=integer(marker.at,0,8640000000000000);
  if(kind==='image'&&!['image','text'].includes(type)||kind==='voice'&&!['voice','text'].includes(type))fail('媒体过期类型与消息不符');
  if(input.image||input.audio||input.modelImage||kind==='image'&&type==='image'&&content&&(!snapshot||Media.isMediaUrl(content)||/^data:image\//i.test(content)))fail('已过期媒体不能保留原文件');
  if(kind==='voice'&&input.thumb!==undefined)fail('过期语音不能带图片缩略图');
  return {kind,at};
}
function hasExpiredMedia(message){
  const pending=[message];
  while(pending.length){const row=pending.pop();if(row.meta?.expired)return true;if(row.type==='forward')pending.push(...row.meta.entries);}
  return false;
}
function imageVariants(input,hasImage){
  const result={};
  for(const key of ['thumb','modelImage'])if(input[key]!==undefined){
    if(!hasImage)fail('只有聊天图片可以附带缩略图和模型副本');
    result[key]=image(input[key],false);
  }
  return result;
}
function mediaMeta(input,type){
  const expired=expiredMedia(input,type);
  const result={...voiceMeta(input,{expired:expired?.kind==='voice'}),...imageVariants(input,type==='image'||type==='text'&&Boolean(input.image)||expired?.kind==='image'),...(expired?{expired}:{})};
  if(input.image!==undefined)result.image=image(input.image);
  if(input.amountCents!==undefined)result.amountCents=integer(input.amountCents,1,100000000);
  if(input.transactionId!==undefined)result.transactionId=text(input.transactionId,100);
  if(input.note!==undefined)result.note=text(input.note,200);
  if(input.entries!==undefined)result.entries=forwardEntries(input.entries);
  if(input.quote!==undefined)result.quote=quoteSnapshot(input.quote);
  if(input.transcriptSource!==undefined)result.transcriptSource=enumOf(input.transcriptSource,['demo','provider']);
  if(input.caption!==undefined)result.caption=text(input.caption,60000);
  if(input.stickerId!==undefined)result.stickerId=text(input.stickerId,100);
  if(input.stickerSemantic!==undefined)result.stickerSemantic=stickerSemantic(input.stickerSemantic);
  const sticker=redpacketSticker(input.stickerImage,type);
  if(sticker)result.stickerImage=sticker;
  return result;
}
function images(input,legacy){
  if(input===undefined)return legacy?[image(legacy,false)]:[];
  if(!Array.isArray(input)||input.length>9)fail('图片最多 9 张');
  return input.map(value=>image(value,false));
}
function permissions(input={},old={}){
  if(!obj(input)||Object.keys(input).some(key=>!['blocked','onlyChat','hideMyMoments','hideTheirMoments'].includes(key)))fail('朋友权限格式无效');
  return Object.fromEntries(['blocked','onlyChat','hideMyMoments','hideTheirMoments'].map(key=>[key,bool(input[key],old[key]||false)]));
}
function chatAllowed(r){
  if(r.permissions?.blocked)fail('该朋友已加入黑名单，请先移出后再聊天',403,'CONTACT_BLOCKED');
}
function momentAllowed(r){
  chatAllowed(r);
  if(r.permissions?.onlyChat)fail('该朋友设为仅聊天，不能生成朋友圈',403,'MOMENTS_RESTRICTED');
}
function momentInteractionAllowed(s,m){
  if(m.authorId==='me')return;
  const r=role(s,m.authorId);
  momentAllowed(r);
  if(r.permissions?.hideTheirMoments)fail('已设置不看该朋友的朋友圈',403,'MOMENTS_RESTRICTED');
}
function stickerImageKey(value){
  const media=value.match(/^\/api\/media\/([a-f0-9]{64})\./i);
  return media?media[1].toLowerCase():value.startsWith('data:image/')?require('node:crypto').createHash('sha256').update(Buffer.from(value.slice(value.indexOf(',')+1),'base64')).digest('hex'):value;
}
function stickerSemantic(value){
  if(!obj(value)||typeof value.meaning!=='string'||!value.meaning.trim()||value.meaning.length>1000||typeof value.usage!=='string'||value.usage.length>1000||!Array.isArray(value.tags)||value.tags.length>20||value.tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.length>50))fail('表情语义快照格式无效');
  const result={meaning:value.meaning,tags:[...value.tags],usage:value.usage};
  for(const field of ['description','visibleText'])if(value[field]!==undefined)result[field]=text(value[field],2000);
  return result;
}
function stickerBytes(stickers,dataDir){
  return stickers.reduce((total,{image})=>total+(image.startsWith('data:image/')?Buffer.from(image.slice(image.indexOf(',')+1),'base64').length:dataDir&&Media.isMediaUrl(image)?Media.describeMediaFile(dataDir,image.slice('/api/media/'.length))?.size??fail('表情图片不存在',404):Buffer.byteLength(image)),0);
}
function addRoleStickers(s,r,selected){
  const additions=[];
  for(const sticker of selected)if(![...r.stickers,...additions].some(x=>stickerImageKey(x.image)===stickerImageKey(sticker.image))){
    additions.push({id:id(),name:sticker.name||`表情 ${s.stickers.indexOf(sticker)+1}`,image:sticker.image});
  }
  if(r.stickers.length+additions.length>200||stickerBytes([...r.stickers,...additions],s[Symbol.for('pipi.mediaDir')])>16*1024*1024)fail('好友表情库最多 200 张，总大小不能超过 16 MB',413,'LIMIT');
  r.stickers.push(...additions);
}
function forwardEntries(input,depth=1,budget={count:0}){
  if(depth>3||!Array.isArray(input)||!input.length||input.length>100)fail('合并转发最多 3 层、100 条消息');
  return input.map(entry=>{
    if(!obj(entry)||++budget.count>100)fail('合并转发最多 100 条消息');
    const type=enumOf(entry.type,['text','image','voice','forward']);
    const expired=expiredMedia(entry.meta,type,{content:entry.content});
    const result={senderName:text(entry.senderName,100),type,content:type==='image'?image(entry.content,expired?.kind==='image'):text(entry.content,100000)};
    if(entry.meta!==undefined){
      if(!obj(entry.meta))fail('转发消息元数据无效');
      if(type==='forward')result.meta={entries:forwardEntries(entry.meta.entries,depth+1,budget)};
      else{
        result.meta={...voiceMeta(entry.meta,{required:type==='voice',expired:expired?.kind==='voice'}),...(expired?{expired}:{})};
        if(entry.meta.transcriptSource!==undefined)result.meta.transcriptSource=enumOf(entry.meta.transcriptSource,['demo','provider']);
        if(entry.meta.image!==undefined)result.meta.image=image(entry.meta.image,false);
        Object.assign(result.meta,imageVariants(entry.meta,type==='image'||type==='text'&&Boolean(result.meta.image)||expired?.kind==='image'));
        if(entry.meta.caption!==undefined)result.meta.caption=text(entry.meta.caption,60000);
        if(entry.meta.stickerId!==undefined)result.meta.stickerId=text(entry.meta.stickerId,100);
        if(entry.meta.stickerSemantic!==undefined)result.meta.stickerSemantic=stickerSemantic(entry.meta.stickerSemantic);
        if(entry.meta.quote!==undefined)result.meta.quote=quoteSnapshot(entry.meta.quote);
      }
    }
    if(type==='forward'&&!result.meta?.entries)fail('合并转发缺少消息');
    if(type==='voice'&&(!result.meta?.audio&&expired?.kind!=='voice'||result.meta.durationMs===undefined))fail('转发语音缺少音频');
    return result;
  });
}
function quoteSnapshot(input){
  if(!obj(input))fail('引用消息格式无效');
  const expired=expiredMedia(input,input.type,{snapshot:true,content:input.content});
  const result={sender:enumOf(input.sender,['user','assistant','system']),type:enumOf(input.type,['text','image','voice','forward','transfer','redpacket']),content:text(input.content,100000)};
  if(expired)result.expired=expired;
  if(input.transcript!==undefined)result.transcript=text(input.transcript,100000);
  if(input.durationMs!==undefined)result.durationMs=integer(input.durationMs,1,600000);
  if(input.senderName!==undefined)result.senderName=text(input.senderName,100);
  if(input.stickerId!==undefined)result.stickerId=text(input.stickerId,100);
  if(input.stickerSemantic!==undefined)result.stickerSemantic=stickerSemantic(input.stickerSemantic);
  if(input.caption!==undefined)result.caption=text(input.caption,60000);
  if(input.image!==undefined)result.image=image(input.image,expired?.kind==='image');
  Object.assign(result,imageVariants(input,Boolean(result.image)||expired?.kind==='image'));
  if(input.unavailable!==undefined)result.unavailable=enumOf(input.unavailable,['deleted','recalled']);
  return result;
}
function notifications(s){
  const retained=new Map(s.momentNotifications.map(n=>[n.id,n])),list=[];
  function add(moment,type,actorId,eventId,createdAt,content=''){
    if(actorId==='me')return;
    role(s,actorId);
    const key=`${type}:${moment.id}:${eventId}`,old=retained.get(key);
    list.push({id:key,momentId:moment.id,type,actorId,content,createdAt:old?.createdAt??createdAt,read:old?.read??false});
  }
  for(const moment of s.moments){
    if(moment.authorId==='me')for(const actorId of moment.likes)add(moment,'like',actorId,actorId,moment.createdAt);
    for(const comment of moment.comments)if(moment.authorId==='me'||comment.replyToAuthorId==='me')add(moment,'comment',comment.authorId,comment.id,comment.createdAt,comment.content);
    if(moment.authorId!=='me'&&moment.mentions.includes('me'))add(moment,'mention',moment.authorId,moment.authorId,moment.createdAt,moment.content);
  }
  s.momentNotifications=list;
}
function newFarm(){
  return {coins:100,seeds:10,plots:Array.from({length:6},(_,i)=>({id:String(i+1),crop:null,plantedAt:null,readyAt:null}))};
}
function archiveStatus(s,endedAt=Date.now()){
  const current=s.profile.status;
  if(!current)return;
  s.statusHistory.push({id:'status-'+current.startedAt,...current,endedAt:Math.max(current.startedAt,Math.min(endedAt,current.expiresAt))});
  s.profile.status=null;
}
function defaults(s){
  Stickers.ensure(s);
  s.rolePersonas??=[];
  s.personaFolders??=[];
  s.profile.gender??='unset';
  s.profile.status??=null;
  s.statusHistory??=[];
  s.momentNotifications??=[];
  s.farm.friends??={};
  for(const r of s.roles){r.rolePersonaId??='';r.patText??='';r.permissions??=permissions();r.modelId??='';r.stickers??=[];r.cover??='';r.voiceId??='';r.voiceMode??='global';r.appearancePrompt??='';r.faceReferences??=[];r.bodyReferences??=[];r.schedulePrompt??='';r.city??='';r.outreachEnabled??=false;r.momentsAutoEnabled??=true;s.farm.friends[r.id]??=newFarm();}
  require('./engine/models.cjs').migrate(s);
  require('./engine/registry.cjs').ensure(s);
  s.settings.timezone??='';
  s.settings.mediaRetentionDays??=7;
  s.engine.usage??=[];
  require('./engine/usage.cjs').ensure(s);
  require('./engine/actions.cjs').initializeWallet(s,require('./engine/registry.cjs').values(s,'actions').initialBalanceCents);
  for(const moment of s.moments){moment.images??=moment.image?[moment.image]:[];moment.location??='';moment.mentions??=[];}
  notifications(s);
  if(s.profile.status&&s.profile.status.expiresAt<=Date.now())archiveStatus(s,s.profile.status.expiresAt);
  return s;
}
function detachMessages(s,deleted){
  for(const f of s.favorites)if(deleted.has(f.messageId))delete f.messageId;
  for(const m of s.messages)if(m.meta?.quote&&deleted.has(m.meta.quote.messageId)){delete m.meta.quote.messageId;m.meta.quote.unavailable='deleted';}
  s.messages=s.messages.filter(x=>!deleted.has(x.id));
  require('./engine/tool-history.cjs').remove(s,deleted);
}
function quote(s,roleId,messageId){
  const m=find(s.messages,text(messageId,100),'引用消息');
  if(m.roleId!==roleId)fail('不能跨会话引用消息');
  if(m.meta?.kind==='recalled')fail('不能引用已撤回消息');
  const source=role(s,roleId),img=m.type==='image'?m.content:m.meta?.image;
  return {messageId:m.id,sender:m.sender,senderName:m.sender==='user'?s.profile.name:m.sender==='assistant'?(source.remark||source.name):'系统消息',type:m.type,content:m.type==='image'?'[图片]':m.type==='voice'?'[语音]':m.content.slice(0,100000),...(img?{image:img}:{}),...imageVariants(m.meta||{},Boolean(img)||m.meta?.expired?.kind==='image'),...(m.meta?.expired?{expired:{...m.meta.expired}}:{}),...(m.type==='voice'&&m.meta?.transcript!==undefined?{transcript:m.meta.transcript}:{}),...(m.type==='voice'&&m.meta?.durationMs!==undefined?{durationMs:m.meta.durationMs}:{}),...(m.meta?.stickerId?{stickerId:m.meta.stickerId}:{}),...(m.meta?.caption?{caption:m.meta.caption}:{}),...(m.meta?.stickerSemantic?{stickerSemantic:structuredClone(m.meta.stickerSemantic)}:{})};
}
function date(x){
  x=text(x,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x+'T00:00:00Z'))||new Date(x+'T00:00:00Z').toISOString().slice(0,10)!==x)fail('日期无效');
  return x;
}
function find(list,key,description='记录'){
  const item=list.find(x=>x.id===key);
  if(!item)fail(`${description}不存在`,404,'NOT_FOUND');
  return item;
}
function selectedRecords(list,ids){
  if(!Array.isArray(ids)||ids.length<1||ids.length>100||!ids.every(x=>typeof x==='string'&&x.length>0&&x.length<=100))fail('请选择 1 到 100 条记录');
  const selected=new Set(ids);
  if(selected.size!==ids.length)fail('不能重复选择同一条记录');
  const records=list.filter(item=>selected.has(item.id));
  if(records.length!==ids.length)fail('选择的记录不存在',404,'NOT_FOUND');
  return records;
}
function role(s,key){
  return find(s.roles,key,'角色');
}
function time(x,def){
  x=text(x,5,def);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(x))fail('时间格式须为 HH:mm');
  return x;
}
function timestamp(x){
  if(typeof x!=='number'||!Number.isSafeInteger(x)||x<0||x>8640000000000000)fail('时间戳无效');
  return x;
}
// Product choices, not a version-specific copy of WeChat's changing status catalog.
const statusPresets=['happy','daze','busy','focus','fish','work','travel','exercise','coffee','rest','music','game','sleep','other'];
const statusLifetimeMs=24*60*60*1000;
function statusDescription(x){
  const value=text(x,120).trim();
  if([...value].length>60||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)||/[\uD800-\uDFFF]/u.test(value))fail('状态说明最多 60 字，不能包含控制字符');
  return value;
}
function savedStatus(input){
  if(input===undefined||input===null)return null;
  if(!obj(input))fail('状态格式无效');
  const preset=enumOf(input.preset,statusPresets),description=statusDescription(input.description);
  const startedAt=timestamp(input.startedAt),expiresAt=timestamp(input.expiresAt);
  if(expiresAt-startedAt!==statusLifetimeMs)fail('状态有效期无效');
  return {preset,description,startedAt,expiresAt};
}
function provider(input={},old={}){
  if(!obj(input))fail('服务配置无效');
  const p={
    mode:enumOf(input.mode,['preset','custom'],old.mode||'custom'),baseUrl:text(input.baseUrl,2048,old.baseUrl||''),model:text(input.model,200,old.model||''),voice:text(input.voice,100,old.voice||'alloy'),key:old.key||''
  };
  if(p.baseUrl){
    let u;
    try{
      u=new URL(p.baseUrl);
    }
    catch{
      fail('服务地址无效');
    }
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)fail('服务地址须为无凭据的 HTTP(S) 地址');
    p.baseUrl=p.baseUrl.replace(/\/+$/,'');
  }
  if(input.clearKey!==undefined&&bool(input.clearKey))p.key='';
  if(input.key!==undefined){
    const k=text(input.key,4096);
    if(/[\r\n]/.test(k))fail('密钥格式无效');
    if(k)p.key=k;
  }
  return p;
}
function initial(){
  return defaults({
    revision:0,profile:{
      name:'我',wechatId:'pipi_me',avatar:'',cover:'',bio:'',region:'',status:null
    },personas:[],rolePersonas:[],personaFolders:[],roles:[],messages:[],memories:[],moments:[],ledger:[],wallet:{
      balanceCents:100000,roleBalances:{},transactions:[]
    },farm:{
      coins:100,seeds:10,cropConfig:structuredClone(cropConfig),plots:Array.from({
        length:6
      },(_,i)=>({
        id:String(i+1),crop:null,plantedAt:null,readyAt:null
      })),visits:[]
    },favorites:[],stickers:[],emojiRecents:[],settings:{
      preset:{
        label:'我的模型服务商',baseUrl:'',model:''
      },providers:Object.fromEntries(['chat','vision','tts','stt'].map(c=>[c,provider({
        mode:'preset'
      })])),momentsAuto:false,momentsMinutes:360,momentsLastAttemptAt:Date.now()
    }
  });
}
// Work on a display or forward copy. Stored messages and backup snapshots retain the originals.
function cleanChatCopy(message,messageIds){
  const {stripMessageNumbers}=require('./engine/response.cjs');
  if(message.sender==='assistant'&&(message.type==='text'||message.type==='voice')){
    message.content=stripMessageNumbers(message.content,messageIds);
    if(message.meta?.transcript)message.meta.transcript=stripMessageNumbers(message.meta.transcript,messageIds);
  }
  if(message.meta?.quote?.sender==='assistant')message.meta.quote.content=stripMessageNumbers(message.meta.quote.content,messageIds);
}
function publicState(s,{runtimeModels=true}={}){
  const out=defaults(structuredClone(s));
  if(runtimeModels){
    const {conversationMessageIds}=require('./engine/response.cjs');
    for(const [roleId,messages] of Map.groupBy(out.messages,m=>m.roleId)){
      const ids=conversationMessageIds(messages,roleId);
      for(const message of messages)cleanChatCopy(message,ids);
    }
  }
  out.profile.cover??='';
  out.profile.patText??='';
  out.profile.status??=null;
  if(out.profile.status&&out.profile.status.expiresAt<=Date.now())out.profile.status=null;
  out.stickers??=[];
  for(const sticker of out.stickers)sticker.semantic=Stickers.publicSemantic(Stickers.get(out,sticker.image));
  delete out.stickerSemantics;
  out.emojiRecents??=[];
  for(const r of out.roles){
    r.muted??=false;
    r.tags??=[];
    r.description??='';
    r.phone??='';
    r.starred??=false;
    r.chatBackground??='';
  }
  for(const p of Object.values(out.settings.providers)){
    p.keySet=Boolean(p.key);
    delete p.key;
  }
  if(runtimeModels)out.voiceAvailability=require('./engine/modules/voice.cjs').availability(out);
  out.settings.ai=require('./engine/models.cjs').sanitize(out.settings.ai,{runtime:runtimeModels});
  delete out.engine.summaries;
  delete out.engine.data.execution;
  delete out.engine.data.actions.roleMedia;
  if(out.engine.data.memory)delete out.engine.data.memory.vectors;
  return out;
}
function backupState(s){
  const out=publicState(s,{runtimeModels:false});
  out.stickerSemantics=structuredClone(Stickers.ensure(s));
  out.engine.summaries=structuredClone(s.engine?.summaries||{});
  out.engine.data=structuredClone(s.engine.data);
  return out;
}
const countLimits={
  roles:[200,'好友'],personas:[100,'身份'],rolePersonas:[100,'好友人设'],personaFolders:[100,'人设文件夹'],messages:[20000,'消息'],memories:[3000,'记忆'],moments:[3000,'朋友圈动态'],ledger:[20000,'账本记录'],favorites:[5000,'收藏'],stickers:[200,'收藏表情'],emojiRecents:[24,'最近使用的表情'],statusHistory:[10000,'状态记录'],momentNotifications:[20000,'朋友圈通知']
};
const baselineKey=Symbol.for('pipi.limitBaseline');
// A write that starts from a stored document only fails a limit when it grows past it, so a full state can still shrink or record errors.
function limitBaseline(s,bytes){
  Object.defineProperty(s,baselineKey,{value:{bytes,stickerBytes:stickerBytes(s.stickers||[],s[Symbol.for('pipi.mediaDir')]),counts:Object.fromEntries(Object.keys(countLimits).map(key=>[key,s[key]?.length||0])),transactions:s.wallet.transactions.length,visits:s.farm.visits.length},configurable:true});
  return s;
}
function limit(s,before=s[baselineKey]){
  s.stickers??=[];
  s.emojiRecents??=[];
  const grows=(value,old)=>!before||value>old();
  const stickerTotal=stickerBytes(s.stickers,s[Symbol.for('pipi.mediaDir')]);
  if(stickerTotal>16*1024*1024&&grows(stickerTotal,()=>before.stickerBytes))fail('收藏表情总大小不能超过 16 MB',413,'LIMIT');
  for(const [key,[max,label]] of Object.entries(countLimits)){
    if(s[key].length>max&&grows(s[key].length,()=>before.counts[key]))fail(`${label}已达数量上限`,413,'LIMIT');
  }
  if(s.wallet.transactions.length>20000&&grows(s.wallet.transactions.length,()=>before.transactions)||s.farm.visits.length>20000&&grows(s.farm.visits.length,()=>before.visits))fail('记录数量已达上限',413,'LIMIT');
  if(s[Symbol.for('pipi.mediaDir')])for(const r of s.roles)if(stickerBytes(r.stickers,s[Symbol.for('pipi.mediaDir')])>16*1024*1024)fail('好友表情库总大小不能超过 16 MB',413,'LIMIT');
  const bytes=Buffer.byteLength(JSON.stringify(s));
  if(bytes>64*1024*1024&&grows(bytes,()=>before.bytes))fail('数据总量超过 64 MB',413,'LIMIT');
}
function saveProfile(p,old){
  return {
    name:text(p.name,80,old.name),wechatId:text(p.wechatId,80,old.wechatId),avatar:p.avatar===undefined?(old.avatar||''):image(p.avatar,true,'头像'),cover:p.cover===undefined?(old.cover||''):image(p.cover,true,'朋友圈背景图'),bio:text(p.bio,1000,old.bio),region:text(p.region,100,old.region),gender:enumOf(p.gender,['unset','male','female'],old.gender||'unset'),patText:text(p.patText,100,old.patText||''),status:old.status||null
  };
}
function savePersona(p,old={}){
  return {
    id:old.id||id(),name:text(p.name,80,old.name||'新身份'),prompt:text(p.prompt,16000,old.prompt||''),avatar:p.avatar===undefined?(old.avatar||''):image(p.avatar)
  };
}
function saveRolePersona(s,p,old={}){
  const name=text(p.name,80,old.name||''),prompt=text(p.prompt,100000,old.prompt||''),folderId=text(p.folderId,100,old.folderId||'');
  if(!name.trim()||!prompt.trim())fail('人设名称和正文不能为空');
  if(folderId)find(s.personaFolders,folderId,'文件夹');
  return {id:old.id||id(),name,prompt,folderId,createdAt:old.createdAt||Date.now()};
}
function saveRole(s,p,old={}){
  const rolePersonaId=text(p.rolePersonaId,100,old.rolePersonaId||'');
  if(rolePersonaId)find(s.rolePersonas,rolePersonaId,'好友人设');
  const personaId=text(p.personaId,80,old.personaId||'');
  if(personaId)find(s.personas,personaId,'身份');
  const modelId=text(p.modelId,100,old.modelId||'');
  let stickers=old.stickers||[];
  if(p.stickers!==undefined){
    if(!Array.isArray(p.stickers)||p.stickers.length>200||!p.stickers.every(obj))fail('好友表情库最多 200 张');
    const ids=new Set();
    stickers=p.stickers.map(sticker=>{
      const key=text(sticker.id,100),name=text(sticker.name,100).trim();
      if(!key||['__proto__','constructor','prototype'].includes(key)||ids.has(key)||!name)fail('好友表情标识重复或名称为空');
      ids.add(key);return {id:key,name,image:image(sticker.image,false)};
    });
    if(stickerBytes(stickers,s[Symbol.for('pipi.mediaDir')])>16*1024*1024)fail('好友表情库总大小不能超过 16 MB',413,'LIMIT');
  }
  return {
    rolePersonaId,patText:text(p.patText,100,old.patText||''),modelId,stickers,cover:p.cover===undefined?(old.cover||''):image(p.cover,true,'朋友圈背景图'),
    voiceId:text(p.voiceId,200,old.voiceId||''),voiceMode:enumOf(p.voiceMode,['on','off','global','often','emotional','only_tool'],old.voiceMode||'global'),appearancePrompt:text(p.appearancePrompt,4000,old.appearancePrompt||''),faceReferences:imageRefs(p.faceReferences,old.faceReferences,3),bodyReferences:imageRefs(p.bodyReferences,old.bodyReferences,3),schedulePrompt:text(p.schedulePrompt,4000,old.schedulePrompt||''),city:text(p.city,80,old.city||''),outreachEnabled:bool(p.outreachEnabled,old.outreachEnabled||false),momentsAutoEnabled:bool(p.momentsAutoEnabled,old.momentsAutoEnabled??true),
    permissions:permissions(p.permissions,old.permissions),
    tags:tags(p.tags,old.tags||[]),description:text(p.description,500,old.description||''),phone:text(p.phone,80,old.phone||''),starred:bool(p.starred,old.starred||false),chatBackground:p.chatBackground===undefined?(old.chatBackground||''):image(p.chatBackground),
    id:old.id||id(),name:text(p.name,80,old.name||'新朋友'),remark:text(p.remark,80,old.remark||''),wechatId:text(p.wechatId,80,old.wechatId||''),avatar:p.avatar===undefined?(old.avatar||''):image(p.avatar,true,'头像'),bio:text(p.bio,1000,old.bio||''),prompt:text(p.prompt,16000,old.prompt||''),personaId,relationship:text(p.relationship,100,old.relationship||'朋友'),pinned:bool(p.pinned,old.pinned||false),hidden:bool(p.hidden,old.hidden||false),muted:bool(p.muted,old.muted||false),unread:old.unread||0,proactive:bool(p.proactive,old.proactive||false),proactiveMinutes:p.proactiveMinutes===undefined?(old.proactiveMinutes||60):integer(p.proactiveMinutes,5,10080),quietStart:time(p.quietStart,old.quietStart||'22:00'),quietEnd:time(p.quietEnd,old.quietEnd||'08:00'),lastActiveAt:old.lastActiveAt||Date.now()
  };
}
function ledger(p,old={}){
  return {
    id:old.id||id(),amountCents:integer(p.amountCents,1,100000000000),type:enumOf(p.type,['expense','income']),category:text(p.category,100),merchant:text(p.merchant,300),date:date(p.date),note:text(p.note,2000)
  };
}
function visibility(s,v){
  if(v===undefined||v==='all')return 'all';
  if(!Array.isArray(v)||v.length>200)fail('可见范围无效');
  return [...new Set(v.map(x=>role(s,x).id))];
}
function message(s,r,sender,content,type='text',extra={}){
  const m={
    id:id(),roleId:r.id,sender,type,content,createdAt:Date.now(),status:'sent',...extra
  };
  s.messages.push(m);
  r.lastActiveAt=Date.now();
  r.hidden=false;
  return m;
}
function apply(s,type,p){
  defaults(s);
  s.stickers??=[];
  s.emojiRecents??=[];
  if(!obj(p))fail('操作数据须为对象');
  switch(type){
    case 'status.save':{
      const preset=enumOf(p.preset,statusPresets),description=statusDescription(p.description),startedAt=Math.max(Date.now(),(s.profile.status?.startedAt||0)+1,(s.statusHistory.at(-1)?.startedAt||0)+1);
      const current=s.profile.status;
      if(current?.preset===preset&&Date.now()<current.expiresAt){
        current.description=description;
        break;
      }
      archiveStatus(s);
      s.profile.status={preset,description,startedAt,expiresAt:startedAt+statusLifetimeMs};
      break;
    }
    case 'status.end':archiveStatus(s);
    break;
    case 'emoji.use':{
      const token=emojiToken(p.token);
      s.emojiRecents=[token,...s.emojiRecents.filter(value=>value!==token)].slice(0,24);
      break;
    }
    case 'sticker.add':{
      const inputs=p.images===undefined?[p.image]:p.images;
      if(!Array.isArray(inputs)||!inputs.length||inputs.length>200)fail('每批请选择 1 至 200 张表情');
      if(p.names!==undefined&&(!Array.isArray(p.names)||p.names.length!==inputs.length))fail('表情名称须与图片一一对应');
      const names=p.names?.map(value=>text(value,100).trim());
      const images=inputs.map(value=>image(value,false));
      for(const [i,img] of images.entries())if(!s.stickers.some(x=>stickerImageKey(x.image)===stickerImageKey(img)))s.stickers.push({id:id(),image:img,createdAt:Date.now(),...(names?.[i]?{name:names[i]}:{})});
      break;
    }
    case 'sticker.semantic.save':Stickers.save(s,p);break;
    case 'role.stickers.add':{
      const r=role(s,text(p.roleId,100));
      if(!Array.isArray(p.stickerIds)||!p.stickerIds.length||p.stickerIds.length>200)fail('请选择 1 至 200 张表情');
      const selected=p.stickerIds.map(value=>find(s.stickers,text(value,100),'收藏表情'));
      addRoleStickers(s,r,selected);
      break;
    }
    case 'sticker.delete':find(s.stickers,p.id,'收藏表情');
    s.stickers=s.stickers.filter(x=>x.id!==p.id);
    break;
    case 'profile.save':checkWechatId(p.wechatId,s.profile.wechatId);s.profile=saveProfile(p,s.profile);
    break;
    case 'persona.save':{
      const old=p.id?find(s.personas,p.id,'身份'):null;
      const n=savePersona(p,old||{});
      if(old)Object.assign(old,n);
      else s.personas.push(n);
      break;
    }
    case 'persona.delete':find(s.personas,p.id);
    s.personas=s.personas.filter(x=>x.id!==p.id);
    for(const r of s.roles)if(r.personaId===p.id)r.personaId='';
    break;
    case 'personaFolder.save':{
      const name=text(p.name,40).trim();
      if(!name)fail('文件夹名称不能为空');
      if(s.personaFolders.some(folder=>folder.name===name))fail('文件夹名称重复');
      if(s.personaFolders.length>=100)fail('文件夹已达数量上限',413,'LIMIT');
      s.personaFolders.push({id:id(),name});break;
    }
    case 'personaFolder.delete':{
      const folder=find(s.personaFolders,text(p.id,100),'文件夹');
      s.personaFolders=s.personaFolders.filter(item=>item.id!==folder.id);
      for(const item of s.rolePersonas)if(item.folderId===folder.id)item.folderId='';
      break;
    }
    case 'rolePersona.save':{
      const old=p.id?find(s.rolePersonas,text(p.id,100),'好友人设'):null;
      const next=saveRolePersona(s,p,old||{});
      if(!old&&s.rolePersonas.length>=100)fail('好友人设已达数量上限',413,'LIMIT');
      if(old&&old.prompt!==next.prompt)for(const friend of s.roles)if(friend.rolePersonaId===old.id)friend.personaRevision=(friend.personaRevision||0)+1;
      if(old)Object.assign(old,next);else s.rolePersonas.push(next);
      break;
    }
    case 'rolePersona.delete':{
      const item=find(s.rolePersonas,text(p.id,100),'好友人设');
      s.rolePersonas=s.rolePersonas.filter(value=>value.id!==item.id);
      for(const r of s.roles)if(r.rolePersonaId===item.id){r.rolePersonaId='';r.personaRevision=(r.personaRevision||0)+1;}
      break;
    }
    case 'rolePersona.bind':{
      if(p.roleIds!==undefined)fail('绑定方式已更新，请刷新页面后重试',409,'PERSONA_BINDING_RELOAD');
      const item=find(s.rolePersonas,text(p.id,100),'好友人设');
      if(!Array.isArray(p.changes)||p.changes.length>200)fail('好友绑定变更无效');
      const updates=new Map();
      for(const change of p.changes){
        if(!obj(change)||typeof change.expectedPersonaId!=='string'||typeof change.selected!=='boolean')fail('好友绑定变更无效');
        const roleId=text(change.roleId,100),expected=text(change.expectedPersonaId,100);
        if(!roleId||(!change.selected&&expected!==item.id))fail('好友绑定变更无效');
        const friend=s.roles.find(r=>r.id===roleId),next=change.selected?item.id:'';
        if(!friend||(friend.rolePersonaId!==expected&&friend.rolePersonaId!==next))fail('好友资料或绑定已变更，请关闭后重新打开绑定窗口',409,'PERSONA_BINDING_CHANGED');
        if(updates.has(friend))fail('好友列表重复');
        updates.set(friend,next);
      }
      for(const [friend,next] of updates)if(friend.rolePersonaId!==next){
        friend.rolePersonaId=next;friend.personaRevision=(friend.personaRevision||0)+1;
      }
      break;
    }
    case 'rolePersona.move':{
      const item=find(s.rolePersonas,text(p.id,100),'好友人设'),folderId=text(p.folderId,100);
      if(folderId)find(s.personaFolders,folderId,'文件夹');
      item.folderId=folderId;break;
    }
    case 'role.save':{
      const old=p.id?role(s,p.id):null;
      checkWechatId(p.wechatId,old?.wechatId);
      const n=saveRole(s,old?p:{voiceMode:'on',...p},old||{});
      if(old&&(old.rolePersonaId!==n.rolePersonaId||!n.rolePersonaId&&(old.prompt||old.name)!==(n.prompt||n.name)))old.personaRevision=(old.personaRevision||0)+1;
      if(old)Object.assign(old,n);
      else s.roles.push(n);
      s.farm.friends[n.id]??=newFarm();
      require('./engine/actions.cjs').initializeWallet(s,require('./engine/registry.cjs').values(s,'actions').initialBalanceCents);
      break;
    }
    case 'role.delete':{
      role(s,p.id);
      const refund=s.wallet.transactions.filter(t=>t.roleId===p.id&&t.direction==='out'&&t.status==='pending').reduce((total,t)=>total+t.amountCents,0);
      s.wallet.balanceCents=integer(s.wallet.balanceCents+refund,0,Number.MAX_SAFE_INTEGER);
      s.roles=s.roles.filter(x=>x.id!==p.id);
      detachMessages(s,new Set(s.messages.filter(x=>x.roleId===p.id).map(x=>x.id)));
      delete s.wallet.roleBalances[p.id];
      delete s.wallet.initializedRoles[p.id];
      s.wallet.credits=s.wallet.credits.filter(x=>x.roleId!==p.id);
      s.wallet.transactions=s.wallet.transactions.filter(x=>x.roleId!==p.id);
      delete s.engine.summaries[p.id];
      s.engine.jobs=s.engine.jobs.filter(x=>x.roleId!==p.id);
      if(s.engine.data.compression?.estimates)delete s.engine.data.compression.estimates[p.id];
      require('./engine/execution.cjs').removeRole(s,p.id);
      require('./engine/registry.cjs').removeRole(s,p.id);
      if(s.engine.data.actions.roleMedia)s.engine.data.actions.roleMedia=s.engine.data.actions.roleMedia.filter(x=>x.roleId!==p.id);
      const autonomy=s.engine.data.autonomy;
      if(autonomy){delete autonomy.profiles?.[p.id];delete autonomy.plans?.[p.id];delete autonomy.attempts?.[p.id];if(autonomy.history)autonomy.history=autonomy.history.filter(x=>x.roleId!==p.id);}
      s.farm.visits=s.farm.visits.filter(x=>x.roleId!==p.id);
      delete s.farm.friends[p.id];
      s.memories=s.memories.filter(x=>x.roleId!==p.id);
      s.moments=s.moments.filter(x=>x.authorId!==p.id);
      for(const m of s.moments){
        m.likes=m.likes.filter(x=>x!==p.id);
        m.comments=m.comments.filter(x=>x.authorId!==p.id);
        const retained=new Set(m.comments.map(c=>c.id));
        for(const c of m.comments)if(c.replyTo&&!retained.has(c.replyTo)){delete c.replyTo;delete c.replyToAuthorId;}
        if(Array.isArray(m.visibility))m.visibility=m.visibility.filter(x=>x!==p.id);
        m.mentions=m.mentions.filter(x=>x!==p.id);
      }
      const momentIds=new Set(s.moments.map(m=>m.id));
      s.momentNotifications=s.momentNotifications.filter(n=>n.actorId!==p.id&&momentIds.has(n.momentId));
      break;
    }
    case 'conversation.pin':role(s,p.roleId).pinned=bool(p.pinned);
    break;
    case 'conversation.mute':role(s,p.roleId).muted=bool(p.muted);
    break;
    case 'conversation.hide':role(s,p.roleId).hidden=bool(p.hidden);
    break;
    case 'conversation.read':role(s,p.roleId).unread=0;
    break;
    case 'conversation.unread':role(s,p.roleId).unread=1;
    break;
    case 'conversation.delete':
    case 'conversation.clear':{
      const r=role(s,p.roleId);
      detachMessages(s,new Set(s.messages.filter(x=>x.roleId===r.id).map(x=>x.id)));
      delete s.engine.summaries[r.id];
      // Reply drafts and action records describe the removed chat. A reminder run that will resume keeps its records so finished actions are not repeated.
      const execution=require('./engine/execution.cjs').data(s);
      for(const [key,run] of Object.entries(execution.runs))if(run.roleId===r.id&&!(run.jobId&&['running','interrupted'].includes(run.status)))delete execution.runs[key];
      execution.actions=execution.actions.filter(action=>action.roleId!==r.id||execution.runs[action.runId]);
      // Outreach notes about unanswered messages and a pending "talk later" follow-up also describe the removed chat.
      const outreach=s.engine.data?.outreach;
      if(outreach){const rec=outreach.records?.[r.id];if(rec){rec.unanswered=0;rec.unansweredMsgs=[];}delete outreach.replyFacts?.[r.id];delete outreach.holds?.[r.id];}
      const memory=s.engine.data?.memory;
      if(memory)for(const key of ['lastExtracted','lastExtractedAt','cursors'])delete memory[key]?.[r.id];
      if(type==='conversation.delete'){r.hidden=true;r.unread=0;}
      break;
    }
    case 'message.delete':find(s.messages,p.id);
    detachMessages(s,new Set([p.id]));
    break;
    case 'message.deleteMany':{
      const r=role(s,p.roleId),selected=selectedRecords(s.messages,p.ids);
      if(selected.some(m=>m.roleId!==r.id))fail('只能删除当前会话的消息');
      if(selected.some(m=>m.status==='pending'))fail('正在生成中，请稍后删除消息',409,'CHAT_BUSY');
      detachMessages(s,new Set(selected.map(m=>m.id)));
      break;
    }
    case 'message.recall':{
      const m=find(s.messages,text(p.id,100),'消息');
      const ownPat=m.sender==='system'&&m.meta?.kind==='pat'&&m.meta.author==='me';
      if(!(m.sender==='user'&&['text','image','voice','forward'].includes(m.type)&&m.status==='sent')&&!ownPat)fail('只能撤回本人已发送的消息或拍一拍');
      if(Date.now()-m.createdAt>120000)fail('本项目撤回窗口为发送后两分钟');
      const recalledText=m.sender==='user'&&m.type==='text'?m.content:undefined,recalledType=ownPat?'pat':m.type;
      for(const f of s.favorites)if(f.messageId===m.id)delete f.messageId;
      for(const item of s.messages)if(item.meta?.quote?.messageId===m.id){delete item.meta.quote.messageId;item.meta.quote.unavailable='recalled';}
      Object.assign(m,{sender:'system',type:'text',content:ownPat?'你撤回了一次拍一拍':'你撤回了一条消息',status:'sent',meta:{kind:'recalled',recalledType,recalledAt:Date.now(),...(recalledText!==undefined?{recalledText}:{})}});
      require('./engine/tool-history.cjs').remove(s,[m.id]);
      delete m.error;
      break;
    }
    case 'message.forward':{
      const target=role(s,p.targetRoleId),selected=selectedRecords(s.messages,p.ids),sourceRoleId=selected[0].roleId;
      chatAllowed(target);
      const mode=enumOf(p.mode,['individual','separate','merged'],'individual');
      if(selected.some(m=>m.roleId!==sourceRoleId))fail('只能转发同一个会话的消息');
      if(selected.some(hasExpiredMedia))fail('图片或语音已过期，不能转发');
      if(selected.some(m=>!['user','assistant'].includes(m.sender)||!['text','image','voice','forward'].includes(m.type)||m.status!=='sent'))fail('只能转发已发送成功的文字、图片、语音或合并消息');
      const source=role(s,sourceRoleId);
      const messageIds=require('./engine/response.cjs').conversationMessageIds(s.messages,sourceRoleId);
      const ordered=structuredClone(selected).sort((a,b)=>a.createdAt-b.createdAt);
      for(const m of ordered)cleanChatCopy(m,messageIds);
      if(mode==='merged'){
        const entries=forwardEntries(ordered.map(m=>({senderName:m.sender==='user'?s.profile.name:(source.remark||source.name),type:m.type,content:m.content,...(m.meta?{meta:m.meta}:{})})));
        message(s,target,'user',`${s.profile.name}和${source.remark||source.name}的聊天记录`,'forward',{meta:{entries}});
        break;
      }
      for(const m of ordered){
        const meta={};
        for(const key of ['audio','durationMs','transcript','contentEmotion','voiceEmotion','image','thumb','modelImage','transcriptSource','stickerId','stickerSemantic','caption'])if(m.meta?.[key]!==undefined)meta[key]=m.meta[key];
        if(m.type==='forward')meta.entries=forwardEntries(m.meta.entries);
        if(m.meta?.quote){
          const {sender}=m.meta.quote,senderName=m.meta.quote.senderName||(sender==='user'?s.profile.name:sender==='assistant'?(source.remark||source.name):'系统消息');
          meta.quote={...quoteSnapshot(m.meta.quote),senderName};
        }
        message(s,target,'user',m.content,m.type,Object.keys(meta).length?{meta}:{});
      }
      break;
    }
    case 'message.favorite':{
      const m=find(s.messages,p.id);
      if(m.meta?.kind==='recalled')fail('已撤回消息不能收藏');
      if(hasExpiredMedia(m))fail('图片或语音已过期，不能收藏');
      if(!s.favorites.some(x=>x.messageId===m.id))s.favorites.push({
        id:id(),messageId:m.id,content:m.content,type:m.type,...(m.meta?{meta:mediaMeta(m.meta,m.type)}:{}),createdAt:Date.now()
      });
      break;
    }
    case 'message.pat':{
      const r=role(s,p.roleId),target=enumOf(p.target,['self','contact'],'contact');
      chatAllowed(r);
      const who=target==='self'?'自己':`“${r.remark||r.name}”`;
      const patText=target==='self'?(s.profile.patText||''):(r.patText||'').replace(/^的/,'');
      message(s,r,'system',`我拍了拍${who}${patText?'的'+patText:''}`,'text',{meta:{kind:'pat',author:'me',target,patText}});
      break;
    }
    case 'memory.save':{
      const r=role(s,p.roleId),old=p.id?find(s.memories,p.id):null;
      if(old&&old.roleId!==r.id)fail('不能跨角色移动记忆');
      const n={
        id:old?.id||id(),roleId:r.id,content:text(p.content,12000),createdAt:old?.createdAt||Date.now()
      };
      if(old)Object.assign(old,n);
      else s.memories.push(n);
      break;
    }
    case 'memory.delete':find(s.memories,p.id);
    s.memories=s.memories.filter(x=>x.id!==p.id);
    break;
    case 'moment.create':{
      const content=text(p.content,10000),photos=images(p.images,p.image),location=text(p.location,200).trim();
      if(/[\r\n\u0000-\u001f]/u.test(location))fail('位置只能是单行文字');
      const mentions=p.mentions===undefined?[]:visibility(s,p.mentions);
      if(mentions==='all')fail('提醒对象必须是角色列表');
      const visible=visibility(s,p.visibility);
      if(mentions.some(key=>Array.isArray(visible)&&!visible.includes(key)))fail('提醒对象须在可见范围内');
      if(!content.trim()&&!photos.length)fail('请输入动态内容或图片');
      s.moments.push({
        id:id(),authorId:'me',content,image:photos[0]||'',images:photos,location,mentions,visibility:visible,likes:[],comments:[],createdAt:Date.now()
      });
      break;
    }
    case 'moment.like':{
      const m=find(s.moments,p.id);
      momentInteractionAllowed(s,m);
      m.likes=m.likes.includes('me')?m.likes.filter(x=>x!=='me'):[...m.likes,'me'];
      break;
    }
    case 'moment.comment':{
      const content=text(p.content,2000);
      if(!content.trim())fail('评论不能为空');
      const moment=find(s.moments,p.id);
      momentInteractionAllowed(s,moment);
      const target=p.replyTo===undefined?null:find(moment.comments,text(p.replyTo,100),'被回复评论');
      if(p.authorId!==undefined&&p.authorId!=='me')fail('评论作者不可伪造');
      if(p.replyToAuthorId!==undefined&&p.replyToAuthorId!==target?.authorId)fail('被回复作者与原评论不符');
      moment.comments.push({
        id:id(),authorId:'me',content,...(target?{replyTo:target.id,replyToAuthorId:target.authorId}:{}),createdAt:Date.now()
      });
      break;
    }
    case 'moment.delete':if(find(s.moments,p.id).authorId!=='me')fail('只能删除自己的动态');
    s.moments=s.moments.filter(x=>x.id!==p.id);
    break;
    case 'moment.notifications.read':{
      const selected=p.ids===undefined?s.momentNotifications:selectedRecords(s.momentNotifications,p.ids);
      for(const item of selected)item.read=true;
      break;
    }
    case 'moment.comment.delete':{
      const moment=find(s.moments,p.id),comment=find(moment.comments,p.commentId,'评论');
      if(comment.authorId!=='me')fail('只能删除自己的评论');
      moment.comments=moment.comments.filter(c=>c.id!==comment.id);
      for(const c of moment.comments)if(c.replyTo===comment.id){delete c.replyTo;delete c.replyToAuthorId;}
      break;
    }
    case 'ledger.save':{
      const old=p.id?find(s.ledger,p.id):null;
      const n=ledger(p,old||{});
      if(old)Object.assign(old,n);
      else s.ledger.push(n);
      break;
    }
    case 'ledger.delete':find(s.ledger,p.id);
    s.ledger=s.ledger.filter(x=>x.id!==p.id);
    break;
    case 'wallet.transfer':{
      const requestId=text(p.requestId,100);
      if(!/^[\w-]{8,100}$/.test(requestId))fail('请提供有效 requestId');
      require('./engine/actions.cjs').transfer(s,p.roleId,{...p,requestId},'user',require('./engine/registry.cjs').values(s,'actions'));
      break;
    }
    case 'wallet.handle':{
      const transaction=find(s.wallet.transactions,text(p.id,100),'红包或转账');
      require('./engine/actions.cjs').settle(s,transaction.id,p.action,'user',transaction.roleId);
      break;
    }
    case 'farm.plant':{
      const farm=p.roleId===undefined?s.farm:s.farm.friends[role(s,p.roleId).id],plot=find(farm.plots,p.plotId,'地块'),crop=enumOf(p.crop,['carrot','tomato']);
      if(plot.crop)fail('该地块已有作物');
      if(farm.seeds<1)fail('种子不足');
      farm.seeds--;
      Object.assign(plot,{
        crop,plantedAt:Date.now(),readyAt:Date.now()+cropConfig[crop].durationMs
      });
      break;
    }
    case 'farm.harvest':{
      const farm=p.roleId===undefined?s.farm:s.farm.friends[role(s,p.roleId).id],plot=find(farm.plots,p.plotId,'地块');
      if(!plot.crop||Date.now()<plot.readyAt)fail('作物尚未成熟');
      farm.coins+=cropConfig[plot.crop].reward;
      farm.seeds+=2;
      Object.assign(plot,{
        crop:null,plantedAt:null,readyAt:null
      });
      break;
    }
    case 'farm.water':{
      const friend=role(s,p.roleId),farm=s.farm.friends[friend.id];
      const today=new Date().toISOString().slice(0,10);
      if(s.farm.visits.some(x=>x.roleId===p.roleId&&x.date===today))fail('今天已经帮该朋友浇水');
      const now=Date.now(),plot=p.plotId===undefined?farm.plots.find(p=>p.crop&&p.readyAt>now):find(farm.plots,p.plotId,'地块');
      if(!plot?.crop||plot.readyAt<=now)fail('好友没有需要浇水的作物，请先在其农场播种');
      plot.readyAt=Math.max(now,plot.readyAt-60000);
      s.farm.visits.push({
        roleId:p.roleId,date:today,plotId:plot.id
      });
      s.farm.coins+=5;
      break;
    }
    case 'favorite.save':{
      const old=p.id?find(s.favorites,p.id,'收藏'):null;
      if(old&&old.type!=='note')fail('只能编辑笔记收藏');
      const content=text(p.content,100000,old?.content||''),photos=p.images===undefined?(old?.meta.images||[]):images(p.images);
      const input=p.todos===undefined?(old?.meta.todos||[]):p.todos;
      if(!Array.isArray(input)||input.length>100||!input.every(obj))fail('待办清单最多 100 项');
      const seen=new Set(),todos=input.map(todo=>{
        const key=todo.id===undefined?id():text(todo.id,100),value=text(todo.text,1000).trim();
        if(!key||seen.has(key)||!value)fail('待办标识重复或文字为空');
        seen.add(key);return {id:key,text:value,done:bool(todo.done)};
      });
      if(!content.trim()&&!photos.length&&!todos.length)fail('笔记不能为空');
      const note={id:old?.id||id(),type:'note',content,meta:{images:photos,todos},createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()};
      if(old)Object.assign(old,note);else s.favorites.push(note);
      break;
    }
    case 'favorite.delete':find(s.favorites,p.id);
    s.favorites=s.favorites.filter(x=>x.id!==p.id);
    break;
    case 'favorite.deleteMany':{
      const selected=new Set(selectedRecords(s.favorites,p.ids).map(f=>f.id));
      s.favorites=s.favorites.filter(f=>!selected.has(f.id));
      break;
    }
    case 'settings.save':{
      let preset=s.settings.preset,providers=s.settings.providers;
      if(p.preset!==undefined){
        if(!obj(p.preset))fail('预设格式错误');
        preset={
          label:text(p.preset.label,100,s.settings.preset.label),baseUrl:text(p.preset.baseUrl,2048,s.settings.preset.baseUrl),model:text(p.preset.model,200,s.settings.preset.model)
        };
        provider({baseUrl:preset.baseUrl});
      }
      if(p.providers!==undefined){
        if(!obj(p.providers)||Object.keys(p.providers).some(k=>!['chat','vision','tts','stt'].includes(k)))fail('能力配置无效');
        providers={...providers};
        for(const [k,v]of Object.entries(p.providers))providers[k]=provider(v,providers[k]);
      }
      if(p.preset!==undefined||p.providers!==undefined){
        const {migrate,retainKeyRevisions}=require('./engine/models.cjs');
        const legacy=prefs=>{
          const draft={settings:prefs};
          migrate(draft);
          return migrate(draft);
        };
        const before=legacy({preset:s.settings.preset,providers:s.settings.providers}),after=legacy({preset,providers});
        const ai=s.settings.ai;
        const legacyChanged=!isDeepStrictEqual(after,before);
        if(ai)retainKeyRevisions(ai.sources,before.sources);
        if(!ai||isDeepStrictEqual(ai,before)){
          retainKeyRevisions(before.sources,after.sources);
          s.settings.ai=after;
        }else if(legacyChanged)fail('旧版页面不能覆盖已配置的模型，请刷新后在模型页面修改',409,'PROVIDER_CONFIG_CHANGED');
        s.settings.preset=preset;
        s.settings.providers=providers;
      }
      if(p.momentsAuto!==undefined){
        const enabled=bool(p.momentsAuto);
        if(enabled&&!s.settings.momentsAuto)s.settings.momentsLastAttemptAt=Date.now();
        s.settings.momentsAuto=enabled;
      }
      if(p.momentsMinutes!==undefined)s.settings.momentsMinutes=integer(p.momentsMinutes,30,10080);
      break;
    }
    default:fail('未知操作',400,'UNKNOWN_ACTION');
  }
  notifications(s);
  limit(s);
  return s;
}
// Backups are rebuilt field by field. Unknown properties (including secrets and SQL) never enter state.
function validateBackup(input,current){
  if(!obj(input)||input.format!=='pipi-phone'||input.version!==1||!obj(input.state))fail('备份格式或版本无效');
  const a=input.state,s=initial();
  s.emojiRecents=emojiRecents(a.emojiRecents);
  const arrays=['personas','roles','messages','memories','moments','ledger','favorites'];
  if(a.stickers!==undefined&&(!Array.isArray(a.stickers)||!a.stickers.every(obj)))fail('收藏表情备份格式无效');
  for(const k of arrays){
    if(!Array.isArray(a[k]))fail(`备份缺少 ${k}`);
    if(!a[k].every(obj))fail(`备份 ${k} 含有无效记录`);
  }
  if(!obj(a.profile)||!obj(a.wallet)||!obj(a.farm)||!obj(a.settings))fail('备份结构不完整');
  s.revision=current.revision;
  s.profile=saveProfile(a.profile,s.profile);
  s.profile.status=savedStatus(a.profile.status);
  s.statusHistory=[];
  s.personas=[];
  s.roles=[];
  s.messages=[];
  s.memories=[];
  s.moments=[];
  s.ledger=[];
  s.favorites=[];
  const seen=new Set();
  function validId(x){
    x=text(x,100);
    if(!x||['__proto__','constructor','prototype'].includes(x)||seen.has(x))fail('备份中记录标识缺失或重复');
    seen.add(x);
    return x;
  }
  if(a.statusHistory!==undefined){
    if(!Array.isArray(a.statusHistory)||!a.statusHistory.every(obj))fail('状态历史格式无效');
    for(const item of a.statusHistory){
      const status=savedStatus(item),endedAt=timestamp(item.endedAt);
      if(endedAt<status.startedAt||endedAt>status.expiresAt)fail('状态结束时间无效');
      s.statusHistory.push({id:validId(item.id),...status,endedAt});
    }
    if(s.profile.status&&s.statusHistory.some(item=>item.startedAt===s.profile.status.startedAt))fail('当前状态不能同时出现在历史中');
  }
  for(const sticker of a.stickers||[]){
    s.stickers.push({id:validId(sticker.id),image:image(sticker.image,false),createdAt:timestamp(sticker.createdAt),...(sticker.name===undefined?{}:{name:text(sticker.name,100).trim()})});
  }
  for(const p of a.personas){
    if(!obj(p))fail('身份数据无效');
    s.personas.push({
      ...savePersona(p),id:validId(p.id)
    });
  }
  for(const key of ['personaFolders','rolePersonas'])if(a[key]!==undefined&&(!Array.isArray(a[key])||!a[key].every(obj)))fail('好友人设备份格式无效');
  for(const folder of a.personaFolders||[]){
    const name=text(folder.name,40).trim();
    if(!name||s.personaFolders.some(item=>item.name===name))fail('文件夹名称为空或重复');
    s.personaFolders.push({id:validId(folder.id),name});
  }
  for(const item of a.rolePersonas||[])s.rolePersonas.push({...saveRolePersona(s,item),id:validId(item.id),createdAt:timestamp(item.createdAt)});
  for(const r of a.roles){
    if(!obj(r))fail('角色数据无效');
    s.roles.push({
      ...saveRole(s,{...r,modelId:''}),id:validId(r.id),personaRevision:integer(r.personaRevision??0,0,Number.MAX_SAFE_INTEGER),unread:integer(r.unread,0,100000),lastActiveAt:timestamp(r.lastActiveAt)
    });
  }
  for(const m of a.messages){
    if(!obj(m))fail('消息数据无效');
    role(s,m.roleId);
    const type=enumOf(m.type,['text','image','voice','forward','transfer','redpacket']);
    const expired=expiredMedia(m.meta,type,{content:m.content});
    const n={
      id:validId(m.id),roleId:m.roleId,sender:enumOf(m.sender,['user','assistant','system']),type,content:type==='image'?image(m.content,expired?.kind==='image'):text(m.content,100000),createdAt:timestamp(m.createdAt),status:enumOf(m.status,['sent','error','pending','demo'])
    };
    if(n.status==='pending'){
      n.status='error';
      n.error='恢复的待发送消息，请重试';
    }
    if(m.error)n.error=text(m.error,1000);
    if(m.meta!==undefined){
      if(!obj(m.meta))fail('消息元数据格式错误');
      n.meta=expired?{expired}:{};
      if(m.meta.amountCents!==undefined)n.meta.amountCents=integer(m.meta.amountCents,1,100000000);
      Object.assign(n.meta,voiceMeta(m.meta,{expired:expired?.kind==='voice'}));
      if(m.meta.image!==undefined)n.meta.image=image(m.meta.image);
      Object.assign(n.meta,imageVariants(m.meta,type==='image'||type==='text'&&Boolean(n.meta.image)||expired?.kind==='image'));
      if(m.meta.transactionId!==undefined)n.meta.transactionId=text(m.meta.transactionId,100);
      if(m.meta.note!==undefined)n.meta.note=text(m.meta.note,200);
      if(m.meta.transcriptSource!==undefined)n.meta.transcriptSource=enumOf(m.meta.transcriptSource,['demo','provider']);
      if(m.meta.entries!==undefined)n.meta.entries=forwardEntries(m.meta.entries);
      if(m.meta.caption!==undefined)n.meta.caption=text(m.meta.caption,60000);
      if(m.meta.stickerId!==undefined)n.meta.stickerId=text(m.meta.stickerId,100);
      if(m.meta.stickerSemantic!==undefined)n.meta.stickerSemantic=stickerSemantic(m.meta.stickerSemantic);
      const sticker=redpacketSticker(m.meta.stickerImage,type);
      if(sticker){
        if(!n.meta.transactionId)fail('红包表情缺少对应交易');
        n.meta.stickerImage=sticker;
      }
      if(m.meta.kind!==undefined){
        n.meta.kind=enumOf(m.meta.kind,['pat','recalled']);
        if(n.sender!=='system'||type!=='text'||n.status!=='sent')fail('系统事件消息格式无效');
        if(n.meta.kind==='pat'){
          if(m.meta.patText!==undefined)n.meta.patText=text(m.meta.patText,100);
          n.meta.author=enumOf(m.meta.author,['me',n.roleId]);
          n.meta.target=enumOf(m.meta.target,['self','contact']);
          if(n.meta.author!=='me'&&n.meta.target!=='self')fail('好友拍一拍的对象无效');
        }else{
          if(m.meta.author!==undefined)n.meta.author=enumOf(m.meta.author,['me',n.roleId]);
          n.meta.recalledType=enumOf(m.meta.recalledType,['text','image','voice','forward','pat']);
          n.meta.recalledAt=timestamp(m.meta.recalledAt);
          if(m.meta.recalledText!==undefined){
            if(n.meta.recalledType!=='text'||n.meta.author&&n.meta.author!=='me')fail('只有用户文字撤回可以保留再编辑正文');
            n.meta.recalledText=text(m.meta.recalledText,100000);
          }
        }
      }
    }
    if(type==='voice'&&(!n.meta?.audio&&expired?.kind!=='voice'||n.meta.durationMs===undefined))fail('语音消息缺少音频');
    if(type==='forward'&&!n.meta?.entries)fail('合并转发缺少消息');
    s.messages.push(n);
  }
  for(let i=0;i<a.messages.length;i++){
    const q=a.messages[i].meta?.quote;
    if(q===undefined)continue;
    const n=s.messages[i],snapshot=quoteSnapshot(q);
    if(q.messageId!==undefined){
      const target=find(s.messages,text(q.messageId,100),'引用消息');
      if(target.roleId!==n.roleId||target.id===n.id||target.meta?.kind==='recalled')fail('引用消息不属于当前会话或已撤回');
      snapshot.messageId=target.id;
    }
    n.meta={...(n.meta||{}),quote:snapshot};
  }
  for(const m of a.memories){
    role(s,m.roleId);
    s.memories.push({
      id:validId(m.id),roleId:m.roleId,content:text(m.content,12000),createdAt:timestamp(m.createdAt)
    });
  }
  for(const m of a.moments){
    if(m.authorId!=='me')role(s,m.authorId);
    if(!Array.isArray(m.likes)||!Array.isArray(m.comments)||m.comments.length>2000||!m.comments.every(obj))fail('动态互动数据无效');
    const likes=[...new Set(m.likes.map(x=>x==='me'?'me':role(s,x).id))];
    const comments=m.comments.map(c=>({
      id:validId(c.id),authorId:c.authorId==='me'?'me':role(s,c.authorId).id,content:text(c.content,2000),createdAt:timestamp(c.createdAt)
    }));
    for(let i=0;i<m.comments.length;i++){
      const original=m.comments[i],comment=comments[i];
      if(original.replyTo!==undefined){
        const target=find(comments,text(original.replyTo,100),'被回复评论');
        if(target.id===comment.id)fail('评论不能回复自身');
        if(original.replyToAuthorId!==undefined&&original.replyToAuthorId!==target.authorId)fail('被回复作者与原评论不符');
        comment.replyTo=target.id;
        comment.replyToAuthorId=target.authorId;
      }else if(original.replyToAuthorId!==undefined)fail('缺少被回复评论');
    }
    const photos=images(m.images,m.image),location=text(m.location,200);
    if(/[\r\n\u0000-\u001f]/u.test(location))fail('位置只能是单行文字');
    if(m.mentions!==undefined&&(!Array.isArray(m.mentions)||m.mentions.length>200))fail('提醒对象格式无效');
    const mentions=[...new Set((m.mentions||[]).map(key=>key==='me'?'me':role(s,key).id))];
    s.moments.push({id:validId(m.id),authorId:m.authorId,content:text(m.content,10000),image:photos[0]||'',images:photos,location,mentions,visibility:visibility(s,m.visibility),likes,comments,createdAt:timestamp(m.createdAt)});
  }
  for(const l of a.ledger)s.ledger.push({
    ...ledger(l),id:validId(l.id)
  });
  s.wallet={
    balanceCents:integer(a.wallet.balanceCents,0,Number.MAX_SAFE_INTEGER),roleBalances:{},transactions:[],credits:[],initializedRoles:{}
  };
  if(!obj(a.wallet.roleBalances)||!Array.isArray(a.wallet.transactions)||!a.wallet.transactions.every(obj))fail('钱包备份格式错误');
  for(const [k,v]of Object.entries(a.wallet.roleBalances)){
    if(k==='__proto__'||k==='constructor'||k==='prototype')fail('钱包角色标识无效');
    role(s,k);
    s.wallet.roleBalances[k]=integer(v,0,Number.MAX_SAFE_INTEGER);
  }
  const requests=new Set();
  for(const t of a.wallet.transactions){
    role(s,t.roleId);
    const req=text(t.requestId,100);
    if(req&&requests.has(req))fail('转账防重标识重复');
    if(req)requests.add(req);
    const type=enumOf(t.type,['transfer','redpacket']),sticker=redpacketSticker(t.stickerImage,type);
    s.wallet.transactions.push({
      id:validId(t.id),roleId:text(t.roleId,100),type,amountCents:integer(t.amountCents,1,100000000),direction:enumOf(t.direction,['out','in']),status:enumOf(t.status,['pending','received','returned'],'received'),createdAt:timestamp(t.createdAt),...(t.updatedAt===undefined?{}:{updatedAt:timestamp(t.updatedAt)}),note:text(t.note,200),...(sticker?{stickerImage:sticker}:{}),...(req?{
        requestId:req
      }:{})
    });
  }
  function savedFarm(input){
    if(!obj(input)||!Array.isArray(input.plots)||input.plots.length!==6||!input.plots.every(obj))fail('农场备份格式错误');
    const plotIds=new Set();
    return {coins:integer(input.coins),seeds:integer(input.seeds),plots:input.plots.map(p=>{
      const pid=text(p.id,100);
      if(!pid||plotIds.has(pid))fail('地块标识重复');
      plotIds.add(pid);
      const crop=enumOf(p.crop,[null,'carrot','tomato']);
      const plantedAt=crop?timestamp(p.plantedAt):null,readyAt=crop?timestamp(p.readyAt):null;
      if(crop&&readyAt<=plantedAt)fail('作物时间无效');
      return{
        id:pid,crop,plantedAt,readyAt
      };
    })};
  }
  if(!Array.isArray(a.farm.visits)||!a.farm.visits.every(obj))fail('农场拜访记录无效');
  const visitIds=new Set();
  s.farm={...savedFarm(a.farm),cropConfig:structuredClone(cropConfig),friends:{},visits:a.farm.visits.map(v=>{
    const roleId=role(s,v.roleId).id,day=date(v.date),key=roleId+':'+day;
    if(visitIds.has(key))fail('农场拜访记录重复');
    visitIds.add(key);
    return {roleId,date:day,...(v.plotId===undefined?{}:{plotId:text(v.plotId,100)})};
  })};
  if(a.farm.friends!==undefined){
    if(!obj(a.farm.friends))fail('好友农场格式无效');
    for(const [key,value]of Object.entries(a.farm.friends))s.farm.friends[role(s,key).id]=savedFarm(value);
  }
  for(const r of s.roles)s.farm.friends[r.id]??=newFarm();
  for(const visit of s.farm.visits)if(visit.plotId!==undefined)find(s.farm.friends[visit.roleId].plots,visit.plotId,'浇水地块');
  for(const f of a.favorites){
    if(f.messageId)find(s.messages,f.messageId,'收藏引用消息');
    const type=enumOf(f.type,['text','image','voice','forward','note','transfer','redpacket']);
    let meta=f.meta===undefined?undefined:mediaMeta(f.meta,type);
    if(type==='note'){
      if(f.messageId||!obj(f.meta)||!Array.isArray(f.meta.todos)||f.meta.todos.length>100||!f.meta.todos.every(obj))fail('笔记备份格式无效');
      const todoIds=new Set();
      meta={images:images(f.meta.images),todos:f.meta.todos.map(todo=>{
        const key=text(todo.id,100),value=text(todo.text,1000).trim();
        if(!key||todoIds.has(key)||!value)fail('笔记待办标识重复或文字为空');
        todoIds.add(key);return {id:key,text:value,done:bool(todo.done)};
      })};
      if(!text(f.content,100000).trim()&&!meta.images.length&&!meta.todos.length)fail('笔记不能为空');
    }
    if(type==='forward'&&!meta?.entries)fail('合并转发收藏缺少消息');
    s.favorites.push({
      ...(meta?{meta}:{}),id:validId(f.id),...(f.messageId?{
        messageId:text(f.messageId,100)
      }:{}),content:type==='image'?image(f.content,false):text(f.content,100000),type,createdAt:timestamp(f.createdAt),...(f.updatedAt===undefined?{}:{updatedAt:timestamp(f.updatedAt)})
    });
  }
  s.settings=structuredClone(current.settings);
  if(a.settings.preset!==undefined){
    if(!obj(a.settings.preset))fail('备份预设服务格式错误');
    const p=a.settings.preset;
    s.settings.preset={
      label:text(p.label,100),baseUrl:provider({
        baseUrl:p.baseUrl
      }).baseUrl,model:text(p.model,200)
    };
  }
  if(a.settings.providers!==undefined){
    if(!obj(a.settings.providers))fail('备份服务配置格式错误');
    for(const k of ['chat','vision','tts','stt'])if(a.settings.providers[k]!==undefined){
      const p=a.settings.providers[k];
      if(!obj(p))fail('备份能力配置格式错误');
      s.settings.providers[k]=provider({
        mode:p.mode,baseUrl:p.baseUrl,model:p.model,voice:p.voice
      },{
        key:current.settings.providers[k].key
      });
    }
  }
  for(const k of ['chat','vision','tts','stt']){
    const before=current.settings.providers[k],after=s.settings.providers[k];
    const oldUrl=before.mode==='preset'?current.settings.preset.baseUrl:before.baseUrl;
    const newUrl=after.mode==='preset'?s.settings.preset.baseUrl:after.baseUrl;
    if(oldUrl!==newUrl)after.key='';
  }
  s.settings.mediaRetentionDays=enumOf(a.settings.mediaRetentionDays,[7,30,90,'forever'],7);
  s.settings.momentsAuto=bool(a.settings.momentsAuto,false);
  s.settings.momentsMinutes=a.settings.momentsMinutes===undefined?360:integer(a.settings.momentsMinutes,30,10080);
  s.settings.momentsLastAttemptAt=a.settings.momentsLastAttemptAt===undefined?Date.now():timestamp(a.settings.momentsLastAttemptAt);
  require('./engine/state.cjs').restore(s,a,current,validId);
  Stickers.validateBackup(s,a.stickerSemantics);
  s.momentNotifications=[];
  if(a.momentNotifications!==undefined){
    if(!Array.isArray(a.momentNotifications)||!a.momentNotifications.every(obj))fail('朋友圈通知格式无效');
    const notificationIds=new Set();
    for(const n of a.momentNotifications){
      const key=text(n.id,100);
      if(notificationIds.has(key))fail('朋友圈通知重复');
      notificationIds.add(key);
      s.momentNotifications.push({id:key,createdAt:timestamp(n.createdAt),read:bool(n.read)});
    }
  }
  defaults(s);
  if(a.momentNotifications?.some(n=>!s.momentNotifications.some(saved=>saved.id===n.id)))fail('朋友圈通知没有对应互动');
  limit(s);
  return s;
}
module.exports={
  addRoleStickers,id,fail,obj,text,integer,bool,enumOf,image,redpacketSticker,audio,date,find,role,initial,publicState,backupState,apply,limit,limitBaseline,imageVariants,message,validateBackup,ledger,quote,defaults,chatAllowed,momentAllowed
};
