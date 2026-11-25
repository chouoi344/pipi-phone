/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
(() => {
  const categories=['外出','居家','睡衣','运动'],seasons=['春','夏','秋','冬'];
  const maxFiles=20,maxBytes=512*1024;
  const P=()=>window.Pipi;
  const size=bytes=>bytes<1024*1024?Math.round(bytes/1024)+' KB':(bytes/1024/1024).toFixed(1)+' MB';

  async function compress(file){
    const app=P();
    if(!file)throw new Error('请选择 PNG、JPG 或 WebP 静态图片');
    if(file.size>20*1024*1024)throw new Error('图片不能超过 20 MB');
    const source=app?.readImage?await app.readImage(file,false,true):file;
    const mime=source.type||file.type;
    if(mime==='image/gif')throw new Error('衣柜需要静态图片，请选择其中一帧后上传');
    if(app?.detectAnimatedImage?await app.detectAnimatedImage(source,mime):false)throw new Error('衣柜需要静态图片，请选择其中一帧后上传');
    let decoded;
    try{
      decoded=app?.decodeImageSource?await app.decodeImageSource(source):await (async()=>{const b=await createImageBitmap(source);return {source:b,width:b.width,height:b.height,close(){b.close();}};})();
    }catch{throw new Error('无法读取图片，请换一张图片');}
    try{
      const scale=Math.min(1,1600/Math.max(decoded.width,decoded.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(decoded.width*scale));
      canvas.height=Math.max(1,Math.round(decoded.height*scale));
      const context=canvas.getContext('2d');
      let compressed;
      for(let step=0;step<5;step++){
        context.clearRect(0,0,canvas.width,canvas.height);
        context.drawImage(decoded.source,0,0,canvas.width,canvas.height);
        for(const quality of [.86,.74,.62]){
          compressed=app?.encodeCanvas?await app.encodeCanvas(canvas,{quality,preferWebp:true,alpha:false}):await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));
          if(!compressed)throw new Error('图片压缩失败，请重新选择');
          if(compressed.size<=maxBytes)break;
        }
        if(compressed.size<=maxBytes)break;
        canvas.width=Math.max(1,Math.round(canvas.width*.75));
        canvas.height=Math.max(1,Math.round(canvas.height*.75));
      }
      if(compressed.size>maxBytes)throw new Error('图片压缩后仍过大，请换一张图片');
      const output=scale===1&&['image/png','image/jpeg','image/webp'].includes(mime)&&source.size<=maxBytes&&source.size<compressed.size?source:compressed;
      const image=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(new Error('图片读取失败，请重新选择'));
        reader.readAsDataURL(output);
      });
      return {image,bytes:output.size};
    }finally{decoded.close();}
  }

  function open(roleId,onSaved,{simulated=false}={}){
    const rows=[];
    let active=true,workers=0,saving=false,sequence=0;
    const markup=`<div class="wardrobe-import-toolbar">
      <button type="button" data-wardrobe-pick>选择图片</button>
      <span data-wardrobe-progress role="status" aria-live="polite">每次最多 20 张</span>
      <input type="file" data-wardrobe-files accept="image/*" multiple hidden>
    </div>
    <p class="wardrobe-import-note">选图后自动识别穿搭、类型和季节，可修改后统一入库。${simulated?'验收使用本机模拟识别。':'识别使用已配置的识图模型。'}</p>
    <p class="wardrobe-import-selection-error" role="alert" hidden></p>
    <div class="wardrobe-import-list" data-wardrobe-list></div>
    <p class="wardrobe-import-empty">先选择想放进衣柜的穿搭图片</p>`;
    P().openModal('批量导入穿搭',markup,async()=>{
      if(rows.some(row=>processing(row)||!complete(row))||!rows.length)return;
      saving=true;
      root.querySelector('[data-close]').disabled=true;
      try{
        const result=await P().api('/api/engine/schedule',{roleId,action:'importWardrobe',items:rows.map(row=>({
          description:row.description.trim(),category:row.category,seasons:row.seasons,image:row.image
        }))});
        if(root.isConnected)P().closeModal();
        onSaved(result);
      }finally{
        saving=false;
        if(root.isConnected){root.querySelector('[data-close]').disabled=false;updateSummary();}
      }
    },'确认入库',()=>{active=false;});
    const root=document.querySelector('#overlay > .modal-sheet');
    root.classList.add('wardrobe-import-dialog');
    const file=root.querySelector('[data-wardrobe-files]'),list=root.querySelector('[data-wardrobe-list]');
    const processing=row=>['queued','compressing','recognizing'].includes(row.status);
    const complete=row=>!!row.image&&row.description.trim().length>0&&row.seasons.length>0;

    function updateSummary(){
      const pending=rows.filter(processing).length,ready=rows.filter(row=>!processing(row)&&complete(row)).length;
      root.querySelector('[data-wardrobe-progress]').textContent=!rows.length?'每次最多 20 张':
        pending?'正在识别 '+(rows.length-pending)+' / '+rows.length:'已就绪 '+ready+' / '+rows.length;
      root.querySelector('.wardrobe-import-empty').hidden=rows.length>0;
      root.querySelector('[type=submit]').disabled=saving||pending>0||!rows.length||ready!==rows.length;
      root.querySelector('[data-wardrobe-pick]').disabled=saving||rows.length>=maxFiles;
    }

    function updateRow(row){
      const busy=processing(row),node=row.node;
      node.querySelector('fieldset').disabled=busy;
      node.querySelector('[data-wardrobe-retry]').hidden=row.status!=='failed';
      node.querySelector('[data-wardrobe-status]').textContent={queued:'等待识别',compressing:'正在压缩',recognizing:'正在识别',done:'已识别',manual:'已手动填写',failed:row.error}[row.status];
      node.querySelector('[data-wardrobe-status]').classList.toggle('has-error',row.status==='failed');
      node.querySelector('[data-wardrobe-size]').textContent=row.bytes?size(row.file.size)+' → '+size(row.bytes):size(row.file.size);
      if(row.image&&!node.querySelector('img')){
        const image=document.createElement('img');image.src=row.image;image.alt='';
        node.querySelector('.wardrobe-import-thumb').replaceChildren(image);
      }
      updateSummary();
    }

    function addRow(file){
      const row={id:++sequence,file,status:'queued',description:'',category:'外出',seasons:[],image:'',bytes:0,error:''};
      const node=document.createElement('article');
      node.className='wardrobe-import-row';node.dataset.wardrobeRow=row.id;
      node.innerHTML=`<div class="wardrobe-import-thumb" aria-hidden="true">${P().icons.image}</div>
        <div class="wardrobe-import-row-main">
          <div class="wardrobe-import-row-heading"><span title="${P().esc(file.name)}">${P().esc(file.name)}</span><button type="button" data-wardrobe-remove aria-label="移除 ${P().esc(file.name)}">移除</button></div>
          <fieldset disabled><label class="wardrobe-import-description"><span class="wardrobe-import-label">穿搭描述</span><textarea data-wardrobe-description rows="2" maxlength="2000" placeholder="识别后可修改，也可自行填写" aria-label="穿搭描述"></textarea></label>
          <div class="wardrobe-import-classification"><label><span class="wardrobe-import-label">类型</span><select data-wardrobe-category aria-label="穿搭类型">${categories.map(value=>`<option>${value}</option>`).join('')}</select></label>
          <div class="wardrobe-import-seasons" role="group" aria-label="适用季节">${seasons.map(value=>`<label><input type="checkbox" data-wardrobe-season value="${value}"><span>${value}</span></label>`).join('')}</div></div></fieldset>
          <div class="wardrobe-import-row-footer"><span data-wardrobe-status role="status"></span><button type="button" data-wardrobe-retry hidden>重试</button><span data-wardrobe-size></span></div>
        </div>`;
      row.node=node;rows.push(row);list.append(node);
      node.querySelector('[data-wardrobe-remove]').onclick=()=>{
        rows.splice(rows.indexOf(row),1);node.remove();updateSummary();
      };
      node.querySelector('[data-wardrobe-retry]').onclick=()=>{row.status='queued';row.error='';updateRow(row);runQueue();};
      node.querySelector('fieldset').oninput=()=>{
        row.description=node.querySelector('[data-wardrobe-description]').value;
        row.category=node.querySelector('[data-wardrobe-category]').value;
        row.seasons=[...node.querySelectorAll('[data-wardrobe-season]:checked')].map(input=>input.value);
        if(row.status==='failed'&&complete(row))row.status='manual';
        updateRow(row);
      };
      updateRow(row);
    }

    async function processRow(row){
      try{
        if(!row.image){row.status='compressing';updateRow(row);Object.assign(row,await compress(row.file));}
        if(!active||!root.isConnected||!rows.includes(row))return;
        row.image=await P().uploadImageData(row.image);
        if(!active||!root.isConnected||!rows.includes(row))return;
        row.status='recognizing';updateRow(row);
        const result=await P().api('/api/engine/schedule',{roleId,action:'identifyWardrobe',image:row.image});
        if(!active||!root.isConnected||!rows.includes(row))return;
        Object.assign(row,result.item,{status:'done',error:''});
        row.node.querySelector('[data-wardrobe-description]').value=row.description;
        row.node.querySelector('[data-wardrobe-category]').value=row.category;
        row.node.querySelectorAll('[data-wardrobe-season]').forEach(input=>{input.checked=row.seasons.includes(input.value);});
      }catch(error){row.status='failed';row.error=error.message;}
      if(active&&root.isConnected&&rows.includes(row))updateRow(row);
    }

    function runQueue(){
      while(active&&root.isConnected&&workers<2){
        const row=rows.find(item=>item.status==='queued');
        if(!row)break;
        row.status='compressing';workers++;
        processRow(row).finally(()=>{workers--;runQueue();});
      }
    }

    root.querySelector('[data-wardrobe-pick]').onclick=()=>file.click();
    file.onchange=()=>{
      const selected=[...file.files],error=root.querySelector('.wardrobe-import-selection-error');
      file.value='';
      error.hidden=selected.length<=maxFiles-rows.length;
      error.textContent=error.hidden?'':'每次最多导入 20 张，请减少所选图片后再试。';
      if(!error.hidden)return;
      selected.forEach(addRow);runQueue();
    };
    updateSummary();file.click();
  }
  window.PipiWardrobeImport={open,compress};
})();
