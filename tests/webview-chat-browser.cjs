// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// This release check uses the actual browser executable, an empty profile and a loopback server.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require(process.env.PIPI_BROWSER_DRIVER || 'puppeteer-core');
const {createApp} = require('../server.cjs');
const State = require('../lib/state.cjs');
const Media = require('../lib/media-store.cjs');

async function exerciseAlbum(page, friendId, tap) {
  await page.evaluate(id => Pipi.showView('role-config', id), friendId);
  await tap('#view [data-life-category=photo]');
  await page.waitForSelector('#view .life-album-deck img');
  const cover = await page.$eval('#view .life-album-deck', el => {
    const box = el.getBoundingClientRect(), image = el.querySelector('img').getBoundingClientRect();
    return {width: box.width, height: box.height, imageHeight: image.height};
  });
  assert.ok(cover.width > 0 && Math.abs(cover.width / 1.4 - cover.height) < 2 && cover.imageHeight > 20,
    'the dated album must reserve a visible cover even before its lazy image loads');
  await tap('#view [data-life-action=albumDay]');
  await page.waitForFunction(() => document.querySelector('.life-photo-grid img')?.naturalWidth > 0);
  const photo = await page.$eval('.life-photo-grid button', el => el.getBoundingClientRect().toJSON());
  assert.ok(photo.width > 40 && Math.abs(photo.width - photo.height) < 2, 'the opened album shows square photo previews');
  await page.evaluate(() => { Pipi.closeModal(); Pipi.showView('chats'); });
}

async function exerciseVoiceOverlay(page, {width, tap, capture}) {
  // Supply only the native recorder responses, including on the HTTP fixture.
  // The app still opens its own overlay and receives real captured pointer events.
  const fixture = await page.evaluateHandle(() => {
    const meta = document.createElement('meta');
    meta.name = 'pipi-recording'; meta.content = 'test';
    document.head.append(meta);
    const prompt = window.prompt, commands = [];
    window.prompt = (message, command) => {
      if (message !== 'pipi-recording:test') return prompt(message, command);
      commands.push(command);
      return 'ok';
    };
    return {commands, restore() { meta.remove(); window.prompt = prompt; }};
  });
  await tap('[data-action=toggle-voice]');
  const center = async selector => {
    const {x, y, width, height} = await (await page.$(selector)).boundingBox();
    return {x: x + width / 2, y: y + height / 2};
  };
  const start = await center('[data-record]');
  const touch = width < 650 ? await page.target().createCDPSession() : null;
  const move = point => touch
    ? touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [point]})
    : page.mouse.move(point.x, point.y);
  if (touch) await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [start]});
  else { await move(start); await page.mouse.down(); }
  try {
    await page.waitForSelector('[data-record].recording');
    const layout = await page.evaluate(() => {
      const shell = document.querySelector('.phone-shell');
      const safeBottom = shell.getBoundingClientRect().bottom - parseFloat(getComputedStyle(shell).getPropertyValue('--safe-bottom'));
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {safeBottom, bubble:box('.vg-bubble'), hint:box('.vg-release-hint'), send:box('.vg-send-area svg'),
        targets:[box('.vg-target[data-mode=cancel] i'), box('.vg-target[data-mode=text] i')]};
    });
    await capture('voice-hold');
    assert.ok(layout.bubble.width >= 100 && layout.bubble.height >= 40,
      'the recording bubble should have a visible width and height: ' + JSON.stringify(layout));
    for (const target of layout.targets) {
      assert.ok(target.width >= 44 && target.height >= 44 && layout.bubble.bottom < target.top,
        'the recording actions should be reachable below the bubble');
      assert.ok(target.bottom < layout.hint.top && layout.hint.bottom <= layout.send.top &&
        layout.send.bottom <= layout.safeBottom + 1, 'the actions and prompt should clear the system controls');
    }
    for (const mode of ['text', 'cancel']) {
      await move(await center('.vg-target[data-mode=' + mode + '] i'));
      await page.waitForSelector('.vg-surface[data-mode=' + mode + ']');
    }
  } finally {
    if (touch) {
      await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await touch.detach();
    } else await page.mouse.up();
    await fixture.evaluate(f => f.restore());
  }
  await page.waitForSelector('.vg-surface', {hidden: true});
  assert.deepEqual(await fixture.evaluate(f => f.commands), ['start', 'cancel'], 'lifting over cancel discards the recording');
  await fixture.dispose();
  await tap('[data-action=toggle-voice]');
}

