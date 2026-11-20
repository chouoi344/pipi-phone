/* SPDX-License-Identifier: AGPL-3.0-only */
(() => {
  'use strict';
  const P=()=>window.Pipi,labels={pending:'待补全',queued:'等待识别',analyzing:'识别中',ready:'已标注',failed:'识别失败'};
  const pending=s=>!s.semantic||['pending','failed'].includes(s.semantic.status);
  function render(stickers){
    const {esc,icons}=P(),ready=stickers.filter(s=>s.semantic?.status==='ready').length;
    return `<div class="content page-content sticker-manager semantic-library"><div class="sticker-library-tools"><span>${stickers.length} / 200 · 已标注 ${ready}</span>${stickers.some(pending)?'<button type="button" data-complete-stickers>补全含义</button>':''}</div><div class="sticker-grid"><button class="add-sticker" data-action="add-sticker" aria-label="添加收藏表情">${icons.add}</button>${stickers.map(s=>`<article class="sticker-library-item"><button type="button" class="sticker-library-image" data-sticker-detail="${esc(s.id)}" aria-label="查看表情含义"><img src="${esc(s.image)}" alt="表情"></button><button type="button" class="sticker-delete-mark" data-remove-sticker="${esc(s.id)}" aria-label="移除收藏表情">×</button><button type="button" class="sticker-library-meaning ${s.semantic?.status==='ready'?'is-ready':''}" data-sticker-detail="${esc(s.id)}"><span>${esc(s.semantic?.status==='ready'?s.semantic.meaning:labels[s.semantic?.status]||'待补全')}</span></button></article>`).join('')}</div><input type="file" id="sticker-file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.bmp,.avif" hidden></div>`;
  }
  function openDetail(id){
    const p=P(),s=p.getState().stickers.find(x=>x.id===id);if(!s)return;
    const info=s.semantic||{status:'pending'},esc=p.esc;
    p.openPage('表情含义',`<div class="sticker-semantic-preview"><img src="${esc(s.image)}" alt="表情预览"><span data-semantic-status>${esc(labels[info.status])}${info.manual?' · 手动标注':''}</span></div><div class="sticker-semantic-fields"><label>表达含义<textarea name="meaning" maxlength="600" rows="3" placeholder="这张表情想表达什么">${esc(info.meaning||'')}</textarea></label><label>语气标签<input name="tags" maxlength="300" value="${esc((info.tags||[]).join('、'))}" placeholder="例如：撒娇、调侃、无奈"></label><label>适用场景<textarea name="usage" maxlength="600" rows="3" placeholder="适合在什么情况下使用">${esc(info.usage||'')}</textarea></label><p class="sticker-semantic-error" role="status">${esc(info.error||'')}</p>${pending(s)?'<button type="button" class="secondary-btn sticker-analyze">'+(info.status==='failed'?'重新识别':'识别含义')+'</button>':''}</div>`,async form=>{
      await p.act('sticker.semantic.save',{id,meaning:form.elements.meaning.value,tags:form.elements.tags.value.split(/[、,，\n]/).map(t=>t.trim()).filter(Boolean),usage:form.elements.usage.value});p.closePage();p.refresh();
    },'保存');
    const form=document.querySelector('#overlay .modal-form'),button=form.querySelector('.sticker-analyze');
    form.dataset.semanticId=id;form.addEventListener('input',()=>{form.dataset.semanticDirty='true';});
    if(button)button.onclick=async()=>{
      button.disabled=true;const status=form.querySelector('[data-semantic-status]'),error=form.querySelector('.sticker-semantic-error');error.textContent='';
      try{await analyze([s]);syncDetail();}
      catch(e){error.textContent=e.message;button.disabled=false;}
    };
  }
  function syncDetail(){
    const form=document.querySelector('[data-semantic-id]');if(!form)return;
    const info=P().getState().stickers.find(s=>s.id===form.dataset.semanticId)?.semantic;if(!info)return;
    form.querySelector('[data-semantic-status]').textContent=(labels[info.status]||'待补全')+(info.manual?' · 手动标注':'');
    form.querySelector('.sticker-semantic-error').textContent=info.error||'';
    const button=form.querySelector('.sticker-analyze');if(button){button.disabled=['queued','analyzing'].includes(info.status);button.hidden=info.status==='ready';button.textContent=button.disabled?'识别中…':'识别含义';}
    if(info.status==='ready'&&!form.dataset.semanticDirty){form.elements.meaning.value=info.meaning;form.elements.tags.value=info.tags.join('、');form.elements.usage.value=info.usage;}
  }
  async function animationFrames(image){
    let blob;
    if(image.startsWith('data:image/')){const [prefix,payload]=image.split(',');blob=new Blob([Uint8Array.from(atob(payload),c=>c.charCodeAt(0))],{type:prefix.slice(5,prefix.indexOf(';'))});}
    else{const response=await fetch(image);if(!response.ok)throw new Error('图片读取失败');blob=await response.blob();}
    const buffer=await blob.arrayBuffer(),bytes=new Uint8Array(buffer),data=new DataView(buffer);
    const tag=at=>String.fromCharCode(...bytes.subarray(at,at+4));
    let animated=blob.type==='image/gif';
    if(['image/png','image/webp'].includes(blob.type)){
      const webp=blob.type==='image/webp';
      for(let at=webp?12:8;at+8<=bytes.length;){if(tag(at+(webp?0:4))===(webp?'ANIM':'acTL')){animated=true;break;}const size=data.getUint32(at+(webp?4:0),webp);at+=size+(webp?8+size%2:12);}
    }
    if(!animated||!window.ImageDecoder||!await ImageDecoder.isTypeSupported(blob.type))return;
    const decoder=new ImageDecoder({data:bytes,type:blob.type,preferAnimation:true});
    try{
      await decoder.tracks.ready;const count=decoder.tracks.selectedTrack.frameCount;
      const positions=[...new Set(Array.from({length:Math.min(5,count)},(_,i)=>Math.round(i*(count-1)/Math.max(1,Math.min(5,count)-1))))],frames=[];
      for(const frameIndex of positions){const {image:frame}=await decoder.decode({frameIndex});try{const scale=Math.min(1,768/Math.max(frame.displayWidth,frame.displayHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(frame.displayWidth*scale));canvas.height=Math.max(1,Math.round(frame.displayHeight*scale));canvas.getContext('2d').drawImage(frame,0,0,canvas.width,canvas.height);frames.push(canvas.toDataURL('image/png'));}finally{frame.close();}}
      return frames;
    }finally{decoder.close();}
  }
  async function analyze(stickers){
    const selected=stickers.filter(pending);if(!selected.length)return;
    let ids=[],frames={},size=0;
    const submit=async()=>{const result=await P().api('/api/stickers/analyze',{ids,frames});P().receiveState(result.state);ids=[];frames={};size=0;};
    for(const s of selected){
      let images;
      try{images=await animationFrames(s.image);}catch(error){P().toast('动图读取失败，可手动填写含义');}
      const bytes=images?.reduce((sum,frame)=>sum+frame.length,0)||0;
      if(ids.length&&size+bytes>8*1024*1024)await submit();
      ids.push(s.id);if(images)frames[s.id]=images;size+=bytes;
    }
    if(ids.length)await submit();
  }
  function bind(root){
    root.querySelectorAll('[data-sticker-detail]').forEach(button=>button.onclick=()=>openDetail(button.dataset.stickerDetail));
    const complete=root.querySelector('[data-complete-stickers]');
    if(complete)complete.onclick=async()=>{
      complete.disabled=true;
      try{
        await analyze(P().getState().stickers);
        if(root.dataset.route==='stickers'&&P().getState()?.stickers.some(sticker=>sticker.semantic?.status==='pending'&&sticker.semantic.error)){
          P().toast('请先配置图片转述模型，或手动标注表情含义');
        }
      }catch(error){P().toast(error.message);}
      finally{complete.disabled=false;}
    };
  }
  window.PipiStickers={render,bind,analyze,animationFrames,syncDetail};
})();
