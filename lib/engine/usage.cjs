// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const T=require('./time.cjs');
const toolEchoNotice='模型把工具调用写成了文字，请确认模型或中转服务支持工具调用。';
const empty=()=>({count:0,inputTokens:0,outputTokens:0,totalTokens:0,failures:0,estimatedCount:0});
function add(total,row){total.count++;total.inputTokens+=row.inputTokens||0;total.outputTokens+=row.outputTokens||0;total.totalTokens=total.inputTokens+total.outputTokens;if(!row.success)total.failures++;if(row.estimated)total.estimatedCount++;}
function addModel(models,row){const key=row.modelId||row.model||'';let item=models.find(x=>x.modelId===key);if(!item){item={modelId:key,model:row.model||'',...empty()};models.push(item);}add(item,row);}
function ensure(state){
  if(!state.engine.usageTotals){
    const rows=state.engine.usage||[],summary=empty(),models=[];
    for(const row of rows){add(summary,row);addModel(models,row);}
    state.engine.usageTotals={summary,models,source:'retained-records-baseline',since:rows.length?rows.reduce((earliest,row)=>Math.min(earliest,row.at),Infinity):null};
  }
  return state.engine.usageTotals;
}
function record(state,row,now=Date.now()){
  const totals=ensure(state);add(totals.summary,row);addModel(totals.models,row);totals.since??=row.at;
  state.engine.usage??=[];state.engine.usage.push(row);state.engine.usage=state.engine.usage.filter(x=>x.at>=now-90*86400000);
}
const errorLabel=/^(?:网络连接失败|请求超时|模型返回为空|模型返回格式无效|模型配置不完整|模型协议不支持|音频格式不支持|音频超出限制|请求已取消|模型服务请求失败|模型调用失败|模型服务拒绝过大请求)(?:（HTTP [0-9]{3}）)?/;
function cleanDetail(value,secret){
  if(typeof value!=='string')return '';
  if(secret)value=value.replaceAll(secret,'[已隐藏]');
  return Array.from(value
    .replace(/\b(?:authorization|x-api-key|api[_ -]?key|access[_ -]?token|password|secret)\b["']?\s*[:=]\s*(?:["'][^"']*["']|(?:Bearer\s+)?[^\s,;]+)/gi,'[已隐藏]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,'[已隐藏]')
    .replace(/\b(?:sk-|xai-|hf_|gsk_|AIza|AKIA|ghp_|github_pat_)[A-Za-z0-9_-]+/g,'[已隐藏]')
    .replace(/\b[A-Za-z0-9._~+/=-]{24,}\b/g,'[已隐藏]')
    .replace(/[\s\u0000-\u001f\u007f]+/g,' ').trim()).slice(0,120).join('');
}
function safeError(error,secret){
  if(!error)return '';
  if(error.code==='PROVIDER_REQUEST_TOO_LARGE')return '模型服务拒绝过大请求（HTTP 413） · 本次 '+require('../request-budget.cjs').sizeLabel(error.requestBytes);
  const names={PROVIDER_NETWORK:'网络连接失败',PROVIDER_TIMEOUT:'请求超时',PROVIDER_EMPTY:'模型返回为空',PROVIDER_RESPONSE:'模型返回格式无效',PROVIDER_UNCONFIGURED:'模型配置不完整',PROVIDER_PROTOCOL_UNSUPPORTED:'模型协议不支持',PROVIDER_AUDIO_FORMAT:'音频格式不支持',PROVIDER_AUDIO_LIMIT:'音频超出限制'};
  const status=Number.isInteger(error.upstreamStatus)?error.upstreamStatus:null;
  const label=error.name==='AbortError'?'请求已取消':names[error.code]||(status?'模型服务请求失败':'模型调用失败');
  const base=label+(status?'（HTTP '+status+'）':'');
  if(!status||typeof error.rawBody!=='string')return base;
  let upstream;
  try{upstream=JSON.parse(error.rawBody);}catch{return base;}
  const rawDetail=upstream?.error?.message||(typeof upstream?.error==='string'?upstream.error:'')||upstream?.message||upstream?.detail||upstream?.base_resp?.status_msg;
  const detail=cleanDetail(rawDetail,secret);
  return detail?base+' · '+detail:base;
}
function displayError(value){
  if(typeof value!=='string')return null;
  const base=errorLabel.exec(value)?.[0];
  if(!base)return null;
  const suffix=value.slice(base.length);
  if(!suffix)return base;
  if(!suffix.startsWith(' · '))return null;
  const detail=cleanDetail(suffix.slice(3));
  return detail?base+' · '+detail:base;
}
function report(state,{range='all',now=Date.now()}={}){
  if(!['all','1','7','15','30'].includes(range))throw Object.assign(new Error('用量时间范围无效'),{status:400,code:'VALIDATION'});
  const timezone=state.settings.timezone||'UTC',today=T.dayKey(now,timezone),start=range==='all'?'':T.addDays(today,1-Number(range));
  const rows=(state.engine.usage||[]).filter(x=>{const day=T.dayKey(x.at,timezone);return x.at>=now-90*86400000&&day<=today&&(!start||day>=start);});
  const totals=ensure(state),summary=range==='all'?{...totals.summary}:empty(),models=range==='all'?structuredClone(totals.models):[];
  if(range!=='all')for(const row of rows){add(summary,row);addModel(models,row);}
  const trend=Array.from({length:7},(_,i)=>({date:T.addDays(today,i-6),...empty()}));
  for(const row of state.engine.usage||[]){const item=trend.find(x=>x.date===T.dayKey(row.at,timezone));if(item)add(item,row);}
  const sources=state.settings.ai?.sources||[],configured=state.settings.ai?.models||[];
  const items=rows.slice().sort((a,b)=>b.at-a.at).slice(0,500).map(row=>({at:row.at,sourceName:row.sourceName||sources.find(x=>x.id===configured.find(m=>m.id===row.modelId)?.sourceId)?.name||'',purpose:row.purpose,model:row.model||'',inputTokens:row.inputTokens||0,outputTokens:row.outputTokens||0,estimated:Boolean(row.estimated),success:Boolean(row.success),durationMs:Number.isFinite(row.durationMs)?row.durationMs:null,error:row.error===toolEchoNotice?toolEchoNotice:row.success?'':displayError(row.error)}));
  return {range,timezone,summary,models:models.sort((a,b)=>b.totalTokens-a.totalTokens),trend,logs:{items,total:rows.length,truncated:rows.length>500,limit:500},totalMeta:{source:totals.source,since:totals.since,note:'总用量从现存记录建立累计；此前已清理的记录无法恢复。明细仅保留近90天。'}};
}
module.exports={toolEchoNotice,empty,ensure,record,report,safeError,displayError};