async function exerciseDraftRedraw(page, {skin, timing, width, tap, visible}) {
  // Release the real read receipt while composing to exercise the redraw from
  // a late server response. All other requests continue normally.
  const readReceipt = await page.evaluateHandle(() => {
    const fetch = window.fetch;
    const receipt = {ready: false, delivered: false};
    const hold = new Promise(resolve => { receipt.release = resolve; });
    window.fetch = async function(url, options) {
      if (url !== '/api/action' || JSON.parse(options.body).type !== 'conversation.read') {
        return fetch.apply(this, arguments);
      }
      window.fetch = fetch;
      const response = await fetch.apply(this, arguments);
      const readJson = response.json.bind(response);
      response.json = async () => {
        const payload = await readJson();
        receipt.ready = true;
        await hold;
        // The action handler consumes the resolved JSON before the next frame.
        requestAnimationFrame(() => { receipt.delivered = true; });
        return payload;
      };
      return response;
    };
    return receipt;
  });
  const replyCount = await page.evaluate(() => Pipi.getState().messages.filter(message => message.sender === 'assistant' && message.content === '收到测试消息。').length + 1);
  const message = 'sent-' + skin + '-' + timing;
  await page.type('#compose-text', message);
  await tap('#compose-form [type=submit]');
  await page.waitForFunction(text => Pipi.getState().messages.some(m => m.sender === 'user' && m.content === text), {}, message);
  await page.waitForFunction(count => [...document.querySelectorAll('#chat-messages [data-bubble]')]
    .filter(bubble => bubble.textContent === '收到测试消息。').length >= count, {}, replyCount);
  await page.waitForFunction(receipt => receipt.ready, {}, readReceipt);
  const focusComposer = () => page.evaluate(() => document.querySelector('#view #compose-text').focus());
  const prefix = timing === 'during-input' ? 'draft-' : '';
  let liftPointer;
  if (timing !== 'touch-down') {
    await focusComposer();
    if (prefix) await page.keyboard.sendCharacter(prefix);
  } else {
    const point = await page.$eval('#view #compose-text', editor => {
      const box = editor.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      if (!editor.contains(document.elementFromPoint(x, y))) throw new Error('The chat editor is covered');
      return {x, y};
    });
    if (width < 650) {
      const touch = await page.target().createCDPSession();
      await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [point]});
      liftPointer = async () => {
        await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await touch.detach();
      };
    } else {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      liftPointer = () => page.mouse.up();
    }
  }
  const editorBeforeReceipt = await page.evaluateHandle(receipt => {
    const editor = document.querySelector('#view #compose-text');
    receipt.release();
    return editor;
  }, readReceipt);
  if (liftPointer) {
    await page.waitForFunction(receipt => receipt.delivered, {}, readReceipt);
    assert.equal(await editorBeforeReceipt.evaluate(editor => editor.isConnected), true,
      'the held editor survives until the user lifts their finger');
    await liftPointer();
  }
  await page.waitForFunction(editor => !editor.isConnected, {}, editorBeforeReceipt);
  assert.equal(await page.$eval('#view #compose-text', input => input.textContent), prefix);
  if (!prefix) {
    await page.keyboard.sendCharacter('dr');
    assert.equal(await page.$eval('#view #compose-text', input => input.textContent), 'dr',
      'the first two characters reach the editor after the remote update');
  }
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#view #compose-text')), true,
    'the editor keeps focus across a read receipt');
  await editorBeforeReceipt.dispose();
  await readReceipt.dispose();
  await page.keyboard.sendCharacter(prefix ? skin : 'aft-' + skin);
  assert.equal(await page.$eval('#compose-text', input => input.textContent), 'draft-' + skin);
  await tap('[data-action=back]');
  await visible('#view[data-route=chats]');
  await tap('[data-open-chat]');
  await page.waitForFunction(text => document.querySelector('#compose-text').innerText === text, {}, 'draft-' + skin);
  await focusComposer();
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
}

