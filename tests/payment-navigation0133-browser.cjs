// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { chromium } = require(
  process.env.PIPI_PLAYWRIGHT_MODULE || 'playwright',
);
const S = require('../lib/state.cjs'),
  { createApp } = require('../server.cjs');
const out = path.resolve(
  __dirname,
  '../../.codex/validation/full-0133/redpacket',
);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PIPI_BROWSER_EXECUTABLE,
  });
  const results = [];
  try {
    for (const width of [390, 1280])
      for (const skin of ['classic', 'waterdrop']) {
        const initial = S.initial();
        S.apply(initial, 'role.save', {
          name: '支付隔离好友',
          momentsAutoEnabled: false,
        });
        const role = initial.roles[0];
        S.message(initial, role, 'assistant', '隔离测试消息', 'text');
        initial.wallet.balanceCents = 10000;
        for (const type of ['redpacket', 'transfer']) {
          const id = 'incoming-' + type;
          initial.wallet.transactions.push({
            id,
            roleId: role.id,
            type,
            direction: 'in',
            status: 'pending',
            amountCents: 123,
            createdAt: Date.now(),
          });
          S.message(initial, role, 'assistant', '隔离待领取', type, {
            meta: { transactionId: id, amountCents: 123 },
          });
        }
        const app = createApp({
          host: '127.0.0.1',
          port: 0,
          dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pipi-payment0133-')),
          initialState: () => initial,
        });
        await app.listen();
        const page = await browser.newPage({
            viewport: { width, height: 900 },
          }),
          errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const metric = async (name) =>
          results.push({
            width,
            skin,
            name,
            ...(await page.evaluate(() => ({
              route: document.querySelector('#view')?.dataset.route,
              history: history.state,
            }))),
          });
        const settled = () =>
          page.waitForFunction(
            () =>
              document.querySelector('#view')?.dataset.route === 'chat' &&
              !document.querySelector('.page-editor'),
          );
        const open = async (type) => {
          if (
            !(await page.locator('[data-action=chat-' + type + ']').isVisible())
          )
            await page.locator('[data-action=toggle-panel]').click();
          await page.locator('[data-action=chat-' + type + ']').click();
          const paymentForm = page.locator('form[data-payment-form="' + type + '"]');
          await paymentForm.waitFor();
          assert.equal(await paymentForm.locator('button[type=submit]').count(), 1);
          assert.equal(await paymentForm.locator('.modal-header button[type=submit]').count(), 0);
          const pay = paymentForm.locator(type === 'redpacket'
            ? '.wallet-pay-page > .wallet-pay-confirm'
            : '.pay-keypad > .wallet-pay-confirm');
          assert.equal(await pay.isVisible(), true);
          assert.equal(await pay.isDisabled(), true);
        };
        const amount = async (type) => {
          if (type === 'redpacket')
            await page.locator('[data-pay-focus]').click();
          await page.locator('[data-pay-key="1"]').click();
          if (type === 'redpacket')
            await page.locator('[data-pay-key=done]').click();
        };
        try {
          await page.goto('http://127.0.0.1:' + app.server.address().port);
          await page.locator('[name=displayName]').fill('隔离测试');
          await page.locator('[name=password]').fill('Only-Isolated-0133');
          await page
            .locator('[name=confirmPassword]')
            .fill('Only-Isolated-0133');
          await page.locator('#auth-form [type=submit]').click();
          await page.locator('[data-open-chat]').click();
          await page.evaluate(
            (skin) => (document.documentElement.dataset.skin = skin),
            skin,
          );
          for (const type of ['redpacket', 'transfer']) {
            for (const exit of ['arrow', 'Escape', 'history']) {
              await open(type);
              await amount(type);
              const n = await page.evaluate(
                () => Pipi.getState().wallet.transactions.length,
              );
              if (exit === 'arrow') await page.locator('.modal-back').click();
              else if (exit === 'Escape') await page.keyboard.press('Escape');
              else await page.goBack();
              await settled();
              assert.equal(
                await page.evaluate(
                  () => Pipi.getState().wallet.transactions.length,
                ),
                n,
              );
              assert.equal(
                await page
                  .locator('[data-action=chat-' + type + ']')
                  .isVisible(),
                true,
              );
              await metric(type + ' cancel ' + exit);
            }
            await open(type);
            await amount(type);
            await page.route('**/api/action', async (route) => {
              if (route.request().postDataJSON()?.type === 'wallet.transfer')
                await route.fulfill({
                  status: 503,
                  contentType: 'application/json',
                  body: JSON.stringify({ error: '隔离发送失败' }),
                });
              else await route.continue();
            });
            await page.locator('.wallet-pay-confirm').click();
            await page
              .locator('.modal-error')
              .filter({ hasText: '隔离发送失败' })
              .waitFor();
            assert.equal(await page.locator('[name=amount]').inputValue(), '1');
            await metric(type + ' failure retains form');
            await page.unroute('**/api/action');
            const before = await page.evaluate(
              () => Pipi.getState().wallet.transactions.length,
            );
            await page.route('**/api/action', async (route) => {
              if (route.request().postDataJSON()?.type === 'wallet.transfer')
                await new Promise((r) => setTimeout(r, 180));
              await route.continue();
            });
            await page.locator('.wallet-pay-confirm').evaluate((b) => {
              b.click();
              b.click();
            });
            await settled();
            await page.waitForTimeout(250);
            await page.unroute('**/api/action');
            assert.equal(
              await page.evaluate(
                () => Pipi.getState().wallet.transactions.length,
              ),
              before + 1,
            );
            assert.equal(
              await page.evaluate(() => history.state.overlay),
              undefined,
            );
            await metric(type + ' successful duplicate-click send');
            const visible = await page
              .locator('.payment-' + type)
              .last()
              .evaluate((el) => {
                const a = el.getBoundingClientRect(),
                  b = document
                    .querySelector('#chat-messages')
                    .getBoundingClientRect();
                return a.top >= b.top && a.bottom <= b.bottom;
              });
            assert.equal(visible, true, 'sent payment visible');
            await page
              .locator('.payment-' + type)
              .last()
              .click();
            await page.locator('.wallet-transaction-detail').waitFor();
            await page.locator('.modal-back').click();
            await settled();
            await metric(type + ' outgoing detail back');
            await page
              .locator('.payment-' + type)
              .first()
              .click();
            await page.locator('[data-payment-handle=receive]').click();
            await page.waitForFunction(
              (id) =>
                Pipi.getState().wallet.transactions.find((t) => t.id === id)
                  ?.status === 'received',
              'incoming-' + type,
            );
            await page.locator('.modal-back').click();
            await settled();
            await metric(type + ' incoming receive back');
            // Commit the real HTTP request, then lose its response before the browser sees it.
            await open(type);
            await amount(type);
            const paymentBefore = await page.evaluate(() => ({
                balance: Pipi.getState().wallet.balanceCents,
                transactions: Pipi.getState().wallet.transactions.length,
                messages: Pipi.getState().messages.filter((m) =>
                  ['redpacket', 'transfer'].includes(m.type),
                ).length,
              })),
              requestIds = [];
            const cardsBefore = await page
              .locator('#view .payment-' + type)
              .count();
            let committed;
            await page.route('**/api/action', async (route) => {
              const body = route.request().postDataJSON();
              if (body?.type !== 'wallet.transfer') return route.continue();
              requestIds.push(body.payload.requestId);
              if (requestIds.length === 1) {
                const response = await route.fetch();
                assert.equal(response.status(), 200);
                committed = await response.json();
                await route.abort('failed');
              } else await route.continue();
            });
            await page.locator('.wallet-pay-confirm').click();
            await page.waitForFunction(() =>
              document.querySelector('.modal-error')?.textContent.trim(),
            );
            assert.equal(await page.locator('[name=amount]').inputValue(), '1');
            assert.equal(
              committed.state.wallet.transactions.length,
              paymentBefore.transactions + 1,
            );
            assert.equal(
              committed.state.wallet.balanceCents,
              paymentBefore.balance - 100,
            );
            await page.locator('.wallet-pay-confirm').click();
            await settled();
            await page.unroute('**/api/action');
            assert.equal(requestIds.length, 2);
            assert.equal(requestIds[0], requestIds[1]);
            const retried = await page.evaluate(() => ({
              balance: Pipi.getState().wallet.balanceCents,
              transactions: Pipi.getState().wallet.transactions.length,
              messages: Pipi.getState().messages.filter((m) =>
                ['redpacket', 'transfer'].includes(m.type),
              ).length,
              role: history.state.route.arg,
            }));
            assert.equal(retried.balance, paymentBefore.balance - 100);
            assert.equal(retried.transactions, paymentBefore.transactions + 1);
            assert.equal(retried.messages, paymentBefore.messages + 1);
            assert.equal(retried.role, role.id);
            assert.equal(
              await page.locator('#view .payment-' + type).count(),
              cardsBefore + 1,
            );
            await metric(
              type + ' committed response lost then same-request retry',
            );
          }
          await page.screenshot({
            path: path.join(out, skin + '-' + width + '.png'),
          });
          await page.locator('#view .back-btn').click();
          await page.locator('#view[data-route=chats]').waitFor();
          await metric('chat back reaches chat list once');
          await page.locator('[data-nav=me]').click();
          await page.locator('[data-action=services]').click();
          await page.locator('[data-feature-view=wallet]').click();
          await page.locator('#wallet-balance').click();
          for (const type of ['redpacket', 'transfer']) {
            await page.locator('#wallet-' + type).click();
            await page.locator('[data-wallet-person]').click();
            await amount(type);
            await page.locator('.modal-back').click();
            await page.locator('.wallet-recipients').waitFor();
            await page.locator('[data-wallet-person]').click();
            await amount(type);
            await page.locator('.wallet-pay-confirm').click();
            await page.locator('.wallet-balance-page').waitFor();
            await page.waitForTimeout(100);
            assert.equal(await page.locator('.wallet-balance-page').count(), 1);
            await metric(type + ' wallet send returns balance');
          }
          await page.locator('.modal-back').click();
          await page.waitForFunction(
            () => !document.querySelector('.page-editor'),
          );
          assert.equal(await page.locator('#wallet-balance').count(), 1);
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
          await app.close();
        }
      }
    console.log('PASS payment navigation cases', results.length);
    fs.writeFileSync(
      path.join(out, 'results.json'),
      JSON.stringify(results, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
