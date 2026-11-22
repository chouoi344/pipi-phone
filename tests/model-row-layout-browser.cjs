// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium, webkit} = require(process.env.PIPI_PLAYWRIGHT_MODULE || 'playwright');
const {initial} = require('../lib/state.cjs');
const activationFixture = require('./fixtures/waterdrop-activation.cjs');
const {createApp} = require('../server.cjs');

const kinds = ['chat', 'tts', 'stt', 'image', 'decision', 'embedding', 'rerank'];
function modelState() {
  const state = initial();
  const ai = state.settings.ai;
  ai.sources.push({id:'layout-source', name:'模型排版测试', baseUrl:'https://example.invalid/v1', key:'test-only', template:'openai', kinds});
  for (const kind of kinds) {
    const id = 'layout-' + kind;
    ai.models.push({id, sourceId:'layout-source', kind, model:'长名称测试模型-' + kind + '-0123456789'.repeat(8), enabled:true, capabilities:kind === 'chat' ? ['text','image','audio','tool_use'] : []});
    ai.assign[kind] = id;
  }
  return state;
}

// Measure the copy and the actual buttons, including space reserved for touch.
function measure(row) {
  const bounds = el => { const {left,right,top,bottom,width,height} = el.getBoundingClientRect(); return {left,right,top,bottom,width,height}; };
  return {
    row:bounds(row), copy:bounds(row.querySelector('.model-copy')),
    name:bounds(row.querySelector('strong')),
    controls:[...row.querySelectorAll('.model-actions button,.add-candidate')].map(bounds)
  };
}
async function checkRows(page, skin, width) {
  await page.setViewportSize({width,height:820});
  await page.evaluate(s => { window.PipiSkins.select(s); window.PipiEngine.openSettings('providers'); }, skin);
  assert.equal(await page.locator('html').getAttribute('data-skin'), skin);
  for (const kind of kinds) {
    await page.locator('[data-model-category="'+kind+'"]').click();
    const toggle = page.locator('[data-provider-toggle="layout-source"]');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const provider = page.locator('[data-provider-card="layout-source"]');
    const configured = provider.locator('.inline-model-item').filter({has:page.locator('[role="switch"]')});
    const m = await configured.evaluate(measure);
    const label = [skin,width,kind].join(' ');
    assert.ok(m.copy.width >= m.row.width - 48 && m.name.width > 0, label+' model name needs a full text row');
    assert.equal(m.controls.length, kind === 'image' ? 3 : 4, label);
    for (const [i,button] of m.controls.entries()) {
      assert.ok(button.top >= m.copy.bottom - 1 && button.right <= m.row.right + 1, label+' actions below the text and inside the row');
      assert.ok(button.width >= 44 && button.height >= 44, label+' usable touch area');
      if (i) assert.ok(button.left >= m.controls[i-1].right - 1, label+' separate controls');
    }
    await provider.locator('[data-provider-fetch]').click();
    const candidate = provider.locator('.inline-model-item').filter({has:page.locator('.add-candidate')});
    const c = await candidate.evaluate(measure);
    assert.ok(c.copy.right <= c.controls[0].left+1 && c.copy.top < c.controls[0].bottom && c.copy.bottom > c.controls[0].top, label+' available model and plus on same line');
  }
}
async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'pipi-model-row-'));
  activationFixture.seedInstallation(directory);
  const app = createApp({host:'127.0.0.1',port:0,dataDir:directory,initialState:modelState,waterdropPublicKey:activationFixture.publicKey});
  await app.listen();
  const base = 'http://127.0.0.1:'+app.server.address().port;
  try {
    for (const engine of [chromium,webkit]) {
      const browser = await engine.launch(engine === chromium && process.env.PIPI_BROWSER_EXECUTABLE ? {executablePath:process.env.PIPI_BROWSER_EXECUTABLE} : {});
      try {
        const page = await browser.newPage(), request = page.context().request;
        const credentials = {displayName:'隔离测试',password:'Local-Model-Layout-Only'};
        const endpoint = engine === chromium ? 'setup' : 'login';
        const auth = await request.post(base+'/api/'+endpoint,{headers:{Origin:base},data:credentials});
        assert.equal(auth.status(),200);
        if (engine === chromium) {
          const session = await auth.json();
          assert.equal(session.appearance.installationId,activationFixture.installationId);
          const activation = await request.post(base+'/api/appearance/waterdrop',{headers:{Origin:base,'X-CSRF-Token':session.csrfToken},data:{code:activationFixture.code}});
          assert.equal((await activation.json()).waterdropActivated,true);
          // Ask the CSS parser to reject :has just like older Android WebViews.
          await page.route('**/*.css*',async route=>{
            const response = await route.fetch();
            await route.fulfill({response,body:(await response.text()).replaceAll(':has(',':unsupported-relational-selector(')});
          });
        }
        await page.route('**/api/engine/models/list',route=>route.fulfill({json:{models:[{model:'可添加的测试型号',capabilities:[]}]}}));
        await page.goto(base);
        await page.waitForFunction(()=>Boolean(window.Pipi?.getState()));
        for (const skin of ['classic','waterdrop']) for (const width of [320,390,1280]) await checkRows(page,skin,width);
        console.log(engine.name()+' · 2 skins × 3 widths × 7 model categories passed');
      } finally { await browser.close(); }
    }
  } finally { await app.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
