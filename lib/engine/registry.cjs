// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {setImmediate:yieldToIO}=require('node:timers/promises');
const modules=['waiting','schedule','voice','selfie','outreach','life-moments','memory','segments','actions','compression','caption','scheduler'].map(name=>require('./modules/'+name+'.cjs'));
// Keep retired schemas for old backups only; their settings never register jobs or pages.
const retiredModules=['proactive','time-gaps','autonomy'].map(name=>require('./modules/'+name+'.cjs'));
const error=message=>{throw Object.assign(new Error(message),{status:400,code:'VALIDATION'});};
function get(id){const m=modules.find(m=>m.id===id);if(!m)error('功能不存在');return m;}
function list(){return modules.map(({id,name,description,settings,page,isolated})=>({id,name,description,settings:settings.filter(field=>!field.roleOnly),page,isolated:Boolean(isolated)}));}
function isEnabled(state,id){
  const m=modules.find(x=>x.id===id);if(!m)return false;
  const toggle=m.settings?.find(p=>p.key==='enabled'&&!p.roleOnly);if(!toggle)return true;
  const saved=state?.settings?.modules?.[id]?.enabled;
  return typeof saved==='boolean'?saved:toggle.default!==false;
}
function normalizeSegments(result,saved){
  if(saved&&!Object.hasOwn(saved,'splitMode')){
    // Earlier clients persisted these defaults whenever any option was saved.
    if(saved.intervalMode==='length'&&(saved.logBase??2.6)===2.6)result.intervalMode='random';
    if(saved.cleanupPattern==='。$')result.cleanupPattern='';
  }
  delete result.maxSegments;
  delete result.lengthJitterSeconds;
}
function values(state,id){
  const defaults=Object.fromEntries(get(id).settings.map(p=>[p.key,p.default]));
  const saved=state.settings.modules?.[id],result={...defaults,...saved};
  if(id==='voice'&&state.settings.modules?.actions?.allowVoice===false)result.enabled=false;
  if(id==='waiting'){
    // Keep the previously effective legacy rhythm; raw backups retain their original values.
    if(saved?.maxWaitSeconds===30){
      if(saved.idleSeconds===1.5)result.idleSeconds=1;
      if(saved.incompleteWaitSeconds===12)result.incompleteWaitSeconds=3;
    }
    result.maxWaitSeconds=Math.min(result.maxWaitSeconds,8);
    result.idleSeconds=Math.min(result.idleSeconds,result.maxWaitSeconds);
  }
  if(id==='segments')normalizeSegments(result,saved);
  if(id==='selfie'&&result.stylePrompt===require('./photo-core.cjs').LEGACY_SELFIE_STYLE)result.stylePrompt=defaults.stylePrompt;
  return result;
}
function validate(id,input,old={},forBackup=false){
  if(!input||typeof input!=='object'||Array.isArray(input))error('功能参数须为对象');
  const m=forBackup?[...modules,...retiredModules].find(m=>m.id===id):get(id);
  if(!m)error('功能不存在');
  // Keep old backups readable after moving the timeout to the judgment model.
  const oldWaiting=forBackup&&id==='waiting';
  let settings=oldWaiting?m.settings.map(setting=>{
    if(setting.key==='maxWaitSeconds')return {...setting,max:300};
    if(setting.key==='idleSeconds')return {...setting,max:60};
    return setting;
  }):m.settings;
  if(oldWaiting&&Object.hasOwn(input,'decisionTimeoutSeconds'))settings.push({key:'decisionTimeoutSeconds',label:'旧云端判断超时时间（秒）',type:'number',min:1,max:30});
  if(forBackup&&id==='segments'){
    const retired=[
      {key:'maxSegments',label:'旧分段条数上限',type:'number',min:1,max:30,integer:true},
      {key:'lengthJitterSeconds',label:'旧字数间隔增量',type:'number',min:0,max:10}
    ].filter(p=>Object.hasOwn(input,p.key));
    settings=[...settings,...retired];
  }
  if(forBackup&&m.legacySettings)settings=[...settings,...m.legacySettings.filter(p=>Object.hasOwn(input,p.key))];
  const known=new Map(settings.map(p=>[p.key,p]));
  if(Object.keys(input).some(key=>!known.has(key)))error('包含未知的功能参数');
  const result={...Object.fromEntries(m.settings.map(p=>[p.key,p.default])),...old,...input};
  for(const p of settings){
    const value=result[p.key];
    if(p.type==='boolean'&&typeof value!=='boolean')error(p.label+'须为开关值');
    if(p.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||p.integer&&!Number.isSafeInteger(value)||value<p.min||value>p.max))error(p.label+'超出允许范围');
    if(['text','textarea'].includes(p.type)&&(typeof value!=='string'||value.length>p.maxLength))error(p.label+'格式或长度无效');
    if(p.type==='select'&&!p.options.some(option=>(typeof option==='string'?option:option.value)===value))error(p.label+'选项无效');
    if(p.regex&&value){try{new RegExp(value,'gu');}catch{error(p.label+'的正则表达式无效');}}
  }
  if(id==='compression'&&result.maxTurns===0)error('最多保留轮数须为 -1 或正整数');
  if(id==='segments'&&result.minSeconds>result.maxSeconds)error('最短间隔不能大于最长间隔');
  if(forBackup&&id==='segments')normalizeSegments(result,input);
  if(id==='schedule'){
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.boundary))error('每日换日时间须为 HH:mm');
    // Optional global overrides are distinct from the inherited defaults in old plans and backups.
    for(const key of m.globalSettingKeys)if(!Object.hasOwn(input,key)&&!Object.hasOwn(old,key))delete result[key];
  }
  if(id==='waiting'&&result.idleSeconds>(oldWaiting?input.maxWaitSeconds??30:result.maxWaitSeconds))error('停止打字等待不能超过等待上限');
  if(id==='outreach'){
    if(!forBackup&&result.minIdleMinutes>result.maxIdleMinutes)error('最长联系间隔不能小于最短间隔');
    for(const key of ['quietStart','quietEnd'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(result[key]))error('免打扰时间格式须为 HH:mm');
  }
  return result;
}
function apply(state,id,input,now=Date.now()){
  state.settings.modules??={};
  const stored=state.settings.modules;
  const result=validate(id,input,['waiting','segments'].includes(id)?values(state,id):stored[id]);
  if(id==='voice'&&Object.hasOwn(input,'enabled')){
    if(result.enabled&&!get('voice').availability(state).modelReady)error('请先在模型设置中添加并选择语音合成模型');
    // The first save on the restored voice page replaces the older tool switch.
    if(stored.actions)delete stored.actions.allowVoice;
  }
  if(id==='outreach')get(id).saveGlobalSettings(state,result,now);
  else{
    if(id==='memory'&&((isEnabled(state,id)&&!result.enabled)||(values(state,id).autoExtract&&!result.autoExtract))){
      state.engine??={};state.engine.data??={};
      const data=state.engine.data.memory??={};data.settingsRevision=(data.settingsRevision||0)+1;
      if(isEnabled(state,id)&&!result.enabled)data.readRevision=(data.readRevision||0)+1;
    }
    stored[id]=result;
  }
  return result;
}
function defaults(state){
  state.settings.modules??={};
  state.engine??={};state.engine.summaries??={};state.engine.jobs??=[];state.engine.data??={};
  for(const m of modules)state.engine.data[m.data]??={};
  require('./execution.cjs').data(state);
  return state;
}
function recordFault(ctx,m,err){
  try{
    ctx.mutate?.(s=>{s.engine.data[m.data]??={};s.engine.data[m.data].lastError={message:String(err?.message||err).slice(0,500),at:Date.now()};});
  }catch{}
}
async function hooks(name,ctx){
  for(const m of modules){
    if(!m.hooks?.[name])continue;
    if(ctx.getState&&!isEnabled(ctx.getState(),m.id))continue;
    if(m.isolated){
      try{await m.hooks[name](ctx);}
      catch(err){if(err?.name==='AbortError'||ctx.signal?.aborted)throw err;recordFault(ctx,m,err);}
    }else await m.hooks[name](ctx);
  }
}
function tools(state,role,config){
  return modules.filter(m=>isEnabled(state,m.id)).flatMap(m=>m.tools.flatMap(group=>group.definitions?group.definitions(state,role,config):[group]));
}
async function executeTool(name,args,ctx){
  const state=ctx.getState(),role=state.roles.find(r=>r.id===ctx.roleId);
  for(const m of modules){
    if(!isEnabled(state,m.id))continue;
    for(const group of m.tools){
      const defs=group.definitions?group.definitions(state,role):[group];
      if(defs.some(t=>t.function.name===name))return group.execute(name,args,ctx);
    }
  }
  error('这个角色动作当前不可用');
}
async function runJobs(ctx,{skip}={}){
  for(const m of modules){
    if(m.id===skip||!m.jobs.length)continue;
    // Let pending HTTP requests and response writes progress between jobs.
    await yieldToIO();
    if(ctx.getState&&!isEnabled(ctx.getState(),m.id))continue;
    for(const job of m.jobs){
      if(m.isolated){
        try{await job.run(ctx);}
        catch(err){recordFault(ctx,m,err);}
      }else await job.run(ctx);
    }
  }
}
function removeRole(state,roleId){for(const m of modules)m.removeRole?.(state,roleId);}
module.exports={modules,retiredModules,list,get,isEnabled,values,validate,apply,defaults,ensure:defaults,hooks,tools,executeTool,runJobs,removeRole};
