// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

module.exports=async function formalLifeScenarios(t){
  const {assert,command,evaluate,wait,click,fill,capture,check,noOverflow,deviceScaleFactor}=t;
  const basicName='[data-life-field=name]';
  async function enterFriend(id){
    await evaluate("Pipi.showView('chats')");
    await click('[data-open-chat="'+id+'"]');
    await click('[data-action=chat-details]');
    await click('[data-action=open-role-config]');
    await wait('!!document.querySelector("[data-life-root] [data-life-field=name]")');
    assert.equal(await evaluate("document.querySelector('[data-life-root]').dataset.lifeRoot"),id);
  }
  await check('formal life panels for two isolated friends, with save, reload and desktop and mobile layouts',async()=>{
    const [a,b]=await evaluate(`(async()=>{
      const sample=(color,label)=>{
        const canvas=document.createElement('canvas');canvas.width=360;canvas.height=360;
        const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,360,360);
        c.fillStyle='#fff';c.font='bold 48px sans-serif';c.fillText(label,48,172);
        return canvas.toDataURL('image/png');
      };
      const roles=[['许澄','苏州展览讲解员。十点开会，十一点散会后布展，夜里睡觉。说话简短。','#3668ab'],['沈禾','杭州插画师，喜欢橙色。','#a8522e']];
      for(const [name,prompt,color] of roles){
        await Pipi.act('rolePersona.save',{name:name+'验收人设',prompt});
        const persona=Pipi.getState().rolePersonas.find(p=>p.name===name+'验收人设');
        const avatar=sample(color,name);
        await Pipi.act('role.save',{name,prompt,rolePersonaId:persona.id,avatar,faceReferences:[avatar],outreachEnabled:false});
      }
      return roles.map(([name])=>Pipi.getState().roles.find(r=>r.name===name).id);
    })()`);
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor,mobile:true});
    await enterFriend(a);
    await fill(basicName,'许澄·已保存');
    await fill('#lb-city','苏州');
    await click('[data-life-action=saveAll]');
    await wait(`Pipi.getState().roles.find(role=>role.id===${JSON.stringify(a)}).name==='许澄·已保存'`);
    await noOverflow('390-role-basic');await capture('390-formal-role-basic');
    for(const name of ['schedule','interaction','memory','stickers','photo','wardrobe','moments']){
      const category='[data-life-category='+name+']';
      await click(category);
      await wait(`document.querySelector('${category}')?.getAttribute('aria-pressed')==='true'`);
      await noOverflow('390-role-'+name);
    }
    await capture('390-formal-role-moments');
    await enterFriend(b);
    assert.equal(await evaluate(`document.querySelector('${basicName}').value`),'沈禾');
    assert.notEqual(await evaluate("document.querySelector('#lb-city').value"),'苏州');
    await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor,mobile:false});
    await noOverflow('1440-role-basic');await capture('1440-formal-role-basic');
    await command('Page.reload');
    await wait('!!window.Pipi?.getState()?.roles?.length');
    await enterFriend(a);
    assert.equal(await evaluate(`document.querySelector('${basicName}').value`),'许澄·已保存');
    assert.equal(await evaluate("document.querySelector('#lb-city').value"),'苏州');
    assert.equal(await evaluate(`Pipi.getState().roles.find(r=>r.id===${JSON.stringify(a)}).faceReferences.length`),1);
    await capture('1440-formal-role-saved');
  });
  await check('formal life recovery keeps the current role draft and rejects partial saves',async()=>{
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:700,deviceScaleFactor,mobile:true});
    const id=await evaluate(`(async()=>{
      await Pipi.act('role.save',{name:'角色配置恢复测试'});
      const role=Pipi.getState().roles.find(r=>r.name==='角色配置恢复测试');
      const original=Pipi.api;
      window.lifeRecovery={original,down:true,reads:0};
      Pipi.api=(path,...args)=>{
        if(path==='/api/engine/life?roleId='+role.id){lifeRecovery.reads++;if(lifeRecovery.down)return Promise.reject(new Error('测试读取中断'));}
        return original(path,...args);
      };
      Pipi.showView('role-config',role.id);
      return role.id;
    })()`);
    try{
      const retry='[data-life-action=retryLoad]';
      await wait(`Boolean(document.querySelector('${retry}'))`);
      assert.deepEqual(await evaluate('Array.from({length:3},()=>{Pipi.refresh();return lifeRecovery.reads;})'),[1,1,1]);
      await evaluate('lifeRecovery.down=false');await click(retry);
      await wait(`Boolean(document.querySelector('${basicName}'))`);
      await fill(basicName,'角色配置已重试');await fill('#lb-city','虚构城');
      await evaluate(`(async()=>{lifeRecovery.down=true;await Pipi.act('role.save',{id:${JSON.stringify(id)},remark:'变动触发刷新'});Pipi.refresh();})()`);
      await wait(`Boolean(document.querySelector('${retry}'))`);
      const requestCount=await evaluate('lifeRecovery.reads');
      assert.deepEqual(await evaluate('Array.from({length:3},()=>{Pipi.refresh();return lifeRecovery.reads;})'),Array(3).fill(requestCount));
      await evaluate('lifeRecovery.down=false');await click(retry);
      await wait(`!document.querySelector('${retry}')`);
      assert.equal(await evaluate(`document.querySelector('${basicName}').value`),'角色配置已重试');
      assert.equal(await evaluate(`document.querySelector('#lb-city').value`),'虚构城');
      await click('[data-life-category=moments]');
      await fill('[data-life-field=dailyMax]','-1');
      await click('[data-life-action=saveAll]');
      await wait(`document.querySelector('.life-error')?.textContent.includes('非负整数')`);
      const original=await evaluate(`Pipi.api('/api/engine/life?roleId='+${JSON.stringify(id)}).then(x=>[x.role.name,x.schedule.city,x.moments.settings.dailyMax])`);
      assert.deepEqual(original,['角色配置恢复测试','',2]);
      await fill('[data-life-field=dailyMax]','3');
      await click('[data-life-action=saveAll]');
      await wait(`Pipi.getState().roles.some(r=>r.id===${JSON.stringify(id)}&&r.name==='角色配置已重试'&&r.city==='虚构城')`);
      await command('Page.reload');
      await wait(`document.querySelector('[data-life-category=moments]')?.getAttribute('aria-pressed')==='true'&&document.querySelector('[data-life-field=dailyMax]')?.value==='3'`);
      await click('[data-life-category=basic]');
      assert.equal(await evaluate(`document.querySelector('${basicName}').value`),'角色配置已重试');
      assert.equal(await evaluate(`document.querySelector('#lb-city').value`),'虚构城');
    }finally{await evaluate('if(window.lifeRecovery){Pipi.api=lifeRecovery.original;delete window.lifeRecovery;}');}
  });
  await check('formal life memory pagination and sticker, reference and wardrobe links operate in the panel',async()=>{
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor,mobile:true});
    const id=await evaluate(`(async()=>{
      await Pipi.act('role.save',{name:'生活数据验收'});
      const id=Pipi.getState().roles.find(r=>r.name==='生活数据验收').id;
      let result;
      for(let index=1;index<=21;index++)result=await Pipi.api('/api/engine/memory',{roleId:id,action:'add',content:'生活验收记录 · '+index,memoryType:'GENERAL',importance:0.8,locked:true});
      Pipi.setState(result.state);
      const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#bb67ee';ctx.fillRect(0,0,32,32);
      await Pipi.act('sticker.add',{image:canvas.toDataURL('image/png'),name:'生活验收表情'});
      return id;
    })()`);
    await enterFriend(id);
    await click('[data-life-category=memory]');
    await wait(`document.querySelectorAll('.life-memory-card').length===20`);
    await click('[data-lm-offset="20"]');
    await wait(`document.querySelectorAll('.life-memory-card').length===1`);
    await fill('#lm-search-input','生活验收记录 · 21');
    await click('#lm-search-form [type=submit]');
    await wait(`document.querySelector('.life-memory-count')?.textContent.includes('找到 1 条')&&document.querySelector('.lm-card-body')?.textContent.endsWith('21')`);
    await click('[data-life-category=stickers]');
    await click('[data-engine-action=add-role-sticker]');
    await click('.engine-sticker-choice');
    await click('#overlay .modal-submit');
    await wait(`document.querySelectorAll('[data-role-sticker]').length===1`);
    await noOverflow('390-role-sticker-library');
    await click('[data-life-category=photo]');
    await evaluate(`(async()=>{
      const input=document.querySelector('#ref-image-input');input.click=()=>{};
      document.querySelector('[data-ref-upload^="faceReferences:"]').click();
      const data=Uint8Array.from(atob(Pipi.getState().stickers[0].image.split(',')[1]),byte=>byte.charCodeAt(0));
      const selection=new DataTransfer();selection.items.add(new File([data],'reference.png',{type:'image/png'}));
      input.files=selection.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await wait(`Pipi.getState().roles.find(r=>r.id===${JSON.stringify(id)}).faceReferences.length===1`);
    await click('[data-life-category=wardrobe]');
    await click('[data-life-action=wardrobeAdd]');
    await fill('.schedule-wardrobe-dialog [name=description]','蓝衬衫与黑色长裤');
    await click('.schedule-wardrobe-dialog [type=submit]');
    await wait(`document.querySelector('.life-wardrobe-name')?.textContent==='蓝衬衫与黑色长裤'`);
    await noOverflow('390-role-wardrobe');
    await capture('390-life-wardrobe-saved');
  });
  await check('formal life current wallet, independent ledger, contacts and discovery routes',async()=>{
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor,mobile:true});
    await evaluate("Pipi.showView('contacts')");
    await wait('!!document.querySelector(".contacts-index")');
    await noOverflow('390-formal-contacts');
    await evaluate("Pipi.showView('discover')");
    await click('[data-action=engine-functions]');
    await click('[data-module=actions]');
    await wait('!!document.querySelector("[name=allowStickers]")');
    await click('[name=allowStickers]');
    await click('#engine-module-form [type=submit]');
    await wait('Pipi.getState().settings.modules?.actions?.allowStickers===false');
    await click('[name=allowStickers]');
    await click('#engine-module-form [type=submit]');
    await wait('Pipi.getState().settings.modules?.actions?.allowStickers===true');
    await noOverflow('390-formal-global-tools');
    await capture('390-formal-global-tools');
    await evaluate("Pipi.showView('me')");
    await click('[data-action=services]');
    await click('[data-feature-view=wallet]');
    await noOverflow('390-formal-wallet');
    const starting=await evaluate('Pipi.getState().wallet.balanceCents');
    const roleId=await evaluate('Pipi.getState().roles[0].id');
    const sent=await evaluate(`(async()=>{
      const input={roleId:${JSON.stringify(roleId)},type:'transfer',amountCents:1234,note:'验收虚拟转账',requestId:crypto.randomUUID()};
      await Pipi.act('wallet.transfer',input);
      await Pipi.act('wallet.transfer',input);
      const s=Pipi.getState();return [s.wallet.balanceCents,s.wallet.transactions.filter(item=>item.note===input.note).length];
    })()`);
    assert.deepEqual(sent,[starting-1234,1]);
    await evaluate("Pipi.showView('services')");
    await click('[data-feature-view=ledger]');
    await click('#ledger-add');
    await fill('[name=amount]','12.34');
    await fill('[name=merchant]','验收独立账本');
    await click('.modal-submit');
    await wait('Pipi.getState().ledger.some(item=>item.merchant==="验收独立账本"&&item.amountCents===1234)');
    assert.equal(await evaluate('Pipi.getState().wallet.balanceCents'),starting-1234);
    await noOverflow('390-formal-ledger');
    await capture('390-formal-ledger');
    const exported=await evaluate("Pipi.api('/api/backup').then(b=>({format:b.format,ledger:b.state.ledger.some(i=>i.merchant==='验收独立账本'),keys:b.state.settings.ai.sources.some(s=>s.key)}))");
    assert.deepEqual(exported,{format:'pipi-phone',ledger:true,keys:false});
  });
};
