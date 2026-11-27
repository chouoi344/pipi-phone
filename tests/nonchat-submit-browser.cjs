// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),S=require('../lib/state.cjs');

async function main(){
  const engine=process.argv[2]||'chromium',old=engine==='83';
  const driver=require(old?process.env.PIPI_BROWSER_DRIVER:(process.env.PIPI_PLAYWRIGHT_MODULE||'playwright'));
  const browser=await (old?driver:driver[engine]).launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE||undefined});
  try{
    for(const [width,skin] of [[390,'classic'],[1280,'waterdrop']]){
      const state=S.initial();S.apply(state,'role.save',{name:'测试好友'});state.wallet.balanceCents=10000;
      for(let i=0;i<30;i++)S.apply(state,'moment.create',{content:'动态 '+i,visibility:'all'});
      const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-nonchat-'));
      const app=createApp({host:'127.0.0.1',port:0,dataDir:dir,initialState:()=>state,mediaTimers:false,providerUrlAllowlist:[]});
      await app.listen();const page=await browser.newPage();
      try{
        const viewport={width,height:800};if(old)await page.setViewport(viewport);else await page.setViewportSize(viewport);
        page.setDefaultTimeout(9000);
        await page.goto('http://127.0.0.1:'+app.server.address().port);
        await page.waitForSelector('#auth-form [name=displayName]');
        await page.evaluate(()=>{
          localStorage.setItem('pipi.first-use-notice.seen','1');document.querySelector('[name=displayName]').value='测试';
          for(const i of document.querySelectorAll('[type=password]'))i.value='Local-Nonchat-2026';
          document.querySelector('#auth-form [type=submit]').click();
        });
        await page.waitForSelector('[data-open-chat]');
        await page.evaluate(skin=>{
          document.documentElement.dataset.skin=skin;Pipi.showView('moments');
          window.backgroundRevision=async()=>{
            const response=await Pipi.api('/api/action',{type:'profile.save',payload:{bio:'后台变化 '+Date.now()}});
            Pipi.receiveState(response.state||await Pipi.api('/api/state'));
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          };
          window.counts={};const request=PipiNetwork.request;
          PipiNetwork.request=async(path,options)=>{
            if(path==='/api/action'){
              const type=JSON.parse(options.body).type;
              counts[type]=(counts[type]||0)+1;
              await new Promise(r=>setTimeout(r,100));
            }
            return request(path,options);
          };
        },skin);
        const scroll=await page.evaluate(async()=>{
          const scroller=document.querySelector('.moments-content');scroller.scrollTop=530;
          const before=scroller.scrollTop;await backgroundRevision();return [before,document.querySelector('.moments-content').scrollTop];
        });
        assert.ok(scroll[0]>100);assert.ok(Math.abs(scroll[0]-scroll[1])<=2,'timeline scrolling changed '+scroll);
        await page.evaluate(()=>PipiFeatures.composeMoment({textOnly:true}));
        const burst=async(selector)=>page.$eval(selector,b=>{for(let i=0;i<5;i++)b.click();});
        const input=async(selector,text)=>page.$eval(selector,(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},text);
        await input('.moment-compose textarea','这是一条测试动态');
        await page.evaluate(async()=>{document.querySelector('.moment-compose textarea').blur();await backgroundRevision();});
        assert.equal(await page.$eval('.moment-compose textarea',e=>e.value),'这是一条测试动态');
        await burst('.moment-compose-page [type=submit]');
        await page.waitForFunction(()=>!document.querySelector('.moment-compose-page')&&Pipi.getState().moments.some(m=>m.content==='这是一条测试动态'));
        const id=await page.evaluate(()=>Pipi.getState().moments.find(m=>m.content==='这是一条测试动态').id);
        await page.evaluate(id=>{const card=document.querySelector('[data-moment-id="'+id+'"]');card.querySelector('summary').click();card.querySelector('[data-comment]').click();},id);
        await input('.moment-comment-bar textarea','测试评论');
        const draft=await page.evaluate(async()=>{
          document.querySelector('.moment-comment-bar button').focus();await backgroundRevision();
          return document.querySelector('.moment-comment-bar textarea')?.value;
        });
        assert.equal(draft,'测试评论','a background update discarded the comment while its send button was focused');
        await burst('.moment-comment-bar [type=submit]');
        await page.waitForFunction(()=>!document.querySelector('.moment-comment-bar'));
        await page.evaluate(()=>{Pipi.showView('profile');document.querySelector('[data-action=profile-name]').click();});
        await input('#overlay [name=name]','已保存的名字');
        await page.evaluate(async()=>{document.querySelector('#overlay [type=submit]').focus();await backgroundRevision();});
        assert.equal(await page.$eval('#overlay [name=name]',e=>e.value),'已保存的名字');
        const previous=await page.evaluate(()=>counts['profile.save']);
        await burst('#overlay [type=submit]');await page.waitForFunction(()=>Pipi.getState().profile.name==='已保存的名字');
        assert.equal(await page.evaluate(()=>counts['profile.save']),previous+1);
        for(const type of ['redpacket','transfer']){
          await page.evaluate(type=>{PipiFeatures.transfer(type,Pipi.getState().roles[0].id);},type);
          const form='form[data-payment-form="'+type+'"]';
          if(type==='redpacket')await page.$eval(form+' [data-pay-focus]',e=>e.click());
          await page.$eval(form+' [data-pay-key="1"]',e=>e.click());
          if(type==='redpacket')await page.$eval(form+' [data-pay-key=done]',e=>e.click());
          await burst(form+' .wallet-pay-confirm');
          await page.waitForFunction(()=>!document.querySelector('[data-payment-form]'));
        }
        const actual=await page.evaluate(()=>{
          const s=Pipi.getState(),moments=s.moments.filter(m=>m.content==='这是一条测试动态');
          return {posts:moments.length,comments:moments[0].comments.map(c=>c.content),balance:s.wallet.balanceCents,transactions:s.wallet.transactions.map(t=>t.type).sort(),postsSent:counts['moment.create'],commentsSent:counts['moment.comment'],paymentsSent:counts['wallet.transfer']};
        });
        assert.deepEqual(actual,{posts:1,comments:['测试评论'],balance:9800,transactions:['redpacket','transfer'],postsSent:1,commentsSent:1,paymentsSent:2});
        console.log('PASS',engine,width,skin,'朋友圈、评论、红包、转账和资料保存连点，后台刷新后保留草稿和阅读位置');
      }finally{await page.close();await app.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:3});}
    }
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
