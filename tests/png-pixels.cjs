// SPDX-License-Identifier: MIT
// Lossless CDP PNG decode for actual rendered-pixel assertions.
'use strict';
const zlib=require('node:zlib');
function pngPixels(buffer){
  let width,height,channels;const data=[];
  for(let i=8;i<buffer.length;){const size=buffer.readUInt32BE(i),type=buffer.toString('ascii',i+4,i+8),part=buffer.subarray(i+8,i+8+size);if(type==='IHDR'){width=part.readUInt32BE(0);height=part.readUInt32BE(4);if(part[8]!==8||![2,6].includes(part[9]))throw Error('Unsupported screenshot PNG format');channels=part[9]===6?4:3;}if(type==='IDAT')data.push(part);i+=size+12;}
  const bytes=zlib.inflateSync(Buffer.concat(data)),stride=width*channels,pixels=Buffer.alloc(width*height*channels);let offset=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=bytes[offset++];for(let x=0;x<stride;x++){const left=x>=channels?pixels[y*stride+x-channels]:0,up=y?pixels[(y-1)*stride+x]:0,corner=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0;const predict=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,corner):NaN;if(!Number.isFinite(predict))throw Error('Unsupported PNG filter');pixels[y*stride+x]=(bytes[offset++]+predict)&255;}}
  return {width,height,channels,pixels};
}

