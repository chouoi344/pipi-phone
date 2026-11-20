'use strict';
const {sampleState}=require('./sample-data.cjs');
// Local-only acceptance service. Creates no connections to remote providers.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),zlib=require('node:zlib');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const project=path.resolve(__dirname,'..'),workspace=path.dirname(project),home=path.join(workspace,'.codex/validation/life-20261117'),dataDir=path.join(home,'data');
const PASSWORD='Life-preview_2026!',PORT=18818,MARKER='life-preview-20261117-v1';
process.env.ALLOW_PRIVATE_PROVIDERS='1';
for(const key of ['SOURCE_URL','PIPI_SOURCE_URL','PIPI_VOICE_SOURCE_URL','PIPI_IMAGE_SOURCE_URL','PIPI_AUXILIARY_SOURCE_URL'])process.env[key]='';
const S=require('../lib/state.cjs'),Schedule=require('../lib/engine/modules/schedule.cjs'),Outreach=require('../lib/engine/modules/outreach.cjs'),Moments=require('../lib/engine/modules/life-moments.cjs'),Data=require('../lib/engine/schedule-data.cjs'),T=require('../lib/engine/time.cjs'),Media=require('../lib/media-store.cjs');
function png(){
 const w=256,h=256,pixels=Buffer.alloc((w*3+1)*h),letters=['10001 11011 10101 10001 10001','01110 10001 10001 10001 01110','01111 10000 10000 10000 01111','10001 10010 11100 10010 10001'].map(x=>x.split(' '));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=y*(w*3+1)+1+x*3,cell=Math.floor(x/32)+Math.floor(y/32),lx=Math.floor((x-24)/9),ly=Math.floor((y-100)/9),letter=Math.floor(lx/6),bit=letters[letter]?.[ly]?.[lx%6];pixels[at]=bit==='1'?30:cell%2?255:225;pixels[at+1]=bit==='1'?20:cell%2?210:240;pixels[at+2]=bit==='1'?50:245;}
 function crc(b){let n=0xffffffff;for(const x of b){n^=x;for(let i=0;i<8;i++)n=n&1?(n>>>1)^0xedb88320:n>>>1;}return (n^0xffffffff)>>>0;}
 function chunk(name,body){const type=Buffer.from(name),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(body.length);sum.writeUInt32BE(crc(Buffer.concat([type,body])));return Buffer.concat([size,type,body,sum]);}
 const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function wav(){const rate=16000,length=rate*2,b=Buffer.alloc(44+length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length*2,40);for(let i=0;i<length;i++)b.writeInt16LE(Math.round(Math.sin(i/rate*Math.PI*2*(i<rate?440:660))*3500*Math.min(1,i/400,(length-i)/400)),44+i*2);return b;}
