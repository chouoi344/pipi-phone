// SPDX-License-Identifier: MIT
'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
function productFunction(name){
  const match=new RegExp('^  (?:async )?function '+name+'\\(','m').exec(source);assert.ok(match,name);
  const rest=source.slice(match.index+match[0].length),end=/\n  (?:async )?function /.exec(rest);assert.ok(end,name+' boundary');
  return source.slice(match.index,match.index+match[0].length+end.index);
}
function forms(gender='unset'){
  const calls=[],pages=[],role={id:'alice',name:'Alice',prompt:'Existing story',relationship:'Old friend',personaId:'persona',modelId:'model'};
  const scope=vm.createContext({calls,pages,role,gender});
  vm.runInContext(`const state={profile:{gender},roles:[role],personas:[]},route={name:'new-friends'},icons={check:'<svg></svg>'};let avatarDraft='avatar';
    function roleById(id){return state.roles.find(role=>role.id===id);}function esc(value){return String(value??'');}
    function avatarForm(){return '';}function field(label,name,value){return '<label>'+label+'<input name="'+name+'" value="'+(value||'')+'"></label>';}
    function selectField(label,name,value){return '<select name="'+name+'">'+value+'</select>';}
    function openModal(title,html,submit,label){pages.push({title,html,submit,label});}const openPage=openModal;
    function formValues(form){return form.values;}async function act(type,payload){calls.push({type,payload});Object.assign(role,payload);}
    const profileImageAccept='image/png';function bindProfileImage(){}function bindAvatar(){}function closeModal(){}function refresh(){}function toast(){}function showView(){}
    function safeImage(value){return typeof value==='string'&&value.startsWith('data:image');}const controls={};const overlay={querySelector(selector){return controls[selector]||(controls[selector]={value:''});}};
    const window={PipiEngine:{roleModelField:()=>'<select name="modelId"></select>'}};
    ${['editRole','editProfileGender','checkWechatId'].map(productFunction).join('\n')}
    globalThis.ui={editRole,editProfileGender,controls};`,scope);
  return {ui:scope.ui,role,calls,pages};
}
test('friend details no longer edit story fields and saving keeps existing story data',async()=>{
  const f=forms();f.ui.editRole('alice');const page=f.pages[0];
  assert.doesNotMatch(page.html,/name="prompt"|name="relationship"|name="personaId"|name="modelId"|名字 \*/);assert.match(page.html,/name="cover"/);
  await page.submit({isConnected:true,values:{name:'Renamed',remark:'Note',cover:''}});
  assert.equal(f.role.name,'Renamed');assert.equal(f.role.prompt,'Existing story');assert.equal(f.role.relationship,'Old friend');assert.equal(f.role.personaId,'persona');assert.equal(f.role.modelId,'model');
});
test('gender page offers two selectable rows and preserves an existing unset value on Done',async()=>{
  const f=forms();f.ui.editProfileGender();const page=f.pages[0];
  assert.equal((page.html.match(/type="radio"/g)||[]).length,2);assert.doesNotMatch(page.html,/value="unset"|<select| checked/);assert.equal(page.label,'完成');
  await page.submit({isConnected:true,values:{}});assert.equal(f.calls.length,0);
});
for(const gender of ['male','female'])test('gender page selects and saves '+gender,async()=>{
  const f=forms(gender);f.ui.editProfileGender();const page=f.pages[0];assert.match(page.html,new RegExp('value="'+gender+'" checked'));
  const selected=gender==='male'?'female':'male';await page.submit({isConnected:true,values:{gender:selected}});assert.equal(f.calls[0].type,'profile.save');assert.equal(f.calls[0].payload.gender,selected);
});
test('search results have cancel and drill-down links without a main-tab frame',()=>{
  const scope=vm.createContext({});vm.runInContext(`let globalSearchTerm='Alice';const state={roles:[{id:'alice',name:'Alice',hidden:true}],messages:[{id:'old',roleId:'alice',content:'Alice hello',createdAt:1}]},icons={search:''};
    function roleById(id){return state.roles.find(r=>r.id===id);}function roleName(r){return r.name;}function esc(x){return x;}function avatar(){return '';}function richText(x){return x;}function preview(m){return m.content;}function shortTime(){return '';}
    ${productFunction('renderGlobalSearch')}globalThis.render=renderGlobalSearch;`,scope);
  const html=scope.render();assert.match(html,/data-action="cancel-global-search"/);assert.match(html,/data-nav="role" data-arg="alice"/);assert.match(html,/data-global-message="old"/);assert.doesNotMatch(html,/bottom-tabs|top-nav|new-menu/);
});
test('settings and role manager no longer expose removed search or proactive controls',()=>{
  const scope=vm.createContext({});vm.runInContext(`const state={settings:{},roles:[{id:'alice'}],personas:[],memories:[]},route={arg:'alice'},routes=new Map(),storageMaintenance=false,accountSecurity=false;function header(){return '';}function plainCell(title,action){return title+' '+action;}function roleById(){return state.roles[0];}function roleName(){return 'Alice';}
    ${productFunction('renderSettings')}${productFunction('renderRoleConfig')}globalThis.ui={renderSettings,renderRoleConfig};`,scope);
  assert.doesNotMatch(scope.ui.renderSettings(),/settings-search|搜索/);const html=scope.ui.renderRoleConfig();assert.doesNotMatch(html,/主动消息|proactive/);assert.doesNotMatch(html,/edit-role-setting|bind-persona|bind-role-model/);assert.doesNotMatch(html,/bind-role-persona/);
});

test('friend pat field previews actual wording and saves with normal profile details',async()=>{
  const f=forms();f.ui.editRole('alice');const controls=f.ui.controls,pat=controls['[name=patText]'];assert.equal(pat.maxLength,100);controls['[name=name]'].value='小甲';controls['[name=remark]'].value='阿甲';pat.value='肩膀';pat.oninput();assert.equal(controls['#role-pat-preview'].textContent,'我拍了拍“阿甲”的肩膀');await f.pages[0].submit({isConnected:true,values:{name:'小甲',patText:'肩膀'}});assert.equal(f.role.patText,'肩膀');assert.equal(f.role.prompt,'Existing story');
});
