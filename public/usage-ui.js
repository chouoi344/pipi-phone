// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const P=()=>window.Pipi,esc=value=>P().esc(value),$=selector=>document.querySelector(selector);
  const ranges=[['all','总用量'],['1','今天'],['7','7天'],['15','15天'],['30','一个月']];
  const purposes={chat:'对话回复',caption:'图片转述',compress:'上下文整理',stt:'语音转文字',voiceUnderstanding:'语音条理解',tts:'语音生成',image:'图片生成',embedding:'嵌入检索',rerank:'重排序',decision:'判断',test:'连接测试',memory:'记忆整理',schedule:'日程生成',autonomy:'自主活动'};
  const glyphs={refresh:'<path d="M20 7v5h-5M4 17v-5h5M6.2 6.2a8 8 0 0 1 13 2L20 12M4 12l.8 3.8a8 8 0 0 0 13 2"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v2"/>',down:'<path d="m5 8 7 7 7-7"/>',search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',success:'<path d="m5 12 4 4 10-10"/>',error:'<path d="m7 7 10 10M17 7 7 17"/>'};
  const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`;
  const fresh=()=>({tab:'usage',range:'all',data:null,logs:null,logTimezone:null,requests:new Map(),errors:new Map(),query:'',status:'all',purpose:'all',expanded:false,focus:null});
  let ui=fresh(),cache=new Map(),epoch=0;
  const activeRange=(page=ui)=>page.tab==='logs'?'all':page.range;
  const busy=()=>ui.requests.has(activeRange());
  const failure=()=>ui.errors.get(activeRange())||'';
  const hasData=()=>ui.tab==='logs'?Boolean(ui.logs):Boolean(ui.data);
  const format=value=>value.toLocaleString('zh-CN');
  const compact=value=>value>=10000?`${(value/10000).toFixed(1)}万`:format(value);
  const purposeLabel=value=>purposes[value]||value||'模型调用';
  const duration=value=>value===null?'耗时未记录':value<1000?`${Math.round(value)} 毫秒`:`${(value/1000).toFixed(1)} 秒`;
  const dateText=(at,timeOnly=false)=>new Intl.DateTimeFormat('zh-CN',{timeZone:ui.logTimezone,...(timeOnly?{}:{month:'2-digit',day:'2-digit'}),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(at);
  const statusMark=success=>`<span class="usage-status-mark ${success?'':'error'}">${icon(success?'success':'error')}</span>`;
  function load(page,range,notify=true){
    if(page.requests.has(range))return page.requests.get(range);
    const session=epoch;
    page.errors.delete(range);
    const request=P().api(`/api/engine/usage?range=${range}`).then(data=>{
      if(session!==epoch||page!==ui)return;
      cache.set(range,data);
      if(page.range===range)page.data=data;
      if(range==='all'){page.logs=data.logs;page.logTimezone=data.timezone;}
    }).catch(error=>{
      if(session!==epoch||page!==ui)return;
      page.errors.set(range,error.message);
      if(notify&&activeRange(page)===range&&$('#usage-page'))P().toast(error.message);
    }).finally(()=>{
      page.requests.delete(range);
      if(session===epoch&&page===ui&&$('#usage-page'))P().refresh();
    });
    page.requests.set(range,request);
    return request;
  }
  function open(){ui={...fresh(),data:cache.get('all')||null,logs:cache.get('all')?.logs||null,logTimezone:cache.get('all')?.timezone||null};P().showView('engine-usage');void reload();}
  function getView(){
    const {tab,range,query,status,purpose,expanded}=ui;
    return {tab,range,query,status,purpose,expanded};
  }
  async function restoreView(view){
    const page=ui={...fresh(),...view,data:cache.get(view?.range||'all')||null,logs:cache.get('all')?.logs||null,logTimezone:cache.get('all')?.timezone||null};
    await load(page,activeRange(page),false);
  }
  function reload(range=ui.range){
    const page=ui;
    if(page.tab==='usage'&&page.range!==range){page.range=range;page.data=cache.get(range)||null;}
    const request=load(page,activeRange(page));
    P().refresh();
    return request;
  }
  function chart(){
    const items=ui.data.trend,max=Math.max(...items.map(x=>x.totalTokens),1),bar=23;
    return `<svg class="usage-chart" viewBox="0 0 332 136" role="img" aria-label="最近一周每日输入和输出用量"><path class="grid-line" d="M12 12h308M12 59h308M12 106h308"/>${items.map((item,index)=>{const x=26+index*43,ih=item.inputTokens/max*84,oh=item.outputTokens/max*84;return `<rect x="${x}" y="${106-ih}" width="${bar}" height="${ih}" fill="#07c160" rx="2"/><rect x="${x}" y="${106-ih-oh}" width="${bar}" height="${oh}" fill="#aadfc0" rx="2"/><text x="${x+bar/2}" y="128" text-anchor="middle">${esc(item.date.slice(5).replace('-','.'))}</text>`;}).join('')}</svg>`;
  }
  function modelRows(models){
    const max=Math.max(...ui.data.models.map(item=>item.totalTokens),1);
    return models.map(item=>`<div class="usage-model-row"><div class="usage-model-top"><span>${esc(item.model||'未记录模型名称')}</span><b>${compact(item.totalTokens)}</b></div><div class="usage-model-meta"><span>${format(item.count)} 次调用</span><span>Token</span></div><meter min="0" max="${max}" value="${item.totalTokens}" aria-label="${esc(item.model)} 用量"></meter></div>`).join('');
  }
  function usageToolbar(){
    return `<div class="usage-toolbar"><button class="usage-period" data-usage-action="period" ${busy()?'disabled':''}>${ranges.find(([value])=>value===ui.range)[1]}${icon('down')}</button><span>${busy()?'正在刷新…':ui.range==='all'?'累计已记录用量':ui.range==='1'?'今天':`最近 ${ui.range} 天`}</span></div>`;
  }
  function usageBody(){
    const {summary:s,models}=ui.data,rangeLabel=ranges.find(([value])=>value===ui.range)[1];
    return `${usageToolbar()}
      <section class="usage-card usage-total-card"><p class="usage-eyebrow">${ui.range==='all'?'总用量':rangeLabel+'用量'}<button data-usage-action="info" aria-label="统计说明">${icon('info')}</button></p><div class="usage-total">${format(s.totalTokens)}<span>Token</span></div><div class="usage-io"><div><span class="usage-metric-label"><i></i>输入</span><p>${format(s.inputTokens)}</p></div><div><span class="usage-metric-label"><i class="output"></i>输出</span><p>${format(s.outputTokens)}</p></div></div><div class="usage-summary"><div>调用次数<b>${format(s.count)}</b></div><div>成功率<b>${s.count?((s.count-s.failures)/s.count*100).toFixed(1)+'%':'—'}</b></div></div></section>
      <section class="usage-card"><div class="usage-card-header"><h3>用量趋势</h3><small>近一周</small></div><div class="usage-legend"><span><i></i>输入</span><span><i class="output"></i>输出</span></div>${chart()}</section>
      <section class="usage-card"><div class="usage-card-header"><h3>模型用量</h3><small>${models.length} 个模型</small></div>${models.length?`<div class="usage-model-rows">${modelRows(models.slice(0,3))}</div>${models.length>3?`<details class="usage-models-more"${ui.expanded?' open':''}><summary>查看全部模型</summary><div class="usage-model-rows">${modelRows(models.slice(3))}</div></details>`:''}`:'<p class="usage-empty">这个时间范围还没有调用记录</p>'}</section>
      <p class="usage-note">${s.estimatedCount?`${format(s.estimatedCount)} 次用量含估算 · `:''}用量不代表实际扣费</p>`;
  }
  function filteredLogs(){
    const query=ui.query.trim().toLowerCase();
    return (ui.logs?.items||[]).map((record,index)=>({record,index})).filter(({record:r})=>(ui.status==='all'||r.success===(ui.status==='success'))&&(ui.purpose==='all'||r.purpose===ui.purpose)&&(!query||`${r.model} ${r.sourceName} ${purposeLabel(r.purpose)} ${r.error||''}`.toLowerCase().includes(query)));
  }
  function logRows(){
    const logs=filteredLogs();
    return logs.length?`<div class="usage-log-list">${logs.map(({record:r,index})=>`<button class="usage-log-row" data-usage-record="${index}">${statusMark(r.success)}<span class="usage-log-copy"><span class="usage-log-title"><b>${esc(purposeLabel(r.purpose))}${r.success?'完成':'失败'}</b><time>${esc(dateText(r.at))}</time></span><span class="usage-log-model">${esc(r.model||'模型未记录')} · ${duration(r.durationMs)}</span>${!r.success?`<span class="usage-log-error">${esc(r.error||'这条历史记录未保存失败原因')}</span>`:''}</span></button>`).join('')}</div>`:`<p class="usage-empty">${ui.logs?.items.length?'没有符合条件的记录':'还没有模型调用记录'}</p>`;
  }
  function logCount(){const count=filteredLogs().length;return `${format(count)} 条记录${ui.logs?.truncated?` · 显示最近 ${ui.logs.limit} 条`:''}`;}
  function logsBody(){return `<label class="usage-search">${icon('search')}<input id="usage-search" type="search" placeholder="搜索模型、用途或错误" aria-label="搜索日志" value="${esc(ui.query)}"></label><div class="usage-filters"><button data-usage-action="status">${{all:'全部状态',success:'成功',error:'失败'}[ui.status]}${icon('down')}</button><button data-usage-action="purpose">${ui.purpose==='all'?'全部用途':esc(purposeLabel(ui.purpose))}${icon('down')}</button></div><div class="usage-log-count"><span id="usage-log-count">${logCount()}</span><span>${busy()?'正在刷新…':'最近 90 天'}</span></div><div id="usage-log-results">${logRows()}</div>`;}
  function render(){
    const search=$('#usage-search');ui.focus=search&&document.activeElement===search?{start:search.selectionStart,end:search.selectionEnd}:null;
    const page=ui;
    if(!hasData()&&!busy()&&!failure())queueMicrotask(()=>{if(page===ui&&$('#usage-page')&&!hasData()&&!busy()&&!failure())void reload();});
    return `<header class="topbar"><div class="header-leading"><button class="back-btn" data-action="back" aria-label="返回">${P().icons.back}</button></div><h2 class="title-centered">用量与日志</h2><div class="header-actions"><button class="icon-btn usage-refresh" data-usage-action="refresh" aria-label="刷新用量与日志" ${busy()?'disabled':''}>${icon('refresh')}</button></div></header><nav class="usage-tabs" aria-label="用量与日志" role="tablist"><button id="usage-summary-tab" role="tab" aria-controls="usage-page" aria-selected="${ui.tab==='usage'}" data-usage-tab="usage">用量</button><button id="usage-log-tab" role="tab" aria-controls="usage-page" aria-selected="${ui.tab==='logs'}" data-usage-tab="logs">日志</button></nav><div class="content page-content usage-content" id="usage-page" role="tabpanel" aria-labelledby="${ui.tab==='usage'?'usage-summary-tab':'usage-log-tab'}">${hasData()&&failure()?`<p class="usage-empty" role="alert">更新失败：${esc(failure())}，当前显示上次成功结果。</p>`:''}${hasData()?(ui.tab==='usage'?usageBody():logsBody()):`${ui.tab==='usage'?usageToolbar():''}<p class="usage-empty">${esc(failure()||(ui.tab==='logs'?'正在读取日志…':'正在读取用量…'))}</p>`}</div>`;
  }
  function sheet(title,html){
    P().openModal(title,html,null);
    const dialog=$('#overlay > .page-editor');dialog.classList.add('usage-sheet');
    const close=dialog.querySelector('.modal-close');
    if(close){close.textContent='×';close.setAttribute('aria-label','关闭');}
  }
  function info(){sheet('统计说明',`<div class="usage-info"><p>Token 是模型处理输入、生成回复时使用的计量单位，这里的用量不代表账单金额。</p><p>总用量从已有记录累计，之后持续累加。旧版已经清理的历史记录无法补回。</p><p>今天、7天、15天和一个月分别统计对应范围；一个月按近30天计算。趋势固定显示最近7天，按设置中的时区划分。</p><p>服务商未返回用量时沿用程序的估算，并单独标注。详细调用记录保留90天；较早的日志清理不会减少累计总用量。</p></div>`);}
  function showRecord(index){
    const r=ui.logs.items[index],rows=[['时间',dateText(r.at)],['用途',purposeLabel(r.purpose)],['服务商',r.sourceName||'未记录'],['模型',r.model||'未记录'],['耗时',duration(r.durationMs)],['输入 / 输出',`${format(r.inputTokens)} / ${format(r.outputTokens)} Token${r.estimated?'（含估算）':''}`]];
    sheet('调用详情',`<div class="usage-detail-status">${statusMark(r.success)}${esc(purposeLabel(r.purpose))}${r.success?'完成':'失败'}</div><div class="usage-detail-card">${rows.map(([label,value])=>`<div class="usage-detail-row"><span>${label}</span><span>${esc(value)}</span></div>`).join('')}</div>${r.success?'':`<div class="usage-detail-error"><b>失败原因</b>${esc(r.error||'这条历史记录未保存失败原因')}</div>`}`);
  }
  function bindRecords(){document.querySelectorAll('[data-usage-record]').forEach(button=>button.onclick=()=>showRecord(Number(button.dataset.usageRecord)));}
  function updateLogs(){
    const pane=$('#usage-page'),top=pane.scrollTop;
    $('#usage-log-results').innerHTML=logRows();$('#usage-log-count').textContent=logCount();bindRecords();pane.scrollTop=top;
  }
  function pickStatus(){P().actionSheet('记录状态',[['all','全部状态'],['success','成功'],['error','失败']].map(([value,label])=>({label,icon:value===ui.status?P().icons.check:'',run:()=>{ui.status=value;P().refresh();}})));}
  function pickPurpose(){P().actionSheet('调用用途',[['all','全部用途'],...[...new Set(ui.logs.items.map(r=>r.purpose))].map(value=>[value,purposeLabel(value)])].map(([value,label])=>({label,icon:value===ui.purpose?P().icons.check:'',run:()=>{ui.purpose=value;P().refresh();}})));}
  function bind(){
    document.querySelectorAll('[data-usage-tab]').forEach(button=>button.onclick=()=>{if(ui.tab===button.dataset.usageTab)return;ui.tab=button.dataset.usageTab;if(!hasData()&&!failure())void load(ui,activeRange());P().refresh({resetScroll:true});});
    document.querySelectorAll('[data-usage-action]').forEach(button=>button.onclick=()=>{
      if(button.dataset.usageAction==='refresh')void reload();
      if(button.dataset.usageAction==='info')info();
      if(button.dataset.usageAction==='period')P().actionSheet('统计时间',ranges.map(([value,label])=>({label:value==='30'?label+'（近30天）':label,icon:value===ui.range?P().icons.check:'',run:()=>reload(value)})));
      if(button.dataset.usageAction==='status')pickStatus();
      if(button.dataset.usageAction==='purpose')pickPurpose();
    });
    const details=$('.usage-models-more');if(details)details.ontoggle=()=>{ui.expanded=details.open;};
    const search=$('#usage-search');if(search){search.oninput=()=>{ui.query=search.value;updateLogs();};if(ui.focus){search.focus({preventScroll:true});search.setSelectionRange(ui.focus.start,ui.focus.end);ui.focus=null;}}
    bindRecords();
  }
  window.PipiUsage={open,render,bind,getView,restoreView,reset:()=>{epoch++;cache.clear();ui=fresh();}};
})();
