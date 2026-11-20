// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const P=()=>window.Pipi, state=()=>P().getState(), esc=value=>P().esc(value);
  let retainedDraft=null;
  let search='';
  const personas=()=>state().rolePersonas||[], folders=()=>state().personaFolders||[];
  const friends=id=>state().roles.filter(role=>role.rolePersonaId===id);
  const roleName=role=>role.remark||role.name;
  const heading=(title,right='')=>`<header class="topbar"><div class="header-leading"><button class="back-btn" data-action="back" aria-label="返回">${P().icons.back}</button></div><h2 class="title-centered">${esc(title)}</h2><div class="header-actions">${right}</div></header>`;
  const button=(label,action,attrs='')=>`<button type="button" data-rp-action="${action}" ${attrs}>${label}</button>`;
  const note=text=>`<p class="page-note">${esc(text)}</p>`;
  function render(name,arg) {
    if(name==='role-persona-detail') {
      const item=personas().find(item=>item.id===arg);
      if(!item)return heading('人设详情')+note('这份人设已删除。');
      return heading('人设详情',button('···','menu',`data-id="${esc(item.id)}" aria-label="人设操作" class="nav-text"`))+`<div class="content page-content rp-detail"><h3>${esc(item.name)}</h3>${note('创建时间：'+new Date(item.createdAt).toLocaleString())}<div class="rp-prompt">${esc(item.prompt)}</div>${note('已绑定朋友：'+(friends(item.id).map(roleName).join('、')||'暂无'))}</div>`;
    }
    if(name!=='role-personas')return null;
    const folder=folders().find(item=>item.id===arg),folderId=folder?.id||'';
    const term=search.trim().toLocaleLowerCase();
    const items=personas().filter(item=>(item.folderId||'')===folderId&&(!term||(item.name+'\n'+item.prompt).toLocaleLowerCase().includes(term)));
    const cards=items.map(item=>{
      const bound=friends(item.id), attrs=`data-id="${esc(item.id)}"`;
      const label=bound.length?'已绑定：'+bound.map(roleName).join('、'):'暂未绑定朋友';
      return `<article class="rp-card">
        ${button(`<h3>${esc(item.name)}</h3><p class="rp-snippet">${esc(item.prompt)}</p>`,'detail',`${attrs} class="rp-card-open"`)}
        ${button(esc(label),'bind',`${attrs} class="rp-bound" aria-haspopup="dialog"`)}
        ${button('···','menu',`${attrs} class="rp-card-menu" aria-label="${esc(item.name)}的操作"`)}
      </article>`;
    }).join('');
    return heading(folder?.name||'我的人设',button('＋','create-menu','aria-label="新建人设或文件夹" class="nav-text"'))+`<div class="content page-content rp-library" data-folder="${esc(folderId)}"><label class="rp-search"><input type="text" inputmode="search" id="rp-search" placeholder="搜索人设" aria-label="搜索人设" value="${esc(search)}"></label>${!folderId&&folders().length?`<div class="rp-folders">${folders().map(item=>`<div class="rp-folder">${button(`<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h7l2 3h9v12H3Z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>${esc(item.name)}</span><small>${personas().filter(p=>p.folderId===item.id).length}</small>`,'folder',`data-id="${esc(item.id)}" class="rp-folder-open"`)}${button('···','folder-menu',`data-id="${esc(item.id)}" class="rp-folder-menu" aria-label="${esc(item.name)}的文件夹操作"`)}</div>`).join('')}</div>`:''}<p class="rp-count">${folder?esc(folder.name):folders().length?'未分类人设':'全部人设'} <span>${items.length} 份</span></p><div class="rp-cards">${cards}</div>${!items.length?`<div class="empty"><h3>${term?'没有找到人设':personas().length||folder?'当前目录没有人设':'还没有人设'}</h3><p>${term?'试试其他关键词':'创建 AI 好友的性格、经历和说话方式。'}</p>${button('新建人设','create','class="primary-btn"')}</div>`:''}</div>`;
  }
  function bind(name,arg) {
    if(!['role-personas','role-persona-detail'].includes(name))return;
    const view=document.querySelector('#view'),folderId=view.querySelector('.rp-library')?.dataset.folder||'';
    view.querySelectorAll('[data-rp-action]').forEach(el=>el.onclick=()=>{
      const id=el.dataset.id;
      switch(el.dataset.rpAction){
        case 'folder':search='';P().showView('role-personas',id);break;
        case 'folder-menu':folderMenu(id);break;
        case 'detail':P().showView('role-persona-detail',id);break;
        case 'bind':bindFriends(id);break;
        case 'menu':menu(id);break;
        case 'create':edit('',folderId);break;
        case 'create-menu':P().actionSheet('新建',[{label:'新建人设',run:()=>edit('',folderId)},...(!folderId?[{label:'新建文件夹',run:createFolder}]:[])]);break;
      }
    });
    const input=view.querySelector('#rp-search');
    if(input){const update=()=>{search=input.value;const start=input.selectionStart,end=input.selectionEnd;P().refresh();const next=document.querySelector('#rp-search');next.focus({preventScroll:true});next.setSelectionRange(start,end);};input.oninput=event=>{if(!event.isComposing)update();};input.oncompositionend=update;}
  }
  function menu(id) {
    const item=personas().find(item=>item.id===id);
    P().actionSheet(item.name,[{label:'编辑人设',run:()=>edit(id)},{label:'移动到文件夹',run:()=>move(id)},{label:'删除人设',danger:true,run:()=>P().confirmDialog('删除这份人设？','已绑定朋友将解除绑定，沿用保留的原设定；原设定不会被删除。',async()=>{await P().act('rolePersona.delete',{id});if(document.querySelector('#view').dataset.route==='role-persona-detail'){P().closeModal(false);P().goBack();}},'删除')}]);
  }
  function edit(id='',folderId='') {
    const key=id||'new:'+folderId,item=personas().find(item=>item.id===id),initial={name:item?.name||'',prompt:item?.prompt||'',folderId:item?.folderId||folderId},draft=retainedDraft?.key===key?retainedDraft.value:{...initial};retainedDraft=null;
    let reading=false;
    P().openPage(id?'编辑人设':'新建人设',`<div class="rp-editor"><label class="form-field"><span class="field-label">人设名称</span><input name="name" maxlength="80" value="${esc(draft.name)}" placeholder="给这份人设起个名字" required></label><div class="rp-editor-tools"><span class="field-label">人设正文</span><button type="button" id="rp-upload" class="secondary-btn">上传 TXT</button><input type="file" id="rp-file" accept=".txt,text/plain" hidden></div><textarea name="prompt" class="rp-textarea" maxlength="100000" placeholder="粘贴或输入角色的性格、经历、说话方式…" required>${esc(draft.prompt)}</textarea><p class="rp-editor-foot"><span id="rp-file-status" role="status">正文将保留原有空白和换行</span><span id="rp-length">${draft.prompt.length} / 100000</span></p><p class="rp-file-error" id="rp-file-error" role="alert"></p></div>`,async form=>{
      if(reading)throw new Error('正在读取 TXT，请稍候');
      if(!draft.name.trim()||!draft.prompt.trim())throw new Error('请填写人设名称和正文');
      await P().act('rolePersona.save',{...(id?{id}:{}),...draft});if(form.isConnected){P().closeModal(false);P().refresh();}P().toast('人设已保存');
    },'保存',()=>{if(JSON.stringify(draft)===JSON.stringify(initial))return;retainedDraft={key,value:draft};edit(id,folderId);P().confirmDialog('放弃本次修改？','尚未保存的内容会丢失。',()=>{retainedDraft=null;P().closeModal(false);},'放弃');});
    const form=document.querySelector('#overlay .modal-form'),name=form.querySelector('[name=name]'),prompt=form.querySelector('[name=prompt]'),file=form.querySelector('#rp-file'),upload=form.querySelector('#rp-upload'),error=form.querySelector('#rp-file-error'),status=form.querySelector('#rp-file-status');
    prompt.value=draft.prompt;
    let generation=0,readSequence=0;
    name.oninput=()=>{draft.name=name.value;};
    prompt.oninput=()=>{generation++;draft.prompt=prompt.value;form.querySelector('#rp-length').textContent=draft.prompt.length+' / 100000';};
    upload.onclick=()=>file.click();
    file.onchange=async()=>{
      const selected=file.files[0];if(!selected)return;
      const token=++generation,readId=++readSequence;error.textContent='';reading=true;const submit=form.querySelector('[type=submit]');submit.disabled=true;status.textContent='正在读取 TXT…';
      try {
        if(!/\.txt$/i.test(selected.name))throw new Error('请选择 TXT 文件');
        if(selected.size>1024*1024)throw new Error('TXT 文件不能超过 1 MB');
        const text=decodeTXT(await selected.arrayBuffer());
        if(!form.isConnected||token!==generation)return;
        if(text.includes('\0'))throw new Error('TXT 包含无效的 NUL 字符');
        if(text.length>100000)throw new Error('正文不能超过 100000 字符');
        if(!text.trim())throw new Error('TXT 正文不能为空');
        const apply=()=>{if(!form.isConnected||token!==generation)return;draft.prompt=text;prompt.value=text;if(!draft.name.trim()){draft.name=selected.name.replace(/\.txt$/i,'').slice(0,80);name.value=draft.name;}form.querySelector('#rp-length').textContent=text.length+' / 100000';status.textContent=selected.name+' · 预览后点击保存';};
        if(prompt.value) {
          status.textContent=selected.name+' · 已读取，请确认是否替换正文';
          let replaced=false;
          const dialog=document.createElement('dialog');dialog.className='rp-replace-dialog';dialog.innerHTML='<h3>替换人设正文？</h3><p>上传的 TXT 将替换当前正文；保存后才会写入人设。</p><div><button type="button" data-cancel>取消</button><button type="button" data-replace>替换</button></div>';form.append(dialog);
          dialog.querySelector('[data-cancel]').onclick=()=>P().closeChildDialog();
          dialog.querySelector('[data-replace]').onclick=()=>{if(token===generation){apply();replaced=true;}P().closeChildDialog();};
          dialog.addEventListener('close',()=>{if(!replaced&&form.isConnected&&readId===readSequence)status.textContent=token===generation?'已取消导入，正文未修改':'正文已修改，未导入 TXT';dialog.remove();},{once:true});
          if(!P().openChildDialog(dialog))dialog.remove();
        } else apply();
      } catch(err) {if(form.isConnected&&token===generation){error.textContent=err.message;status.textContent='未导入，请检查文件';}}
      finally {file.value='';if(form.isConnected&&readId===readSequence){reading=false;submit.disabled=false;if(token!==generation)status.textContent='正文已修改，未导入 TXT';}}
    };
  }
  function decodeTXT(buffer) {
    const bytes=new Uint8Array(buffer);
    if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(2));
    if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes.subarray(2));
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030',{fatal:true}).decode(bytes);}
  }
  function createFolder() {
    P().openModal('新建文件夹','<label class="form-field"><span class="field-label">文件夹名称</span><input name="name" maxlength="40" required></label>',async form=>{await P().act('personaFolder.save',{name:form.querySelector('[name=name]').value});if(form.isConnected){P().closeModal();P().refresh();}});
  }
  function folderMenu(id) {
    const folder=folders().find(item=>item.id===id);
    P().actionSheet(folder.name,[{label:'删除文件夹',danger:true,run:()=>P().confirmDialog('删除这个文件夹？','文件夹内的人设会移回首页，好友绑定保持不变。',async()=>{await P().act('personaFolder.delete',{id});P().refresh();},'删除')}]);
  }
  function move(id) {
    const item=personas().find(item=>item.id===id);
    P().openModal('移动人设',`<div class="rp-choice-list">${[{id:'',name:'全部人设'},...folders()].map(folder=>`<label class="rp-choice"><span>${esc(folder.name)}</span><input type="radio" name="folderId" value="${esc(folder.id)}" ${(item.folderId||'')===folder.id?'checked':''}></label>`).join('')}</div>`,async form=>{await P().act('rolePersona.move',{id,folderId:form.querySelector('[name=folderId]:checked').value});if(form.isConnected){P().closeModal();P().refresh();}});
  }

  function bindFriends(id) {
    const openedState=state(),roles=openedState.roles,bindings=new Map(roles.map(role=>[role.id,role.rolePersonaId||'']));
    const content=roles.length
      ?note('勾选已使用其他人设的好友会换绑，取消勾选已绑定的好友可恢复原设定。换绑会保留原来的聊天、共同记忆和生活档案。')
        +`<div class="rp-friend-list">${roles.map(role=>`<label class="rp-friend"><input type="checkbox" name="roleIds" value="${esc(role.id)}" ${bindings.get(role.id)===id?'checked':''}>${P().avatar(role,40)}<span>${esc(roleName(role))}<small>${esc(personas().find(p=>p.id===role.rolePersonaId)?.name||'未绑定（沿用原设定）')}</small></span></label>`).join('')}</div>`
      :note('还没有好友，请先在通讯录添加。');
    const save=async form=>{
      const checked=new Set(Array.from(form.querySelectorAll('[name=roleIds]:checked'),input=>input.value));
      const changes=[];
      for(const [roleId,expectedPersonaId] of bindings){
        const selected=checked.has(roleId);
        if(selected!==(expectedPersonaId===id))changes.push({roleId,expectedPersonaId,selected});
      }
      if(changes.length){
        try{await P().act('rolePersona.bind',{id,changes});}
        catch(error){if(error.status===409)P().receiveState(await P().api('/api/state'));throw error;}
      }
      if(form.isConnected){P().closeModal(false);P().refresh();}
    };
    P().openModal('绑定好友',content,roles.length?save:undefined,'保存',()=>{if(state()!==openedState)P().refresh();},'cancel',{lockWhileSaving:true});
    document.querySelector('#overlay > .page-editor').classList.add('model-sheet');
  }
  window.PipiPersonas={render,bind};
})();