const image=png(),audio=wav();
function plan(){return {outfit:'模拟浅蓝外套和长裤',mood:'平静',daySummary:'模拟验收：读书、散步与规律休息',dayType:'休息日',dayTypeReason:'隔离验收资料',slots:Array.from({length:12},(_,i)=>({start:String(i*2).padStart(2,'0')+':00',end:i===11?'23:59':String(i*2+2).padStart(2,'0')+':00',activity:i<3?'夜间熟睡':['洗漱与早餐','阅读与整理','模拟午间阅读','吃午饭','散步','读书','晚饭','整理笔记','睡前阅读'][i-3],scene:'模拟书房',phone:i<3?'offline':'free',restType:i<3?'night_sleep':'none',mood:'平静'}))};}
function chat(body){
 const messages=body.messages||[],system=messages.filter(m=>m.role==='system').map(m=>typeof m.content==='string'?m.content:'').join('\n');
 const text=messages.filter(m=>m.role==='user').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).at(-1)||'';
 let content;
 if(/10个字段/.test(system))content=Object.fromEntries(Data.PROFILE_FIELDS.map(k=>[k,'模拟验收：喜欢安静阅读和散步，规律休息。']));
 else if(/scheduleChanges/.test(system))content={scheduleChanges:[],promises:[],userEvents:[],promiseUpdates:[],userEventUpdates:[],longEventUpdates:[],userEventDoneIds:[],moodUpdate:'',changeNote:''};
 else if(/slots|日程生成|作息规划/.test(system)&&!/自主判断是否公开/.test(system))content=plan();
 else if(/自主判断是否公开分享/.test(system))content={skip:false,text:'【模拟验收】今天读书时看到一段有意思的文字。',imagePrompt:'明显标有MOCK的模拟书房场景',kind:'scene'};
 else if(/看实际配图/.test(system))content={skip:false,text:'【模拟验收】这张MOCK图片只是本地流程测试素材。'};
 else if(/只识别图片中的衣服/.test(system)){
  const samples=[
   {description:'模拟识别：长款风衣搭直筒裤',category:'外出',seasons:['春','秋']},
   {description:'模拟识别：宽松针织衫和棉质长裤',category:'居家',seasons:['秋','冬']},
   {description:'模拟识别：薄款短袖睡衣套装',category:'睡衣',seasons:['夏']},
   {description:'模拟识别：轻薄训练上衣配运动裤',category:'运动',seasons:['春','夏','秋']}
  ];
  content=samples[createHash('sha256').update(text).digest()[0]%samples.length];
 }
 else if(/自主判断是否回复用户/.test(system))content={skip:false,text:'【模拟验收】看到你的评论啦，这里记录的是模拟生活片刻。'};
 else if(/decision|system-one/.test(body.model||''))content={complete:true,probability:1};
 else if(/embedding/.test(body.model||''))return {data:[{embedding:[1,0,0,0]}]};
 else{
  const tools=body.tools||[],hasTool=messages.slice(messages.findLastIndex(m=>m.role==='user')+1).some(m=>m.role==='tool');
  const tool= !hasTool&&/(?:请|给我|帮我|我想听)/.test(text)?/语音/.test(text)?'send_voice':/自拍|拍照|照片/.test(text)?'send_selfie':'':'';
  if(tool&&tools.some(t=>t.function.name===tool))return {choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'mock-'+Date.now(),type:'function',function:{name:tool,arguments:JSON.stringify(tool==='send_voice'?{text:'这是一条模拟语音，实际播放本机测试音。'}:{prompt:'MOCK模拟自拍参考',count:1})}}]}}],usage:{prompt_tokens:20,completion_tokens:20}};
  content=/\[NO_ACTION\]/.test(text)&&/不想说|没有新进展/.test(text)?'【模拟验收】刚读到有意思的一页，想分享给你。':/跳过|保持安静|skip/i.test(text)?'[NO_ACTION]':'【模拟验收】本机模型已收到消息，所有内容都是隔离测试资料。';
 }
 return {choices:[{message:{role:'assistant',content:typeof content==='string'?content:JSON.stringify(content)}}],usage:{prompt_tokens:20,completion_tokens:20}};
}
function send(res,value){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}
function mockServer(){return http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.endsWith('/voices'))return send(res,{voices:[{voice_id:'mock-life-voice',name:'模拟验收测试音（非真人语音）',category:'premade',description:'本机440Hz与660Hz测试音'}],has_more:false});
 if(url.pathname.includes('/text-to-speech/')||url.pathname.endsWith('/audio/speech')){res.setHeader('Content-Type','audio/wav');return res.end(audio);}
 if(url.pathname.endsWith('/models'))return send(res,{data:[{id:'mock-life-chat'},{id:'mock-life-image'},{id:'breeze-tts-2'}],models:[{model_id:'breeze-tts-2'}]});
 const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>24*1024*1024)throw Error('本机模拟请求超过24MB');chunks.push(c);}
 if(/\/images\/(?:generations|edits)$/.test(url.pathname))return send(res,{created:Math.floor(Date.now()/1000),data:[{b64_json:image.toString('base64')}]});
 if(url.pathname.endsWith('/chat/completions'))return send(res,chat(JSON.parse(Buffer.concat(chunks).toString())));
 res.statusCode=404;send(res,{error:{message:'本机模拟接口不支持此路径'}});
 }catch(error){res.statusCode=500;send(res,{error:{message:error.message}});}});}
