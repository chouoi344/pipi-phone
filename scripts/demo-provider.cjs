// SPDX-License-Identifier: MIT
// Extends the local HTTP provider fixture in tests/adversarial.test.cjs.
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const MODES={success:'成功',delay:'延迟 3 秒',retry:'首次失败，重试成功',http:'HTTP 503',json:'无效 JSON',empty:'空结果',disconnect:'连接中断',timeout:'45 秒超时',tools:'角色动作后收尾'};
const KEY='LOCAL_DEMO_ONLY_NOT_A_REAL_KEY';
function createDemoProvider({host='127.0.0.1',port=0,appUrl='',password=''}={}){
  let mode='success',attempt=0,sequence=0,prepareSamples;
  const queued=[];
  function prepareResponses(responses){
    if(!Array.isArray(responses))throw new TypeError('模拟响应须为数组');
    return responses.map(response=>{
      if(!response||typeof response!=='object'||Array.isArray(response))throw new TypeError('模拟响应须为对象');
      const status=response.status??200,delayMs=response.delayMs??0;
      if(!Number.isInteger(status)||status<200||status>599)throw new TypeError('模拟响应状态码无效');
      if(!Number.isFinite(delayMs)||delayMs<0||delayMs>60000)throw new TypeError('模拟响应延迟须为 0–60000 毫秒');
      return {status,delayMs,body:structuredClone(response.body??{})};
    });
  }
  function enqueueResponses(responses){
    queued.push(...prepareResponses(responses));return queued.length;
  }
  function setScenario({mode:nextMode='success',responses=[]}={}){
    if(!Object.hasOwn(MODES,nextMode))throw new TypeError('模拟场景无效');
    const next=prepareResponses(responses);queued.splice(0,queued.length,...next);
    mode=nextMode;attempt=0;
  }
  const requests=[],tone=fs.readFileSync(path.join(__dirname,'demo-assets/tone.mp3'));
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      const target=new URL(req.url,'http://'+req.headers.host),route=target.pathname;
      if(req.method==='GET'&&route==='/'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"});
        res.end(fs.readFileSync(path.join(__dirname,'demo.html')));return;
      }
      if(req.method==='GET'&&route==='/demo.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(fs.readFileSync(path.join(__dirname,'demo-ui.js')));return;}
      if(req.method==='GET'&&route==='/demo/state'){json(res,200,{mode,modes:MODES,appUrl,password,requests});return;}
      if(req.method==='POST'&&route==='/demo/samples'){
        if(req.headers.origin!=='http://'+req.headers.host){json(res,403,{error:'请从本地演示控制台准备样本'});return;}
        json(res,200,await prepareSamples());return;
      }
      if(req.method==='POST'&&route==='/demo/mode'){
        if(req.headers.origin!=='http://'+req.headers.host){json(res,403,{error:'请从本地演示控制台切换场景'});return;}
        const data=await read(req,1024),next=JSON.parse(data).mode;
        if(!Object.hasOwn(MODES,next)){json(res,400,{error:'演示场景无效'});return;}
        mode=next;attempt=0;queued.length=0;json(res,200,{mode});return;
      }
      if(req.method==='GET'&&['/samples/receipt.png','/samples/tone.mp3'].includes(route)){
        const name=path.basename(route);res.writeHead(200,{'Content-Type':name.endsWith('.png')?'image/png':'audio/mpeg','Content-Disposition':'attachment; filename="demo-'+name+'"'});res.end(fs.readFileSync(path.join(__dirname,'demo-assets',name)));return;
      }
      if(!route.startsWith('/v1/')){json(res,404,{error:'不存在的演示接口'});return;}
      if(req.headers.authorization!=='Bearer '+KEY){json(res,401,{error:'本地演示只接受演示密钥'});return;}
      const raw=await read(req,20*1024*1024),isMultipart=String(req.headers['content-type']).startsWith('multipart/form-data');
      const body=raw.length?(isMultipart?null:JSON.parse(raw)):null;
      const started=performance.now();
      const event={id:++sequence,path:route,mode,startedAt:Date.now(),status:'处理中',bytes:raw.length,body:snapshot(body)};
      requests.push(event);if(requests.length>40)requests.shift();
      const finish=status=>{if(event.status==='处理中'){event.status=status;event.elapsedMs=Math.round(performance.now()-started);}};
      res.on('finish',()=>finish('HTTP '+res.statusCode));res.on('close',()=>finish('连接关闭'));
      const selected=mode,currentAttempt=++attempt;
      if(queued.length){
        const response=queued.shift();event.scenario=true;
        if(response.delayMs)await new Promise(resolve=>setTimeout(resolve,response.delayMs));
        if(!res.destroyed)json(res,response.status,response.body);
        return;
      }
      if(selected==='delay')await new Promise(resolve=>setTimeout(resolve,3000));
      if(selected==='timeout')return; // Production provider timeout remains 45 seconds.
      if(selected==='disconnect'){res.destroy();return;}
      if(selected==='http'||selected==='retry'&&currentAttempt===1){json(res,503,{error:{message:'LOCAL DEMO: simulated upstream outage'}});return;}
      if(selected==='json'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"broken":');return;}
      if(selected==='empty'){json(res,200,route.endsWith('/speech')?{}:{choices:[]});return;}
      if(route==='/v1/models'&&req.method==='GET'){json(res,200,{data:['chat','vision','tts','stt'].map(c=>({id:'local-demo-'+c}))});return;}
      if(route==='/v1/chat/completions'&&req.method==='POST'){
        if(!Array.isArray(body?.messages)||typeof body.model!=='string'){json(res,400,{error:'演示收到不兼容的聊天请求'});return;}
        if(selected==='tools'){
          const pat=body.tools?.find(tool=>/pat/i.test(tool.function?.name||''));
          const completed=body.messages.some(message=>message.role==='tool');
          const message=pat&&!completed?{role:'assistant',content:null,tool_calls:[{id:'demo-pat-'+event.id,type:'function',function:{name:pat.function.name,arguments:'{}'}}]}:{role:'assistant',content:'[本地模拟响应] 动作已完成。'};
          json(res,200,{id:'local-demo-'+event.id,choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:31,completion_tokens:12,total_tokens:43}});return;
        }
        const system=body.messages.find(m=>m.role==='system')?.content||'',last=body.messages.findLast(m=>m.role==='user')?.content;
        event.hasImage=body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
        const receipt=system.startsWith('识别账单或小票')||system.startsWith('Extract bookkeeping entries');
        const moment=typeof last==='string'&&last.startsWith('以你的角色身份写一条简短自然的朋友圈动态');
        const text=receipt?JSON.stringify([{amountCents:1250,type:'expense',category:'餐饮',merchant:'本地演示咖啡店',date:new Date().toISOString().slice(0,10),note:'固定演示草稿，不是真实图片识别'}]):
          '[本地演示响应] '+(event.hasImage&&!moment?'图片已通过真实请求到达本地模拟服务；这里返回固定说明，不识别图片内容。':last==='Reply with OK.'?'OK：本地模拟服务连通。':typeof last==='string'&&last.includes('朋友圈动态')?'今天把一件小事慢慢做好了。（固定演示文案）':'已收到：'+String(last||'').slice(0,80)+'。这条固定回复用于检查聊天、保存与重试。');
        json(res,200,{id:'local-demo-'+event.id,choices:[{message:{role:'assistant',content:text}}]});return;
      }
      if(route==='/v1/audio/transcriptions'&&req.method==='POST'){
        event.multipart=isMultipart&&raw.includes(Buffer.from('name="model"'))&&raw.includes(Buffer.from('name="file"'));
        if(!event.multipart){json(res,400,{error:'需要真实 multipart model/file 字段'});return;}
        json(res,200,{text:'本地演示转写：这是一段固定文字，未识别录音内容。'});return;
      }
      if(route==='/v1/audio/speech'&&req.method==='POST'){
        if(typeof body?.input!=='string'||typeof body.model!=='string'){json(res,400,{error:'缺少朗读文字或模型'});return;}
        event.inputChars=body.input.length;res.writeHead(200,{'Content-Type':'audio/mpeg'});res.end(tone);return;
      }
      json(res,404,{error:'该模型能力尚未实现，本地演示不补造接口'});
    }catch(error){json(res,error.status||400,{error:error.message});}
  });
  return {server,get mode(){return mode;},requests,setScenario,enqueueResponses,setAppUrl(value){appUrl=value;},setPrepareSamples(callback){prepareSamples=callback;},listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve(server.address());});}),async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
function snapshot(value){
  if(Array.isArray(value))return value.map(snapshot);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/^(authorization|api[-_]?key|key)$/i.test(key)).map(([key,item])=>[key,snapshot(item)]));
  return value;
}
async function read(req,max){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(new Error('演示请求过大'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);}
module.exports={createDemoProvider,KEY};
