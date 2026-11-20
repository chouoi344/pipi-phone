// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const P=()=>window.Pipi,esc=value=>P().esc(value);
  let account=null,error='',sequence=0;
  const active=()=>document.querySelector('#view')?.dataset.route==='account-security';
  async function load(){
    const token=++sequence;error='';
    try{const result=await P().api('/api/account');if(token===sequence)account=result;}
    catch(cause){if(token===sequence)error=cause.message;}
    finally{if(token===sequence&&active())P().refresh();}
  }
  function enter(){account=null;error='';void load();}
  function render(){return `<div class="content page-content account-content"><section class="section"><button class="cell plain-cell" type="button" data-account-password><span class="cell-body cell-title">修改密码</span>${P().icons.chevron}</button></section><p class="section-title">登录设备</p><section class="section"><div class="cell"><span class="cell-body cell-title">有效会话</span><span class="cell-value">${account?account.sessionCount+' 个':'正在读取…'}</span></div><button class="cell plain-cell" type="button" data-account-revoke ${!account||account.otherSessionCount===0?'disabled':''}><span class="cell-body cell-title">退出其他设备</span><span class="cell-value">${account?account.otherSessionCount+' 个':''}</span>${P().icons.chevron}</button></section><p class="page-note">每次登录会建立一个会话。修改密码或退出其他设备后，当前设备保持登录。</p>${error?`<p class="page-note" role="alert">${esc(error)}</p><button type="button" class="secondary-btn" data-account-retry>重新读取</button>`:''}</div>`;}
  function password(){
    const fields=[['currentPassword','当前密码','current-password'],['newPassword','新密码','new-password'],['confirmPassword','再次输入新密码','new-password']];
    P().openModal('修改密码',fields.map(([name,label,autocomplete])=>`<label class="form-field"><span class="field-label">${label}</span><input name="${name}" type="password" autocomplete="${autocomplete}" ${name==='currentPassword'?'':'minlength="8"'} required></label>`).join('')+'<p class="page-note">新密码至少 8 位。修改后，其他设备需要重新登录。</p>',async form=>{
      const currentPassword=form.elements.currentPassword.value,newPassword=form.elements.newPassword.value,confirmPassword=form.elements.confirmPassword.value;if(newPassword!==confirmPassword)throw new Error('两次输入的新密码不一致');
      const result=await P().api('/api/account/password',{currentPassword,newPassword,confirmPassword});account=result;if(form.isConnected)P().closeModal(false);if(active())P().refresh();P().toast(result.message);
    },'保存',undefined,'cancel',{lockWhileSaving:true});document.querySelector('#overlay > .page-editor').classList.add('model-sheet');
  }
  function revoke(){P().confirmDialog('退出其他设备？',`其他 ${account.otherSessionCount} 个有效会话将退出，当前设备保持登录。`,async()=>{const result=await P().api('/api/account/sessions/revoke',{});account=result;if(active())P().refresh();P().toast(result.message);},'退出其他设备');}
  function bind(){document.querySelector('[data-account-password]')?.addEventListener('click',password);document.querySelector('[data-account-revoke]')?.addEventListener('click',revoke);document.querySelector('[data-account-retry]')?.addEventListener('click',()=>void load());}
  function reset(){sequence++;account=null;error='';}
  window.PipiAccount={enter,render,bind,reset};
})();