function model(id,kind,sourceId,name){return {id,sourceId,model:name,kind,capabilities:kind==='chat'?['text','image','tool_use']:[],maxContextTokens:128000,temperature:null,maxTokens:null,timeoutSeconds:15,extraBody:{},...(kind==='tts'?{protocol:'breezeblue',voice:'mock-life-voice'}:{})};}
function seed(source,now){
 const s=sampleState();s.messages=[];s.moments=[];s.profile.name='生活插件隔离验收';s.profile.bio='所有角色、图片与声音均为本机模拟资料';s.settings.timezone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 s.settings.ai.sources.push({id:'life-mock',name:'本机模拟模型',baseUrl:source,key:'LOCAL_MOCK_ONLY',template:'compatible',builtin:false},{id:'life-mock-voice',name:'本机模拟Breeze',baseUrl:source,key:'LOCAL_MOCK_ONLY',template:'breezeblue',kinds:['tts'],builtin:false});
 s.settings.ai.models=[model('life-chat','chat','life-mock','mock-life-chat'),model('life-backup','chat','life-mock','mock-life-backup'),model('life-image','image','life-mock','mock-life-image'),model('life-tts','tts','life-mock-voice','breeze-tts-2')];
 Object.assign(s.settings.ai.assign,{chat:'life-chat',chatSelections:['life-chat'],chatFallbacks:['life-backup'],caption:'life-chat',compress:'life-chat',image:'life-image',tts:'life-tts'});
 const reference=Media.saveImage(dataDir,image);
 for(const [i,r]of s.roles.entries()){
  r.name=i?'模拟验收·乙':'模拟验收·甲';r.prompt=i?'模拟角色乙，热爱散步和画画，讲话轻快。':'模拟角色甲，喜欢阅读与手作，表达温和具体。';r.bio='本机模拟验收角色';r.lastActiveAt=now-2*HOUR;r.outreachEnabled=true;r.voiceId='mock-life-voice';r.voiceMode='global';r.appearancePrompt='明显的模拟验收角色，参考图为MOCK占位素材';r.faceReferences=[reference];r.avatar=reference;
  const persona={id:S.id(),name:r.name+'独立人设',prompt:r.prompt,folderId:'',createdAt:now,updatedAt:now};s.rolePersonas.push(persona);r.rolePersonaId=persona.id;
  Schedule.saveSettings(s,r.id,{weatherEnabled:false,autoGenerate:false,surpriseProbability:0,chatChangeEnabled:false,routineJitterMinutes:0});
  Schedule.saveProfile(s,r.id,Object.fromEntries(Data.PROFILE_FIELDS.map(k=>[k,'【模拟验收】喜欢阅读、散步，按自己的节奏生活。'])));
  Schedule.addWardrobeItem(s,r.id,{description:i?'模拟米色衬衣与长裤':'模拟浅蓝外套与长裤',category:'外出',seasons:['春','夏','秋','冬']});Schedule.saveForRole(s,r.id,plan(),now);
  Schedule.addPromise(s,r.id,{content:'【模拟验收】把读书笔记的进展告诉我',type:'tell',dueAt:now+5*MIN},now);
  Schedule.addUserEvent(s,r.id,{content:'【模拟验收】今天的阅读安排',dueAt:now-3*HOUR,followUpHours:2},now);
  Outreach.saveRoleSettings(s,r.id,{enabled:true,quietHoursEnabled:false});Moments.saveRoleSettings(s,r.id,{enabled:true});
  s.engine.data.outreach.records[r.id]={day:T.dayKey(now,s.settings.timezone),count:0,photos:0,unanswered:0,firedKeys:[],nextDueAt:now-1};
  s.moments.push({id:S.id(),authorId:r.id,content:'【模拟验收】这是一条用于评论回复验收的本地动态。',image:reference,images:[reference],visibility:'all',likes:[],comments:[{id:S.id(),authorId:'me',content:'【模拟验收】今天读的什么书？',createdAt:now-5*MIN}],createdAt:now-30*MIN});
 }
 return s;
}
const MIN=60000,HOUR=60*MIN;
async function main(){
 // Probe before creating data. A conflicting service is never stopped.
 const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(PORT,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
 fs.mkdirSync(home,{recursive:true});const dbFile=path.join(dataDir,'pipi.sqlite'),existed=fs.existsSync(dbFile);
 if(fs.existsSync(dataDir)&&!existed)throw Error('隔离data目录已存在且没有已标记数据库，请保留该目录并另行核对。');
 const mock=mockServer();await new Promise((resolve,reject)=>{mock.once('error',reject);mock.listen(0,'127.0.0.1',resolve);});const source='http://127.0.0.1:'+mock.address().port+'/v1';
 let app;try{
  fs.mkdirSync(dataDir,{recursive:true});const db=new DatabaseSync(dbFile);
  try{
   if(existed){if(db.prepare('SELECT value FROM meta WHERE key=?').get('lifePreviewMarker')?.value!==MARKER)throw Error('数据库没有隔离验收标记，拒绝修改。');const row=db.prepare('SELECT json FROM app WHERE id=1').get(),s=JSON.parse(row.json);for(const provider of s.settings.ai.sources){if(['life-mock','life-mock-voice'].includes(provider.id))provider.baseUrl=source;else if(provider.baseUrl)throw Error('隔离资料出现非本机模拟服务地址，拒绝启动。');}db.prepare('UPDATE app SET json=? WHERE id=1').run(JSON.stringify(s));}
   else{db.exec('CREATE TABLE app (id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL); CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);');db.prepare('INSERT INTO app VALUES(1,?)').run(JSON.stringify(seed(source,Date.now())));db.prepare('INSERT INTO meta VALUES(?,?)').run('lifePreviewMarker',MARKER);}
  }finally{db.close();}
  app=require('../server.cjs').createApp({dataDir,host:'127.0.0.1',port:PORT,lifePreview:true,providerUrlAllowlist:[source]});await app.listen();
  const initialized=app.db.prepare('SELECT value FROM meta WHERE key=?').get('password');
  if(!initialized){const base='http://127.0.0.1:'+PORT,res=await fetch(base+'/api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({password:PASSWORD,displayName:'生活插件隔离验收',setupToken:app.db.prepare('SELECT value FROM meta WHERE key=?').get('setupToken')?.value})});if(!res.ok)throw Error(await res.text());}
  const saved=JSON.parse(app.db.prepare('SELECT json FROM app WHERE id=1').get().json),meta={url:'http://localhost:'+PORT+'/life-preview.html',password:PASSWORD,pid:process.pid,port:PORT,mockPort:mock.address().port,dataDir,roleIds:saved.roles.map(r=>r.id),isolated:true,model:'本机mock，图片MOCK占位，语音为测试音'};
  fs.writeFileSync(path.join(home,'preview.json'),JSON.stringify(meta,null,2));console.log(JSON.stringify(meta));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();mock.closeAllConnections();mock.close();process.exit(0);});
 }catch(error){if(app)await app.close();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));throw error;}
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={png,wav,chat};
