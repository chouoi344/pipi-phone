// SPDX-License-Identifier: AGPL-3.0-only
(() => {
  const P = () => window.Pipi;
  const esc = value => P().esc(value ?? '');
  const value = (ui, role, key) => ui.draft['basic.' + key] ?? role[key] ?? '';
  const fields = [['name','名字','给这位朋友起个名字'],['wechatId','微信号','填写微信号'],['voiceId','音色'],['region'],['outreach'],['bio','个性签名','TA 的一句话介绍'],['patText','拍一拍','填写后缀']];

  function image(ui, role, key, label) {
    const src = value(ui, role, key);
    const safe = /^\/api\/media\/[a-f\d]{32,64}\.(png|jpg|jpeg|webp|gif)$/i.test(src) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(src);
    const fallback = key === 'avatar' ? '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="17" r="9"/><path d="M8 43c0-11 7-17 16-17s16 6 16 17"/></svg>' : '';
    return `<div class="lb-image lb-image-${key}"><span class="lb-image-picture">${safe ? `<img src="${esc(src)}" alt="${label}预览">` : fallback}</span><button type="button" class="lb-image-action" data-pick-image="${key}">${safe?'更换':'选择'}${label==='头像'?'头像':'背景图'}</button><input type="file" data-basic-image="${key}" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.bmp,.avif" hidden></div>`;
  }

  function field(ui, role, [key, label, placeholder], outreachState) {
    if(key==='region')return region(ui,ui.data.schedule);
    if(key==='outreach')return outreach(outreachState);
    if(key==='voiceId'){
      const selected=voiceName(ui,value(ui,role,key));
      const availability=P().getState().voiceAvailability,available=availability.enabled;
      const enabled=ui.draft['basic.voiceMode']===undefined?ui.data.voiceAvailability.friendEnabled:ui.draft['basic.voiceMode']!=='off';
      const hint=!availability.modelReady?'请先在模型设置中添加并选择语音合成模型。':available?'':'请先在「发现 → 功能 → 发语音」开启总开关。';
      return `<label class="life-field life-check lb-voice-toggle"><span>启用语音</span><input type="checkbox" role="switch" data-basic-voice-toggle ${available&&enabled?'checked':''} ${available?'':'disabled'}></label>
        <div class="lb-voice-row"><span id="lb-voice-title">音色</span><button type="button" class="lb-voice" data-basic-voice ${available&&enabled?'':'disabled'} aria-labelledby="lb-voice-title lb-voice-name" aria-haspopup="listbox" aria-expanded="false" aria-controls="lb-voice-menu" popovertarget="lb-voice-menu"><span class="lb-voice-value"><span id="lb-voice-name" data-voice-name>${esc(selected)}</span><i aria-hidden="true"></i></span></button><div id="lb-voice-menu" class="lb-voice-menu" popover="auto" role="listbox" aria-label="选择音色"></div></div>${hint?`<p class="lb-voice-hint">${esc(hint)}</p>`:''}`;
    }
    const attrs = `data-life-field="${key}" aria-label="${label}" placeholder="${placeholder}"`;
    const content = esc(value(ui,role,key));
    let editor = `<input type="text" ${attrs} value="${content}"${key === 'wechatId' ? ' autocapitalize="none" spellcheck="false"' : ''}>`;
    if(key==='bio'){
      editor=`<span class="lb-signature" data-text="${content}"><textarea ${attrs} rows="1">${content}</textarea></span>`;
    }else if(key==='patText'){
      const name=role.remark||value(ui,role,'name')||'朋友';
      editor=`<span class="lb-pat-line"><span class="lb-pat-start">我拍了拍“<span data-pat-name>${esc(name)}</span>”</span><span>的</span><input type="text" ${attrs} value="${content.replace(/^的/,'')}" maxlength="100"></span>`;
    }
    const hint=key==='wechatId'?'<small>（不支持中文）</small>':'';
    return `<label class="lb-field"><span class="lb-label">${label}${hint}</span>${editor}</label>`;
  }
  function region(ui, schedule) {
    const weatherEnabled=ui.draft['schedule.weatherEnabled']??schedule.settings.weatherEnabled;
    const city=ui.draft['schedule.city']??schedule.city;
    return `<div class="lb-region" data-life-scope="schedule">
      <label class="life-field life-check lb-voice-toggle"><span>获取天气</span><input type="checkbox" role="switch" data-life-field="weatherEnabled" ${weatherEnabled?'checked':''}></label>
      <div class="lb-voice-row lb-region-city">
        <label for="lb-city"><span id="lb-city-label">所在城市</span><small id="lb-city-hint">（支持虚拟城市）</small></label>
        <span class="lb-city-editor">
          <input id="lb-city" type="text" data-life-field="city" aria-labelledby="lb-city-label" aria-describedby="lb-city-hint" placeholder="填写城市名称" maxlength="100" value="${esc(city)}">
        </span>
      </div>
    </div>`;
  }
  function outreach({enabled,mode,note}) {
    return `<div class="lb-outreach" data-life-scope="interaction">
      <label class="life-field life-check lb-voice-toggle"><span>主动信息</span><input type="checkbox" role="switch" data-life-field="enabled" ${enabled?'checked':''}></label>
      <div class="lb-voice-row"><span id="lb-outreach-label">联系方式</span>
        <fieldset class="lb-outreach-modes" data-outreach-modes aria-labelledby="lb-outreach-label" ${enabled?'':'disabled'}>
          <label><input type="radio" name="lb-outreach-mode" data-life-field="mode" value="schedule" ${mode==='schedule'?'checked':''}><span>跟随日程</span></label>
          <label><input type="radio" name="lb-outreach-mode" data-life-field="mode" value="custom" ${mode==='custom'?'checked':''}><span>自己配置</span></label>
        </fieldset>
      </div>
      <p class="life-outreach-note" data-outreach-note ${note?'':'hidden'}>${esc(note)}</p>
    </div>`;
  }
  function voiceName(ui, voiceId) {
    if(!voiceId)return '选择音色';
    if(ui.voiceModel!==P().getState().settings.ai.assign.tts)return '已设置音色';
    return ui.voices?.find(voice=>voice.voice_id===voiceId)?.name || (ui.voicesComplete?'当前音色不可用':'已设置音色');
  }
  function render(ui, role, outreachState) {
    return `<section data-life-scope="basic" class="lb-profile-card"><div class="lb-card-head">${image(ui,role,'cover','朋友圈背景图')}${image(ui,role,'avatar','头像')}</div><div class="lb-card-fields">${fields.map(f=>field(ui,role,f,outreachState)).join('')}</div></section>`;
  }

  function loadVoices(ui) {
    const modelId=P().getState().settings.ai.assign.tts;
    if(ui.voiceRequest?.modelId===modelId)return ui.voiceRequest.task;
    const request={modelId};
    request.task=P().api('/api/engine/voices',{voiceType:'all'}).then(result=>{
      if(ui.voiceRequest!==request)return;
      ui.voices=result.voices;
      ui.voiceModel=result.modelId;
      ui.voicesComplete=result.complete;
      ui.voiceError='';
    },error=>{
      if(ui.voiceRequest!==request)return;
      ui.voices=null;
      ui.voicesComplete=false;
      ui.voiceError=error.message;
    }).finally(()=>{if(ui.voiceRequest===request)ui.voiceRequest=null;});
    ui.voiceRequest=request;
    return request.task;
  }

  function bind(root,ui,role) {
    function acceptSuffix(input){
      if(input.value.startsWith('的')){
        const cursor=input.selectionStart;
        input.value=input.value.slice(1);
        input.setSelectionRange(Math.max(0,cursor-1),Math.max(0,cursor-1));
      }
      ui.draft['basic.patText']=input.value;
    }
    const suffix=root.querySelector('[data-life-field="patText"]');
    suffix.oncompositionend=()=>acceptSuffix(suffix);
    root.oninput=({target,isComposing})=>{
      switch(target.dataset.lifeField){
        case 'bio': target.parentElement.dataset.text=target.value; break;
        case 'name': root.querySelector('[data-pat-name]').textContent=role.remark||target.value||'朋友'; break;
        case 'patText': if(!isComposing)acceptSuffix(target); break;
      }
    };
    const updateName=()=>{root.querySelector('[data-voice-name]').textContent=voiceName(ui,value(ui,role,'voiceId'));};
    const trigger=root.querySelector('[data-basic-voice]');
    root.querySelector('[data-basic-voice-toggle]').onchange=({target})=>{
      ui.draft['basic.voiceMode']=target.checked ? 'on' : 'off';
      trigger.disabled=!target.checked;
    };
    const menu=root.querySelector('.lb-voice-menu');
    if(typeof menu.showPopover!=='function'||!window.ResizeObserver){
      menu.hidden=true;
      trigger.removeAttribute('popovertarget');
      trigger.removeAttribute('aria-controls');
      trigger.removeAttribute('aria-expanded');
      trigger.setAttribute('aria-haspopup','dialog');
      trigger.onclick=()=>{
        const selected=value(ui,role,'voiceId');
        return window.PipiModels.singleChoiceSheet('选择音色',async()=>{
          await loadVoices(ui);
          const choices=(ui.voices||[]).map(v=>({value:v.voice_id,label:v.name}));
          const missing=selected&&ui.voicesComplete&&!choices.some(v=>v.value===selected);
          return {choices,note:missing?'已选音色不在当前模型列表，请重新选择':choices.length?'':ui.voiceError||'音色库暂无音色'};
        },selected,voiceId=>{
          ui.draft['basic.voiceId']=voiceId;
          updateName();
        },{name:'friend-voice',note:'正在读取音色…',selectImmediately:true});
      };
      return;
    }
    const scroller=root.closest('[data-life-root]');
    function positionMenu(){
      const anchor=trigger.getBoundingClientRect(), viewport=scroller.getBoundingClientRect();
      if(anchor.bottom<=viewport.top || anchor.top>=viewport.bottom){menu.hidePopover();return;}
      menu.style.minWidth=Math.max(104,anchor.width)+'px';
      menu.style.maxWidth=Math.min(240,scroller.clientWidth-32)+'px';
      const below=viewport.bottom-anchor.bottom-6, above=anchor.top-viewport.top-6;
      const desired=Math.min(244,menu.scrollHeight+2);
      const up=below<desired && above>below;
      menu.style.left=(anchor.right-menu.offsetWidth)+'px';
      menu.style.maxHeight=Math.max(1,Math.min(244,up?above:below))+'px';
      menu.style.top=(up ? anchor.top-4-menu.offsetHeight : anchor.bottom+4)+'px';
    }
    async function present(){
      if(trigger.disabled){menu.hidePopover();return;}
      menu.innerHTML='<p role="status">正在读取音色…</p>';
      positionMenu();
      await loadVoices(ui);
      if(!menu.matches(':popover-open'))return;
      const selected=value(ui,role,'voiceId');
      const voiceExists=ui.voices?.some(v=>v.voice_id===selected);
      const warning=selected&&ui.voicesComplete&&!voiceExists?'<p role="status">已选音色不在当前模型列表，请重新选择</p>':'';
      menu.innerHTML=warning+((ui.voices||[]).map(v=>`<button type="button" role="option" aria-selected="${v.voice_id===selected}" data-voice-id="${esc(v.voice_id)}">${esc(v.name)}</button>`).join('') || `<p role="status">${esc(ui.voiceError||'音色库暂无音色')}</p>`);
      updateName();
      positionMenu();
      const active=menu.querySelector('[aria-selected="true"]');
      if(active)menu.scrollTop=active.offsetTop-(menu.clientHeight-active.offsetHeight)/2;
    }
    const sizeObserver=new ResizeObserver(positionMenu);
    menu.ontoggle=()=>{
      const open=menu.matches(':popover-open');
      trigger.setAttribute('aria-expanded',String(open));
      if(open){sizeObserver.observe(scroller);present();}
      else sizeObserver.disconnect();
    };
    menu.onclick=e=>{
      const option=e.target.closest('[data-voice-id]');
      if(!option)return;
      ui.draft['basic.voiceId']=option.dataset.voiceId;
      updateName();
      menu.hidePopover();
      trigger.focus({preventScroll:true});
    };
    trigger.onkeydown=menu.onkeydown=e=>{
      if(trigger.disabled)return;
      if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
      e.preventDefault();
      if(!menu.matches(':popover-open')){menu.showPopover();return;}
      const options=Array.from(menu.querySelectorAll('[role="option"]'));
      const current=options.indexOf(document.activeElement);
      const index=e.key==='Home'?0:e.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,current+(e.key==='ArrowDown'?1:-1)));
      options[index]?.focus({preventScroll:true});
      options[index]?.scrollIntoView({block:'nearest'});
    };
    scroller.addEventListener('scroll',()=>{if(menu.matches(':popover-open'))positionMenu();});
  }
  window.PipiLifeBasic={render,bind};
})();
