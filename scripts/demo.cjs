// SPDX-License-Identifier: MIT
// Uses the real app + isolated temporary data, following adversarial.test.cjs.
'use strict';
const {mkdtemp,readFile,realpath}=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('./sample-data.cjs'),{createDemoProvider,KEY}=require('./demo-provider.cjs');
const PASSWORD='Pipi-local-demo-2026!';
async function createDemo({host='127.0.0.1',browserHost=host,appPort=51022,providerPort=51023,resumeDir}={}){
  if(resumeDir){
    resumeDir=await realpath(resumeDir);
    if(path.dirname(resumeDir)!==await realpath(os.tmpdir())||!/^pipi-local-demo-[\w-]+$/.test(path.basename(resumeDir)))throw new Error('只能恢复系统临时目录中的 pipi-local-demo-* 演示数据');
  }
  const previous=process.env.ALLOW_PRIVATE_PROVIDERS;
  const restoreEnvironment=()=>{if(previous===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=previous;};
  let app,provider,dataDir,cookie='',csrf='';
  try{
    process.env.ALLOW_PRIVATE_PROVIDERS='1';
    dataDir=resumeDir?path.resolve(resumeDir):await mkdtemp(path.join(os.tmpdir(),'pipi-local-demo-'));
    provider=createDemoProvider({host,port:providerPort,password:PASSWORD});await provider.listen();
    const controlUrl=`http://${browserHost}:${provider.server.address().port}`,providerBase=`http://${host}:${provider.server.address().port}/v1`;
    app=createApp({dataDir,host,port:appPort,providerUrlAllowlist:[providerBase],demoModel:true});await app.listen();
    const appBase=`http://${host}:${app.server.address().port}`,appUrl=`http://${browserHost}:${app.server.address().port}`;
    provider.setAppUrl(appUrl);
    async function request(route,body){
      const res=await fetch(appBase+route,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:appBase,'Content-Type':'application/json','X-CSRF-Token':csrf})},body:body===undefined?undefined:JSON.stringify(body)});
      const value=await res.json(),setCookie=res.headers.get('set-cookie');
      if(setCookie)cookie=setCookie.split(';')[0];if(value.csrfToken)csrf=value.csrfToken;
      return {status:res.status,body:value};
    }
    if(resumeDir){
      const login=await request('/api/login',{password:PASSWORD});if(login.status!==200)throw new Error(login.body.error);
    }else{
      const setupToken=(await readFile(path.join(dataDir,'setup-token.txt'),'utf8')).trim();
      const setup=await request('/api/setup',{password:PASSWORD,displayName:'本地模型演示',setupToken});
      if(setup.status!==200)throw new Error(setup.body.error);
      const configured=await request('/api/engine/config');if(configured.status!==200)throw new Error(configured.body.error);
      const ai=configured.body.ai;
      ai.sources.push({id:'local-demo',name:'本地演示（固定响应，无外部调用）',baseUrl:providerBase,key:KEY,builtin:false});
      ai.models=['chat','vision','tts','stt'].map(capability=>({id:'local-demo-'+capability,sourceId:'local-demo',model:'local-demo-'+capability,kind:capability==='vision'?'chat':capability,capabilities:capability==='chat'?['text','image','tool_use']:capability==='vision'?['text','image']:[],maxContextTokens:128000,temperature:null,maxTokens:null,timeoutSeconds:45,extraBody:{},voice:capability==='tts'?'alloy':''}));
      ai.assign={...ai.assign,chat:'local-demo-chat',caption:'local-demo-vision',tts:'local-demo-tts',stt:'local-demo-stt',voiceUnderstanding:'local-demo-stt'};
      const saved=await request('/api/engine/models',{ai});
      if(saved.status!==200)throw new Error(saved.body.error);
      for(const role of saved.body.state.roles){
        const result=await request('/api/action',{type:'role.save',payload:{id:role.id,name:role.name+'（演示）',bio:'本地模拟服务演示角色，不调用真实模型。'}});
        if(result.status!==200)throw new Error(result.body.error);
      }
    }
    provider.setPrepareSamples(async()=>{
      const result=await request('/api/backup');if(result.status!==200)throw new Error(result.body.error);
      const backup=result.body,s=backup.state,r=s.roles[0];
      if(!r)throw new Error('请先添加一个演示角色');
      if(s.messages.some(m=>m.id.startsWith('demo046-')))return {roleName:r.remark||r.name,alreadyPrepared:true};
      const audio='data:audio/mpeg;base64,'+(await readFile(path.join(__dirname,'demo-assets/tone.mp3'))).toString('base64');
      const image='data:image/png;base64,'+(await readFile(path.join(__dirname,'demo-assets/receipt.png'))).toString('base64'),now=Date.now();
      const add=(id,sender,type,content,meta)=>{const m={id:'demo046-'+id,roleId:r.id,sender,type,content,createdAt:now+s.messages.length,status:'sent',...(meta?{meta}:{})};s.messages.push(m);return m;};
      add('notice','system','text','本地预设：以下语音为提示音，引用内容为演示资料，不调用外部模型。');
      add('voice-fresh','assistant','voice','',{audio,durationMs:450});
      add('voice-cached','user','voice','',{audio,durationMs:450,transcript:'本地演示转写：这是一段固定文字，未识别录音内容。',transcriptSource:'demo'});
      const photo=add('photo','assistant','image',image);
      const link=add('link','user','text','https://example.com/demo');
      const long=add('long','assistant','text','演示：记录今天的小事，分享沿途的风景和一段很长的文字，用于验证引用的两行截断效果。https://example.com/demo/long-quoted-message');
      for(const source of [photo,link,long])add('reply-'+source.id,'user','text','1',{quote:{messageId:source.id,sender:source.sender,senderName:source.sender==='user'?s.profile.name:r.remark||r.name,type:source.type,content:source.type==='image'?'[图片]':source.content,...(source.type==='image'?{image}:{})}});
      const restored=await request('/api/restore',{backup,confirm:true});if(restored.status!==200)throw new Error(restored.body.error);
      return {roleName:r.remark||r.name,alreadyPrepared:false};
    });
    return {app,provider,appUrl,controlUrl,dataDir,password:PASSWORD,request,async close(){try{await provider.close();await app.close();}finally{restoreEnvironment();}}};
  }catch(error){try{if(provider?.server.listening)await provider.close();if(app)await app.close();}finally{restoreEnvironment();}throw error;}
}
module.exports={createDemo,PASSWORD};
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length&&(args.length!==2||args[0]!=='--resume'))throw new Error('用法：node scripts/demo.cjs [--resume 系统临时目录中的演示数据路径]');
  createDemo({browserHost:'localhost',...(args.length?{resumeDir:args[1]}:{})}).then(demo=>{
    console.log(JSON.stringify({demo:true,app:demo.appUrl,controls:demo.controlUrl,password:demo.password,dataDir:demo.dataDir}));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>demo.close().then(()=>process.exit(0)));
  }).catch(error=>{console.error(error);process.exitCode=1;});
}
