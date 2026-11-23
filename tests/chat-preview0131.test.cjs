// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const part=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const original='/api/media/original.png',thumb='/api/media/thumb.jpg';
function fixture(){const scope=vm.createContext({chatImageSizes:new Map(),chatPreviewStatus:new Map(),thumbnailQueue:[],thumbnailWorkers:0,safeImage:value=>typeof value==='string'&&value.startsWith('/api/media/'),esc:value=>value});vm.runInContext(part('  function queueChatThumbnail(','  async function act('),scope);return scope;}
test('chat preview uses the thumbnail without embedding the original and keeps sticker animation source',()=>{
 const f=fixture(),message={meta:{thumb}};
 const markup=f.chatImageMarkup(message,original,'聊天图片');
 assert.ok(markup.includes('src="'+thumb+'"'));assert.ok(!markup.includes(original));assert.ok(markup.includes('data-media-preview="thumbnail"'));
 assert.ok(f.chatImageMarkup(message,original,'聊天表情',true).includes('src="'+original+'"'));
 assert.ok(f.chatImageMarkup({meta:{}},original,'聊天图片').includes('src="'+original+'"'));
 assert.ok(f.chatImageMarkup({meta:{thumb:'javascript:alert(1)'}},original,'聊天图片').includes('src="'+original+'"'));
});
test('chat preview reserves a square before decode and reuses the measured aspect on return',()=>{
 const f=fixture();assert.ok(f.chatImageMarkup({meta:{thumb}},original,'聊天图片').includes('width="120" height="120"'));
 f.chatImageSizes.set(thumb,{width:150,height:90});assert.ok(f.chatImageMarkup({meta:{thumb}},original,'聊天图片').includes('width="150" height="90"'));
});
test('thumbnail work is limited to two and disconnected queued photos are skipped',async()=>{
 const f=fixture(),pending=[],started=[];f.backfillThumbnail=img=>{started.push(img.id);return new Promise(resolve=>pending.push(resolve));};
 const photos=Array.from({length:5},(_,id)=>({id,isConnected:true,dataset:{}}));for(const img of photos)f.queueChatThumbnail(img);
 assert.equal(started.length,2);photos[2].isConnected=false;pending.shift()();await new Promise(setImmediate);assert.deepEqual(started,[0,1,3]);
 f.queueChatThumbnail(photos[3]);assert.equal(f.thumbnailQueue.length,1);
 while(pending.length){pending.shift()();await new Promise(setImmediate);}assert.deepEqual(started,[0,1,3,4]);assert.equal(f.thumbnailWorkers,0);
});
test('personal profile avatar starts eagerly while list avatars keep the short key',()=>{
 const profile={name:'我',avatar:original},f=vm.createContext({state:{profile},route:{name:'me'},avatarKey:()=> '1',esc:value=>value,assetIcon:()=>'',Math});
 vm.runInContext(part('  function avatar(entity','  function toast('),f);
 assert.ok(f.avatar(profile,64).includes('src="'+original+'"'));assert.ok(f.avatar(profile,64).includes('loading="eager"'));
 f.route.name='profile';assert.ok(f.avatar(profile,60).includes('src="'+original+'"'));
 f.route.name='contacts';const markup=f.avatar(profile,40);assert.ok(!markup.includes('src='));assert.ok(markup.includes('data-avatar-key="1"'));assert.ok(markup.includes('loading="lazy"'));
});
test('idle warmup is thumbnail-only, limited to two conversations and four URLs for the page',async()=>{
 const f=fixture(),scheduled=[],requested=[];Object.assign(f,{previewWarmups:new Map(),previewWarmupTimer:0,navigator:{connection:{effectiveType:'4g'}},route:{name:'chats'},document:{hidden:false},window:{},state:{messages:[]},setTimeout:fn=>{scheduled.push(fn);return scheduled.length;},Image:class{constructor(){this.naturalWidth=320;this.naturalHeight=200;}set src(value){requested.push(value);}decode(){return Promise.resolve();}}});
 for(let i=0;i<12;i++)f.state.messages.push({roleId:['a','b','c'][i%3],content:original,meta:{thumb:'/api/media/preview-'+i+'.jpg'}});
 f.scheduleChatPreviewWarmup(['a','b']);f.scheduleChatPreviewWarmup(['a','b']);assert.equal(scheduled.length,1);scheduled.shift()();await Promise.resolve();
 assert.equal(requested.length,4);assert.ok(requested.every(value=>value.includes('preview-')));assert.equal(f.previewWarmups.size,4);
 f.scheduleChatPreviewWarmup(['b','c']);assert.equal(scheduled.length,0);
});
test('save-data and slow mobile connections do not schedule background images',()=>{
 for(const connection of [{saveData:true},{effectiveType:'3g'},{effectiveType:'2g'},{effectiveType:'slow-2g'}]){const f=fixture();Object.assign(f,{previewWarmups:new Map(),previewWarmupTimer:0,navigator:{connection},setTimeout:()=>{assert.fail('slow network scheduled a warmup');}});f.scheduleChatPreviewWarmup(['a']);}
});
test('quoted image prefers its existing thumbnail and still points to the quoted message',()=>{
 const f=vm.createContext({state:{profile:{name:'我'},messages:[{id:'photo',meta:{thumb}}]},safeImage:value=>typeof value==='string'&&value.startsWith('/api/media/'),esc:value=>value,richText:value=>value,roleName:()=> '朋友',renderExpiredImage:()=>''});
 vm.runInContext(part('  function renderMessageQuote(','  function renderVoiceTranscript('),f);
 const markup=f.renderMessageQuote({messageId:'photo',sender:'user',type:'image',content:original},{});assert.ok(markup.includes('src="'+thumb+'"'));assert.ok(!markup.includes(original));assert.ok(markup.includes('data-quote-message="photo"'));
});
