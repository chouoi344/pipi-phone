// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const P=()=>window.Pipi;
  const esc=value=>P().esc(value);
  const entries=new Map();
  const newOverview=()=>({friends:null,revision:-1,loading:false,error:'',page:0,returnPosition:null});
  let overview=newOverview();
  const pageSize=10;
  const weekdays=['周日','周一','周二','周三','周四','周五','周六'];
  const scheduleTypes={once:'仅一次',daily:'每天',weekly:'每周',interval:'固定间隔'};
  const statuses={pending:'待发送',running:'发送中',completed:'已发送',failed:'发送失败',expired:'已过期',cancelled:'已取消'};
  const isUpcoming=job=>job.status==='pending'||job.status==='running';
  const dueTime=job=>job.deferredUntil||job.nextAt;
  const finishedTime=job=>job.lastFinishedAt||job.completedAt||job.lastRunAt;
  const timezone=()=>P().getState().settings.timezone||'UTC';

  function localParts(at){
    return Object.fromEntries(new Intl.DateTimeFormat('zh-CN',{timeZone:timezone(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(part=>[part.type,part.value]));
  }

  function displayTime(at){
    const {year,month,day,hour,minute}=localParts(at);
    return `${year}/${month}/${day} ${hour}:${minute}`;
  }

  function overviewRows(){
    if(overview.error)return `<div class="reminder-load-error" role="alert"><p>读取提醒总览失败。${esc(overview.error)}</p><button type="button" data-reminder-overview-retry>重新读取</button></div>`;
    if(!overview.friends)return '<p class="reminder-empty">正在读取提醒总览…</p>';
    if(!overview.friends.length)return '<p class="reminder-empty">暂无好友设置提醒</p>';
    const count=Math.ceil(overview.friends.length/pageSize);
    overview.page=Math.min(overview.page,count-1);
    const start=overview.page*pageSize;
    const rows=overview.friends.slice(start,start+pageSize).map(({roleId,name,pendingCount,totalCount,next})=>
      `<button type="button" class="cell plain-cell reminder-overview-row" data-reminder-overview-role="${esc(roleId)}">
        <span class="cell-body"><span class="cell-title">${esc(name)}</span>
          <span class="cell-desc">${next?esc(next.note):'暂无待发送'}</span>
          ${next?`<span class="cell-desc">下次 ${esc(displayTime(next.at))}</span>`:''}</span>
        <span class="cell-value">${pendingCount?`${pendingCount} 条待发`:`${totalCount} 条记录`}</span>${P().icons.chevron}
      </button>`).join('');
    const nav=count>1?`<nav class="model-pagination" aria-label="提醒总览分页"><button type="button" data-reminder-overview-step="-1" ${overview.page===0?'disabled':''}>上页</button><span>${overview.page+1} / ${count} 页</span><button type="button" data-reminder-overview-step="1" ${overview.page===count-1?'disabled':''}>下页</button></nav>`:'';
    return rows+nav;
  }

  function renderOverview(){
    return `<h2 class="section-title reminder-section-title">提醒总览</h2><section class="section reminder-group" aria-label="提醒总览" data-reminder-overview>${overviewRows()}</section>`;
  }

  async function loadOverview(){
    const view=overview;
    if(view.loading)return;
    view.loading=true;
    view.revision=P().getState().revision;
    view.error='';
    try{
      const result=await P().api('/api/engine/jobs/overview');
      view.friends=result.friends;
    }catch(error){
      view.error=error.message;
    }finally{
      view.loading=false;
      const region=document.querySelector('#view [data-reminder-overview]');
      if(view===overview&&region){
        // Replace just the list so a late response never resets the settings form.
        region.innerHTML=overviewRows();
        if(view.revision!==P().getState().revision)loadOverview();
      }
    }
  }

  function bindOverview(){
    const region=document.querySelector('#view [data-reminder-overview]');
    const content=region.closest('.content');
    const form=content.querySelector('#engine-module-form');
    const advanced=form.querySelector('details.engine-details');
    if(overview.returnPosition){
      const {top,expanded,fields}=overview.returnPosition;
      overview.returnPosition=null;
      for(const [name,value] of fields)form.elements.namedItem(name).value=value;
      if(advanced)advanced.open=expanded;
      content.scrollTop=top;
    }
    region.onclick=({target})=>{
      const role=target.closest('[data-reminder-overview-role]');
      if(role){
        overview.returnPosition={top:content.scrollTop,expanded:advanced?.open,fields:[...new FormData(form)]};
        P().showView('role-reminders',role.dataset.reminderOverviewRole);
        return;
      }
      const step=target.closest('[data-reminder-overview-step]');
      if(step){
        overview.page+=Number(step.dataset.reminderOverviewStep);
        region.innerHTML=overviewRows();
      }
      if(target.closest('[data-reminder-overview-retry]'))loadOverview();
    };
    if(overview.revision!==P().getState().revision)loadOverview();
  }

  function scheduleLabel(plan){
    if(plan.type==='weekly')return `每周 ${plan.weekdays.map(day=>weekdays[day].slice(1)).join('、')}`;
    if(plan.type==='interval')return `每 ${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(plan.intervalMs/3600000)} 小时`;
    return scheduleTypes[plan.type];
  }

  function entry(roleId){
    if(!entries.has(roleId))entries.set(roleId,{jobs:null,revision:-1,loading:false,error:'',pages:{upcoming:0,history:0}});
    return entries.get(roleId);
  }

  async function load(roleId,view){
    view.loading=true;
    view.revision=P().getState().revision;
    view.error='';
    try{
      const result=await P().api(`/api/engine/jobs?roleId=${encodeURIComponent(roleId)}&includeHistory=1`);
      view.jobs=result.jobs;
      view.revision=result.revision??view.revision;
    }catch(error){
      view.error=error.message;
    }finally{
      view.loading=false;
      if(entries.get(roleId)===view&&document.querySelector('[data-reminder-role]')?.dataset.reminderRole===roleId)P().refresh();
    }
  }

  function renderJob(job){
    const postponed=job.status==='pending'&&job.deferredUntil;
    let timing=finishedTime(job);
    let timeLabel='';
    if(job.status==='pending'){timing=dueTime(job);timeLabel=postponed?'延至':'下次';}
    if(job.status==='running'){timing=job.lastRunAt||job.nextAt;timeLabel='开始于';}
    if(job.status==='completed')timeLabel='发送于';
    if(job.status==='failed')timeLabel='失败于';
    if(job.status==='expired'){timing=job.nextAt;timeLabel='原定';}
    const previous=isUpcoming(job)&&job.schedule.type!=='once'&&job.lastStatus
      ?`<p class="reminder-meta">上次${esc(statuses[job.lastStatus])}${finishedTime(job)?` · ${esc(displayTime(finishedTime(job)))}`:''}</p>`:'';
    return `<article class="reminder-item" data-reminder-id="${esc(job.id)}" data-reminder-status="${esc(job.status)}">
      <div class="reminder-item-heading"><h3>${esc(job.note)}</h3><span class="reminder-status">${postponed?'免打扰延后':statuses[job.status]}</span></div>
      <p class="reminder-meta">${job.userRequested?'你设置的':'AI 安排'} · ${esc(scheduleLabel(job.schedule))}${timing&&timeLabel?` · ${timeLabel} ${esc(displayTime(timing))}`:''}</p>
      ${previous}${job.lastError?`<p class="reminder-meta reminder-error">${esc(job.lastError)}</p>`:''}
      <div class="reminder-actions">${job.status==='pending'?`<button type="button" data-reminder-action="edit" aria-label="编辑提醒：${esc(job.note)}">编辑</button>`:''}<button type="button" class="danger" data-reminder-action="delete" aria-label="删除提醒：${esc(job.note)}">删除</button></div>
    </article>`;
  }

  function renderGroup(name,title,list,empty,view){
    const pageCount=Math.ceil(list.length/pageSize);
    const page=Math.min(view.pages[name],Math.max(0,pageCount-1));
    view.pages[name]=page;
    const nav=pageCount>1?`<nav class="model-pagination" aria-label="${title}分页"><button type="button" data-reminder-action="page" data-reminder-group="${name}" data-page-step="-1" ${page===0?'disabled':''}>上页</button><span>${page+1} / ${pageCount} 页</span><button type="button" data-reminder-action="page" data-reminder-group="${name}" data-page-step="1" ${page===pageCount-1?'disabled':''}>下页</button></nav>`:'';
    return `<h2 class="section-title reminder-section-title">${title}</h2><section class="section reminder-group" aria-label="${title}">${list.length?list.slice(page*pageSize,(page+1)*pageSize).map(renderJob).join(''):`<p class="reminder-empty">${empty}</p>`}${nav}</section>`;
  }

  function render(roleId){
    const view=entry(roleId);
    if(!view.loading&&view.revision!==P().getState().revision)load(roleId,view);
    let body='';
    if(view.error)body=`<div class="reminder-load-error" role="alert"><p>${esc(view.error)}</p><button type="button" data-reminder-action="retry">重新读取</button></div>`;
    if(view.jobs){
      const upcoming=view.jobs.filter(isUpcoming).sort((a,b)=>dueTime(a)-dueTime(b));
      const history=view.jobs.filter(job=>!isUpcoming(job)).sort((a,b)=>(finishedTime(b)||b.nextAt)-(finishedTime(a)||a.nextAt));
      body+=renderGroup('upcoming','待发送',upcoming,'暂时没有待发送的提醒',view)+renderGroup('history','发送记录',history,'暂无发送记录',view);
    }else if(!view.error)body='<p class="page-note">正在读取提醒…</p>';
    return {body:`<div class="reminder-page" data-reminder-role="${esc(roleId)}">${body}</div>`,action:'<button type="button" class="reminder-add" data-reminder-action="create">新建</button>'};
  }

  function readSchedule(form){
    const {repeat,date,time,hours}=form.elements;
    if(repeat.value==='once')return {type:'once',at:`${date.value}T${time.value}`};
    if(repeat.value==='interval')return {type:'interval',intervalMs:Math.round(Number(hours.value)*3600000)};
    if(repeat.value==='weekly')return {type:'weekly',time:time.value,weekdays:[...form.querySelectorAll('[name=weekday]:checked')].map(input=>Number(input.value))};
    return {type:'daily',time:time.value};
  }

  function openEditor(roleId,job){
    const plan=job?.schedule||{type:'once'};
    const parts=localParts(plan.at||job?.nextAt||Date.now()+5*60000);
    const date=`${parts.year}-${parts.month}-${parts.day}`;
    const time=plan.time||`${parts.hour}:${parts.minute}`;
    const selectedDays=plan.weekdays||[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const hours=plan.type==='interval'?plan.intervalMs/3600000:1;
    const title=job?'编辑提醒':'新建提醒';
    let initialSchedule;
    const fields=`<div class="reminder-editor">
      <label class="form-field"><span class="field-label">提醒内容</span><textarea name="note" rows="3" maxlength="4000" placeholder="例如：别忘了收衣服" required>${esc(job?.note||'')}</textarea></label>
      <fieldset class="reminder-repeat"><legend>重复方式</legend><div class="reminder-repeat-options">${Object.entries(scheduleTypes).map(([value,label])=>`<label><input type="radio" name="repeat" value="${value}" ${value===plan.type?'checked':''}><span>${label}</span></label>`).join('')}</div></fieldset>
      <label class="form-field" data-repeat-field="once"><span class="field-label">日期</span><input name="date" type="date" value="${esc(date)}" required></label>
      <label class="form-field" data-repeat-field="once daily weekly"><span class="field-label">时间</span><input name="time" type="time" value="${esc(time)}" required></label>
      <fieldset class="reminder-repeat" data-repeat-field="weekly"><legend>星期</legend><div class="reminder-repeat-options reminder-weekdays">${weekdays.map((label,day)=>`<label><input type="checkbox" name="weekday" value="${day}" ${selectedDays.includes(day)?'checked':''}><span>${label}</span></label>`).join('')}</div></fieldset>
      <label class="form-field" data-repeat-field="interval"><span class="field-label">每隔多少小时</span><input name="hours" type="number" value="${esc(hours)}" min="1" max="8784" step="any" required inputmode="decimal"></label>
      <p class="small-note">按小手机时区 ${esc(timezone())} 执行。${job&&!job.userRequested?'AI 安排的提醒遵守全局免打扰。':'到点直接在这位好友的聊天里发送。'}</p>
    </div>`;
    P().openModal(title,fields,async form=>{
      const note=form.elements.note.value.trim();
      if(!note)throw new Error('请填写提醒内容');
      const schedule=readSchedule(form);
      if(schedule.type==='weekly'&&!schedule.weekdays.length)throw new Error('请选择至少一天');
      const payload={roleId,note,...(job?{id:job.id}:{}),...(!job||JSON.stringify(schedule)!==initialSchedule?{schedule}:{})};
      const result=await P().api('/api/engine/jobs/save',payload);
      P().setState(result.state);
      if(form.isConnected){P().closePage(false);P().refresh();P().toast(job?'提醒已更新':'提醒已创建');}
    },'保存',()=>{
      if(entry(roleId).revision!==P().getState().revision)P().refresh();
    },'cancel',{lockWhileSaving:true});
    const sheet=document.querySelector('#overlay > .page-editor');
    sheet.classList.add('model-sheet','reminder-sheet');
    const form=sheet.querySelector('form');
    const updateFields=()=>{
      const repeat=form.elements.repeat.value;
      for(const area of form.querySelectorAll('[data-repeat-field]')){
        area.hidden=!area.dataset.repeatField.split(' ').includes(repeat);
        for(const control of area.querySelectorAll('input'))control.disabled=area.hidden;
      }
    };
    for(const option of form.querySelectorAll('[name=repeat]'))option.onchange=updateFields;
    updateFields();
    initialSchedule=JSON.stringify(readSchedule(form));
  }

  function bind(roleId){
    for(const button of document.querySelectorAll('#view [data-reminder-action]'))button.onclick=()=>{
      const view=entry(roleId);
      switch(button.dataset.reminderAction){
        case 'create':openEditor(roleId);break;
        case 'retry':if(!view.loading)load(roleId,view);break;
        case 'page':view.pages[button.dataset.reminderGroup]+=Number(button.dataset.pageStep);P().refresh();break;
        case 'edit':openEditor(roleId,view.jobs.find(job=>job.id===button.closest('[data-reminder-id]').dataset.reminderId));break;
        case 'delete':{
          const id=button.closest('[data-reminder-id]').dataset.reminderId;
          P().confirmDialog('删除这个提醒？','删除后 TA 不会再按这个提醒发送消息。',async()=>{
            const result=await P().api('/api/engine/jobs/delete',{roleId,id});
            P().setState(result.state);
          },'删除');
          break;
        }
      }
    };
  }

  window.PipiReminders={render,bind,renderOverview,bindOverview,invalidate:roleId=>entries.delete(roleId),reset:()=>{entries.clear();overview=newOverview();}};
})();
