// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net'),fs=require('node:fs'),path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const S=require('../lib/state.cjs'),R=require('../lib/engine/registry.cjs'),Models=require('../lib/engine/models.cjs'),Runtime=require('../lib/engine/runtime.cjs'),E=require('../lib/engine/execution.cjs');
const root=path.resolve(__dirname,'../outputs/integrated-optimization/followup-limits/delivery'),image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWVQAAAAASUVORK5CYII=';
fs.mkdirSync(root,{recursive:true});
const originalConnect=net.Socket.prototype.connect,oldPrivate=process.env.ALLOW_PRIVATE_PROVIDERS;
net.Socket.prototype.connect=function(...args){let input=args[0];if(Array.isArray(input))input=input[0];if(typeof input==='number')input={port:input,host:typeof args[1]==='string'?args[1]:'localhost'};if(input&&typeof input==='object'&&input.port!==undefined)assert.ok(['127.0.0.1','localhost','::1','::ffff:127.0.0.1'].includes(String(input.host||input.hostname||'localhost')),'Image delivery tests permit only loopback sockets');return originalConnect.apply(this,args);};
process.env.ALLOW_PRIVATE_PROVIDERS='1';
test.after(()=>{net.Socket.prototype.connect=originalConnect;if(oldPrivate===undefined)delete process.env.ALLOW_PRIVATE_PROVIDERS;else process.env.ALLOW_PRIVATE_PROVIDERS=oldPrivate;});
async function until(check,label){const end=Date.now()+7000;while(Date.now()<end){if(check())return;await delay(5);}throw Error('Timed out: '+label);}
async function fixture(t,{answer,waitingText='我拍一下给你看。',segments=true,photo=true,failImage=false,failureAnswer='这次没拍成，晚点再给你。',continueAfterImage=false,previousWaiting='',otherRoleWaiting=''}={}){
  const requests=[],directory=fs.mkdtempSync(path.join(root,'image-delivery-fixture-'));let state=S.initial(),chatCalls=0,runtime;
  const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');requests.push({url:req.url,model:body.model});
    if(req.url==='/v1/images/generations'){if(failImage){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Synthetic image generation failure'}}));return;}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{b64_json:image}]}));return;}
    assert.equal(req.url,'/v1/chat/completions');chatCalls++;const message=photo&&chatCalls===1?{role:'assistant',content:continueAfterImage?null:answer,tool_calls:[{id:'fixed-image-call',type:'function',function:{name:'generate_image',arguments:JSON.stringify({prompt:'A synthetic tiny image',sendToChat:true,waitingText})}},...(continueAfterImage?[{id:'fixed-pat-call',type:'function',function:{name:'pat_user',arguments:'{}'}}]:[])]}:{role:'assistant',content:failImage?failureAnswer:answer};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'fixed-http-response',object:'chat.completion',model:body.model,choices:[{index:0,message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:8,total_tokens:28}}));
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseUrl='http://127.0.0.1:'+server.address().port+'/v1';
  for(const module of R.modules)if(module.settings.some(field=>field.key==='enabled'))state.settings.modules[module.id]={...R.values(state,module.id),enabled:false};
  state.settings.modules.actions={...R.values(state,'actions'),enabled:true};state.settings.modules.waiting={...R.values(state,'waiting'),enabled:false};state.settings.modules.segments={...R.values(state,'segments'),enabled:segments,minSeconds:0,maxSeconds:0};
  S.apply(state,'role.save',{name:'Synthetic image role',prompt:'Only synthetic fixture data',voiceMode:'off'});const roleId=state.roles[0].id,ai=Models.sanitize(state.settings.ai);
  if(previousWaiting)S.message(state,S.role(state,roleId),'assistant',previousWaiting);
  if(otherRoleWaiting){S.apply(state,'role.save',{name:'Other synthetic role',voiceMode:'off'});S.message(state,state.roles[1],'assistant',otherRoleWaiting);}
  const model=(id,kind)=>({id,sourceId:'loopback-fixture',model:'fixed-'+id,kind,capabilities:kind==='chat'?['text','tool_use']:[],maxContextTokens:128000,temperature:null,maxTokens:null,timeoutSeconds:2,extraBody:{},voice:''});
  Models.save(state,{sources:[...ai.sources,{id:'loopback-fixture',name:'Local fixed HTTP fixture',baseUrl,key:'SYNTHETIC_ONLY',builtin:false}],models:[model('chat','chat'),model('image','image')],assign:{...ai.assign,chat:'chat',image:'image'}});
  const getState=()=>structuredClone(state),mutate=fn=>{const next=structuredClone(state),value=fn(next);state=next;return {state:getState(),value};};
  runtime=Runtime.create({getState,mutate,dataDir:directory});
  t.after(async()=>{try{await runtime.close();}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));require('../lib/engine/memory-store.cjs').close(directory);fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({test:t.name,requests,messages:state.messages.map(({roleId,sender,type,content,meta})=>({roleId,sender,type,content,meta})),runs:Object.values(E.data(state).runs).map(({status,answer,segments,delivered})=>({status,answer,segments,delivered}))},null,2));}});
  const message=mutate(s=>S.message(s,S.role(s,roleId),'user',photo?'请画一张小图发给我':'请解释页面上的文字','text',{status:'pending'})).value;
  runtime.enqueue(roleId,message.id);await until(()=>!runtime.isBusy(roleId),'original runtime finishes');assert.equal(state.messages.find(m=>m.id===message.id).status,'sent',state.messages.find(m=>m.id===message.id).error);
  return {get state(){return state;},requests,get replies(){return state.messages.filter(m=>m.sender==='assistant'&&m.roleId===roleId).map(m=>m.type==='image'?'image':m.content);},async nextTextTurn(nextAnswer){
    photo=false;answer=nextAnswer;chatCalls=0;
    const next=mutate(s=>S.message(s,S.role(s,roleId),'user','这是下一轮普通聊天','text',{status:'pending'})).value;
    runtime.enqueue(roleId,next.id);await until(()=>!runtime.isBusy(roleId),'next ordinary turn finishes');assert.equal(state.messages.find(m=>m.id===next.id).status,'sent');
  }};
}

