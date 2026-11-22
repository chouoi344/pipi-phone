// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const PNG='data:image/png;base64,aGVsbG8=';
function productFunction(name){
  const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);assert.ok(match,name);
  const rest=source.slice(match.index+match[0].length),end=/\n  (?:async )?function /.exec(rest);assert.ok(end,name+' boundary');
  return source.slice(match.index,match.index+match[0].length+end.index);
}
function forms(origin='chats'){
  const role={id:'alice',name:'Alice',avatar:PNG,cover:PNG,prompt:'Her story',relationship:'Friend',personaId:'persona',modelId:'model'};
  const calls=[],pages=[],navigations=[],notices=[];
  const pick={},file={files:[],isConnected:true,click(){}},value={value:PNG},submit={disabled:false};
  const controls={'#pick-role-cover':pick,'#role-cover-file':file,'[name=cover]':value,'.modal-submit':submit,'.modal-error':{textContent:''},'[name=patText]':{value:''},'[name=name]':{value:role.name},'[name=remark]':{value:''},'#role-pat-preview':{textContent:''}};
  controls['.modal-form']={values:{name:role.name,remark:'',cover:role.cover,patText:''}};
  const overlay={querySelector:selector=>controls[selector]};
  file.form={querySelector:selector=>selector==='input[type=file]:disabled'&&file.disabled?file:controls[selector]};
  const scope=vm.createContext({role,calls,pages,navigations,notices,overlay});
  vm.runInContext(`const state={roles:[role],personas:[]},route={name:'${origin}'};let avatarDraft='${PNG}';
    function roleById(id){return state.roles.find(r=>r.id===id);}function esc(v){return String(v??'');}function safeImage(v){return typeof v==='string'&&v.startsWith('data:image/');}
    function avatarForm(){return '<div>头像</div>';}function field(label,name,value){return '<label>'+label+'<input name="'+name+'" value="'+(value||'')+'"></label>';}
    function openModal(title,html,submit,label){pages.push({title,html,submit,label});}function bindAvatar(){}function closeModal(){}function refresh(){}
    function formValues(form){return form.values;}async function act(type,payload){calls.push({type,payload});if(payload.id)Object.assign(role,payload);else state.roles.push({id:'new',...payload});}
    function toast(message){notices.push(message);}function showView(name,arg){navigations.push({name,arg});}
    const profileImageAccept='image/png';let imageReader=async file=>file.image;async function uploadProfileImage(file){return imageReader(file);}
    ${productFunction('bindProfileImage')}${productFunction('editRole')}${productFunction('checkWechatId')}${productFunction('changedFields')}
    globalThis.ui={editRole,setReader(fn){imageReader=fn;},state};`,scope);
  return {ui:scope.ui,role,calls,pages,navigations,notices,pick,file,value,submit};
}
test('friend basics leave persona, model and story bindings unchanged while saving a separate cover',async()=>{
  const f=forms();f.ui.editRole('alice');const page=f.pages[0];
  assert.match(page.html,/朋友圈背景图/);assert.match(page.html,/<img[^>]+alt="朋友圈背景图预览"/);
  assert.doesNotMatch(page.html,/personaId|modelId|prompt|relationship|绑定我的人设|使用的模型/);
  f.file.files=[{name:'sample.png',image:PNG+'YQ=='}];await f.file.onchange();
  assert.equal(f.value.value,PNG+'YQ==');assert.match(f.pick.innerHTML,/朋友圈背景图预览/);
  await page.submit({isConnected:true,values:{name:'Updated',remark:'Note',wechatId:'alice',bio:'A real bio',cover:f.value.value}});
  const payload=f.calls[0].payload;assert.equal(payload.cover,PNG+'YQ==');assert.equal(Object.hasOwn(payload,'avatar'),false);assert.equal(f.role.avatar,PNG);
  assert.equal(Object.hasOwn(payload,'personaId'),false);assert.equal(Object.hasOwn(payload,'modelId'),false);
  assert.equal(f.role.personaId,'persona');assert.equal(f.role.modelId,'model');assert.equal(f.role.prompt,'Her story');assert.equal(f.role.relationship,'Friend');
});
test('new friend creation returns to the populated new-friends page and still rejects a blank name',async()=>{
  const f=forms();f.ui.editRole();const page=f.pages[0];
  await assert.rejects(page.submit({isConnected:true,values:{name:'  ',cover:''}}),/请填写角色名字/);assert.equal(f.calls.length,0);
  await page.submit({isConnected:true,elements:{momentsAutoEnabled:{checked:false}},values:{name:'New friend',remark:'New note',wechatId:'new',bio:'New bio',cover:PNG}});
  assert.equal(f.navigations[0].name,'new-friends');assert.equal(f.ui.state.roles.at(-1).name,'New friend');assert.equal(f.ui.state.roles.at(-1).cover,PNG);
});
test('adding from new-friends keeps the existing page history entry',async()=>{
  const f=forms('new-friends');f.ui.editRole();
  await f.pages[0].submit({isConnected:true,elements:{momentsAutoEnabled:{checked:false}},values:{name:'New friend',cover:''}});
  assert.deepEqual(f.navigations,[]);assert.equal(f.ui.state.roles.at(-1).name,'New friend');
});
test('new friend auto moments is off by default and submits the actual checkbox boolean',async()=>{
  for(const checked of [false,true]){const f=forms();f.ui.editRole();assert.match(f.pages[0].html,/<input type="checkbox" name="momentsAutoEnabled">/);await f.pages[0].submit({isConnected:true,elements:{momentsAutoEnabled:{checked}},values:{name:'Auto moments friend',momentsAutoEnabled:'on',cover:''}});assert.equal(f.calls[0].payload.momentsAutoEnabled,checked);}
});
test('cover reading finishes before save becomes available and a failed read keeps the old cover',async()=>{
  const f=forms();f.ui.editRole('alice');let finish;
  f.ui.setReader(()=>new Promise(resolve=>{finish=resolve;}));f.file.files=[{name:'sample.png',image:PNG}];
  const reading=f.file.onchange();assert.equal(f.submit.disabled,true);assert.equal(f.pick.disabled,true);
  finish(PNG+'Yg==');await reading;assert.equal(f.submit.disabled,false);assert.equal(f.value.value,PNG+'Yg==');
  f.ui.setReader(async()=>{throw new Error('图片读取失败');});await f.file.onchange();
  assert.equal(f.value.value,PNG+'Yg==');assert.equal(f.notices.at(-1),'朋友圈背景图：图片读取失败');assert.equal(f.submit.disabled,false);
});
test('new-friends list shows actual saved details and a decorative header mark',()=>{
  const scope=vm.createContext({});vm.runInContext(`const state={roles:[{id:'alice',name:'Alice',bio:'An actual signature'},{id:'bob',name:'Bob',remark:'Bobby',wechatId:'bob_id'}]},icons={search:'search',more:'<svg class="nav-more-mark"></svg>'};
    function header(title,options){return '<header>'+title+options.right+'</header>';}function esc(v){return String(v??'');}function avatar(role,size){return '<img data-size="'+size+'" alt="'+role.name+'">';}function roleName(role){return role.remark||role.name;}
    ${productFunction('renderNewFriends')}globalThis.render=renderNewFriends;`,scope);
  const html=scope.render(),header=html.split('</header>')[0];
  assert.match(header,/<span class="new-friends-more" aria-hidden="true">/);assert.doesNotMatch(header,/<button|data-action|tabindex/);
  assert.match(html,/Alice/);assert.match(html,/An actual signature/);assert.match(html,/Bobby/);assert.match(html,/微信号：bob_id/);
  assert.equal((html.match(/已添加/g)||[]).length,2);assert.equal((html.match(/data-size="40"/g)||[]).length,2);
  assert.match(html,/data-action="add-role">创建新朋友/);assert.doesNotMatch(html,/请求|申请|昨天|今天|2026/);
});
test('settings offer a direct usage route and both duplicate moments management entries are absent',async()=>{
  const navigations=[],scope=vm.createContext({navigations,storageMaintenance:false,accountSecurity:false});vm.runInContext(`const state={settings:{}},routes=new Map(),route={};const window={PipiUsage:{open:async()=>showView('engine-usage')}};
    function header(){return '';}function plainCell(title,action){return '<button data-action="'+action+'">'+title+'</button>';}function roleById(){}function showView(name){navigations.push(name);}
    ${productFunction('renderSettings')}${productFunction('handleAction')}globalThis.ui={renderSettings,handleAction};`,scope);
  const html=scope.ui.renderSettings();assert.match(html,/data-action="engine-usage">用量/);assert.doesNotMatch(html,/朋友圈管理|moments-settings/);
  await scope.ui.handleAction('engine-usage');assert.deepEqual(navigations,['engine-usage']);
  const permissions=source.split(/\r?\n/).find(line=>line.includes("routes.set('friend-permissions'"));assert.doesNotMatch(permissions,/moments-settings/);
});
function stickers(routeName='stickers'){
  const calls=[],notices=[],renders=[],file={files:[],disabled:false,isConnected:true,value:'selected'};
  const scope=vm.createContext({calls,notices,renders});vm.runInContext(`const state={stickers:[]};let authEpoch=1,stickerUploadEpoch=-1,route={name:'${routeName}'},composeText='unfinished draft',composeImage='draft-image',quoteId='quote';
    let read=async file=>{if(file.error)throw new Error(file.error);return file.image;};async function uploadImage(file){return read(file);}
    let save=async(type,payload)=>{calls.push({type,payload});};async function act(type,payload){await save(type,payload);for(const image of payload.images)if(!state.stickers.some(sticker=>sticker.image===image))state.stickers.push({id:'sticker-'+state.stickers.length,image});}
    function toast(message){notices.push(message);}function refresh(){renders.push('page');}function updateComposer(){renders.push('composer');}
    ${productFunction('uploadStickers')}
    globalThis.ui={uploadStickers(file){return uploadStickers([...file.files],route,authEpoch);},readWith(fn){read=fn;},saveWith(fn){save=fn;},leave(){route={name:'about'};},draft:()=>({composeText,composeImage,quoteId})};`,scope);
  return {ui:scope.ui,calls,notices,renders,file};
}
for(const route of ['stickers','chat'])test('multi-sticker upload submits one full batch from '+route+' and keeps its draft',async()=>{
  const f=stickers(route);f.file.files=[{name:'sample.png',image:'first'},{name:'second.png',image:'second'}];await f.ui.uploadStickers(f.file);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].type,'sticker.add');assert.deepEqual([...f.calls[0].payload.images],['first','second']);
  assert.deepEqual(f.renders,[route==='chat'?'composer':'page']);
  assert.deepEqual({...f.ui.draft()},{composeText:'unfinished draft',composeImage:'draft-image',quoteId:'quote'});
});
test('one invalid image prevents any sticker request and server rejection produces no success',async()=>{
  const f=stickers();f.file.files=[{name:'sample.png',image:'valid'},{name:'broken.png',error:'unsupported image'}];await f.ui.uploadStickers(f.file);
  assert.equal(f.calls.length,0);assert.deepEqual(f.renders,[]);assert.equal(f.notices.at(-1),'unsupported image');
  f.file.files=[{name:'sample.png',image:'valid'}];f.ui.saveWith(async()=>{throw new Error('表情库空间不足');});await f.ui.uploadStickers(f.file);
  assert.equal(f.notices.at(-1),'表情库空间不足');assert.equal(f.notices.includes('表情已添加'),false);assert.deepEqual(f.renders,[]);
});
test('pending upload cannot repaint a different page or submit the same selection twice',async()=>{
  const f=stickers('chat');let finish;f.file.files=[{name:'sample.png',image:'first'}];f.ui.readWith(()=>new Promise(resolve=>{finish=resolve;}));
  const reading=f.ui.uploadStickers(f.file);await f.ui.uploadStickers(f.file);f.file.isConnected=false;f.ui.leave();finish('first');await reading;
  assert.equal(f.calls.length,1);assert.deepEqual(f.renders,[]);assert.equal(f.file.disabled,false);
});
test('a state refresh replacing the picker still updates the same page after upload',async()=>{
  const f=stickers('chat');f.file.files=[{name:'sample.png',image:'first'}];f.file.isConnected=false;
  await f.ui.uploadStickers(f.file);assert.deepEqual(f.renders,['composer']);
});
test('both global sticker pickers allow multiple files',()=>{
  const stickerSource=fs.readFileSync(path.join(__dirname,'../public/stickers.js'),'utf8');
  const inputs=(source+stickerSource).match(/<input[^>]*id="sticker-file"[^>]*>/g);assert.equal(inputs.length,2);
  for(const input of inputs)assert.match(input,/\bmultiple\b/);
});
