// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rules } = require('../scripts/build-webview83-css.cjs');

const publicDir = path.join(__dirname, '../public');
const readCss = name => fs.readFileSync(path.join(publicDir, name), 'utf8');

function parsedRules(file) {
  const flat = [];
  function walk(css) {
    for (const rule of rules(css)) {
      if (/^@(?:media|supports)\b/.test(rule.selector)) walk(rule.body);
      else if (!rule.selector.startsWith('@')) flat.push(rule);
    }
  }
  walk(readCss(file));
  return flat;
}

function getDeclarations(body) {
  const map = new Map();
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const val = part.slice(colon + 1).trim();
    map.set(prop, val);
  }
  return map;
}

test('C3: styles.css defines unified icon color and stroke CSS custom properties', () => {
  const styles = readCss('styles.css');
  for (const token of [
    '--icon-primary',
    '--icon-secondary',
    '--icon-muted',
    '--icon-inverse',
    '--icon-active',
    '--icon-stroke',
    '--icon-stroke-nav'
  ]) {
    assert.match(styles, new RegExp(`${token}\\s*:`), `styles.css must define ${token}`);
  }
});

test('C3: icon rules in native.css, styles.css, classic-social.css, classic-chat.css, contact-icons.css and waterdrop-shell.css use CSS variables instead of conflicting hardcoded grays', () => {
  const checks = [
    ['native.css', /\.nav-back-mark\b/, 'color'],
    ['native.css', /\.nav-more-mark\b/, 'color'],
    ['native.css', /\[data-action=new-menu\]>\.icon/, 'color'],
    ['native.css', /\.search-input-wrap>\.icon\b/, 'color'],
    ['native.css', /\.cell \.chevron\b/, 'color'],
    ['native.css', /\.profile-qr \.icon\b/, 'color'],
    ['native.css', /\.profile-card>\.chevron\b/, 'color'],
    ['native.css', /\.compose-panel \.panel-icon\b/, 'color'],
    ['native.css', /\.conversation-muted\b/, 'color'],
    ['styles.css', /^\.search-input-wrap \.icon$/, 'color'],
    ['styles.css', /\.top-menu \.icon\b/, 'color'],
    ['styles.css', /\.voice-playing \.icon\b/, 'color'],
    ['styles.css', /^\.cell \.chevron$/, 'color'],
    ['styles.css', /^\.profile-card \.chevron$/, 'color'],
    ['classic-social.css', /\.cell \.chevron\b/, 'color'],
    ['classic-social.css', /\.bottom-tabs \.tab$/, 'color'],
    ['classic-chat.css', /\.classic-inline-more\b/, 'color'],
    ['waterdrop-shell.css', /\.top-menu \.icon\b/, 'color'],
    ['waterdrop-shell.css', /\.search-input-wrap \.icon\b/, 'color'],
    ['waterdrop-shell.css', /\.cell \.chevron\b/, 'color'],
    ['waterdrop-shell.css', /\.bottom-tabs \.tab$/, 'color']
  ];

  for (const [file, selRe, prop] of checks) {
    const matched = parsedRules(file).filter(r => selRe.test(r.selector));
    assert.ok(matched.length > 0, `Expected rule matching ${selRe} in ${file}`);
    for (const rule of matched) {
      const decls = getDeclarations(rule.body);
      if (decls.has(prop)) {
        assert.match(
          decls.get(prop),
          /^var\(--icon-/,
          `${file} (${rule.selector}) ${prop} should use var(--icon-*), got: ${decls.get(prop)}`
        );
      }
      // Mask icons should inherit currentColor via .mask-icon, not hardcode background-color
      if (/\.(?:icon|chevron|mask-icon)\b/.test(rule.selector) && decls.has('background-color')) {
        assert.doesNotMatch(
          decls.get('background-color'),
          /^(?:#|rgba?\()/i,
          `${file} (${rule.selector}) should not hardcode background-color on mask icon: ${decls.get('background-color')}`
        );
      }
    }
  }

  // Contacts active tab must not diverge to a different green from the other 3 tabs
  const contactRules = parsedRules('contact-icons.css');
  for (const rule of contactRules) {
    if (/\.bottom-tabs \.tab\.active/.test(rule.selector)) {
      const color = getDeclarations(rule.body).get('color');
      if (color) {
        assert.match(color, /^var\(--icon-active/, `contact-icons.css (${rule.selector}) should use var(--icon-active), got ${color}`);
      }
    }
  }
});

test('C3: same-tier inline SVG icons share unified stroke-width tokens', () => {
  const styles = readCss('styles.css');
  assert.match(styles, /stroke-width\s*:\s*var\(--icon-stroke\b/, 'styles.css should apply var(--icon-stroke) to outline cell icons');
  assert.match(styles, /stroke-width\s*:\s*var\(--icon-stroke-nav\b/, 'styles.css should apply var(--icon-stroke-nav) to navigation/composer SVG icons');
  const wdShell = readCss('waterdrop-shell.css');
  assert.doesNotMatch(wdShell, /\.cell\[data-action="skins"\]\s+\.icon\s*\{[^}]*stroke-width\s*:\s*1\.4/, 'waterdrop-shell.css should not hardcode a one-off stroke-width for skins icon');
});

test('C7: text-bearing containers on main pages do not use rigid fixed pixel heights', () => {
  const rigidTargets = [
    ['styles.css', /^\.topbar$/],
    ['styles.css', /^\.conversation$/],
    ['styles.css', /^\.conversation-preview$/],
    ['styles.css', /^\.discover \.cell$/],
    ['styles.css', /^\.search-input-wrap$/],
    ['styles.css', /^\.top-menu button$/],
    ['native.css', />\s*\.topbar$/],
    ['native.css', /\.conversation$/],
    ['native.css', /\.conversation-preview$/],
    ['native.css', /\.search-input-wrap$/],
    ['native.css', /\.payment-card\.message-transfer$/],
    ['native.css', /\.payment-main$/],
    ['native.css', /\.new-friend-accept$/],
    ['classic-social.css', />\s*\.topbar:not\(\.moments-topbar\)$/],
    ['classic-social.css', /\.search-input-wrap$/],
    ['classic-social.css', /\.conversation$/],
    ['classic-chat.css', /\[data-route="chat"\]\s*>\s*\.topbar$/],
    ['waterdrop-shell.css', />\s*\.topbar:not\(\.moments-topbar\)$/],
    ['waterdrop-shell.css', /\.search-input-wrap$/],
    ['waterdrop-shell.css', /\.conversation$/],
    ['waterdrop-shell.css', /\.top-menu button$/],
    ['waterdrop-chat.css', /\[data-route="chat"\]\s*>\s*\.topbar$/],
    ['usage.css', /^\.usage-tabs$/],
    ['redpacket.css', /\.redpacket-amount-row$/],
    ['redpacket.css', /\.redpacket-cover-row$/]
  ];

  for (const [file, selRe] of rigidTargets) {
    const matched = parsedRules(file).filter(r => r.selector.split(',').some(s => selRe.test(s.trim())));
    assert.ok(matched.length > 0, `Expected rule matching ${selRe} in ${file}`);
    for (const rule of matched) {
      const h = getDeclarations(rule.body).get('height');
      if (h !== undefined) {
        assert.doesNotMatch(
          h,
          /^\d+(?:\.\d+)?px$/i,
          `${file} (${rule.selector}) must not fix height to ${h}; use height:auto + min-height`
        );
      }
    }
  }
});

test('C7: primary text elements avoid rigid px line-height that clips text at max system font scale', () => {
  const textChecks = [
    ['styles.css', /^\.topbar h2$/],
    ['styles.css', /^\.cell-title$/],
    ['styles.css', /^\.conversation-name$/],
    ['styles.css', /^\.conversation-preview$/],
    ['styles.css', /^\.profile-card h3$/],
    ['styles.css', /^\.profile-card p$/],
    ['native.css', /\.cell-title$/],
    ['native.css', /\.conversation-name$/],
    ['native.css', /\.conversation-preview$/],
    ['native.css', /\.system-message$/],
    ['native.css', /\.message-date$/],
    ['native.css', /\.message-quote$/],
    ['classic-social.css', /\.topbar h2$/],
    ['classic-social.css', /\.cell-title$/],
    ['classic-social.css', /\.cell-value$/],
    ['classic-social.css', /\.conversation-name$/],
    ['classic-social.css', /\.profile-card h3$/],
    ['classic-social.css', /\.profile-card p$/],
    ['classic-chat.css', /\.topbar h2$/],
    ['classic-chat.css', /\.voice-message$/],
    ['waterdrop-shell.css', /\.topbar h2$/],
    ['waterdrop-shell.css', /\.cell-title$/],
    ['waterdrop-shell.css', /\.cell-value$/],
    ['waterdrop-shell.css', /\.conversation-name$/],
    ['waterdrop-shell.css', /\.profile-card h3$/],
    ['waterdrop-shell.css', /\.profile-card p$/],
    ['waterdrop-chat.css', /\.topbar h2$/]
  ];

  for (const [file, selRe] of textChecks) {
    const matched = parsedRules(file).filter(r => r.selector.split(',').some(s => selRe.test(s.trim())));
    assert.ok(matched.length > 0, `Expected rule matching ${selRe} in ${file}`);
    for (const rule of matched) {
      const lh = getDeclarations(rule.body).get('line-height');
      if (lh !== undefined) {
        assert.doesNotMatch(
          lh,
          /^\d+(?:\.\d+)?px$/i,
          `${file} (${rule.selector}) must use unitless line-height instead of fixed ${lh}`
        );
      }
    }
  }
});
