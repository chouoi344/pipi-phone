// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const P = () => window.Pipi;
  const esc = value => P().esc(value);
  const safeMedia = value => (/^\/api\/media\/[a-f\d]{32,64}\.(png|jpg|jpeg|webp|gif)$/i.test(String(value||'').trim()) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(String(value||'').trim())) ? String(value).trim() : '';
  const ui = {
    config:null, configRevision:null, readOnEntry:false, loading:null, sourceId:'pipi',
    typing:new Set(), activity:new Map(), events:null, started:false, syncing:false, resync:false,
    memTab:'cards', memStatus:'active', memQuery:'', memCache:new Map(), memLoading:new Map(), memExpanded:new Set(),
    memRecallResults:new Map(), lifeMemoryViews:new Map(), lifeStickerEditing:new Set(), importState:null, scheduleSaving:false, voiceSaving:false, outreachSaving:false
  };
  const names = new Set(['engine-home','providers','engine-usage','engine-functions','engine-module','role-stickers','role-reminders','role-references','role-schedule','memories']);
  const waitingModeLabels = {cloud:'智能识别',timer:'固定停顿'};
  const scheduleDraftKey='pipi.schedule-parameters-draft';
  const scheduleFields=[
    {key:'boundary',label:'日程换日时间',type:'time',hint:'按小手机设置的时区。格式如 07:00。'},
    {key:'routineJitterMinutes',label:'起床和入睡浮动',unit:'分钟',hint:'每天略有变化，填 0 则不浮动。'},
    {key:'surpriseProbability',label:'生活小插曲概率',unit:'%',hint:'日程有合适空档时，角色有机会临时改变安排。'},
    {key:'chatChangeEnabled',label:'聊天可调整日程',type:'checkbox',hint:'比如聊着说好早点睡，角色可以调整晚上的安排。'},
    {key:'outfitNoRepeatDays',label:'穿搭避重复',unit:'天',hint:'衣柜有合适的备选时，优先选最近没穿过的。'},
    {key:'referenceHistoryDays',label:'参考过去的日程',unit:'天',hint:'生成时参考最近的日程记录，延续之前的安排。'}
  ];
  const toScheduleInput=(key,value)=>key==='chatChangeEnabled'?value:String(key==='surpriseProbability'?Math.round(value*100):value);
  const getScheduleDraft=()=>JSON.parse(sessionStorage.getItem(scheduleDraftKey)||'{}');
  const moduleChoices = (id,setting) => id==='waiting'?setting.options.map(({value})=>({value,label:waitingModeLabels[value]})):setting.options;
  const MEM_TYPE_LABELS = {FACT:'个人事实',PREFERENCE:'喜好忌口',EVENT:'重要经历',RELATIONSHIP:'关系点滴',PLAN:'约定计划',GENERAL:'共同记忆'};
  const MEMORY_PAGE_SIZE = 20;
  const memoryBrowseKey=roleId=>'pipi.life.memory.'+roleId;
  const memoryNumber = new Intl.NumberFormat('zh-CN');
  const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezones = [
    {value:'Asia/Shanghai',label:'中国（北京时间）'},
    {value:'Asia/Tokyo',label:'日本（东京）'},
    {value:'Asia/Seoul',label:'韩国（首尔）'},
    {value:'Asia/Singapore',label:'新加坡'},
    {value:'America/Los_Angeles',label:'美国（洛杉矶）'},
    {value:'America/Toronto',label:'加拿大（多伦多）'},
    {value:'Europe/London',label:'英国（伦敦）'},
    {value:'Europe/Paris',label:'法国（巴黎）'},
    {value:'Europe/Berlin',label:'德国（柏林）'},
    {value:'Australia/Sydney',label:'澳大利亚（悉尼）'}
  ];
  const timezoneLabel = value => timezones.find(item=>item.value===value)?.label || new Intl.DateTimeFormat('zh-CN',{timeZone:value,timeZoneName:'long'}).formatToParts().find(part=>part.type==='timeZoneName').value;
  const state = () => P().getState();
  const ai = () => ui.config.ai;
  const modelName = model => `${ai().sources.find(source => source.id===model.sourceId)?.name || ''} · ${model.model}`;
  const heading = (title,right='') => `<header class="topbar"><div class="header-leading"><button class="back-btn" data-action="back" aria-label="返回">${P().icons.back}</button></div><h2 class="title-centered">${esc(title)}</h2><div class="header-actions">${right}</div></header>`;
  const row = (title,action,value='',attrs='') => `<button type="button" class="cell plain-cell" data-engine-action="${esc(action)}" ${attrs}><span class="cell-body cell-title">${esc(title)}</span>${value?`<span class="cell-value">${esc(value)}</span>`:''}${P().icons.chevron}</button>`;
  const section = rows => `<section class="section">${rows}</section>`;
  const page = (title,body,right='') => heading(title,right)+`<div class="content page-content engine-content">${body}</div>`;
  const note = text => `<p class="page-note">${esc(text)}</p>`;
  const options = (items,value) => items.map(item=>`<option value="${esc(item.value)}" ${String(item.value)===String(value)?'selected':''}>${esc(item.label)}</option>`).join('');
  const select = (label,name,value,items) => `<label class="form-field"><span class="field-label">${esc(label)}</span><select name="${esc(name)}">${options(items,value)}</select></label>`;
  const field = (label,name,value='',type='text',hint='') => `<label class="form-field"><span class="field-label">${esc(label)}</span>${type==='textarea'?`<textarea name="${esc(name)}" maxlength="20000">${esc(value)}</textarea>`:`<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${type==='password'?'autocomplete="new-password"':'autocomplete="off"'} ${type==='number'?'step="any"':''}>`}${hint?`<span class="field-help">${esc(hint)}</span>`:''}</label>`;
  const button = (title,action,primary=false,attrs='') => `<button type="button" class="${primary?'primary-btn weui-btn weui-btn_primary':'secondary-btn'}" data-engine-action="${action}" ${attrs}>${title}</button>`;
  const modelOptions = (kind='chat',empty='跟随聊天模型',capability='') => [{value:'',label:empty},...ai().models.filter(model=>model.kind===kind&&(!capability||model.capabilities.includes(capability))).map(model=>({value:model.id,label:modelName(model)}))];
  async function task(work) { try { await work(); } catch(error) { P().toast(error.message); } }
  async function load() {
    if(ui.loading)return ui.loading;
    const previousAI=ui.config?.ai,revision=state().revision;
    const request=P().api('/api/engine/config').then(config=>{
      if(ui.loading!==request)return config;
      if(ui.config&&ui.config.ai!==previousAI)config.ai=ui.config.ai;
      ui.configRevision=revision;ui.readOnEntry=false;
      ui.config=config;return config;
    }).finally(()=>{if(ui.loading===request)ui.loading=null;});
    ui.loading=request;
    return request;
  }
  function openSettings(name) {
    const latest=state();
    ui.readOnEntry=ui.configRevision!==latest.revision;
    // The model list is already included in the synchronized phone state.
    if(name==='providers'&&ui.config&&ui.readOnEntry){
      ui.config.ai=latest.settings.ai;
      ui.readOnEntry=false;
    }
    P().showView(name);
  }
  function readPageConfig(panel) {
    const status=panel.querySelector('[role="status"]'),retry=panel.querySelector('button');
    status.textContent='正在读取设置…';retry.parentElement.hidden=true;
    load().then(()=>{
      if(panel.isConnected)P().refresh();
    },error=>{
      if(!panel.isConnected)return;
      status.textContent=error.message;retry.parentElement.hidden=false;
      retry.onclick=()=>readPageConfig(panel);
    });
  }
  function acceptConfig(result) {
    P().setState(result.state);
    ui.config.ai=state().settings.ai;
    return ui.config;
  }
  async function saveAI(next,{stationPreset=false}={}) {
    return acceptConfig(await P().api('/api/engine/models',{ai:next,...(stationPreset?{stationPreset}:{})}));
  }

  function render(name,arg) {
    if(name==='engine-module'&&arg==='caption')name='engine-home';
    if((name==='life-workbench'||name==='role-config'&&P().rolePanelAvailable?.())&&window.PipiLife)return window.PipiLife.render(arg,name==='life-workbench');
    if(!names.has(name))return null;
    if(name==='engine-usage')return window.PipiUsage.render();
    if(name==='role-stickers')return renderStickers(arg);
    if(name==='role-reminders')return renderReminders(arg);
    if(name==='role-references')return renderRoleReferences(arg);
    if(name==='role-schedule')return window.PipiSchedule.render(arg);
    if(name==='memories')return renderRoleMemories(arg);
    if(!ui.config||ui.readOnEntry){
      const titles={'engine-home':'小手机',providers:'模型','engine-functions':'功能','engine-module':'功能'};
      return page(titles[name],'<div data-config-loading><p class="page-note" role="status">正在读取设置…</p><div hidden><button type="button" class="secondary-btn">重新读取</button></div></div>');
    }
    if(name==='engine-home')return page('小手机',section(row('模型','models',ai().assign.chat?'已选择':'未选择')+row('时区','timezone',timezoneLabel(ui.config.timezone||defaultTimezone),'aria-haspopup="dialog"'))+window.PipiModels.renderPreferences(ui.config));
    if(name==='providers')return renderModels();
    if(name==='engine-functions'){
      const order=['schedule','voice','selfie','outreach','waiting','segments','memory','actions','scheduler'];
      const rows=order.map(id=>ui.config.modules.find(module=>module.id===id)).filter(Boolean).map(module=>
        row(module.name,'module','',`data-module="${esc(module.id)}"`));
      return page('功能',section(rows.join('')));
    }
    if(name==='engine-module')return renderModule(arg);
  }
  function renderModels() { return window.PipiModels.render(ui.config); }
  function renderSetting(setting,value) {
    const type=setting.type;
    if(type==='boolean')return `<label class="check-row"><input type="checkbox" name="${esc(setting.key)}" ${value?'checked':''}>${esc(setting.label)}</label>${setting.hint?note(setting.hint):''}`;
    if(type==='select'||setting.options)return select(setting.label,setting.key,value,setting.options.map(option=>typeof option==='object'?option:{value:option,label:String(option)}))+(setting.hint?note(setting.hint):'');
    if(type==='number'||type==='integer'){
      const yuan=setting.unit==='yuan',scale=yuan?100:1;
      const step=yuan?'0.01':type==='integer'||setting.integer?'1':'any';
      return `<label class="form-field"><span class="field-label">${esc(setting.label)}</span><input name="${esc(setting.key)}" type="number" step="${step}" value="${esc(value/scale)}" ${setting.min===undefined?'':`min="${setting.min/scale}"`} ${setting.max===undefined?'':`max="${setting.max/scale}"`} ${yuan?'inputmode="decimal" required':''}>${setting.hint?`<span class="field-help">${esc(setting.hint)}</span>`:''}</label>`;
    }
    return field(setting.label,setting.key,value,type==='textarea'||type==='longtext'?'textarea':'text',setting.hint);
  }
  const voiceDraftKey='pipi.voice-settings-draft';
  const voiceDraft=()=>JSON.parse(sessionStorage.getItem(voiceDraftKey)||'{}');
  const outreachDraftKey='pipi.outreach-settings-draft';
  function outreachDraft(){
    const draft=JSON.parse(sessionStorage.getItem(outreachDraftKey)||'{}');
    delete draft.mode;
    delete draft.enabled;
    return draft;
  }
  function voiceSelection(){const draft=voiceDraft(),tts=draft.tts??state().settings.ai.assign.tts;return {draft,tts,ready:window.PipiModels.ttsModels(ui.config).some(model=>model.id===tts)};}
  function renderModule(id) {
    if(id==='voice'){
      const availability=state().voiceAvailability,{draft,tts,ready}=voiceSelection();
      return page('发语音',note('开启后，可在好友的「角色配置 → 基础配置」中启用语音并选择音色。')+`<form id="engine-module-form" data-module="voice" class="model-ui schedule-parameters">
        <fieldset ${ui.voiceSaving?'disabled':''}><label class="model-preference-row"><span class="preference-copy"><strong>开启发语音功能</strong>${ready?'':'<small id="voice-model-hint">请先在模型设置中添加并选择语音合成模型。</small>'}</span>
        <input type="checkbox" name="enabled" class="switch weui-switch" role="switch" aria-label="开启发语音功能" ${ready&&(draft.enabled??availability.enabled)?'checked':''} ${ready?'':'disabled aria-describedby="voice-model-hint"'}></label>
        ${window.PipiModels.ttsModelRow(ui.config,tts)}</fieldset>
        <div class="button-area"><button type="submit" class="primary" ${ready&&!ui.voiceSaving?'':'disabled'}>保存设置</button></div></form>`);
    }
    if(id==='schedule')return renderScheduleSettings();
    const module=ui.config.modules.find(item=>item.id===id);if(!module)return page('功能',note('找不到这个功能。'));
    const values=ui.config.settings?.[id]||{};
    const err=ui.config.moduleErrors?.[id];
    const faultNote=err?.message?note(`最近组件异常提示：${err.message}（已自动隔离降级，未影响正常聊天）`):'';
    if(id==='outreach')return renderOutreachSettings(module,values,faultNote);
    const controls=advanced=>module.settings.filter(setting=>!(id==='actions'&&setting.key==='allowVoice')&&!!setting.advanced===advanced).map(setting=>{
      const value=values[setting.key]??setting.default;
      if(['waiting','segments','memory'].includes(id)&&setting.type==='select'){
        const label=moduleChoices(id,setting).find(option=>option.value===value).label;
        return `<input type="hidden" name="${esc(setting.key)}" value="${esc(value)}">`+row(setting.label,'module-choice',label,`data-setting="${esc(setting.key)}" aria-haspopup="dialog"`)+(setting.hint?note(setting.hint):'');
      }
      const html=renderSetting(setting,value),when=setting.showWhen;
      if(!when)return html;
      const selected=values[when.key]??module.settings.find(item=>item.key===when.key).default;
      return `<div data-setting-mode="${esc(when.key)}" data-setting-value="${esc(when.value)}" ${selected===when.value?'':'hidden'}>${html}</div>`;
    }).join('');
    const advanced=controls(true);
    const overview=id==='scheduler'?window.PipiReminders.renderOverview():'';
    return page(module.name,note(module.description)+faultNote+`<form id="engine-module-form" data-module="${esc(id)}" class="form-section">${controls(false)}${advanced?`<details class="engine-details"><summary>专业微调（不懂无需修改）</summary>${advanced}</details>`:''}<button type="submit" class="primary-btn weui-btn weui-btn_primary">保存设置</button></form>`+overview);
  }

  function renderOutreachSettings(module,saved,faultNote){
    const draft=outreachDraft(),value=key=>draft[key]??saved[key];
    const prompt=module.settings.find(setting=>setting.key==='customPrompt');
    const promptText=value(prompt.key),promptEmpty=!promptText.trim();
    const rowInput=(label,input)=>`<label class="model-preference-row"><span class="preference-copy"><strong>${esc(label)}</strong></span>${input}</label>`;
    const toggle=(label,key)=>rowInput(label,`<input name="${key}" type="checkbox" class="switch weui-switch" role="switch" ${value(key)?'checked':''}>`);
    const time=(label,key)=>rowInput(label,`<span class="schedule-setting-value"><input name="${key}" value="${esc(value(key))}" type="text" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" autocomplete="off" required></span>`);
    const defaults=module.settings.filter(setting=>!setting.advanced&&!['quietHoursEnabled','quietStart','quietEnd','customPrompt'].includes(setting.key)).map(setting=>{
      if(setting.type==='boolean')return toggle(setting.label,setting.key);
      return rowInput(setting.label,`<span class="schedule-setting-value"><input name="${setting.key}" type="number" value="${esc(value(setting.key))}" min="${setting.min}" max="${setting.max}" step="1" inputmode="numeric" required></span>`);
    }).join('');
    return page(module.name,faultNote+`<form id="engine-module-form" data-module="outreach" class="model-ui schedule-parameters outreach-settings">
      <fieldset ${ui.outreachSaving?'disabled':''}>
        <h3 class="section-title settings-group-title">全局免打扰</h3>
        ${section(toggle('启用免打扰时段','quietHoursEnabled')+time('免打扰开始时间','quietStart')+time('免打扰结束时间','quietEnd'))}
        ${note('按小手机时区设置，可跨午夜。开启后，所有好友在此时段暂停发送普通主动信息。')}
        <h3 class="section-title settings-group-title">自己配置</h3>
        ${section(defaults+`<div class="form-block caption-preferences-form"><details class="caption-prompt-details"><summary id="outreach-prompt-label">${esc(prompt.label)}<span class="caption-prompt-preview${promptEmpty?' is-empty':''}">${promptEmpty?'未填写':esc(promptText)}</span></summary><textarea name="${prompt.key}" aria-labelledby="outreach-prompt-label" placeholder="填写补充要求（选填）" rows="2" maxlength="${prompt.maxLength}">\n${esc(promptText)}</textarea></details></div>`)}
        ${note('这里的参数默认适用于所有好友。角色配置里单独改过的参数，只对该好友生效。跟随日程到点可由角色判断是否开口，自己配置按间隔发起联系。')}
      </fieldset>
      <div class="button-area"><button type="submit" class="primary" ${ui.outreachSaving||!Object.keys(draft).length?'disabled':''}>保存设置</button></div>
    </form>`);
  }

  function bindOutreachSettings(form){
    const button=form.querySelector('[type="submit"]');
    form.oninput=({target:input})=>{
      const saved=ui.config.settings.outreach[input.name];
      const value=input.type==='checkbox'?input.checked:input.value,draft=outreachDraft();
      if(value===(typeof saved==='boolean'?saved:String(saved)))delete draft[input.name];
      else draft[input.name]=value;
      sessionStorage.setItem(outreachDraftKey,JSON.stringify(draft));
      if(input.name==='customPrompt'){
        const preview=form.querySelector('.caption-prompt-preview'),empty=!value.trim();
        preview.textContent=empty?'未填写':value;
        preview.classList.toggle('is-empty',empty);
      }
      button.disabled=!Object.keys(draft).length;
    };
    form.onsubmit=event=>{
      event.preventDefault();
      if(ui.outreachSaving||button.disabled)return;
      return task(async()=>{
        const values=outreachDraft();
        for(const key of Object.keys(values))if(form.elements[key].type==='number')values[key]=form.elements[key].valueAsNumber;
        ui.outreachSaving=true;
        form.querySelector('fieldset').disabled=true;
        button.disabled=true;
        try{
          const result=await P().api('/api/engine/modules',{id:'outreach',values});
          sessionStorage.removeItem(outreachDraftKey);
          if(ui.config)Object.assign(ui.config.settings.outreach,result.state.settings.modules.outreach);
          P().setState(result.state);
          P().toast('设置已保存');
        }finally{
          ui.outreachSaving=false;
          if(document.querySelector('#engine-module-form[data-module="outreach"]'))P().refresh();
        }
      });
    };
  }

  function renderScheduleSettings(){
    const draft=getScheduleDraft(),saved=ui.config.settings.schedule;
    const settings=ui.config.modules.find(module=>module.id==='schedule').settings;
    const rows=scheduleFields.map(({key,label,hint,unit,type='number'})=>{
      const value=draft[key]??toScheduleInput(key,saved[key]);
      const setting=settings.find(item=>item.key===key),percent=unit==='%';
      const input=type==='checkbox'
        ?`<input name="${key}" type="checkbox" class="switch weui-switch" role="switch" ${value?'checked':''}>`
        :`<span class="schedule-setting-value"><input name="${key}" value="${esc(value)}" ${type==='time'?`type="text" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" maxlength="5" autocomplete="off"`:`type="number" min="${percent?0:setting.min}" max="${percent?100:setting.max}" step="1" inputmode="numeric"`} required>${unit?`<span>${unit}</span>`:''}</span>`;
      return `<label class="model-preference-row"><span class="preference-copy"><strong>${label}</strong><small>${hint}</small></span>${input}</label>`;
    }).join('');
    return page('日程与穿搭',note('这些规则适用于开启日程的好友。城市、天气和衣柜在各自的角色配置里调整。')+`<form id="schedule-parameters-form" class="model-ui schedule-parameters"><fieldset ${ui.scheduleSaving?'disabled':''}>${rows}</fieldset><div class="button-area"><button type="submit" class="primary" ${ui.scheduleSaving||!Object.keys(draft).length?'disabled':''}>保存设置</button></div></form>`);
  }

  function bindScheduleSettings(){
    const form=document.querySelector('#schedule-parameters-form');
    if(!form)return;
    const button=form.querySelector('[type="submit"]');
    form.oninput=event=>{
      const input=event.target,value=input.type==='checkbox'?input.checked:input.value,draft=getScheduleDraft();
      if(value===toScheduleInput(input.name,ui.config.settings.schedule[input.name]))delete draft[input.name];
      else draft[input.name]=value;
      sessionStorage.setItem(scheduleDraftKey,JSON.stringify(draft));
      button.disabled=!Object.keys(draft).length;
    };
    form.onsubmit=event=>{
      event.preventDefault();
      if(ui.scheduleSaving||button.disabled)return;
      return task(async()=>{
        const draft=getScheduleDraft(),values={};
        for(const {key,type} of scheduleFields)if(Object.hasOwn(draft,key)){
          values[key]=type==='checkbox'||type==='time'?draft[key]:Number(draft[key])/(key==='surpriseProbability'?100:1);
        }
        ui.scheduleSaving=true;
        button.disabled=true;
        form.querySelector('fieldset').disabled=true;
        try{
          const result=await P().api('/api/engine/modules',{id:'schedule',values});
          P().setState(result.state);
          Object.assign(ui.config.settings.schedule,values);
          sessionStorage.removeItem(scheduleDraftKey);
          P().toast('设置已保存');
        }finally{
          ui.scheduleSaving=false;
          if(document.querySelector('#schedule-parameters-form'))P().refresh();
        }
      });
    };
  }

  function renderRefSlots(list,kindLabel,fieldKey){
    const slots=[0,1,2].map(idx=>{
      const url=safeMedia(list?.[idx]);
      if(url){
        return `<div class="ref-slot has-img"><img src="${esc(url)}" alt="${esc(kindLabel)}${idx+1}">${idx===0&&fieldKey==='faceReferences'?'<span class="ref-badge">主脸锚点</span>':''}<div class="ref-actions">${idx>0?`<button type="button" data-ref-primary="${fieldKey}:${idx}">设为主图</button>`:''}<button type="button" class="danger" data-ref-remove="${fieldKey}:${idx}">删除</button></div></div>`;
      }
      return `<div class="ref-slot"><button type="button" class="ref-slot-add" data-ref-upload="${fieldKey}:${idx}"><span>＋</span><span>上传${esc(kindLabel)}</span></button></div>`;
    }).join('');
    return `<div class="ref-grid">${slots}</div>`;
  }

  function renderRoleReferences(roleId,inline=false){
    const r=state()?.roles?.find(x=>x.id===roleId);
    if(!r)return page('人物参考图与自拍',note('找不到这位好友。'));
    const faceRefs=(r.faceReferences||[]).filter(safeMedia),bodyRefs=(r.bodyReferences||[]).filter(safeMedia);
    const fileInput='<input type="file" id="ref-image-input" accept="image/png,image/jpeg,image/webp" hidden>';
    if(inline)return '<div class="ref-inline">'+[['三视图',faceRefs,'faceReferences'],['全身图',bodyRefs,'bodyReferences']].map(([label,list,key])=>
      `<div class="ref-inline-row"><div class="ref-inline-label">${label}<span>${list.length}/3${key==='bodyReferences'?' · 选填':''}</span></div><div class="ref-inline-images">${list.map((url,idx)=>`<button type="button" class="ref-inline-thumb" data-ref-menu="${key}:${idx}" aria-label="${label}${idx+1}${idx===0?'，主图':''}，管理"><img src="${esc(url)}" alt="${label}${idx+1}">${idx===0?'<span>主图</span>':''}</button>`).join('')}${list.length<3?`<button type="button" class="ref-inline-add" data-ref-upload="${key}:${list.length}" aria-label="上传${label}">＋</button>`:''}</div></div>`
    ).join('')+'</div>'+fileInput;
    const faceBlock=`<p class="section-title">三视图（${faceRefs.length}/3）</p>${renderRefSlots(faceRefs,'三视图','faceReferences')}`;
    const bodyBlock=`<p class="section-title">全身图（${bodyRefs.length}/3，选填）</p>${renderRefSlots(bodyRefs,'全身图','bodyReferences')}`;
    const content=faceBlock+bodyBlock+fileInput;
    const intro=note('上传清晰的参考图后，TA 发自拍或照片时会自动锁定同一张脸。三视图可放正面、侧面等清晰参考，第一张作为主图；全身图只在拍全身或今日穿搭时启用。');
    return page(`${r.remark||r.name} · 人物参考图与自拍`,intro+content);
  }

  function ensureMemLoaded(roleId){
    const key=`${roleId}:${ui.memStatus}:${ui.memQuery}`;
    if(ui.memLoading.has(key))return ui.memLoading.get(key);
    const current=()=>ui.memLoading.get(key)===request&&key===`${roleId}:${ui.memStatus}:${ui.memQuery}`;
    const request=P().api(`/api/engine/memory/state?roleId=${encodeURIComponent(roleId)}&status=${encodeURIComponent(ui.memStatus)}&q=${encodeURIComponent(ui.memQuery)}`).then(res=>{
      if(current())ui.memCache.set(roleId,{key,cards:res.cards});
    }).catch(error=>{if(current())ui.memCache.set(roleId,{key,error:error.message});}).finally(()=>{
      const refresh=current();
      if(ui.memLoading.get(key)===request)ui.memLoading.delete(key);
      if(refresh)P().refresh();
    });
    ui.memLoading.set(key,request);
    return request;
  }

  function refreshMemoryCards(roleId){
    ui.memCache.delete(roleId);
    const life=ui.lifeMemoryViews.get(roleId);
    if(life){
      if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===roleId)return loadLifeMemories(roleId);
      life.response=null;
      life.request=null;
    }
    P().refresh();
  }

  function lifeMemoryView(roleId){
    if(!ui.lifeMemoryViews.has(roleId)){
      const saved=JSON.parse(sessionStorage.getItem(memoryBrowseKey(roleId))||'{}');
      ui.lifeMemoryViews.set(roleId,{
        status:saved.status||'active',query:saved.query||'',searchOffset:saved.searchOffset||0,
        browse:saved.browse||{active:{month:null,offset:0},archived:{month:null,offset:0}},response:null,request:null
      });
    }
    return ui.lifeMemoryViews.get(roleId);
  }

  function loadLifeMemories(roleId){
    const view=lifeMemoryView(roleId),{status,query}=view,browse=view.browse[status];
    const offset=query?view.searchOffset:browse.offset;
    const params=new URLSearchParams({roleId,status,q:query,group:'month',limit:MEMORY_PAGE_SIZE,offset});
    if(!query&&browse.month)params.set('month',browse.month);
    const request={};
    view.request=request;
    return P().api('/api/engine/memory/state?'+params).then(response=>{
      if(view.request!==request)return;
      const lastOffset=Math.max(0,Math.ceil(response.total/MEMORY_PAGE_SIZE)-1)*MEMORY_PAGE_SIZE;
      if(!query){
        if(browse.month!==response.month&&browse.month!==null)browse.offset=0;
        browse.month=response.month;
      }
      const validOffset=Math.min(query?offset:browse.offset,lastOffset);
      if(validOffset!==offset){
        if(query)view.searchOffset=validOffset;else browse.offset=validOffset;
        return loadLifeMemories(roleId);
      }
      view.response={...response,status,query,offset};
      sessionStorage.setItem(memoryBrowseKey(roleId),JSON.stringify({status,query,searchOffset:view.searchOffset,browse:view.browse}));
    }).catch(error=>{if(view.request===request)view.response={error:error.message,status,query};}).finally(()=>{
      if(view.request!==request)return;
      view.request=null;
      if(document.querySelector('[data-life-root]')?.dataset.lifeRoot===roleId)P().refresh();
    });
  }

  function memoryMonthLabel(month,includeYear=true){
    if(month==='unknown')return '日期未记录';
    const [year,value]=month.split('-');
    return (includeYear?year+'年':'')+Number(value)+'月';
  }

  function renderLifeMemoryCard(roleId,card,dateFormat){
    const id=esc(card.id);
    const opened=ui.memExpanded.has(roleId+':'+card.id);
    const date=new Date(card.createdAt);
    const dateLabel=card.createdAt>0&&Number.isFinite(date.getTime())?dateFormat.format(date):'日期未记录';
    return `<details class="life-memory-card" data-life-memory-id="${id}" ${opened?'open':''}>
      <summary><span class="life-memory-text">
        <span class="life-memory-meta"><span>${esc(dateLabel)}</span>${card.memoryType!=='GENERAL'?'<span>'+esc(MEM_TYPE_LABELS[card.memoryType]||'共同记忆')+'</span>':''}${card.locked?'<span>已锁定</span>':''}${card.status!=='active'&&card.lastMentionedAt>0?'<span>最近聊到过</span>':''}</span>
        <span class="lm-card-body">${esc(card.content)}</span>
      </span></summary>
      <div class="life-memory-actions">
        ${card.status==='active'?'':'<button type="button" data-lm-restore="'+id+'">恢复记忆</button>'}
        <button type="button" data-lm-edit="${id}">编辑</button>
        <button type="button" data-lm-lock="${id}" aria-pressed="${!!card.locked}">${card.locked?'解锁':'锁定'}</button>
        <button type="button" class="danger" data-lm-delete="${id}">删除</button>
      </div>
    </details>`;
  }

  function renderMemoryMonths(response){
    if(response.query||!response.months.length)return '';
    const displayed=response.months.slice(0,3);
    const selected=response.months.find(item=>item.month===response.month);
    if(selected&&!displayed.includes(selected))displayed[2]=selected;
    displayed.sort((a,b)=>a.month==='recent'?-1:b.month==='recent'?1:a.month.localeCompare(b.month));
    const years=new Set(response.months.filter(item=>!['unknown','recent'].includes(item.month)).map(item=>item.month.slice(0,4)));
    return `<div class="life-memory-months" aria-label="查看月份">${displayed.map(item=>
      `<button type="button" data-lm-month="${esc(item.month)}" aria-pressed="${response.month===item.month}">
        <span>${esc(item.label||memoryMonthLabel(item.month,years.size>1))}</span><small>${memoryNumber.format(item.count)} 条</small>
      </button>`).join('')}</div>`;
  }

  function renderLifeMemories(roleId){
    const view=lifeMemoryView(roleId),response=view.response;
    if(!response&&!view.request)loadLifeMemories(roleId);
    const filters=[['active','当前记忆'],['archived','已归档']].map(([id,label])=>`<button type="button" data-mem-status="${id}" aria-pressed="${(response?.status||view.status)===id}">${label}</button>`).join('');
    let list=note('正在读取记忆…');
    if(response?.error)list=`<div class="lm-feedback" role="alert"><p>${esc(response.error)}</p><button type="button" id="lm-retry">重新读取</button></div>`;
    else if(response){
      const {cards,total,offset,query,nextOffset,months}=response;
      const page=Math.floor(offset/MEMORY_PAGE_SIZE)+1;
      const pages=Math.ceil(total/MEMORY_PAGE_SIZE);
      const dateFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:state().settings.timezone||defaultTimezone,month:'long',day:'numeric',...(query?{year:'numeric'}:{})});
      list=`<section class="life-memory-browse" aria-label="浏览记忆">
        ${renderMemoryMonths(response)}
        <div class="life-memory-count" aria-live="polite">
          <span>${query?'全部月份 · 找到 ':'共 '}${memoryNumber.format(total)} 条</span>
          ${!query&&months.length>3?'<button type="button" data-lm-all-months>更多月份</button>':cards.length?`<span>${memoryNumber.format(offset+1)}–${memoryNumber.format(offset+cards.length)} 条</span>`:''}
        </div>
        ${pages>1?`<nav class="life-memory-pager" aria-label="记忆分页">
          <button type="button" data-lm-offset="${offset-MEMORY_PAGE_SIZE}" ${offset===0?'disabled':''}>上页</button>
          <span>${page} / ${pages} 页</span>
          <button type="button" data-lm-offset="${nextOffset}" ${nextOffset===null?'disabled':''}>下页</button>
        </nav>`:''}
        <div class="life-memory-list">
          ${cards.length?cards.map(card=>renderLifeMemoryCard(roleId,card,dateFormat)).join(''):
            `<div class="life-memory-empty">${query?'没有找到相关记忆':response.status==='archived'?'暂无已归档的记忆':'还没有共同记忆'}</div>`}
        </div>
      </section>`;
    }
    return `<section class="engine-content life-library-panel life-memory-panel">
      <div class="life-memory-toolbar">
        <div class="life-memory-heading"><h3>共同记忆</h3><button type="button" class="life-memory-add" data-engine-action="lm-add-memory">添加记忆</button></div>
        <form id="lm-search-form" class="lm-toolbar"><input type="search" id="lm-search-input" maxlength="200" value="${esc(view.query)}" placeholder="搜索记忆" aria-label="搜索记忆" enterkeyhint="search"><button type="submit">搜索</button></form>
        <div class="life-memory-tools"><div class="lm-filters" aria-label="记忆状态">${filters}</div><button type="button" data-lm-manage>管理</button></div>
      </div>
      ${list}
    </section>`;
  }

  function renderRoleMemories(roleId,inline=false){
    const r=state()?.roles?.find(x=>x.id===roleId);
    if(!r)return page('共同记忆与迁移',note('找不到这位好友。'));
    if(inline&&ui.memTab==='cards')return renderLifeMemories(roleId);
    const expectedKey=`${roleId}:${ui.memStatus}:${ui.memQuery}`;
    const entry=ui.memCache.get(roleId),cached=entry?.key===expectedKey?entry:null;
    if(!cached&&ui.memTab==='cards')ensureMemLoaded(roleId);
    const cards=cached?.cards||[];
    let body='';
    if(ui.memTab==='cards'){
      let cardsHtml;
      if(!cached)cardsHtml=note('正在读取记忆…');
      else if(cached.error)cardsHtml=`<div class="lm-feedback" role="alert"><p>${esc(cached.error)}</p><button type="button" id="lm-retry">重新读取</button></div>`;
      else cardsHtml=cards.length?cards.map(c=>`<article class="lm-card"><div class="lm-card-top"><span class="lm-tag">${esc(MEM_TYPE_LABELS[c.memoryType]||'共同记忆')}</span><button type="button" class="lm-lock-btn ${c.locked?'locked':''}" aria-pressed="${!!c.locked}" data-lm-lock="${esc(c.id)}">${c.locked?'已锁定':'锁定'}</button></div><div class="lm-card-body">${esc(c.content)}</div><div class="lm-card-meta"><span>${c.status!=='active'&&c.lastMentionedAt>0?'最近聊到过':c.accessCount?`唤起 ${c.accessCount} 次`:''}</span><span class="tools">${c.status==='active'?'':'<button type="button" data-lm-restore="'+esc(c.id)+'">恢复记忆</button>'}<button type="button" data-lm-edit="${esc(c.id)}">编辑</button><button type="button" class="danger" data-lm-delete="${esc(c.id)}">删除</button></span></div></article>`).join(''):`<div class="lm-empty"><p>${ui.memQuery?'没有找到相关记忆':ui.memStatus==='archived'?'暂无已归档的记忆':'还没有共同记忆'}</p><span>${ui.memQuery?'换个关键词试试':'可从右上角添加，或从“导入与备份”导入。'}</span></div>`;
      body=`<form id="lm-search-form" class="lm-toolbar"><input type="search" id="lm-search-input" value="${esc(ui.memQuery)}" placeholder="搜索记忆" aria-label="搜索记忆" enterkeyhint="search"><button type="submit">搜索</button></form><div class="lm-controls"><div class="lm-filters" aria-label="记忆状态">${[['active','有效'],['archived','已归档']].map(([id,label])=>`<button type="button" data-mem-status="${id}" aria-pressed="${ui.memStatus===id}">${label}</button>`).join('')}</div><div class="lm-actions">${button('提炼记忆','lm-extract',false,`data-role-id="${esc(roleId)}"`)}${button('整理去重','lm-consolidate',false,`data-role-id="${esc(roleId)}"`)}</div></div>${cardsHtml}`;
    }else if(ui.memTab==='recall'){
      const result=ui.memRecallResults.get(roleId),results=result?.cards;
      const list=results?(results.length?results.map(c=>`<article class="lm-card"><div class="lm-card-top"><span class="lm-tag">${esc(MEM_TYPE_LABELS[c.memoryType]||'共同记忆')}</span></div><div class="lm-card-body">${esc(c.content)}</div></article>`).join(''):note('这句话暂时没有匹配到相关记忆。')):'';
      body=`${note('输入一句话，看看 TA 会想起哪些共同记忆。')}<form id="lm-recall-form" class="form-section">${field('测试语句','query',result?.query||'','text','例如：还记得我喜欢喝什么吗？')}<button type="submit" class="primary-btn weui-btn weui-btn_primary">测试回忆</button></form>${list}`;
    }else{
      const imp=ui.importState?.roleId===roleId?ui.importState:null;
      let previewHtml='';
      if(imp?.preview){
        const p=imp.preview;
        const groupsHtml=(p.groups||[]).map((g,idx)=>`<label class="lm-scope-row"><input type="checkbox" name="importScope" value="${esc(g.scopeKey)}" checked><span><b>${esc(g.personaId)} · ${esc(g.sessionId)}</b> (${g.activeCount}/${g.count} 条)<small>示例：${esc(g.sample)}</small></span></label>`).join('');
        previewHtml=`<p class="section-title">已解析文件：${esc(imp.fileName)}（共 ${p.validCount} 条有效记忆）</p><form id="lm-import-exec-form"><div class="section">${groupsHtml||note('文件中没有发现可导入分组')}</div><div class="form-section"><label class="check-row"><input type="checkbox" name="includeArchived">同时导入已归档/旧记忆</label><button type="submit" class="primary-btn weui-btn weui-btn_primary">导入勾选分组到当前角色</button></div></form>`;
      }
      body=`${note('导入 LivingMemory 的 JSON / CSV 记忆文件，最大 128 MB。')}<div class="form-section">${button('选择文件','lm-pick-import',true)}${button('导出这位好友的记忆','lm-export-json',false,`data-role-id="${esc(roleId)}"`)}<input type="file" id="lm-import-file" accept=".json,.csv,application/json,text/csv" hidden></div>${previewHtml}`;
    }
    if(inline)return `<section class="engine-content life-library-panel life-memory-panel">
      <div class="life-memory-tool-heading"><button type="button" data-mem-tab="cards">${P().icons.back} 共同记忆</button><h3>${ui.memTab==='recall'?'测试回忆':'导入与备份'}</h3></div>
      ${body}
    </section>`;
    const tabs=`<div class="engine-subtabs" role="tablist" aria-label="共同记忆">${[['cards','记忆卡片'],['recall','测试回忆'],['migrate','导入与备份']].map(([id,label])=>`<button type="button" role="tab" aria-selected="${ui.memTab===id}" class="${ui.memTab===id?'active':''}" data-mem-tab="${id}">${label}</button>`).join('')}</div>`;
    const rightBtn=ui.memTab==='cards'?`<button type="button" class="icon-btn" data-engine-action="lm-add-memory" data-role-id="${esc(roleId)}" aria-label="添加记忆">${P().icons.add}</button>`:'';
    return page(`${r.remark||r.name} · 共同记忆`,tabs+body,rightBtn);
  }

  function renderStickers(roleId,inline=false) {
    const role=state().roles.find(item=>item.id===roleId);if(!role)return page('TA 的表情库',note('找不到这位朋友。'));
    const stickers=role.stickers||[],editing=ui.lifeStickerEditing.has(roleId),canRemove=!inline||editing;
    const thumbs=stickers.map((sticker,index)=>{
      const name=sticker.name||'表情 '+(index+1);
      return `<button type="button" data-role-sticker="${esc(sticker.id)}" aria-label="${canRemove?'移除':'查看'}表情：${esc(name)}"><img src="${esc(sticker.image)}" alt="" loading="lazy">${canRemove?'<span class="sticker-delete-mark" aria-hidden="true">×</span>':''}</button>`;
    }).join('');
    if(inline){
      return `<section class="life-library-panel life-stickers sticker-manager">
        <div class="life-sticker-heading"><h3>TA 的表情库 <small>${stickers.length} 张</small></h3>${stickers.length?`<button type="button" data-role-stickers-edit>${editing?'完成':'管理'}</button>`:''}</div>
        <div class="sticker-grid"><button type="button" class="add-sticker" data-engine-action="add-role-sticker" aria-label="从我的表情库添加">${P().icons.add}<span>添加</span></button>${thumbs||'<p>从我的表情库选择，可一次添加多张</p>'}</div>
      </section>`;
    }
    return page('TA 的表情库',`<div class="sticker-manager"><div class="sticker-grid">${thumbs}</div>${button('从我的表情包库添加','add-role-sticker')}</div>${note('点按可移除，不会删除我的表情包库中的原图。')}`);
  }
  function renderReminders(roleId) {
    const {body,action}=window.PipiReminders.render(roleId);
    return page('TA 的提醒',body,action);
  }
  function newModel(sourceId,model,info={}) {return {id:crypto.randomUUID(),sourceId,model,kind:info.kind||'chat',protocol:'auto',capabilities:info.kind&&info.kind!=='chat'?[]:info.capabilities||['text','image','audio','tool_use'],maxContextTokens:0,temperature:null,maxTokens:null,timeoutSeconds:null,extraBody:{},voice:''};}
  function editSource(id) {
    const source=ai().sources.find(item=>item.id===id)||{id:crypto.randomUUID(),name:'',baseUrl:'',keySet:false,builtin:false};
    P().openPage(id?'服务商':'添加其他服务商',`${source.builtin?note(source.name)+(source.baseUrl?note(source.baseUrl):note('尚未配置地址')):note('支持 OpenAI 兼容接口（与 OpenAI 相同的请求格式）。请填写服务商提供的地址和密钥。')+field('服务商名称','name',source.name)+field('接口地址','baseUrl',source.baseUrl,'url')}${field('API Key','key','','password',source.keySet?'已保存；留空保留':'也可先留空，回到模型页粘贴密钥并获取模型。')}<label class="check-row"><input type="checkbox" name="clearKey">清除已保存的密钥</label>`,async form=>{const values=Object.fromEntries(new FormData(form));const next={...source,...(source.builtin?{}:{name:values.name,baseUrl:values.baseUrl}),key:values.key,clearKey:!!form.elements.clearKey.checked};if(!next.baseUrl&&next.key)throw new Error('尚未配置地址，不能保存密钥');await saveAI({...ai(),sources:id?ai().sources.map(item=>item.id===id?next:item):[...ai().sources,next]});if(!id)ui.sourceId=next.id;P().closePage();P().refresh();P().toast('服务商已保存，可获取模型');},'保存');
  }
  const modelProtocols={
    stt:[['transcription','OpenAI 语音转写'],['mimo-asr','MiMo 语音识别'],['qwen-omni','千问 Omni'],['audio-chat','音频对话']],
    tts:[['openai-speech','OpenAI 语音合成'],['breezeblue','BreezeBlue'],['minimax','MiniMax'],['qwen-tts','千问语音合成']],
    decision:[['chat','聊天接口判断'],['system-one','System One']]
  };
  const protocolOptions=kind=>[{value:'auto',label:'自动识别（按服务商与模型名）'},...(modelProtocols[kind]||[]).map(([value,label])=>({value,label}))];
  function modelNumber(value,min,max,label,integer=false) {
    const number=Number(value);
    if(!Number.isFinite(number)||number<min||number>max||integer&&!Number.isSafeInteger(number)){
      throw new Error(`${label}范围为 ${min} 到 ${max}${integer?' 的整数':''}`);
    }
    return number;
  }
  function editModel(id,{nested=false,draftModel,source:draftSource,onConfirm,fixedName=false}={}) {
    const model=draftModel||ai().models.find(item=>item.id===id)||newModel(ui.sourceId,'');
    const source=draftSource||ai().sources.find(item=>item.id===model.sourceId);
    const kindNames={chat:'对话',stt:'语音转文字',tts:'文字转语音',image:'生成图片',embedding:'嵌入',decision:'判断',rerank:'重排序'};
    const chat=model.kind==='chat';
    const identity=`<p class="model-identity">${esc(source.name)} · ${kindNames[model.kind]}</p>`;
    const capabilities=chat?`<div class="engine-capabilities"><p class="field-label">模型能力</p>${[['text','文本'],['image','识图'],['audio','音频'],['tool_use','工具使用']].map(([key,label])=>`<label class="check-row"><input type="checkbox" name="capabilities" value="${key}" ${model.capabilities.includes(key)?'checked':''}>${label}</label>`).join('')}</div>`:'';
    const capacity=chat?field('上下文容量','maxContextTokens',model.maxContextTokens??0,'number','0 = 自动识别')+'<p class="model-capacity-status" id="model-capacity-status" role="status">正在读取容量…</p>':'';
    const parameters=`<label class="form-field"><span class="field-label">${onConfirm?'请求参数（JSON）':'额外参数（JSON）'}</span><textarea name="extraBody">${esc(JSON.stringify(model.extraBody||{},null,2))}</textarea></label>`;
    const advanced=(modelProtocols[model.kind]?select('调用方式','protocol',model.protocol||'auto',protocolOptions(model.kind)):'')+(chat?field('温度','temperature',model.temperature??'','number','留空使用服务商默认值')+field('最大回复长度','maxTokens',model.maxTokens??'','number','单位：Token'):'')+field('超时（秒）','timeoutSeconds',model.timeoutSeconds??'','number','留空使用默认超时')+(onConfirm?'':parameters);
    const modelName=fixedName?`<div class="form-field"><span class="field-label">模型 ID</span><span>${esc(model.model)}</span><input type="hidden" name="model" value="${esc(model.model)}"></div>`:field('模型名称','model',model.model);
    const body=identity+`<div class="model-edit-group">${modelName}${capabilities}${onConfirm?parameters:''}${capacity}</div><details class="engine-details model-parameters"><summary>更多参数</summary><div class="model-edit-group">${advanced}</div></details>`;
    const open=onConfirm?P().openModal:nested?P().openNestedPage:P().openPage;
    open(id?'编辑模型':fixedName?'添加模型':'手动添加模型',body,async form=>{
      const values=Object.fromEntries(new FormData(form));
      let extraBody;try{extraBody=JSON.parse(values.extraBody);}catch{throw new Error('额外参数应为 JSON 对象');}
      if(!extraBody||Array.isArray(extraBody)||typeof extraBody!=='object')throw new Error('额外参数应为 JSON 对象');
      if(JSON.stringify(extraBody).length>32768)throw new Error('额外参数最多 32768 字符');
      const name=values.model.trim();if(!name)throw new Error('请填写模型名称');
      const next={...model,model:name,extraBody};
      next.timeoutSeconds=values.timeoutSeconds===''?null:modelNumber(values.timeoutSeconds,1,600,'超时');
      if(modelProtocols[model.kind])next.protocol=values.protocol;
      if(chat){
        next.maxContextTokens=modelNumber(values.maxContextTokens,0,100000000,'上下文容量',true);
        next.temperature=values.temperature===''?null:modelNumber(values.temperature,0,2,'温度');
        next.maxTokens=values.maxTokens===''?null:modelNumber(values.maxTokens,1,10000000,'最大回复长度',true);
        await refreshMetadata(name,next.maxContextTokens);
        if(!form.isConnected||!isCurrent())return;
        next.capabilities=[...form.querySelectorAll('[name="capabilities"]:checked')].map(input=>input.value);
      }
      if(onConfirm){onConfirm(next);P().closePage();P().refresh();return;}
      const models=id?ai().models.map(item=>item.id===id?next:item):[...ai().models,next];
      await saveAI({...ai(),models});
      if(!form.isConnected||!isCurrent())return;
      P().closePage();P().refresh();P().toast('模型已保存');
    },onConfirm?'确认':'保存');
    const root=document.querySelector('#overlay > .page-editor');
    const isCurrent=()=>root.isConnected&&root===document.querySelector('#overlay > .page-editor');
    root.classList.add('model-parameter-page');
    if(onConfirm){
      root.classList.add('model-sheet','model-ui','provider-model-sheet');
      const actions=document.createElement('div');actions.className='provider-model-actions';
      actions.append(root.querySelector('.modal-close'),root.querySelector('.modal-submit'));
      root.querySelector('.modal-error').before(actions);
    }
    let metadataKey='',capabilityName=model.model.trim(),metadataName=capabilityName,metadataReady=Promise.resolve(),manualRevision=0,nameRevision=0;
    function refreshMetadata(name,limit){
      const protocol=root.querySelector('[name="protocol"]')?.value||'auto';
      const key=JSON.stringify([name.trim(),limit,protocol]);if(key===metadataKey)return metadataReady;
      metadataKey=key;const nameChanged=name.trim()!==capabilityName;
      if(metadataName!==name.trim()){metadataName=name.trim();nameRevision=manualRevision;}
      const status=root.querySelector('#model-capacity-status'),revision=nameRevision;
      if(status)status.textContent=name.trim()?'正在读取容量…':'填写型号后自动识别';
      metadataReady=P().api('/api/engine/models/metadata',{model:name.trim(),kind:model.kind,protocol,sourceId:model.sourceId,...(draftSource?{baseUrl:source.baseUrl,template:source.template}:{}),maxContextTokens:limit}).then(info=>{
        if(metadataKey!==key||!isCurrent())return;
        root.querySelector('[name="timeoutSeconds"]').placeholder=`默认 ${info.timeoutSeconds} 秒`;
        if(!status||!name.trim())return;
        if(nameChanged&&manualRevision===revision)root.querySelectorAll('[name="capabilities"]').forEach(input=>{input.checked=info.capabilities.includes(input.value);});
        capabilityName=name.trim();
        const capacity=info.capacity,matched=info.matchedModel||capacity?.matchedModel;
        status.textContent=capacity.source==='manual'?`当前使用 ${capacity.value.toLocaleString()} Token（手动）`:capacity.recognized?`已识别${matched?' '+matched:''} · ${capacity.value.toLocaleString()} Token`:info.needsChoice?`型号不明确，请补充具体型号：${info.candidates.join('、')}`:`未识别 · 暂按 ${capacity.value.toLocaleString()} Token`;
        if(info.warning)P().toast(info.warning);
      }).catch(error=>{
        if(metadataKey!==key||!isCurrent())return;
        metadataKey='';if(status)status.textContent='容量读取失败：'+error.message;
        throw error;
      });
      return metadataReady;
    }
    const nameInput=root.querySelector('[name="model"]'),capacityInput=root.querySelector('[name="maxContextTokens"]'),protocolInput=root.querySelector('[name="protocol"]');
    const update=()=>task(()=>refreshMetadata(nameInput.value,Number(capacityInput?.value||0)));
    root.querySelectorAll('[name="capabilities"]').forEach(input=>input.onchange=()=>{manualRevision++;});
    nameInput.onchange=update;if(capacityInput)capacityInput.oninput=update;if(protocolInput)protocolInput.onchange=update;
    update();
  }

  function bindVoiceSettings(form){
    form.elements.enabled.onchange=()=>{
      sessionStorage.setItem(voiceDraftKey,JSON.stringify({...voiceDraft(),enabled:form.elements.enabled.checked}));
    };
    form.querySelector('[data-model-pref="voice-model"]').onclick=()=>{
      window.PipiModels.chooseTtsModel(ui.config,voiceSelection().tts,tts=>{
        const draft=voiceDraft();
        if(tts===state().settings.ai.assign.tts)delete draft.tts;
        else draft.tts=tts;
        sessionStorage.setItem(voiceDraftKey,JSON.stringify(draft));
        P().refresh();
      });
    };
    form.onsubmit=event=>{
      event.preventDefault();
      const {ready,tts}=voiceSelection();
      if(ui.voiceSaving||!ready)return;
      const values={enabled:form.elements.enabled.checked};
      ui.voiceSaving=true;
      form.querySelector('fieldset').disabled=true;
      form.querySelector('[type="submit"]').disabled=true;
      task(async()=>{
        try{
          const result=await P().api('/api/engine/modules',{id:'voice',values,...(tts!==state().settings.ai.assign.tts?{tts}:{})});
          sessionStorage.removeItem(voiceDraftKey);
          if(ui.config)acceptConfig(result);
          P().toast('设置已保存');
        }finally{
          ui.voiceSaving=false;
          if(document.querySelector('#engine-module-form[data-module="voice"]'))P().refresh();
        }
      });
    };
  }

  function bind(name,arg) {
    if(name==='engine-module'&&arg==='caption')name='engine-home';
    if(name==='life-workbench'||name==='role-config'&&P().rolePanelAvailable?.()&&window.PipiLife){window.PipiLife?.bind(arg);return;}
    if(!names.has(name))return;
    const pending=document.querySelector('#view [data-config-loading]');
    if(pending){readPageConfig(pending);return;}
    if(name==='engine-usage'){window.PipiUsage.bind();return;}
    if(name==='providers'){window.PipiModels.bind();return;}
    if(name==='engine-home')window.PipiModels.bindPreferences();
    if(name==='engine-module'&&arg==='schedule')bindScheduleSettings();
    if(name==='engine-module'&&arg==='scheduler')window.PipiReminders.bindOverview();
    bindEngineActions(document,arg);
    const moduleForm=document.querySelector('#engine-module-form');
    if(moduleForm?.dataset.module==='voice')bindVoiceSettings(moduleForm);
    else if(moduleForm?.dataset.module==='outreach')bindOutreachSettings(moduleForm);
    else if(moduleForm)moduleForm.onsubmit=event=>{
      event.preventDefault();
      task(async()=>{
        const id=moduleForm.dataset.module,module=ui.config.modules.find(item=>item.id===id),values={};
        for(const setting of module.settings){
          if(id==='actions'&&setting.key==='allowVoice')continue;
          const input=moduleForm.elements[setting.key];
          if(setting.unit==='yuan'){
            const amount=input.valueAsNumber,cents=Math.round(amount*100);
            if(cents/100!==amount)throw new Error(`${setting.label}最多填写两位小数`);
            values[setting.key]=cents;
          }else values[setting.key]=setting.type==='boolean'?input.checked:['number','integer'].includes(setting.type)?Number(input.value):input.value;
        }
        const result=await P().api('/api/engine/modules',{id,values});
        if(result.state)P().setState(result.state);
        await load();P().toast('设置已保存');
      });
    };
    if(name==='role-reminders')window.PipiReminders.bind(arg);
    if(name==='role-stickers')bindRoleStickers(arg,document);

    if(name==='role-references')bindReferences(arg);
    if(name==='role-schedule')window.PipiSchedule.bind(arg);
    if(name==='memories')bindMemories(arg);
  }

  function bindEngineActions(root,roleId){
    root.querySelectorAll('[data-engine-action]').forEach(control=>control.onclick=()=>task(()=>action(control.dataset.engineAction,control,roleId)));
  }
  function bindRoleStickers(roleId,root,preview){
    const edit=root.querySelector('[data-role-stickers-edit]');
    if(edit)edit.onclick=()=>{
      if(ui.lifeStickerEditing.has(roleId))ui.lifeStickerEditing.delete(roleId);
      else ui.lifeStickerEditing.add(roleId);
      P().refresh();
    };
    root.querySelectorAll('[data-role-sticker]').forEach(control=>control.onclick=()=>{
      const id=control.dataset.roleSticker;
      const role=()=>state().roles.find(item=>item.id===roleId);
      if(preview&&!ui.lifeStickerEditing.has(roleId)){
        preview(role().stickers.find(item=>item.id===id).image);
        return;
      }
      P().confirmDialog('移除这张表情？','只从这位好友的表情库移除。',async()=>{
        await P().act('role.save',{id:roleId,stickers:role().stickers.filter(item=>item.id!==id)});
        if(!role().stickers.length)ui.lifeStickerEditing.delete(roleId);
      },'移除');
    });
  }
  function renderRoleLibrary(kind,roleId){
    return kind==='memory'?renderRoleMemories(roleId,true):renderStickers(roleId,true);
  }
  function bindRoleLibrary(kind,roleId,root,previewSticker){
    bindEngineActions(root,roleId);
    if(kind==='memory')bindMemories(roleId,root);
    else bindRoleStickers(roleId,root,previewSticker);
  }

  function bindReferences(roleId,root=document){
    const role=state()?.roles?.find(r=>r.id===roleId);if(!role)return;
    const input=root.querySelector('#ref-image-input');
    let targetField;
    root.querySelectorAll('[data-ref-upload]').forEach(btn=>btn.onclick=()=>{
      [targetField]=btn.dataset.refUpload.split(':');
      input.click();
    });
    if(input)input.onchange=()=>task(async()=>{
      const file=input.files[0],fieldKey=targetField;
      input.value='';if(!file||!fieldKey)return;
      const url=await P().uploadProfileImage(file,{requireUrl:true});
      const current=state().roles.find(r=>r.id===roleId);
      const next=[...(current[fieldKey]||[]),url].slice(0,3);
      await P().act('role.save',{id:roleId,[fieldKey]:next});
      P().refresh();P().toast('参考图已上传');
    });
    async function updateReference(target,remove){
      const [fieldKey,idxStr]=target.split(':'),idx=Number(idxStr);
      const arr=[...(state().roles.find(r=>r.id===roleId)[fieldKey]||[])];
      const [picked]=arr.splice(idx,1);if(!remove)arr.unshift(picked);
      await P().act('role.save',{id:roleId,[fieldKey]:arr});P().refresh();
      P().toast(remove?'已移除参考图':'已设为主图');
    }
    root.querySelectorAll('[data-ref-primary]').forEach(btn=>btn.onclick=()=>task(()=>updateReference(btn.dataset.refPrimary,false)));
    root.querySelectorAll('[data-ref-remove]').forEach(btn=>btn.onclick=()=>task(()=>updateReference(btn.dataset.refRemove,true)));
    root.querySelectorAll('[data-ref-menu]').forEach(btn=>btn.onclick=()=>{
      const target=btn.dataset.refMenu,[key,index]=target.split(':'),actions=[];
      if(Number(index)>0)actions.push({label:'设为主图',run:()=>updateReference(target,false)});
      actions.push({label:'移除',danger:true,run:()=>updateReference(target,true)});
      P().actionSheet((key==='faceReferences'?'三视图':'全身图')+' · 第'+(Number(index)+1)+'张',actions);
    });
  }

  function bindMemories(roleId,root=document){
    const inline=root!==document;
    const life=inline?lifeMemoryView(roleId):null;
    const chooseTab=tab=>{ui.memTab=tab;P().refresh({resetScroll:true});};
    root.querySelectorAll('[data-mem-tab]').forEach(btn=>btn.onclick=()=>chooseTab(btn.dataset.memTab));
    const manage=root.querySelector('[data-lm-manage]');
    if(manage)manage.onclick=()=>P().actionSheet('记忆管理',[
      {label:'测试回忆',run:()=>chooseTab('recall')},
      {label:'导入与备份',run:()=>chooseTab('migrate')},
      {label:'提炼记忆',run:()=>action('lm-extract',manage,roleId)},
      {label:'整理去重',run:()=>action('lm-consolidate',manage,roleId)}
    ]);
    root.querySelectorAll('[data-life-memory-id]').forEach(card=>card.ontoggle=()=>{
      const key=roleId+':'+card.dataset.lifeMemoryId;
      if(card.open)ui.memExpanded.add(key);else ui.memExpanded.delete(key);
    });
    const search=root.querySelector('#lm-search-input'),searchForm=root.querySelector('#lm-search-form'),retry=root.querySelector('#lm-retry');
    const searchCards=()=>{
      const query=search.value.trim();
      if(life){
        if(query===life.query)return;
        life.query=query;life.searchOffset=0;
        loadLifeMemories(roleId);
      }else{ui.memQuery=query;P().refresh();}
    };
    if(searchForm)searchForm.onsubmit=event=>{event.preventDefault();searchCards();};
    if(search)search.onsearch=searchCards;
    if(search&&life)search.oninput=()=>{if(!search.value&&life.query)searchCards();};
    if(retry)retry.onclick=()=>refreshMemoryCards(roleId);
    root.querySelectorAll('[data-mem-status]').forEach(btn=>btn.onclick=()=>{
      const status=btn.dataset.memStatus;
      if(life){
        if(status===life.status)return;
        life.status=status;life.searchOffset=0;
        loadLifeMemories(roleId);
      }else{ui.memStatus=status;P().refresh({resetScroll:true});}
    });
    if(life){
      const chooseMonth=month=>{
        const browse=life.browse[life.status];
        if(browse.month===month)return;
        browse.month=month;browse.offset=0;
        return loadLifeMemories(roleId);
      };
      root.querySelectorAll('[data-lm-month]').forEach(btn=>btn.onclick=()=>chooseMonth(btn.dataset.lmMonth));
      root.querySelectorAll('[data-lm-offset]').forEach(btn=>btn.onclick=()=>{
        const offset=Number(btn.dataset.lmOffset);
        if(life.query)life.searchOffset=offset;else life.browse[life.status].offset=offset;
        loadLifeMemories(roleId);
      });
      const moreMonths=root.querySelector('[data-lm-all-months]');
      if(moreMonths)moreMonths.onclick=()=>{
        P().actionSheet('选择月份',life.response.months.map(({month,count,label})=>({
          label:(label||memoryMonthLabel(month))+' · '+memoryNumber.format(count)+' 条',run:()=>chooseMonth(month)
        })));
        document.querySelector('#overlay .sheet-actions').classList.add('life-memory-month-picker');
      };
    }
    root.querySelectorAll('[data-lm-restore]').forEach(btn=>btn.onclick=()=>task(async()=>{
      const res=await P().api('/api/engine/memory',{roleId,action:'restore',id:btn.dataset.lmRestore});
      P().setState(res.state);await refreshMemoryCards(roleId);P().toast('已恢复到当前记忆');
    }));
    root.querySelectorAll('[data-lm-lock]').forEach(btn=>btn.onclick=()=>task(async()=>{
      const res=await P().api('/api/engine/memory',{roleId,action:'toggleLock',id:btn.dataset.lmLock});
      P().setState(res.state);await refreshMemoryCards(roleId);
    }));
    root.querySelectorAll('[data-lm-edit]').forEach(btn=>btn.onclick=()=>{
      const cards=life?life.response?.cards:ui.memCache.get(roleId)?.cards;
      const card=cards?.find(c=>c.id===btn.dataset.lmEdit);if(!card)return;
      const types=Object.entries(MEM_TYPE_LABELS).filter(([value])=>value!=='GENERAL'||card.memoryType==='GENERAL').map(([value,label])=>({value,label}));
      P().openModal('编辑记忆',field('记忆内容','content',card.content,'textarea')+select('分类','memoryType',card.memoryType||'FACT',types),async form=>{
        const content=form.elements.content.value.trim();if(!content)throw new Error('记忆内容不能为空');
        const res=await P().api('/api/engine/memory',{roleId,action:'update',id:card.id,content,memoryType:form.elements.memoryType.value,importance:card.importance,locked:card.locked});
        P().setState(res.state);P().closeModal();await refreshMemoryCards(roleId);P().toast('记忆已更新');
      });
    });
    root.querySelectorAll('[data-lm-delete]').forEach(btn=>btn.onclick=()=>P().confirmDialog('删除这条记忆？','删除后 TA 将不再从共同记忆里读取这条记录。',async()=>{
      const res=await P().api('/api/engine/memory',{roleId,action:'delete',id:btn.dataset.lmDelete});
      P().setState(res.state);await refreshMemoryCards(roleId);
    },'删除'));
    const recForm=root.querySelector('#lm-recall-form');
    if(recForm)recForm.onsubmit=event=>{event.preventDefault();task(async()=>{
      const query=recForm.elements.query.value;
      const res=await P().api('/api/engine/memory',{roleId,action:'recall',query});
      ui.memRecallResults.set(roleId,{query,cards:res.cards});P().refresh();
    });};
    const fileInput=root.querySelector('#lm-import-file');
    if(fileInput)fileInput.onchange=()=>task(async()=>{
      const file=fileInput.files?.[0];fileInput.value='';if(!file)return;
      if(file.size>128*1024*1024)throw new Error('导入文件不能超过 128 MB');
      const format=file.name.toLowerCase().endsWith('.csv')?'csv':'json';
      P().toast('正在解析迁移文件，请稍候…');
      const res=await P().apiRaw(`/api/engine/memory/import?mode=preview&format=${format}`,file,'application/octet-stream');
      ui.importState={roleId,file,fileName:file.name,format,preview:res.preview};
      P().refresh();
    });
    const impForm=root.querySelector('#lm-import-exec-form');
    if(impForm)impForm.onsubmit=event=>{event.preventDefault();task(async()=>{
      if(ui.importState?.roleId!==roleId)throw new Error('请先选择导入文件');
      const scopes=[...impForm.querySelectorAll('[name=importScope]:checked')].map(el=>el.value);
      const includeArchived=Boolean(impForm.elements.includeArchived?.checked);
      if(!scopes.length&&(ui.importState.preview?.groups?.length||0)>0)throw new Error('请至少勾选一个分组');
      P().toast('正在写入记忆库…');
      const qs=new URLSearchParams({mode:'execute',format:ui.importState.format,roleId,includeArchived:includeArchived?'1':'0',scopes:JSON.stringify(scopes)});
      const res=await P().apiRaw(`/api/engine/memory/import?${qs.toString()}`,ui.importState.file,'application/octet-stream');
      P().setState(res.state);ui.importState=null;ui.memTab='cards';
      await refreshMemoryCards(roleId);
      P().toast(`已成功导入 ${res.result.importedCount} 条记忆`+(res.result.skippedDuplicateCount?`（跳过重复 ${res.result.skippedDuplicateCount} 条）`:''));
    });};
  }

  function addRoleStickers(roleId) {
    const role=state().roles.find(item=>item.id===roleId),stickers=state().stickers;
    P().openPage('我的表情包库',stickers.length?`<div class="engine-sticker-picker">${stickers.map((sticker,index)=>{
      const added=role.stickers.some(item=>item.image===sticker.image),name=sticker.name||'表情 '+(index+1);
      return `<label class="engine-sticker-choice${added?' is-added':''}"><input type="checkbox" name="stickerIds" value="${esc(sticker.id)}" ${added?'disabled':''}><span class="engine-sticker-thumb"><img src="${esc(sticker.image)}" alt="${esc(name)}"><span class="engine-sticker-check" aria-hidden="true">${P().icons.check}</span>${added?'<span class="engine-sticker-added">已添加</span>':''}</span><span class="engine-sticker-name">${esc(name)}</span></label>`;
    }).join('')}</div>`:note('表情包库还是空的，先去添加表情。'),stickers.length?async form=>{
      const stickerIds=new FormData(form).getAll('stickerIds');
      await P().act('role.stickers.add',{roleId,stickerIds});
      if(form.isConnected){P().closePage();P().refresh();}
    }:null,'添加');
    const form=document.querySelector('#overlay .modal-form'),submit=form.querySelector('[type=submit]');
    if(submit){
      const update=()=>{const count=form.querySelectorAll('[name=stickerIds]:checked').length;submit.disabled=!count;submit.textContent=count?'添加 ('+count+')':'添加';};
      form.addEventListener('change',update);update();
    }else{
      const control=document.createElement('button');control.type='button';control.className='secondary-btn block-btn';control.textContent='添加表情';
      control.onclick=()=>{P().closePage();P().showView('stickers');};form.querySelector('.modal-body').append(control);
    }
  }
  async function action(action,control,arg) {
    if(action==='usage'){await window.PipiUsage.open();return;}
    const routes={models:'providers',functions:'engine-functions'};
    if(routes[action]){openSettings(routes[action]);return;}
    if(action==='moments-settings'){window.PipiFeatures?.manageMoments?.();return;}
    if(action==='timezone'){pickTimezone();return;}
    if(action==='module-choice'){
      const form=control.form,id=form.dataset.module;
      const setting=ui.config.modules.find(item=>item.id===id).settings.find(item=>item.key===control.dataset.setting);
      const input=form.elements[setting.key],options=moduleChoices(id,setting);
      const display=control.querySelector('.cell-value');
      window.PipiModels.singleChoiceSheet(control.querySelector('.cell-title').textContent,options,input.value,value=>{
        input.value=value;
        display.textContent=options.find(option=>option.value===value).label;
        form.querySelectorAll(`[data-setting-mode="${setting.key}"]`).forEach(field=>{field.hidden=field.dataset.settingValue!==value;});
      },{selectImmediately:true});
      return;
    }
    if(action==='module'){P().showView('engine-module',control.dataset.module);return;}
    if(action==='add-source'||action==='edit-source'){editSource(control.dataset.source);return;}
    if(action==='manual-model'||action==='edit-model'){editModel(control.dataset.model);return;}
    if(action==='extract-memory'||action==='lm-extract'){
      const roleId=control.dataset.roleId||arg;if(!roleId)return;
      control.disabled=true;try{const res=await P().api('/api/engine/memory/extract',{roleId});P().setState(res.state);await load();await refreshMemoryCards(roleId);P().toast(res.added?.length?`已提炼 ${res.added.length} 条新记忆`:'暂未发现新的重要记忆');}finally{control.disabled=false;}return;
    }
    if(action==='lm-consolidate'){
      const roleId=control.dataset.roleId||arg;if(!roleId)return;
      const res=await P().api('/api/engine/memory',{roleId,action:'consolidate'});P().setState(res.state);await refreshMemoryCards(roleId);
      P().toast(res.archivedCount?`已合并整理 ${res.archivedCount} 条重复/过期小事`:'当前记忆库已经很整洁了');return;
    }
    if(action==='lm-add-memory'){
      const roleId=control.dataset.roleId||arg;if(!roleId)return;
      P().openModal('添加记忆',field('记忆内容','content','','textarea','例如：我只喝热拿铁，而且对花生过敏。')+select('分类','memoryType','FACT',[{value:'FACT',label:'个人事实'},{value:'PREFERENCE',label:'喜好忌口'},{value:'EVENT',label:'重要经历'},{value:'RELATIONSHIP',label:'关系点滴'},{value:'PLAN',label:'约定计划'}]),async form=>{
        const content=form.elements.content.value.trim();if(!content)throw new Error('请填写要记住的内容');
        const res=await P().api('/api/engine/memory',{roleId,action:'add',content,memoryType:form.elements.memoryType.value,importance:0.85,locked:true});
        P().setState(res.state);P().closeModal();await refreshMemoryCards(roleId);P().toast('已保存并锁定记忆');
      });return;
    }
    if(action==='lm-pick-import'){document.querySelector('#lm-import-file')?.click();return;}
    if(action==='lm-export-json'){
      const roleId=control.dataset.roleId;if(!roleId)return;
      const resp=await fetch('/api/engine/memory/export?roleId='+encodeURIComponent(roleId),{credentials:'same-origin'});
      if(!resp.ok)throw new Error('导出失败');
      const blob=await resp.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=`livingmemory-export-${roleId.slice(0,8)}.json`;document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);P().toast('记忆备份已开始下载');return;
    }
    if(action==='add-role-sticker')addRoleStickers(arg);
  }
  function pickTimezone() {
    const timezone=ui.config.timezone||defaultTimezone;
    const choices=timezones.some(item=>item.value===timezone)?timezones:[...timezones,{value:timezone,label:timezoneLabel(timezone)}];
    P().actionSheet('选择时区',choices.map(item=>({label:item.label,icon:item.value===timezone?P().icons.check:'',run:async()=>{if(item.value===timezone)return;const result=await P().api('/api/engine/timezone',{timezone:item.value});P().setState(result.state);await load();P().refresh();}})));
    const sheet=document.querySelector('#overlay > .sheet-actions');sheet.classList.add('engine-timezone-sheet');sheet.setAttribute('aria-label','选择时区');
    const list=document.createElement('div');list.className='engine-timezone-options';
    sheet.querySelectorAll('[data-sheet]').forEach((button,index)=>{button.setAttribute('aria-pressed',String(choices[index].value===timezone));list.append(button);});
    sheet.querySelector('.sheet-caption').after(list);
  }
  function serviceReady(kind) {
    const settings=state()?.settings?.ai,model=settings?.models.find(item=>item.id===settings.assign[kind]);
    if(!model?.model||model.enabled===false)return false;
    const source=settings.sources.find(item=>item.id===model.sourceId);
    return Boolean(source?.baseUrl&&source.keySet);
  }
  async function sync() {if(ui.syncing){ui.resync=true;return;}ui.syncing=true;try{do{ui.resync=false;const result=await P().api('/api/state?since='+P().getState().revision);if(!result.unchanged)P().receiveState(result.state||result);}while(ui.resync);}catch(error){if(error.status!==401)console.debug('实时状态更新失败，将通过定时刷新重试');}finally{ui.syncing=false;}}
  function setChatProgress({roleId,typing,slow}){
    if(typing)ui.typing.add(roleId);else ui.typing.delete(roleId);
    P().updateTyping(roleId,slow);
  }
  function start() {
    if(ui.started||!P()?.getState())return;ui.started=true;
    task(async()=>{const config=await load();if(ui.config===config&&!config.timezone){const result=await P().api('/api/engine/timezone',{timezone:defaultTimezone});if(ui.config===config){P().setState(result.state);config.timezone=defaultTimezone;}}});
    if(!window.EventSource)return;
    ui.events=new EventSource('/api/events');
    ui.events.addEventListener('open',()=>{ui.typing.clear();window.WaterdropChat?.setConnected(true);P().updateTyping();P().syncChatProgress?.();sync();});
    ui.events.addEventListener('error',()=>{ui.typing.clear();window.WaterdropChat?.setConnected(false);P().updateTyping();});
    ui.events.addEventListener('revision',event=>{const data=JSON.parse(event.data);if(data.revision>state().revision)sync();});
    ui.events.addEventListener('typing',event=>setChatProgress(JSON.parse(event.data)));
  }
  function stop() {ui.events?.close();ui.events=null;ui.started=false;ui.config=null;ui.configRevision=null;ui.readOnEntry=false;ui.loading=null;ui.typing.clear();window.PipiReminders?.reset();ui.memCache.clear();ui.memRecallResults.clear();ui.importState=null;ui.activity.clear();sessionStorage.removeItem(scheduleDraftKey);sessionStorage.removeItem(voiceDraftKey);sessionStorage.removeItem(outreachDraftKey);window.PipiUsage?.reset();window.PipiSchedule?.reset();window.PipiModels?.reset();}
  function activity(roleId) {const now=Date.now();if(now-(ui.activity.get(roleId)||0)<2000)return;ui.activity.set(roleId,now);P().api('/api/engine/typing',{roleId}).catch(error=>{if(error.status!==401)console.debug('输入状态上报失败');});}
  function resetActivity(roleId) {ui.activity.delete(roleId);}
  function stopActivity(roleId) {resetActivity(roleId);P().api('/api/engine/typing',{roleId,active:false}).catch(error=>{if(error.status!==401)console.debug('输入状态解除失败');});}
  window.PipiEngine={render,bind,openSettings,renderRoleLibrary,bindRoleLibrary,renderRoleReferences,bindReferences,start,stop,activity,resetActivity,stopActivity,saveModels:saveAI,acceptConfig,newModel,editModel,setChatProgress,isTyping:roleId=>ui.typing.has(roleId),serviceReady,refreshConfig:load,invalidateJobs:roleId=>window.PipiReminders.invalidate(roleId)};
})();