module.exports=async function core043ExtraScenarios(t){
  const {assert,command,evaluate,wait,click,fill,capture,check,delay,metrics,deviceScaleFactor,out}=t;
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor,mobile:true});
  await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const key=async name=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key:name,code:name,windowsVirtualKeyCode:name==='Escape'?27:0});await command('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:name==='Escape'?27:0});await delay(130);};
  const back=async()=>{await click('[data-action=back]');await delay(130);};
  const root=async(tab='chats')=>{for(let i=0;i<6&&await evaluate('!!document.querySelector("#overlay").children.length');i++)await key('Escape');for(let i=0;i<25&&!await evaluate('!!document.querySelector(".bottom-tabs")');i++)await back();await click('[data-nav='+tab+']');await delay(80);};
  const close=async()=>{await click('#overlay > .page-editor [data-close]');await delay(160);};
  const save=async()=>{await click('#overlay > .page-editor .modal-submit');await wait('!document.querySelector("#overlay > .page-editor")');await delay(150);};
  const reload=async()=>{await command('Page.reload');await wait('!!document.querySelector(".bottom-tabs")');};
  const settings=async()=>{await root('me');await click('[data-action=settings]');};
  const chat=async id=>{await root();await click('[data-open-chat="'+id+'"]');await wait('!!document.querySelector("#compose-text")');};
  const roleValue=(id,key)=>evaluate('Pipi.getState().roles.find(r=>r.id==='+JSON.stringify(id)+')['+JSON.stringify(key)+']');
  const act=async(type,payload)=>evaluate('(async()=>{await Pipi.act('+JSON.stringify(type)+','+JSON.stringify(payload)+');return Pipi.getState();})()');
  const createRole=async name=>{await act('role.save',{name,prompt:'A disposable core043 UI fixture; no provider is invoked.'});return evaluate('Pipi.getState().roles.find(r=>r.name==='+JSON.stringify(name)+').id');};
  const snap=async label=>{await evaluate('Promise.all([...document.querySelectorAll(".page-editor")].flatMap(e=>e.getAnimations()).map(a=>a.finished.catch(()=>{})))');await capture('core043-'+label);};
  const guarded=async(label,run,cleanup=async()=>{})=>{try{await run();}catch(error){await snap(label+'-failure').catch(()=>{});throw error;}finally{await cleanup();}};
  const cleanRole=async id=>{if(id&&await evaluate('Pipi.getState().roles.some(r=>r.id==='+JSON.stringify(id)+')'))await act('role.delete',{id});};
  const chooseRoleConfig=async id=>{await settings();await click('[data-action=role-manager]');await click('[data-nav=role-config][data-arg="'+id+'"]');};
  const upload=async(selector,url,name='core043.png')=>evaluate(`(()=>{const raw=atob(${JSON.stringify(url.split(',')[1])}),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([bytes],${JSON.stringify(name)},{type:'image/png'}));const input=document.querySelector(${JSON.stringify(selector)});input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const rejectFiles=async(selector,previewSelector)=>{const revision=await evaluate('Pipi.getState().revision');for(const invalid of ['svg','large']){await evaluate(`(()=>{const transfer=new DataTransfer(),large=${JSON.stringify(invalid)}==='large';transfer.items.add(new File([large?new Uint8Array(5*1024*1024+1):'<svg xmlns="http://www.w3.org/2000/svg"/>'],large?'core043-large.png':'core043-unsupported.svg',{type:large?'image/png':'image/svg+xml'}));const input=document.querySelector(${JSON.stringify(selector)});input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await wait('document.querySelector("#toast").textContent.includes('+JSON.stringify(invalid==='svg'?'不支持 SVG':'5 MB')+')');assert.equal(await evaluate('!!document.querySelector('+JSON.stringify(previewSelector)+')'),false,invalid+' must not create a preview');assert.equal(await evaluate('Pipi.getState().revision'),revision,invalid+' must not commit server data');}};
  const holdReader=()=>evaluate(`(()=>{window.__core043NativeReader=window.FileReader;window.__core043ReaderReady=false;window.FileReader=class extends window.__core043NativeReader{readAsDataURL(file){if(file.name==='core043-late.png'){const callback=this.onload;this.onload=event=>{window.__core043ReaderReady=true;window.__core043ReleaseReader=()=>callback.call(this,event);};}return super.readAsDataURL(file);}};})()`);
  const releaseReader=async()=>{await wait('window.__core043ReaderReady===true');await evaluate('window.__core043ReleaseReader()');await delay(150);};
  const resetReader=()=>evaluate('if(window.__core043NativeReader){window.FileReader=window.__core043NativeReader;delete window.__core043NativeReader;}delete window.__core043ReaderReady;delete window.__core043ReleaseReader;');

  await check('core043 chat pin mute reload and destructive cancel preserve actual records',async()=>{
    let id;
    await guarded('chat-switches',async()=>{
      id=await createRole('CORE043 Switch Fixture');
      await evaluate(`(async()=>{const b=await Pipi.api('/api/backup');b.state.messages.push({id:'core043-clear-sentinel',roleId:${JSON.stringify(id)},sender:'assistant',type:'text',content:'CORE043_DO_NOT_CLEAR_ON_CANCEL',status:'sent',createdAt:Date.now()});const r=await Pipi.api('/api/restore',{backup:b,confirm:true});Pipi.setState(r.state);})()`);
      await act('memory.save',{roleId:id,content:'CORE043 memory survives cancelled deletion'});
      await chat(id);await click('[data-action=chat-details]');
      for(const [action,key] of [['toggle-pin','pinned'],['toggle-mute','muted']]){await click('[data-action='+action+']');await wait('document.querySelector("[data-action='+action+']").getAttribute("aria-checked")==="true"');assert.equal(await roleValue(id,key),true);}
      await reload();assert.equal(await roleValue(id,'pinned'),true);assert.equal(await roleValue(id,'muted'),true);await chat(id);await click('[data-action=chat-details]');
      for(const action of ['toggle-pin','toggle-mute']){await click('[data-action='+action+']');await wait('document.querySelector("[data-action='+action+']").getAttribute("aria-checked")==="false"');}
      await reload();assert.equal(await roleValue(id,'pinned'),false);assert.equal(await roleValue(id,'muted'),false);await chat(id);await click('[data-action=chat-details]');
      const before=await evaluate('({revision:Pipi.getState().revision,messages:Pipi.getState().messages.filter(m=>m.roleId==='+JSON.stringify(id)+').length,memories:Pipi.getState().memories.filter(m=>m.roleId==='+JSON.stringify(id)+').length})');
      await click('[data-action=clear-conversation]');await wait('!!document.querySelector("#alert-confirm")');await click('.alert-actions [data-close]');await delay(160);assert.deepEqual(await evaluate('({revision:Pipi.getState().revision,messages:Pipi.getState().messages.filter(m=>m.roleId==='+JSON.stringify(id)+').length,memories:Pipi.getState().memories.filter(m=>m.roleId==='+JSON.stringify(id)+').length})'),before,'cancel clear must not mutate messages or memory');
      await back();await back();await root('contacts');await click('[data-nav=role][data-arg="'+id+'"]');await click('[data-action=role-menu]');await click('[data-action=delete-role]');await key('Escape');assert.equal(await roleValue(id,'name'),'CORE043 Switch Fixture');assert.equal(await evaluate('Pipi.getState().revision'),before.revision);await snap('contact-delete-cancel');
      await click('[data-action=delete-role]');await click('#alert-confirm');await wait('!Pipi.getState().roles.some(r=>r.id==='+JSON.stringify(id)+')');assert.equal(await evaluate('Pipi.getState().messages.some(m=>m.roleId==='+JSON.stringify(id)+')'),false);assert.equal(await evaluate('Pipi.getState().memories.some(m=>m.roleId==='+JSON.stringify(id)+')'),false);await reload();assert.equal(await evaluate('Pipi.getState().roles.some(r=>r.id==='+JSON.stringify(id)+')'),false);
      metrics.push({kind:'core043-switches-cancel',pinnedReload:true,mutedReload:true,cancelClearRetainsRecords:true,cancelDeleteRetainsRecords:true,confirmedDelete:'temporary role only'});
    },async()=>{await cleanRole(id);});
  });

  await check('core043 role edit persona binding and proactive validation persist through reload',async()=>{
    let id,personaId;
    await guarded('role-proactive',async()=>{
      id=await createRole('CORE043 Configuration Fixture');await settings();await click('[data-action=personas]');await click('[data-action=add-persona]');await fill('[name=name]','CORE043 Bound Persona');await fill('[name=prompt]','CORE043 concrete persona content');await save();personaId=await evaluate('Pipi.getState().personas.find(p=>p.name==="CORE043 Bound Persona").id');
      await chooseRoleConfig(id);await click('[data-action=edit-role]');await fill('[name=name]','CORE043 Edited Role');await fill('[name=prompt]','CORE043 edited role instruction');await fill('[name=relationship]','CORE043 test relationship');await save();assert.equal(await roleValue(id,'name'),'CORE043 Edited Role');assert.equal(await roleValue(id,'prompt'),'CORE043 edited role instruction');
      await click('[data-action=bind-persona]');await fill('[name=personaId]',personaId);await save();assert.equal(await roleValue(id,'personaId'),personaId);
      await click('[data-action=proactive]');const revision=await evaluate('Pipi.getState().revision');await fill('[name=proactiveMinutes]','4');await click('.modal-submit');await wait('!!document.querySelector(".modal-error").textContent');assert.equal(await evaluate('Pipi.getState().revision'),revision,'rejected interval must not commit');assert.equal(await roleValue(id,'proactive'),false);await snap('proactive-invalid-interval');
      await click('[name=proactive]');await fill('[name=proactiveMinutes]','10080');await fill('[name=quietStart]','12:34');await fill('[name=quietEnd]','14:56');await save();await reload();for(const [key,value] of [['name','CORE043 Edited Role'],['prompt','CORE043 edited role instruction'],['personaId',personaId],['proactive',true],['proactiveMinutes',10080],['quietStart','12:34'],['quietEnd','14:56']])assert.equal(await roleValue(id,key),value,key);
      await chooseRoleConfig(id);await click('[data-action=proactive]');assert.equal(await evaluate('document.querySelector("[name=proactive]").checked'),true);assert.equal(await evaluate('document.querySelector("[name=quietStart]").value'),'12:34');await snap('proactive-persisted');await click('[name=proactive]');await save();await reload();assert.equal(await roleValue(id,'proactive'),false);assert.equal(await roleValue(id,'personaId'),personaId);
      metrics.push({kind:'core043-role-binding-proactive',actualUISave:true,invalidIntervalAtomic:true,reload:true,providerCalls:0,enabledIntervalMinutes:10080,disabledBeforeCleanup:true});
    },async()=>{await cleanRole(id);if(personaId&&await evaluate('Pipi.getState().personas.some(p=>p.id==='+JSON.stringify(personaId)+')'))await act('persona.delete',{id:personaId});});
  });

  await check('core043 chat photos preview remove and delayed FileReader stay with the origin role',async()=>{
    let origin,peer;
    await guarded('chat-images',async()=>{
      origin=await createRole('CORE043 Image Origin');peer=await createRole('CORE043 Image Peer');const image=await evaluate('(()=>{const c=document.createElement("canvas");c.width=c.height=2;c.getContext("2d").fillStyle="#d34a42";c.getContext("2d").fillRect(0,0,2,2);return c.toDataURL("image/png")})()');
      await chat(origin);await rejectFiles('#chat-image-file','.compose-image-preview');await upload('#chat-image-file',image);await wait('!!document.querySelector(".compose-image-preview img")');assert.equal(await evaluate('document.querySelector(".compose-image-preview img").src'),image);await snap('chat-image-preview');await click('[data-action=clear-image]');assert.equal(await evaluate('!!document.querySelector(".compose-image-preview")'),false);
      await holdReader();await upload('#chat-image-file',image,'core043-late.png');await wait('window.__core043ReaderReady===true');await back();await click('[data-open-chat="'+peer+'"]');await fill('#compose-text','CORE043_PEER_IMAGE_DRAFT');await releaseReader();assert.equal(await evaluate('!!document.querySelector(".compose-image-preview")'),false,'late image must not attach to peer');assert.equal(await evaluate('document.querySelector("#compose-text").value'),'CORE043_PEER_IMAGE_DRAFT');await snap('chat-late-file-isolated');await chat(origin);assert.equal(await evaluate('!!document.querySelector(".compose-image-preview")'),false);assert.equal(await evaluate('Pipi.getState().messages.some(m=>m.roleId==='+JSON.stringify(origin)+'&&m.type==="image")'),false,'preview never sends an image');
      metrics.push({kind:'core043-chat-file-reader',realFileReader:true,invalidSVGAndOversizeRejected:true,previewRemove:true,controlledLoadCallbackDelay:true,crossRoleDraftUnaffected:true,sentImages:0});
    },async()=>{await resetReader();await cleanRole(origin);await cleanRole(peer);});
  });

  await check('core043 avatar upload remove reupload reload and late reader do not overwrite a new editor',async()=>{
    const oldAvatar=await evaluate('Pipi.getState().profile.avatar');
    await guarded('avatar-images',async()=>{
      const images=await evaluate('["#d34a42","#356abb"].map(color=>{const c=document.createElement("canvas");c.width=c.height=2;const x=c.getContext("2d");x.fillStyle=color;x.fillRect(0,0,2,2);return c.toDataURL("image/png")})');await act('profile.save',{avatar:''});await root('me');await click('[data-nav=profile]');await click('[data-action=profile-avatar]');await rejectFiles('#avatar-file','#pick-avatar img');await upload('#avatar-file',images[0]);await wait('!!document.querySelector("#pick-avatar img")');assert.equal(await evaluate('document.querySelector("#pick-avatar img").src'),images[0]);await wait('!!document.querySelector("#remove-avatar")');await click('#remove-avatar');assert.equal(await evaluate('!!document.querySelector("#pick-avatar img")'),false);await upload('#avatar-file',images[1]);await wait('!!document.querySelector("#remove-avatar")');await snap('avatar-reupload-preview');await save();assert.equal(await evaluate('Pipi.getState().profile.avatar'),images[1]);await reload();assert.equal(await evaluate('Pipi.getState().profile.avatar'),images[1]);
      await root('me');await click('[data-nav=profile]');await click('[data-action=profile-avatar]');await holdReader();await upload('#avatar-file',images[0],'core043-late.png');await wait('window.__core043ReaderReady===true');await close();await click('[data-action=profile-avatar]');await releaseReader();assert.equal(await evaluate('document.querySelector("#pick-avatar img").src'),images[1]);await save();assert.equal(await evaluate('Pipi.getState().profile.avatar'),images[1],'old FileReader cannot overwrite global draft used by the new editor');
      metrics.push({kind:'core043-avatar-file-reader',emptyInitialAvatar:true,invalidSVGAndOversizeRejected:true,previewRemoveReupload:true,reload:true,lateOldEditorIgnored:true});
    },async()=>{await resetReader();await act('profile.save',{avatar:oldAvatar||''});});
  });

  await check('core043 chat member add paints a plain plus inside its separate dashed square',async()=>{
    const id=await evaluate('Pipi.getState().roles[0].id');await chat(id);await click('[data-action=chat-details]');await delay(250);await snap('member-add-plain-plus');
    const bounds=await evaluate('(()=>{const e=document.querySelector(".member-add .icon"),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,border:getComputedStyle(e.closest(".member-add")).borderStyle}})()');assert.equal(bounds.border,'dashed');
    const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,scale:1}}),buffer=Buffer.from(shot.data,'base64');await fs.writeFile(path.join(out,'core043-member-add-paint.png'),buffer);const {width,height,channels,pixels}=pngPixels(buffer);let crossPaint=0,quadrantRing=0;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dx=(x+.5)/width*32-16,dy=(y+.5)/height*32-16,i=(y*width+x)*channels,paint=Math.min(pixels[i],pixels[i+1],pixels[i+2])<230;if(!paint)continue;if((Math.abs(dx)<2&&Math.abs(dy)<10)||(Math.abs(dy)<2&&Math.abs(dx)<10))crossPaint++;if(Math.abs(dx)>5&&Math.abs(dy)>5&&Math.hypot(dx,dy)>11&&Math.hypot(dx,dy)<16.5)quadrantRing++;}
    assert.ok(crossPaint>30,'actual plus pixels must be visible');assert.ok(quadrantRing<10,'plain plus must not paint a circular ring in its diagonal quadrants: '+quadrantRing);metrics.push({kind:'core043-member-add-pixels',bounds,pixelWidth:width,pixelHeight:height,crossPaint,quadrantRing,semantics:'plain plus, separate dashed square',native8080PixelCertification:false});await root();
  });
};
module.exports=pngPixels;