async function run() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pipi-webview-test-'));
  const state = State.initial();
  const provider = http.createServer(async (request, response) => {
    for await (const chunk of request) { /* consume the request before replying */ }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({choices: [{message: {role: 'assistant', content: '收到测试消息。'}}]}));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const modelOrigin = 'http://127.0.0.1:' + provider.address().port;
  process.env.ALLOWED_HOSTS = 'pipi-webview.test'; // Maps to loopback in this browser only.
  process.env.ALLOW_PRIVATE_PROVIDERS = '1'; // Only the loopback test provider is allowlisted below.
  state.settings.ai.sources.push({id: 'fixture', name: 'Local', baseUrl: modelOrigin + '/v1', key: 'local', builtin: false});
  state.settings.ai.models.push({id: 'fixture-chat', sourceId: 'fixture', model: 'fixture', kind: 'chat', capabilities: ['text']});
  state.settings.ai.assign.chat = 'fixture-chat';
  state.settings.modules.waiting = {idleSeconds: 0.05, maxWaitSeconds: 1};
  state.settings.modules.segments = {enabled: false};
  State.apply(state, 'role.save', {name: '兼容测试好友', momentsAutoEnabled: false});
  const friend = state.roles[0];
  const image = Media.saveImage(directory, Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  state.engine.data.selfie.photos = {[friend.id]: [{id: 'test-album-photo', image, createdAt: Date.now()}]};
  State.message(state, friend, 'assistant', image, 'image');
  const wave = Buffer.alloc(44 + 32000);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28); wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(32000, 40);
  const voice = State.message(state, friend, 'assistant', '语音', 'voice', {meta: {
    audio: 'data:audio/wav;base64,' + wave.toString('base64'), durationMs: 1000
  }});
  let browser, page, app;
  try {
    app = createApp({dataDir: directory, host: '127.0.0.1', port: 0, mediaTimers: false,
      initialState: () => state, providerUrlAllowlist: [modelOrigin + '/v1']});
    await app.listen();
    browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH, headless: true,
      args: ['--disable-background-networking', '--disable-component-update', '--no-proxy-server',
        '--host-resolver-rules=MAP pipi-webview.test 127.0.0.1']});
    const version = await browser.version();
    if (process.env.PIPI_CHROME_MAJOR) assert.equal(version.match(/\/(\d+)/)[1], process.env.PIPI_CHROME_MAJOR);
    const width = Number(process.env.PIPI_VIEWPORT_WIDTH || 390);
    console.log('Testing ' + version + ' at ' + width + 'px');
    page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    page.on('error', error => { errors.push(error.message); console.error(error.message); });
    page.setDefaultTimeout(12000);
    await page.setViewport({width, height: 844, isMobile: width < 650, hasTouch: width < 650});
    // Exercise exactly the native launch probes before any page polyfills exist.
    const java = await fs.readFile(path.join(__dirname, '../android/app/src/main/java/com/pipiphone/app/WebViewRequirements.java'), 'utf8');
    const probe = name => JSON.parse(java.match(new RegExp(name + ' = ("(?:[^"\\\\]|\\\\.)*");'))[1]);
    assert.deepEqual(await page.evaluate(probe('FEATURES')), [], 'native capability gate');
    assert.equal(await page.evaluate(probe('SYNTAX')), true, 'native syntax gate');
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(window, 'MediaRecorder', {value: undefined, configurable: true});
    });
    const httpOnly = process.env.PIPI_TEST_HTTP === '1';
    const origin = 'http://' + (httpOnly ? 'pipi-webview.test' : '127.0.0.1') + ':' + app.server.address().port;
    await page.goto(origin, {waitUntil: 'domcontentloaded'});
    assert.equal(await page.evaluate(() => window.isSecureContext), !httpOnly);
    const visible = selector => page.waitForSelector(selector, {visible: true});
    const tap = async selector => {
      await page.waitForFunction(() => !document.querySelector('.navigation-snapshot'));
      await visible(selector);
      await page.$eval(selector, button => button.scrollIntoView({block: 'nearest'}));
      await page.waitForFunction(query => {
        const button = document.querySelector(query);
        if (!button) return false;
        const box = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      }, {}, selector);
      await page.click(selector);
    };
    await tap('#dismiss-notice');
    await page.waitForSelector('.first-notice', {hidden: true});
    const password = 'WebView-Isolated-Only';
    await page.type('[name=displayName]', 'Browser');
    await page.type('[name=password]', password);
    await page.type('[name=confirmPassword]', password);
    await tap('#auth-form [type=submit]');
    await visible('#view[data-route="chats"]');
    assert.equal(await page.evaluate(probe('PAGE_STARTED')), true, 'native page-ready check');
    for (const skin of ['classic', 'waterdrop']) {
      // Exercise both renderers with a test-only entitlement in this page.
      await page.evaluate(id => {
        PipiSkins.configure({waterdropActivated: true});
        PipiSkins.select(id);
      }, skin);
      await exerciseAlbum(page, friend.id, tap);
      await tap('[data-open-chat]');
      await visible('#chat-messages[data-scroll-ready=true]');
      await page.waitForFunction(() => !document.querySelector('.navigation-snapshot') &&
        document.querySelector('#view .chat-photo')?.naturalWidth > 0);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), skin);
      const layout = await page.evaluate(() => {
        const shell = document.querySelector('.phone-shell').getBoundingClientRect();
        const input = document.querySelector('#compose-text').getBoundingClientRect();
        return {inputVisible: input.width > 40 && input.height > 15 && input.top > shell.top && input.bottom <= shell.bottom + 1,
          needsLegacy: !CSS.supports('selector(:is(*))'), loadedLegacy: !!document.querySelector('#legacy-layout').sheet};
      });
      assert.equal(layout.inputVisible, true, 'chat input stays within the phone');
      assert.equal(layout.loadedLegacy, layout.needsLegacy, 'load legacy layout only for engines that need it');
      const capture = async suffix => {
        if (!process.env.PIPI_SCREENSHOTS) return;
        await fs.mkdir(process.env.PIPI_SCREENSHOTS, {recursive: true});
        const filename = [version.split('/').pop(), width, skin, suffix].filter(Boolean).join('-') + '.png';
        await page.screenshot({path: path.join(process.env.PIPI_SCREENSHOTS, filename)});
      };
      await capture();
      await exerciseVoiceOverlay(page, {width, tap, capture});
      await tap('.chat-photo');
      await visible('.image-viewer');
      await page.waitForFunction(() => document.querySelector('.image-stage img')?.naturalWidth > 0);
      await tap('.lightbox-close');
      const playing = page.evaluate(() => new Promise(resolve => {
        document.addEventListener('playing', () => resolve(true), {capture: true, once: true});
        setTimeout(() => resolve(false), 4500);
      }));
      await tap('[data-bubble="' + voice.id + '"]');
      assert.equal(await playing, true, 'voice audio starts');
      await tap('[data-action=toggle-panel]');
      await tap('[data-action=dictation]');
      await page.waitForFunction(insecure => document.querySelector('#toast').textContent.includes(insecure ? 'HTTPS' : '暂时无法录音'), {}, httpOnly);
      await tap('[data-action=toggle-panel]');
      for (const timing of skin === 'classic' ? ['touch-down', 'after-focus'] : ['during-input']) {
        await exerciseDraftRedraw(page, {skin, timing, width, tap, visible});
      }
      await tap('[data-action=back]');
      await visible('#view[data-route=chats]');
      console.log('PASS ' + skin + ' image / voice playback / unavailable microphone / send and receive / back and draft');
      if (skin === 'waterdrop') {
        await tap('#view .bottom-tabs [data-nav=me]');
        await tap('#view [data-action=my-moments]');
        await tap('#view #moment-album-timeline');
        await tap('#view #moment-publish-private');
        await visible('#overlay .moment-compose-text');
        const addPhoto = await page.$eval('#overlay .moment-add-photo', el => el.getBoundingClientRect().toJSON());
        assert.ok(addPhoto.width > 44 && Math.abs(addPhoto.width - addPhoto.height) < 2, 'the add-photo tile is square');
        assert.equal(await page.$eval('#overlay .modal-header h3', title => title.textContent), '私密发表');
        assert.equal(await page.$eval('#overlay #moment-visibility small', value => value.textContent), '私密');
        console.log('PASS waterdrop private Moments editor from Me and album timeline');
      }
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({route: document.querySelector('#view')?.dataset.route,
      screen: document.body.innerText.slice(-800), toast: document.querySelector('#toast')?.textContent})));
    throw error;
  } finally {
    if (page && !page.isClosed()) await page.close();
    if (browser) await browser.close();
    if (app) await app.close();
    await new Promise(resolve => provider.close(resolve));
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await fs.rm(directory, {recursive: true, force: true, maxRetries: 4});
  }
}
run().catch(error => {console.error(error); process.exitCode = 1;});
