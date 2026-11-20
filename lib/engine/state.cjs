// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const S=require('../state.cjs'),M=require('./models.cjs'),R=require('./registry.cjs'),T=require('./time.cjs'),J=require('./scheduler.cjs');
function timestamp(value){return S.integer(value,0,8640000000000000);}
function json(value,depth=0){
  if(depth>50)S.fail('模块数据层级过深');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(x=>json(x,depth+1));
  if(!S.obj(value))S.fail('模块数据必须为 JSON');
  const output={};
  for(const [key,item]of Object.entries(value)){
    if(['__proto__','constructor','prototype'].includes(key))S.fail('模块数据字段无效');
    output[key]=json(item,depth+1);
  }
  return output;
}
function restore(s,a,current,validId){
  s.settings.timezone=a.settings.timezone===undefined||a.settings.timezone===''?'':T.validateTimezone(a.settings.timezone);
  s.settings.modules={};
  if(a.settings.modules!==undefined){
    if(!S.obj(a.settings.modules))S.fail('功能参数备份格式错误');
    for(const [id,values]of Object.entries(a.settings.modules))s.settings.modules[id]=R.validate(id,values,{},true);
  }
  if(a.settings.ai!==undefined){
    if(!S.obj(a.settings.ai)||!Array.isArray(a.settings.ai.sources))S.fail('模型备份格式错误');
    const input=structuredClone(a.settings.ai),previous={settings:structuredClone(current.settings)};
    const builtins=M.sanitize(M.migrate(previous)).sources.filter(source=>source.builtin);
    input.sources=input.sources.map(source=>{
      if(!S.obj(source))S.fail('服务商备份格式错误');
      const {key,clearKey,keySet,...out}=source;
      const builtin=builtins.find(item=>item.id===source.id);
      return builtin?{...out,...builtin}:out;
    });
    s.settings.ai=previous.settings.ai;
    M.save(s,input);
  }else{delete s.settings.ai;M.migrate(s);}
  for(let i=0;i<s.roles.length;i++){
    const selected=S.text(a.roles[i].modelId,100);
    s.roles[i].modelId=selected;
  }
  const input=a.engine;
  if(input!==undefined&&!S.obj(input))S.fail('角色引擎备份格式错误');
  s.engine={summaries:{},jobs:[],data:{},usage:[]};
  R.ensure(s);
  if(input?.summaries!==undefined){
    if(!S.obj(input.summaries))S.fail('长对话记录备份格式错误');
    for(const [roleId,summary]of Object.entries(input.summaries)){
      S.role(s,roleId);
      if(!S.obj(summary))S.fail('长对话记录格式错误');
      if(typeof summary.text!=='string')S.fail('长对话记录文字无效');
      const item={text:S.text(summary.text,60000),coveredUntil:timestamp(summary.coveredUntil),updatedAt:timestamp(summary.updatedAt)};
      if(summary.coveredMessageId!==undefined){
        const key=S.text(summary.coveredMessageId,100),message=s.messages.find(m=>m.id===key);
        if(message&&message.roleId!==roleId)S.fail('长对话记录不能引用其他会话的消息');
        if(message)item.coveredMessageId=key;
      }
      s.engine.summaries[roleId]=item;
    }
  }
  if(input?.data!==undefined){
    if(!S.obj(input.data))S.fail('模块数据备份格式错误');
    const namespaces=new Set([...R.modules,...R.retiredModules].map(module=>module.data).concat('execution'));
    for(const [namespace,data]of Object.entries(input.data)){
      if(!namespaces.has(namespace)||!S.obj(data))S.fail('模块数据命名空间无效');
      s.engine.data[namespace]=json(data);
    }
    const media=s.engine.data.actions.roleMedia;
    if(media!==undefined){
      if(!Array.isArray(media))S.fail('角色图片媒体备份无效');
      const seen=new Set();
      for(const item of media){if(!S.obj(item)||seen.has(item.id))S.fail('角色图片媒体备份无效');seen.add(validId(item.id));S.role(s,item.roleId);S.image(item.image,false);timestamp(item.createdAt);if(item.prompt!==undefined)S.text(item.prompt,8000);}
    }
    if(input.data.autonomy){
      const Aut=require('./autonomy.cjs');Aut.ensure(s);Aut.validateRestore(s.engine.data.autonomy);
      for(const name of ['profiles','plans','attempts'])for(const roleId of Object.keys(s.engine.data.autonomy[name]))S.role(s,roleId);
      for(const row of s.engine.data.autonomy.history)S.role(s,row.roleId);
    }
    if(input.data.execution)require('./execution.cjs').validateRestore(s);
    if(input.data.execution)require('./tool-history.cjs').validate(s);
    if(input.data.schedule)require('./modules/schedule.cjs').validateRestore(s);
  }
  if(input?.jobs!==undefined){
    if(!Array.isArray(input.jobs)||!input.jobs.every(S.obj))S.fail('提醒备份格式错误');
    const settings=R.values(s,'scheduler');
    for(const raw of input.jobs){
      S.role(s,raw.roleId);
      if(typeof raw.userRequested!=='boolean')S.fail('提醒来源标记无效');
      const item={id:validId(raw.id),roleId:raw.roleId,note:S.text(raw.note,4000).trim(),userRequested:S.bool(raw.userRequested),schedule:J.schedule(raw.schedule,settings),nextAt:timestamp(raw.nextAt),status:S.enumOf(raw.status,['pending','running','completed','failed','expired','cancelled']),createdAt:timestamp(raw.createdAt)};
      if(!item.note)S.fail('提醒内容不能为空');
      for(const key of ['updatedAt','lastRunAt','completedAt','deferredUntil','lastFinishedAt'])if(raw[key]!==undefined)item[key]=timestamp(raw[key]);
      if(raw.lastStatus!==undefined)item.lastStatus=S.enumOf(raw.lastStatus,['completed','failed','expired']);
      if(raw.deferredByGlobalQuiet!==undefined)item.deferredByGlobalQuiet=S.bool(raw.deferredByGlobalQuiet);
      if(raw.lastError!==undefined)item.lastError=S.text(raw.lastError,1000);
      s.engine.jobs.push(item);
    }
    for(const role of s.roles)if(J.list(s,role.id).length>settings.maxJobs)S.fail('好友未完成提醒超过数量上限');
  }
  J.recover(s);
  if(input?.usage!==undefined){
    if(!Array.isArray(input.usage)||!input.usage.every(S.obj))S.fail('模型用量备份格式错误');
    for(const raw of input.usage){
      if(typeof raw.estimated!=='boolean'||typeof raw.success!=='boolean')S.fail('模型用量标记无效');
      const item={at:timestamp(raw.at),modelId:S.text(raw.modelId,100),model:S.text(raw.model,200),purpose:S.text(raw.purpose,100),inputTokens:S.integer(raw.inputTokens,0,Number.MAX_SAFE_INTEGER),outputTokens:S.integer(raw.outputTokens,0,Number.MAX_SAFE_INTEGER),estimated:S.bool(raw.estimated),success:S.bool(raw.success)};
      if(raw.inputEstimated!==undefined)item.inputEstimated=S.bool(raw.inputEstimated);
      if(raw.durationMs!==undefined&&raw.durationMs!==null)item.durationMs=S.integer(raw.durationMs,0,Number.MAX_SAFE_INTEGER);
      if(raw.sourceName!==undefined)item.sourceName=S.text(raw.sourceName,100);
      if(raw.error!==undefined&&raw.error!==null)item.error=require('./usage.cjs').displayError(S.text(raw.error,200));
      if(item.at>=Date.now()-90*86400000)s.engine.usage.push(item);
    }
  }
  if(input?.usageTotals!==undefined){
    const raw=input.usageTotals;
    if(!S.obj(raw)||!S.obj(raw.summary)||!Array.isArray(raw.models)||!raw.models.every(S.obj))S.fail('累计用量备份格式错误');
    const aggregate=value=>Object.fromEntries(Object.keys(require('./usage.cjs').empty()).map(key=>[key,S.integer(value[key],0,Number.MAX_SAFE_INTEGER)]));
    s.engine.usageTotals={summary:aggregate(raw.summary),models:raw.models.map(row=>({modelId:S.text(row.modelId,100),model:S.text(row.model,200),...aggregate(row)})),source:'retained-records-baseline',since:raw.since===null?null:timestamp(raw.since)};
  }else require('./usage.cjs').ensure(s);
  if(a.wallet.initializedRoles!==undefined||a.wallet.credits!==undefined){
    if(!S.obj(a.wallet.initializedRoles)||!Array.isArray(a.wallet.credits)||!a.wallet.credits.every(S.obj))S.fail('好友零钱初始化记录格式错误');
    for(const [roleId,value]of Object.entries(a.wallet.initializedRoles)){
      S.role(s,roleId);if(value!==true)S.fail('好友零钱初始化标记无效');s.wallet.initializedRoles[roleId]=true;
    }
    for(const credit of a.wallet.credits){
      S.role(s,credit.roleId);
      s.wallet.credits.push({id:validId(credit.id),roleId:credit.roleId,amountCents:S.integer(credit.amountCents,0,Number.MAX_SAFE_INTEGER),source:S.text(credit.source,100),createdAt:timestamp(credit.createdAt)});
    }
  }
  for(const message of s.messages)if(message.meta?.transactionId){
    const transaction=s.wallet.transactions.find(t=>t.id===message.meta.transactionId);
    if(!transaction||transaction.roleId!==message.roleId||transaction.type!==message.type||transaction.amountCents!==message.meta.amountCents||(transaction.stickerImage||'')!==(message.meta.stickerImage||''))S.fail('红包或转账消息与交易不一致');
  }
  return s;
}
module.exports={restore};
