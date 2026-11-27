// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PIPI_PLAYWRIGHT_MODULE || 'playwright');
const { createApp } = require('../server.cjs');
const State = require('../lib/state.cjs');

const output = path.resolve(__dirname, '../../.codex/validation/acceptance-0134/chat-history');
const messageCount = 421;
const password = 'Isolated-Chat-History-Only';

async function run(browser, width, skin) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipi-chat-history-0134-'));
  const initial = State.initial();
  State.apply(initial, 'role.save', { name: '隔离历史好友' });
  const friend = initial.roles[0];
  const messages = Array.from({length: messageCount}, (_, index) => {
    const text = index === 12 ? '历史消息唯一标记' : `隔离聊天记录 ${index + 1}`;
    return State.message(initial, friend, 'assistant', text, 'text');
  });
  messages.at(-1).meta = { quote: {
    messageId: messages[12].id, sender: 'assistant', type: 'text',
    content: messages[12].content, senderName: friend.name
  } };
  const app = createApp({dataDir, host:'127.0.0.1', port:0, initialState:()=>initial, mediaTimers:false, providerUrlAllowlist:[]});
  await app.listen();
  const context = await browser.newContext({viewport:{width,height:844}, reducedMotion:'reduce'});
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const chat = page.locator('#chat-messages[data-scroll-ready=true]');
    const rows = chat.locator('[data-message]');
    const older = page.getByRole('button',{name:'查看更早消息',exact:true});
    const latest = page.getByRole('button',{name:'回到最新消息',exact:true});
    const target = chat.locator(`[data-message="${messages[12].id}"]`);
    const selector = id => `[data-message="${id}"]`;
    const waitChat = () => chat.waitFor();
    // Exercise the full-history client used by older servers without message paging.
    await page.route('**/api/status',async request=>{
      const response=await request.fetch(),data=await response.json();
      data.clientProtocol.features=data.clientProtocol.features.filter(feature=>feature!=='messages-v1');
      await request.fulfill({response,json:data});
    });
    await page.goto('http://127.0.0.1:'+app.server.address().port);
    await page.locator('#dismiss-notice').click();
    await page.locator('[name=displayName]').fill('历史验收账号');
    await page.locator('[name=password]').fill(password);
    await page.locator('[name=confirmPassword]').fill(password);
    await page.locator('#auth-form [type=submit]').click();
    await page.locator('#view[data-route=chats]').waitFor();
    await page.evaluate(value=>document.documentElement.dataset.skin=value,skin);
    await page.locator(`[data-open-chat="${friend.id}"]`).click();
    await waitChat();
    assert.equal(await rows.count(),120);
    assert.equal(await rows.last().getAttribute('data-message'),messages.at(-1).id);
    assert.equal(await target.count(),0);

    await older.scrollIntoViewIfNeeded();
    const anchorId = await rows.first().getAttribute('data-message');
    const offset = () => chat.locator(selector(anchorId)).evaluate(element=>element.getBoundingClientRect().top-element.closest('#chat-messages').getBoundingClientRect().top);
    const previousOffset = await offset();
    await older.click();
    await waitChat();
    await page.waitForFunction(id=>document.querySelector(`[data-message="${id}"]`).getBoundingClientRect().top<innerHeight,anchorId);
    assert.equal(await rows.count(),240);
    assert.ok(Math.abs(await offset()-previousOffset)<=2,'older page keeps the visible anchor');

    await chat.locator(`[data-quote-message="${messages[12].id}"]`).click();
    await waitChat();
    await target.locator('.message-bubble').waitFor();
    assert.ok(await rows.count()<=120,'locating a quote uses a bounded history window');
    assert.equal(await chat.locator(`[data-message="${messages.at(-1).id}"]`).count(),0);
    await page.getByRole('button',{name:'聊天信息',exact:true}).click();
    await page.getByRole('button',{name:'查找聊天内容',exact:true}).click();
    await page.getByRole('searchbox',{name:'搜索聊天内容'}).fill('历史消息唯一标记');
    await page.locator(`[data-search-message="${messages[12].id}"]`).click();
    await waitChat();
    assert.ok(await target.count());
    assert.ok(await rows.count()<=120,'search opens the matching message');

    await page.reload();
    await waitChat();
    await page.evaluate(value=>document.documentElement.dataset.skin=value,skin);
    assert.ok(await target.count(),'refresh retains the bounded historical location');
    await latest.click();
    await waitChat();
    assert.equal(await rows.count(),120);
    assert.equal(await rows.last().getAttribute('data-message'),messages.at(-1).id);
    assert.equal(await chat.evaluate(list=>list.scrollHeight-list.scrollTop-list.clientHeight<=2),true);
    assert.equal(await page.evaluate(()=>Pipi.getState().messages.length),messageCount);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(output,skin+'-'+width+'.png')});
    return {skin,width,initialCount:messageCount,latestRendered:120,olderRendered:240,quote:true,search:true,reload:true,latest:true,errors};
  } finally {
    await context.close();
    await app.close();
  }
}

async function main() {
  await fs.mkdir(output,{recursive:true});
  const browser = await chromium.launch({headless:true,executablePath:process.env.PIPI_BROWSER_EXECUTABLE});
  try {
    const results = [];
    for (const width of [390,1280]) {
      for (const skin of ['classic','waterdrop']) results.push(await run(browser,width,skin));
    }
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
    console.log('PASS chat history',results.length);
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
