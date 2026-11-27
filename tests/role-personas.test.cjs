'use strict';
const {sampleState}=require('../scripts/sample-data.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../lib/state.cjs'),P=require('../lib/engine/pipeline.cjs'),Providers=require('../lib/providers.cjs');
function fixture(){const s=sampleState();S.defaults(s);return s;}
function save(s,name='人设',prompt='  原文\n第二行  '){S.apply(s,'rolePersona.save',{name,prompt});return s.rolePersonas.at(-1);}
function change(roleId,expectedPersonaId='',selected=true){return {roleId,expectedPersonaId,selected};}

test('删除文件夹保留人设正文与好友绑定，其他目录不变',()=>{
 const s=fixture(),a=save(s),b=save(s,'其他人设','其他正文');
 S.apply(s,'personaFolder.save',{name:'待删除'});S.apply(s,'personaFolder.save',{name:'保留目录'});
 const [removed,kept]=s.personaFolders;
 S.apply(s,'rolePersona.move',{id:a.id,folderId:removed.id});S.apply(s,'rolePersona.move',{id:b.id,folderId:kept.id});
 S.apply(s,'rolePersona.bind',{id:a.id,changes:[change(s.roles[0].id)]});
 const before=structuredClone(s);
 S.apply(s,'personaFolder.delete',{id:removed.id});
 assert.deepEqual(s.personaFolders,[kept]);assert.deepEqual(s.rolePersonas,before.rolePersonas.map(p=>p.id===a.id?{...p,folderId:''}:p));
 assert.deepEqual(s.roles,before.roles);assert.equal(P.system(s,s.roles[0]).content.includes(a.prompt),true);
 S.apply(s,'personaFolder.save',{name:'空文件夹'});const empty=s.personaFolders.at(-1);
 S.apply(s,'personaFolder.delete',{id:empty.id});assert.deepEqual(s.personaFolders,[kept]);
});
test('新库默认空，旧用户身份和好友原设定保留，绑定共享且彼此隔离',()=>{
 const s=fixture(),r=s.roles[0],other=s.roles[1],old=structuredClone(r);assert.deepEqual(s.rolePersonas,[]);assert.deepEqual(s.personaFolders,[]);
 S.apply(s,'persona.save',{name:'独立用户身份',prompt:'用户身份秘密'});S.apply(s,'role.save',{id:r.id,personaId:s.personas[0].id});
 const a=save(s),b=save(s,'其他','其他人设秘密');S.apply(s,'rolePersona.bind',{id:a.id,changes:[change(r.id),change(other.id)]});
 assert.equal(r.rolePersonaId,a.id);assert.equal(other.rolePersonaId,a.id);assert.equal(r.prompt,old.prompt);assert.equal(a.prompt,'  原文\n第二行  ');
 S.apply(s,'rolePersona.bind',{id:b.id,changes:[change(other.id,a.id)]});const context=P.system(s,r).content;assert.ok(context.includes(a.prompt));assert.ok(!context.includes('用户身份秘密'));assert.ok(!context.includes('独立用户身份'));assert.ok(!context.includes(old.prompt));assert.ok(!context.includes('关系：'));assert.ok(context.includes(s.profile.name));assert.ok(!context.includes('其他人设秘密'));const legacy=Providers.context(s,r)[0].content;assert.ok(legacy.includes(a.prompt));assert.ok(!legacy.includes('用户身份秘密'));assert.ok(!legacy.includes('独立用户身份'));assert.ok(!legacy.includes(old.prompt));assert.ok(!legacy.includes('关系：'));assert.ok(!legacy.includes('其他人设秘密'));
 S.apply(s,'role.save',{id:r.id,remark:'新备注'});assert.equal(r.rolePersonaId,a.id);
 S.apply(s,'rolePersona.delete',{id:a.id});assert.equal(r.rolePersonaId,'');assert.equal(r.prompt,old.prompt);assert.equal(s.personas[0].prompt,'用户身份秘密');assert.ok(P.system(s,r).content.includes(old.prompt));assert.ok(P.system(s,r).content.includes('用户身份秘密'));assert.ok(Providers.context(s,r)[0].content.includes('用户身份秘密'));assert.equal(r.relationship,old.relationship);
});
test('文件夹移动及非法输入不部分更新绑定或人设',()=>{
 const s=fixture(),a=save(s);S.apply(s,'personaFolder.save',{name:'分类'});const f=s.personaFolders[0];S.apply(s,'rolePersona.move',{id:a.id,folderId:f.id});assert.equal(a.folderId,f.id);
 const roleId=s.roles[0].id;
 for(const [action,payload]of [['rolePersona.bind',{id:a.id,changes:[change(roleId),change('不存在')]}],['rolePersona.bind',{id:a.id,changes:[change(roleId),change(roleId)]}],['rolePersona.bind',{id:a.id,changes:[{roleId,selected:true}]}],['rolePersona.bind',{id:a.id,changes:[change(roleId,'',false)]}],['rolePersona.save',{id:a.id,name:'改名',prompt:' '}],['rolePersona.move',{id:a.id,folderId:'不存在'}],['role.save',{id:s.roles[0].id,rolePersonaId:'不存在'}],['role.save',{id:s.roles[0].id,patText:'一'.repeat(101)}],['personaFolder.save',{name:'分类'}]]){const before=structuredClone(s);assert.throws(()=>S.apply(s,action,payload));assert.deepEqual(s,before);}
 S.apply(s,'rolePersona.move',{id:a.id,folderId:''});assert.equal(a.folderId,'');
});
test('绑定只改勾选有变动的好友，同目标重试保留其他好友及原资料',()=>{
 const s=fixture(),a=save(s),[first,second]=s.roles;
 const oldTabSelection={id:a.id,changes:[change(first.id)]};
 S.apply(s,'rolePersona.bind',{id:a.id,changes:[change(second.id)]});
 const original=structuredClone(s);
 S.apply(s,'rolePersona.bind',oldTabSelection);
 S.apply(s,'rolePersona.bind',oldTabSelection);
 assert.deepEqual(s.roles,[{...original.roles[0],rolePersonaId:a.id,personaRevision:1},original.roles[1]]);
 const unbind={id:a.id,changes:[change(first.id,a.id,false)]};
 S.apply(s,'rolePersona.bind',unbind);
 S.apply(s,'rolePersona.bind',unbind);
 assert.deepEqual(s,{...original,roles:[{...original.roles[0],personaRevision:2},original.roles[1]]});
});
test('双端同时修改同一好友时拒绝旧提交，整批和旧版全量请求均不改动',()=>{
 const s=fixture(),a=save(s),b=save(s,'新绑定','其他正文'),[first,second]=s.roles;
 S.apply(s,'rolePersona.bind',{id:a.id,changes:[change(first.id),change(second.id)]});
 const staleRemove={id:a.id,changes:[change(first.id,a.id,false),change(second.id,a.id,false)]};
 S.apply(s,'rolePersona.bind',{id:b.id,changes:[change(second.id,a.id)]});
 const before=structuredClone(s);
 assert.throws(()=>S.apply(s,'rolePersona.bind',staleRemove),{status:409,code:'PERSONA_BINDING_CHANGED',message:/重新打开/});
 assert.throws(()=>S.apply(s,'rolePersona.bind',{id:a.id,roleIds:[first.id]}),{status:409,code:'PERSONA_BINDING_RELOAD',message:/刷新页面/});
 assert.deepEqual(s,before);
});
test('备份完整往返、旧备份缺字段兼容及非法引用拒绝',()=>{
 const s=fixture(),a=save(s);S.apply(s,'personaFolder.save',{name:'分类'});S.apply(s,'rolePersona.move',{id:a.id,folderId:s.personaFolders[0].id});S.apply(s,'role.save',{id:s.roles[0].id,rolePersonaId:a.id,patText:'肩膀'});
 const backup={format:'pipi-phone',version:1,state:S.backupState(s)},restored=S.validateBackup(backup,s);assert.deepEqual(restored.rolePersonas,s.rolePersonas);assert.deepEqual(restored.personaFolders,s.personaFolders);assert.equal(restored.roles[0].rolePersonaId,a.id);assert.equal(restored.roles[0].patText,'肩膀');assert.deepEqual(S.publicState(s).rolePersonas,s.rolePersonas);
 const invalid=structuredClone(backup);invalid.state.roles[0].rolePersonaId='坏引用';assert.throws(()=>S.validateBackup(invalid,s));invalid.state=structuredClone(backup.state);invalid.state.rolePersonas.push({...a});assert.throws(()=>S.validateBackup(invalid,s));
 delete backup.state.rolePersonas;delete backup.state.personaFolders;for(const r of backup.state.roles){delete r.rolePersonaId;delete r.patText;}const old=S.validateBackup(backup,s);assert.deepEqual(old.rolePersonas,[]);assert.equal(old.roles[0].rolePersonaId,'');assert.equal(old.roles[0].patText,'');
});
test('拍一拍显示好友内容，模型和备份保留事件发生时文字',()=>{
 const s=fixture(),r=s.roles[0];S.apply(s,'role.save',{id:r.id,patText:'肩膀'});S.apply(s,'message.pat',{roleId:r.id});const m=s.messages.at(-1);assert.ok(m.content.endsWith('的肩膀'));assert.equal(m.meta.patText,'肩膀');assert.equal(P.render(s,m,false).content,'[系统记录] 用户拍了拍角色的肩膀');
 S.apply(s,'role.save',{id:r.id,patText:'脑袋'});assert.ok(P.render(s,m,false).content.includes('肩膀'));const restored=S.validateBackup({format:'pipi-phone',version:1,state:S.backupState(s)},s);assert.equal(restored.messages.at(-1).meta.patText,'肩膀');assert.equal(restored.messages.at(-1).content,m.content);assert.equal(P.render(restored,restored.messages.at(-1),false).content,'[系统记录] 用户拍了拍角色的肩膀');
});
test('人设上限及正文长度在入口拒绝，正文允许10万字符',()=>{
 const s=fixture();save(s,'长正文','文'.repeat(100000));assert.throws(()=>save(s,'过长','文'.repeat(100001)));assert.throws(()=>save(s,'名'.repeat(81)));for(let i=s.rolePersonas.length;i<100;i++)save(s,'人设'+i);const before=structuredClone(s);assert.throws(()=>save(s,'第101份'));assert.deepEqual(s,before);
});
