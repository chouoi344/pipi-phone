// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const P=()=>window.Pipi,esc=value=>P().esc(value);
  const choices=[{value:'7',label:'7 天'},{value:'30',label:'30 天'},{value:'90',label:'90 天'},{value:'forever',label:'永久'}];
  const labels=new Map(choices.map(item=>[item.value,item.label]));
  let storage=null,draft,loading=false,saving=false,error='',sequence=0,timer;
  const active=()=>document.querySelector('#view')?.dataset.route==='storage';
  const bytes=value=>{if(value===0)return '0 MB';const units=['B','KB','MB','GB','TB'],unit=Math.min(units.length-1,Math.floor(Math.log(value)/Math.log(1024)));return (value/1024**unit).toLocaleString('zh-CN',{maximumFractionDigits:2})+' '+units[unit];};
  const date=value=>new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  function redraw(){if(active())P().refresh();}
  function schedule(){clearTimeout(timer);if(storage?.calculating&&active())timer=setTimeout(load,1500);}
  async function load(){
    if(loading)return;const token=++sequence;loading=true;error='';
    try{const next=await P().api('/api/storage');if(token!==sequence)return;const clean=draft===undefined||draft===storage?.retention;storage=next;if(clean)draft=next.retention;}
    catch(cause){if(token===sequence)error=cause.message;}
    finally{if(token===sequence){loading=false;redraw();schedule();}}
  }
  function enter(){clearTimeout(timer);sequence++;loading=saving=false;error='';void load();}
  const row=(title,value)=>`<div class="storage-stat"><span>${title}</span><strong>${esc(value)}</strong></div>`;
  function cleanup(value,empty){if(!value)return `<p class="storage-note">${empty}</p>`;const count=value.images!==undefined?`${value.images} 张图片、${value.voices} 条语音`:value.files!==undefined?`${value.files} 个文件`:'';return `<p class="storage-note">${esc(date(value.at))}${count?' · '+esc(count):''}${value.bytes!==undefined?' · 约涉及 '+esc(bytes(value.bytes)):''}</p>`;}
  function render(){
    if(!storage)return `<div class="content page-content storage-content"><p class="page-note">${error?esc(error):'正在读取存储空间…'}</p>${error?'<button type="button" class="secondary-btn" data-storage-retry>重新读取</button>':''}</div>`;
    const usage=storage.usage,migration=storage.migration,status={complete:'整理完成',running:'正在整理',skipped:'暂未整理',failed:'整理未完成'}[migration.status]||'暂无整理记录';
    return `<div class="content page-content storage-content">
      <p class="storage-note" role="status">当前生效：${esc(labels.get(String(storage.retention)))}。点击「保存时长」可修改，修改后需保存。</p>
      <section class="pt-settings-group storage-group"><h3 class="pt-group-title">聊天图片和语音</h3><button type="button" class="cell plain-cell storage-retention" data-storage-choose${saving?' disabled':''}><span class="cell-body cell-title">保存时长</span><span class="cell-value">${esc(labels.get(String(draft)))}</span>${P().icons.chevron}</button><p class="storage-note">从消息发送时间起计算。升级前的旧消息从完成整理时起计算。</p><p class="storage-note">选择永久后，硬盘空间不足时仍会从最旧的聊天图片和语音开始清理。收藏、头像、表情、朋友圈、衣柜和参考图不受影响。</p><button type="button" class="primary-btn weui-btn weui-btn_primary storage-save" data-storage-save${loading||error||saving||draft===storage.retention?' disabled':''}>${saving?'正在保存…':'保存'}</button>${loading?'<p class="storage-note">正在更新存储空间…</p>':''}${error?`<p class="storage-error" role="alert">${esc(error)}</p><button type="button" class="secondary-btn" data-storage-retry>重新读取</button>`:''}</section>
      <section class="pt-settings-group storage-group"><h3 class="pt-group-title">已用空间</h3>${usage?row('图片和语音',bytes(usage.mediaBytes))+row('文字数据',bytes(usage.textBytes))+row('服务器硬盘剩余',bytes(usage.diskFreeBytes)):`<p class="storage-note">${storage.calculating?'正在计算空间大小…':'暂时无法读取空间大小'}</p>`}${storage.calculating&&usage?'<p class="storage-note">正在更新空间大小…</p>':''}</section>
      <section class="pt-settings-group storage-group"><h3 class="pt-group-title">清理记录</h3><h4>最近一次清理</h4>${cleanup(storage.lastCleanup,'还没有清理记录')}<h4>空间不足时提前清理</h4>${cleanup(storage.lastEarlyCleanup,'还没有提前清理记录')}</section>
      <section class="pt-settings-group storage-group"><h3 class="pt-group-title">旧图片和语音整理</h3>${row('整理状态',status)}${migration.detail?`<p class="storage-note">${esc(migration.detail)}</p>`:''}${migration.beforeBytes!==undefined?`<p class="storage-note">文字资料大小：${esc(bytes(migration.beforeBytes))} → ${esc(bytes(migration.afterBytes))}</p>`:''}${migration.backupName?`<p class="storage-note storage-backup-name">整理前备份：${esc(migration.backupName)}</p>`:''}</section>
    </div>`;
  }
  function choose(){window.PipiModels.singleChoiceSheet('聊天图片和语音保存时长',choices,String(draft),(value,form)=>{draft=value==='forever'?value:Number(value);if(form.isConnected){P().closeModal(false);redraw();requestAnimationFrame(()=>document.querySelector('[data-storage-choose]')?.focus({preventScroll:true}));}},{name:'storage-retention'});}
  function accept(result){storage=result.storage;draft=storage.retention;error='';if(result.state)P().receiveState(result.state);redraw();schedule();P().toast('保存时长已更新');}
  const previewText=preview=>`将清理 ${preview.affected.images} 张图片、${preview.affected.voices} 条语音，约涉及 ${bytes(preview.affected.bytes)}。清理后原图和语音不能恢复。`;
  function confirm(preview,retention){
    let current=preview;const token=sequence;
    P().openModal('确认缩短保存时长',`<p class="storage-confirm-copy">${esc(previewText(current))}</p><p class="storage-note">“约涉及大小”包含这些消息引用的媒体，不代表立即释放的硬盘空间。</p>`,async form=>{
      if(token!==sequence||!active())return;const result=await P().api('/api/storage/retention',{retention,confirmationToken:current.confirmationToken});if(token!==sequence)return;
      if(result.requiresConfirmation){current=result;if(form.isConnected)form.querySelector('.storage-confirm-copy').textContent='资料已有变化，请确认新的数量。'+previewText(current);return;}
      accept(result);if(form.isConnected){P().closeModal(false);requestAnimationFrame(()=>document.querySelector('[data-storage-save]')?.focus({preventScroll:true}));}
    },'确认清理',()=>requestAnimationFrame(()=>document.querySelector('[data-storage-save]')?.focus({preventScroll:true})),'cancel',{lockWhileSaving:true});
    document.querySelector('#overlay > .page-editor').classList.add('model-sheet');
  }
  async function save(){
    if(loading||saving||error||!storage||draft===storage.retention)return;const retention=draft,token=sequence;saving=true;error='';redraw();
    try{const preview=await P().api('/api/storage/retention',{retention,preview:true});if(token!==sequence||!active())return;if(preview.requiresConfirmation){confirm(preview,retention);return;}const result=await P().api('/api/storage/retention',{retention,confirmationToken:preview.confirmationToken});if(token!==sequence)return;if(!active()){accept(result);return;}if(result.requiresConfirmation)confirm(result,retention);else accept(result);}
    catch(cause){if(token===sequence)error=cause.message;}
    finally{if(token===sequence){saving=false;redraw();}}
  }
  function bind(){document.querySelector('[data-storage-choose]')?.addEventListener('click',choose);document.querySelector('[data-storage-save]')?.addEventListener('click',save);document.querySelector('[data-storage-retry]')?.addEventListener('click',()=>void load());schedule();}
  function reset(){clearTimeout(timer);sequence++;storage=null;draft=undefined;loading=saving=false;error='';}
  window.PipiStorage={enter,render,bind,reset};
})();