test('an image prefix cannot resend the already delivered waiting message',async t=>{
  const f=await fixture(t,{answer:'（图片）我拍一下给你看。\n后面慢慢聊。'});
  assert.deepEqual(f.replies,['我拍一下给你看。','image','后面慢慢聊。']);assert.equal(f.requests.filter(r=>r.url.endsWith('/images/generations')).length,1);
});
test('disabled segmentation still removes an already delivered waiting line and preserves the remaining reply',async t=>{
  const f=await fixture(t,{answer:'我拍一下给你看。\n后面慢慢聊。',segments:false});assert.deepEqual(f.replies,['我拍一下给你看。','image','后面慢慢聊。']);
});
test('a photo delivery acknowledgement loses its prefix while keeping the acknowledgement',async t=>{
  const f=await fixture(t,{answer:'（图片）发你看看。'});assert.deepEqual(f.replies,['我拍一下给你看。','image','发你看看。']);
});
test('ordinary discussion of the image label survives even when an image was delivered',async t=>{
  const f=await fixture(t,{answer:'（图片）这个词是界面上的提示。\n你提到的（图片）标记可以保留。'});assert.deepEqual(f.replies,['我拍一下给你看。','image','（图片）这个词是界面上的提示。','你提到的（图片）标记可以保留。']);
});
test('quoted waiting words and a similar new sentence are not fuzzy duplicates',async t=>{
  const f=await fixture(t,{answer:'“我拍一下给你看。”这句是你刚刚说的。\n我拍一下给你看看。'});assert.deepEqual(f.replies,['我拍一下给你看。','image','“我拍一下给你看。','”这句是你刚刚说的。','我拍一下给你看看。']);
});
test('plain text mentioning the image label is unchanged without an image action',async t=>{
  const f=await fixture(t,{photo:false,answer:'（图片）发你看看，是一句举例。\n这个标签叫（图片）。'});assert.deepEqual(f.replies,['（图片）发你看看，是一句举例。','这个标签叫（图片）。']);assert.equal(f.requests.length,1);
});
test('image generation failure keeps its visible failure reply and does not claim an image was delivered',async t=>{
  const f=await fixture(t,{answer:'',failImage:true});assert.deepEqual(f.replies,['我拍一下给你看。','这次没拍成，晚点再给你。']);assert.equal(f.state.messages.filter(m=>m.type==='image').length,0);
});
test('ordinary unsplit paragraphs keep their blank lines without any photo action',async t=>{
  const f=await fixture(t,{photo:false,segments:false,answer:'第一段。\n\n第二段。'});assert.deepEqual(f.replies,['第一段。\n\n第二段。']);
});
test('two intentionally repeated plain text lines are not globally deduplicated',async t=>{
  const f=await fixture(t,{photo:false,answer:'我拍一下给你看。\n我拍一下给你看。'});assert.deepEqual(f.replies,['我拍一下给你看。','我拍一下给你看。']);
});
test('a literal label explanation is kept after a photo even when it starts like an acknowledgement',async t=>{
  const f=await fixture(t,{answer:'（图片）发你看看，是一句举例。'});assert.deepEqual(f.replies,['我拍一下给你看。','image','（图片）发你看看，是一句举例。']);
});
test('an unsplit reply removes only the exact delivered waiting sentence before its new content',async t=>{
  const f=await fixture(t,{segments:false,answer:'我拍一下给你看。后面慢慢聊。'});assert.deepEqual(f.replies,['我拍一下给你看。','image','后面慢慢聊。']);
});
test('a prefix on a later split sentence is removed without changing the surrounding text',async t=>{
  const f=await fixture(t,{answer:'这一张拍好了。（图片）发过去啦！'});assert.deepEqual(f.replies,['我拍一下给你看。','image','这一张拍好了。','发过去啦！']);
});
test('a tool-only photo reply does not need an extra empty or repeated waiting bubble',async t=>{
  const f=await fixture(t,{answer:'（图片）我拍一下给你看。'});assert.deepEqual(f.replies,['我拍一下给你看。','image']);assert.equal(f.requests.filter(r=>r.url.endsWith('/chat/completions')).length,1);
});

