/* SPDX-License-Identifier: AGPL-3.0-only */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '../public');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = [...index.matchAll(/(?:href|data-href)="\/([^"?]+\.css)(?:\?[^"]+)?"/g)]
  .map(match => fs.readFileSync(path.join(root, match[1]), 'utf8')).join('\n');

async function main() {
  const engine = process.env.PIPI_TEST_ENGINE || 'chromium';
  const driver = engine === 'chromium83' ? require(process.env.PIPI_BROWSER_DRIVER) :
    require(process.env.PIPI_PLAYWRIGHT_MODULE || 'playwright')[engine];
  const browser = await driver.launch({headless:true, executablePath:process.env.PIPI_BROWSER_EXECUTABLE || undefined});
  try {
    for (const width of [390,1280]) {
      const page = await browser.newPage();
      const viewport = {width,height:844};
      if (engine === 'chromium83') await page.setViewport(viewport);
      else await page.setViewportSize(viewport);
      for (const skin of ['waterdrop','classic']) for (const wallpaper of [false,true]) {
        await page.setContent('<html data-skin="'+skin+'"><head><style>'+css+'</style></head><body class="wechat-classic"><main class="phone-shell"><div id="view" data-route="chat" data-chat-role="alice" class="'+(wallpaper?'has-custom-wallpaper':'')+'"><div class="chat-messages" id="chat-messages"><div class="message-date">14:20</div><div class="message-row"><div class="message-bubble">你好</div></div><div class="message-row mine"><button data-chat-avatar="self"><span class="avatar"></span></button><div class="message-bubble">好久不见</div></div><div class="system-message">小林拍了拍我</div></div></div></main></body></html>');
        const styles = await page.evaluate(() => {
          const style = selector => getComputedStyle(document.querySelector(selector));
          return ['.message-bubble','.mine .message-bubble'].map(s => style(s).backgroundImage);
        });
        if (skin === 'waterdrop') {
          assert.match(styles[0], /linear-gradient/);
          assert.equal(styles[0], styles[1], 'incoming/outgoing waterdrop glass');
        }
        await page.addScriptTag({path:path.join(root,'ui-motion.js')});
        const feedback = await page.evaluate(() => {
          const date = getComputedStyle(document.querySelector('.message-date'));
          const notice = getComputedStyle(document.querySelector('.system-message'));
          const props = ['fontSize','color','lineHeight','marginBottom','paddingTop','backgroundColor'];
          const matched = props.every(key => date[key] === notice[key]);
          const view=document.getElementById('view'),button=view.querySelector('[data-chat-avatar="self"]');
          const before={messages:[]},event={id:'new',roleId:'alice',sender:'system',meta:{kind:'pat',author:'alice',target:'self'}};
          const after={messages:[event]},motion=window.PipiMotion;
          const update=(old,next)=>{motion.observeChatState(old,next,view);motion.decorateView(view,{name:'chat'});};
          update(null,after);
          const initial=button.classList.contains('avatar-patting');
          update(before,after);
          const animated=button.classList.contains('avatar-patting');
          button.classList.remove('avatar-patting');
          update(after,after);update(null,after);
          const replayed=button.classList.contains('avatar-patting');
          return {matched,initial,animated,replayed};
        });
        assert.deepEqual(feedback,{matched:true,initial:false,animated:true,replayed:false});
        console.log('PASS',engine,width,skin,wallpaper?'custom wallpaper':'default wallpaper');
      }
      await page.close();
    }
  } finally {await browser.close();}
}
main().catch(error => {console.error(error);process.exitCode=1;});
