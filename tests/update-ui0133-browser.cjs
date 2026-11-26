// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Opt-in Chromium acceptance. Only isolated app data and fixture release transport.
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const { chromium } = require(
  process.env.PIPI_PLAYWRIGHT_MODULE || 'playwright',
);
const { createApp } = require('../server.cjs'),
  currentVersion = require('../package.json').version;
const targetVersion = currentVersion.replace(/\d+$/, (n) =>
    String(Number(n) + 1),
  ),
  repository = 'isolated/pipi-phone';
const output = process.env.PIPI_UPDATE_UI_OUTPUT || path.resolve(
  __dirname,
  '../../.codex/validation/full-0133/updates',
);
async function main() {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PIPI_BROWSER_EXECUTABLE || undefined,
    }),
    results = [];
  try {
    for (const width of [390, 1280])
      for (const skin of ['classic', 'waterdrop'])
        for (const installed of [false, true]) {
          const root = await fs.mkdtemp(
              path.join(os.tmpdir(), 'pipi-update-ui-'),
            ),
            updateDir = path.join(root, 'updates');
          await fs.mkdir(updateDir);
          let feed = 'available';
          const write = async (name, value) => {
            const file = path.join(updateDir, name);
            await fs.writeFile(file + '.tmp', JSON.stringify(value));
            await fs.rename(file + '.tmp', file);
          };
          if (installed)
            await write('worker-ready.json', {
              updatedAt: new Date().toISOString(),
              requestSchema: 2,
            });
          const fetchImpl = async (url) => {
            if (feed === 'offline')
              throw new Error('Isolated release unavailable');
            if (feed === 'empty')
              return url.endsWith('/channel.json')
                ? Response.json({ schema: 1 })
                : new Response('', { status: 404 });
            assert(!url.includes('api.github.com'));
            return Response.json(
              url.startsWith('https://raw.githubusercontent.com/')
                ? {
                    version: targetVersion,
                    image: `ghcr.io/${repository}@sha256:` + 'b'.repeat(64),
                    publishedAt: new Date().toISOString(),
                    notes: '隔离更新说明：保留聊天与资料',
                  }
                : {
                    version: targetVersion,
                    image: `ghcr.io/${repository}@sha256:` + 'b'.repeat(64),
                  },
            );
          };
          const app = createApp({
            host: '127.0.0.1',
            port: 0,
            dataDir: path.join(root, 'data'),
            providerUrlAllowlist: [],
            updates: {
              repository,
              currentVersion,
              ...(installed ? { updateDir } : {}),
              fetchImpl,
            },
          });
          await app.listen();
          const page = await browser.newPage({
              viewport: { width, height: 900 },
            }),
            errors = [];
          page.on('pageerror', (e) => errors.push(e.message));
          const status = page.locator('.software-update-status'),
            detail = page.locator('.software-update-detail');
          try {
            await page.goto('http://127.0.0.1:' + app.server.address().port);
            await page.getByRole('button', {name: '我知道了'}).click();
            await page.locator('.first-notice').waitFor({ state: 'detached' });
            await page.locator('[name=displayName]').fill('隔离更新验收');
            await page
              .locator('[name=password]')
              .fill('Isolated-Update-UI-2026!');
            await page
              .locator('[name=confirmPassword]')
              .fill('Isolated-Update-UI-2026!');
            await page.locator('#auth-form [type=submit]').click();
            await page.locator('[data-nav=me]').click();
            await page.locator('[data-action=settings]').click();
            await page.locator('[data-action=about]').click();
            await page.locator('[data-update-entry] > summary').click();
            await page.evaluate(
              (skin) => (document.documentElement.dataset.skin = skin),
              skin,
            );
            await status
              .filter({ hasText: '发现新版本 v' + targetVersion })
              .waitFor();
            assert.match(
              await page.locator('.software-update-notes').textContent(),
              /隔离更新说明/,
            );
            assert.equal(
              await page.locator('[data-update-install]').isVisible(),
              installed,
            );
            if (!installed) {
              assert.match(await detail.textContent(), /未启用一键更新/);
              feed = 'empty';
              await page.locator('[data-update-check]').click();
              await status.filter({ hasText: '暂无正式发布版本' }).waitFor();
              feed = 'offline';
              await page.locator('[data-update-check]').click();
              await status.filter({ hasText: '暂时无法检查更新' }).waitFor();
              feed = 'available';
              await page.locator('[data-update-check]').click();
              await status.filter({ hasText: '发现新版本' }).waitFor();
            } else {
              await page.locator('[data-update-install]').click();
              await page.locator('.alert-dialog [data-close]').click();
              await assert.rejects(
                fs.access(path.join(updateDir, 'request.json')),
                { code: 'ENOENT' },
              );
              await page.locator('[data-update-install]').click();
              await page.locator('#alert-confirm').click();
              await status.filter({ hasText: '已排队' }).waitFor();
              const job = JSON.parse(
                await fs.readFile(path.join(updateDir, 'request.json'), 'utf8'),
              );
              assert.equal(job.version, targetVersion);
              assert.equal(job.previousVersion, currentVersion);
              const phase = async (phase, message, downloadProgress) =>
                write('status.json', {
                  ...job,
                  phase,
                  message,
                  downloadProgress,
                  startedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              const bar = page.getByRole('progressbar');
              const label = page.locator('.software-update-download span');
              await phase('downloading', '正在下载官方新版镜像');
              await bar.waitFor();
              assert.equal(await bar.getAttribute('value'), null);
              await phase('downloading', '正在下载官方新版镜像', {
                completedLayers: 2, totalLayers: 7, layerBytes: 3200000, layerTotalBytes: 17000000,
              });
              await label.filter({ hasText: '已完成 2 / 7 层 · 当前层 3.2 / 17 MB' }).waitFor();
              assert.deepEqual(await bar.evaluate(el => [el.value, el.max]), [2, 7]);
              assert.equal(await page.locator('[data-software-update]').evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
              await page.screenshot({path: path.join(output, `download-${skin}-${width}.png`)});
              await page.route('**/api/updates/status', route => route.fulfill({status: 503, json: {error: '服务重启中'}}), {times: 1});
              await status.filter({ hasText: '等待小手机重新连接' }).waitFor();
              assert.equal(await bar.isVisible(), false);
              await phase('downloading', '正在下载官方新版镜像', {
                completedLayers: 2, layerBytes: 5100000, layerTotalBytes: 17000000,
              });
              await label.filter({ hasText: '已完成 2 层 · 当前层 5.1 / 17 MB' }).waitFor();
              assert.deepEqual(await bar.evaluate(el => [el.value, el.max, el.getAttribute('aria-label')]), [5100000, 17000000, '当前层下载进度']);
              await phase('downloading', '正在下载官方新版镜像', { completedLayers: 3 });
              await label.filter({hasText: /^已完成 3 层$/}).waitFor();
              assert.equal(await bar.getAttribute('value'), null);
              await phase('downloading', '正在下载官方新版镜像', { completedLayers: 7, totalLayers: 7 });
              await label.filter({hasText: /^已完成 7 \/ 7 层$/}).waitFor();
              assert.deepEqual(await bar.evaluate(el => [el.value, el.max]), [7, 7]);
              await phase('backing-up', '隔离资料备份中');
              await status.filter({ hasText: '正在备份资料' }).waitFor();
              assert.equal(await bar.isVisible(), false);
              assert.equal(
                await page.locator('[data-update-check]').isDisabled(),
                true,
              );
              assert.equal(
                await page.locator('[data-update-install]').isVisible(),
                false,
              );
              await phase('succeeded', '隔离新版启动检查通过');
              await status.filter({ hasText: '更新完成' }).waitFor();
              assert.equal(
                await page.locator('[data-update-reload]').isVisible(),
                true,
              );
              // Polling has ended; an explicit check must expose a terminal rollback too.
              await phase('rolled-back', '隔离新版检查失败，旧版资料已恢复');
              await page.locator('[data-update-check]').click();
              await status
                .filter({ hasText: '更新失败，已恢复旧版' })
                .waitFor();
              assert.match(await detail.textContent(), /旧版资料已恢复/);
            }
            const overflow = await page
              .locator('[data-software-update]')
              .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
            assert.equal(overflow, false);
            await page.screenshot({
              path: path.join(
                output,
                `${skin}-${width}-${installed ? 'installed' : 'source'}.png`,
              ),
            });
            assert.deepEqual(errors, []);
            results.push({
              width,
              skin,
              mode: installed ? 'installed-fixture' : 'source-check-only',
              passed: true,
            });
          } finally {
            await page.close();
            await app.close();
            assert.ok(path.basename(root).startsWith('pipi-update-ui-'));
            await fs.rm(root, { recursive: true, force: true });
          }
        }
    await fs.writeFile(
      path.join(output, 'results.json'),
      JSON.stringify(
        {
          currentVersion,
          targetVersion,
          externalProviders: 'none',
          release: 'isolated transport fixture',
          results,
        },
        null,
        2,
      ),
    );
    console.log('PASS update UI browser cases', results.length);
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