const screenshotWaiting='刚才还在喊绝交，一转头就理直气壮点上菜了？等着。';
const screenshotAnswer='胆子越来越大了，刚才还在喊绝交，一转头就理直气壮点上菜了？\n等着。\n（图片）要求提得挺顺口。\n看够了没有，小流氓？\n刚才原谅我的利息，现在可全被你讨回去了。';
const screenshotNew='胆子越来越大了。\n要求提得挺顺口。\n看够了没有，小流氓？\n刚才原谅我的利息，现在可全被你讨回去了。';
for(const segments of [true,false])test('screenshot exact waiting sentences and photo marker do not repeat after real image delivery, split='+segments,async t=>{
  const f=await fixture(t,{waitingText:screenshotWaiting,answer:screenshotAnswer,continueAfterImage:true,segments});
  assert.deepEqual(f.replies,[screenshotWaiting,'image',...(segments?screenshotNew.split('\n'):[screenshotNew])]);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/chat/completions')).length,2);assert.equal(f.requests.filter(r=>r.url.endsWith('/images/generations')).length,1);
});
test('exact waiting sentences quoted or explicitly discussed after a photo remain ordinary dialogue',async t=>{
  const answer='“'+screenshotWaiting+'”这句话是引用。\n你刚才说，等着。\n（图片）这个标签只是一个占位符。';
  const f=await fixture(t,{waitingText:screenshotWaiting,answer,continueAfterImage:true,segments:false});assert.deepEqual(f.replies,[screenshotWaiting,'image',answer]);
});
test('a similar new sentence is preserved rather than semantically deduplicated',async t=>{
  const answer='胆子越来越大了，刚才还在喊绝交，你现在就理直气壮点菜了？';
  const f=await fixture(t,{waitingText:screenshotWaiting,answer,continueAfterImage:true,segments:false});assert.deepEqual(f.replies,[screenshotWaiting,'image',answer]);
});
test('no image action preserves natural dialogue while dropping an isolated photo label',async t=>{
  const answer=screenshotAnswer+'\n（图片）';const f=await fixture(t,{photo:false,answer,segments:false});assert.deepEqual(f.replies,[screenshotAnswer]);
});
test('failed generation preserves repeated waiting words and photo-label discussion in its actual final reply',async t=>{
  const answer='等着。\n（图片）要求提得挺顺口。\n（图片）';
  const f=await fixture(t,{waitingText:screenshotWaiting,answer:'',failureAnswer:answer,failImage:true,segments:false});assert.deepEqual(f.replies,[screenshotWaiting,'等着。\n（图片）要求提得挺顺口。']);assert.equal(f.state.messages.filter(m=>m.type==='image').length,0);
});
test('waiting text from an earlier turn is not a deduplication source for this new photo',async t=>{
  const f=await fixture(t,{previousWaiting:screenshotWaiting,waitingText:'这次我换个角度。',answer:screenshotWaiting,continueAfterImage:true,segments:false});assert.deepEqual(f.replies,[screenshotWaiting,'这次我换个角度。','image',screenshotWaiting]);
});
test('waiting text belonging to another role does not erase this role’s new words',async t=>{
  const f=await fixture(t,{otherRoleWaiting:screenshotWaiting,waitingText:'这次我换个角度。',answer:screenshotWaiting,continueAfterImage:true,segments:false});assert.deepEqual(f.replies,['这次我换个角度。','image',screenshotWaiting]);
});
test('quoted photo labels and waiting words spanning split bubbles stay quoted dialogue',async t=>{
  const answer='“前一句。（图片）我拍一下给你看。”这句是引用。';
  const f=await fixture(t,{answer,continueAfterImage:true});assert.deepEqual(f.replies,['我拍一下给你看。','image','“前一句。','（图片）我拍一下给你看。','”这句是引用。']);
});
test('label definitions and punctuation-only references are preserved rather than treated as media frames',async t=>{
  const answer='（图片）是什么意思？\n（图片）两个字别删。\n“（图片）”\n（图片）是一个占位符。';
  const f=await fixture(t,{answer,continueAfterImage:true,segments:false});assert.deepEqual(f.replies,['我拍一下给你看。','image',answer]);
});
test('a real next turn without a new photo retains the earlier waiting sentence and photo label',async t=>{
  const f=await fixture(t,{waitingText:screenshotWaiting,answer:'这张图给你。',segments:false});await f.nextTextTurn(screenshotAnswer);
  assert.deepEqual(f.replies,[screenshotWaiting,'image','这张图给你。',screenshotAnswer]);assert.equal(f.requests.filter(r=>r.url.endsWith('/images/generations')).length,1);
});
test('single-quoted and code-quoted photo/waiting examples remain intact across sentence boundaries',async t=>{
  const answer="'前一句。（图片）我拍一下给你看。'\n`前一句。（图片）我拍一下给你看。`";
  const f=await fixture(t,{answer,continueAfterImage:true,segments:false});assert.deepEqual(f.replies,['我拍一下给你看。','image',answer]);
});
