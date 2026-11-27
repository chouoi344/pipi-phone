// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '../public');
const readCss = name => fs.readFileSync(path.join(publicDir, name), 'utf8');

test('C4: brand greens across stylesheets are unified into --green and --green-dark tokens', () => {
  const strayGreens = [
    '#07c160', '#1ec96b', '#18bd62', '#06ad56', '#06a956',
    '#06a651', '#07a865', '#087b41', '#067c3f', '#077a3d',
    '#08793f', '#087e40', '#07883f', '#18ac59', '#16994f',
    '#0eb95e', '#16834a', '#19824b', '#17a85c', '#117540',
    '#0b7544', '#57be6a'
  ];
  const re = new RegExp(`(?<=[:\\s,(])(?:${strayGreens.join('|')})(?![0-9a-fA-F])`, 'gi');
  const violations = [];

  for (const file of fs.readdirSync(publicDir).filter(f => f.endsWith('.css') && f !== 'webview83.css')) {
    const raw = readCss(file);
    for (const m of raw.matchAll(re)) {
      const idx = m.index;
      const before = raw.slice(Math.max(0, idx - 32), idx);
      if (/(?:--green|--green-dark|--wd-green)\s*:\s*$/.test(before)) continue;
      const lineStart = raw.lastIndexOf('\n', idx);
      const line = raw.slice(lineStart + 1, raw.indexOf('\n', idx) > -1 ? raw.indexOf('\n', idx) : raw.length);
      if (line.includes('data:image/') || line.includes('linear-gradient(')) continue;
      violations.push(`${file}: ${m[0]} in "${line.trim().slice(0, 90)}"`);
    }
  }
  assert.deepEqual(violations, [], `Found stray hardcoded brand greens:\n${violations.join('\n')}`);
});

test('C8: chat composer interactive controls enforce >= 44px touch targets in both skins', () => {
  const polish = readCss('ui-polish.css');
  assert.match(polish, /\.compose-row\s*>\s*\.icon-btn[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
  const classicChat = readCss('classic-chat.css');
  assert.match(classicChat, /\.classic-inline-more[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
  const wdChat = readCss('waterdrop-chat.css');
  assert.match(wdChat, /\.classic-compose-row\s*>\s*\.icon-btn[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/);
});

test('Design System: muted conversation preview clears muted bell icon and both skins stay distinct', () => {
  const socialJs = fs.readFileSync(path.join(publicDir, 'classic-social.js'), 'utf8');
  assert.match(socialJs, /is-muted/, 'classic-social.js should tag muted conversation rows for WebView 83 safe clearance');
  const polish = readCss('ui-polish.css');
  assert.match(polish, /\.conversation\.is-muted\s+\.conversation-preview\s*\{[^}]*padding-right:\s*24px/);
  assert.match(polish, /html\[data-skin="classic"\][\s\S]*\.payment-card\.message-transfer/);
  assert.match(polish, /html\[data-skin="waterdrop"\][\s\S]*--wd-backdrop:/);
  assert.match(polish, /\.view\[data-route="auth"\]\s*\{[^}]*padding-top:\s*0/);
  assert.match(polish, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('Big-Tech Craft: English WeChat topbar, native 消息 tab, system typography, and 60fps motion engine', () => {
  const socialJs = fs.readFileSync(path.join(publicDir, 'classic-social.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const motionJs = fs.readFileSync(path.join(publicDir, 'ui-motion.js'), 'utf8');
  const polish = readCss('ui-polish.css');

  assert.match(socialJs, /textContent\s*=\s*'WeChat'/);
  assert.match(appJs, /\['chats','chat','消息'\]/);
  assert.match(indexHtml, /\/ui-motion\.js/);
  assert.match(motionJs, /preparePageTransition/);
  assert.match(motionJs, /captureOverlayExit/);
  assert.match(motionJs, /bindEdgeSwipeBack/);
  assert.match(readCss('styles.css'),/--ui-font:\s*-apple-system,[^;]+sans-serif/);
  assert.match(polish,/font-family:\s*var\(--ui-font\)/);
  assert.doesNotMatch(indexHtml,/as="font"|\/fonts\//);
  assert.match(polish, /font-synthesis:\s*none/);
  assert.match(polish, /\.ui-nav-scrim/);
  assert.match(polish, /\.ui-exit-stage/);
  assert.match(polish, /\.ui-swipe-indicator/);
});
