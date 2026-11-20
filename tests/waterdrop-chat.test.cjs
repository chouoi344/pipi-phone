// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/waterdrop-chat.js'), 'utf8');

function fixture({reduced = false, skin = 'waterdrop'} = {}) {
  let clock = 1000, typing = false, rows = [];
  const animations = [], classes = new Set(), properties = new Map(), events = new Map();
  const root = {dataset: {skin}}, motion = {matches: reduced};
  const title = {classList: {toggle(name, active) {if (active) classes.add(name); else classes.delete(name);}, remove: name => classes.delete(name)}};
  const list = {style: {backgroundImage: ''}, querySelectorAll: () => rows};
  const view = {
    dataset: {route: 'chat', chatRole: 'alice'},
    style: {setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name)},
    querySelector(selector) {
      if (selector === '#chat-messages') return list;
      if (selector === '.waterdrop-waiting') return rows.flatMap(row => row.body.children)[0] || null;
      if (selector === '.waterdrop-awaiting') return classes.has('waterdrop-awaiting') ? title : null;
      return title;
    },
    querySelectorAll: selector => selector === '.waterdrop-waiting' ? rows.flatMap(row => row.body.children) : rows
  };
  const document = {
    documentElement: root, hidden: false, querySelector: () => view,
    addEventListener: (name, handler) => events.set(name, handler),
    createElement: () => ({setAttribute() {}, remove() {this.parent.children.splice(this.parent.children.indexOf(this), 1);}})
  };
  const window = {PipiEngine: {isTyping: () => typing}, addEventListener: (name, handler) => events.set(name, handler)};
  vm.runInNewContext(source, {window, document, matchMedia: () => motion, Date: {now: () => clock}});
  const engine = window.WaterdropChat;
  function render(messages, roleId = 'alice') {
    view.dataset.chatRole = roleId;
    rows = messages.filter(message => message.roleId === roleId && message.sender !== 'system').map(message => {
      const body = {children: [], append(label) {label.parent = this; this.children.push(label);}};
      return {dataset: {message: message.id}, body, querySelector: () => body, animate: (frames, options) => animations.push({id: message.id, frames, options})};
    });
    engine.decorate(view);
  }
  return {engine, view, document, root, motion, list, properties, classes, animations, events, render,
    labels: () => rows.flatMap(row => row.body.children.map(label => ({id: row.dataset.message, text: label.textContent}))),
    observe: (before, after) => engine.observeState(before && {messages: before}, {messages: after}, view),
    typing(value) {typing = value; engine.updateTyping(view);}, advance(value) {clock += value;}};
}
const message = (id, extra = {}) => ({id, roleId: 'alice', sender: 'user', status: 'pending', ...extra});

test('waterdrop: initial and offline pending history never start a waiting or arrival animation', () => {
  const f = fixture(), history = [message('old')];
  f.observe(null, history); f.render(history);
  assert.deepEqual(f.labels(), []); assert.deepEqual(f.animations, []);
});

test('waterdrop: accepted messages show one explicit waiting status, then real typing removes it permanently', () => {
  const f = fixture(), first = [message('one')], both = [...first, message('two')];
  f.observe([], first); f.render(first);
  assert.deepEqual(f.labels(), [{id: 'one', text: '等待回复'}]);
  f.observe(first, both); f.render(both);
  assert.deepEqual(f.labels(), [{id: 'two', text: '等待回复'}]);
  f.typing(true); assert.deepEqual(f.labels(), []); assert.ok(f.classes.has('waterdrop-awaiting'));
  f.typing(false); assert.deepEqual(f.labels(), []); assert.ok(!f.classes.has('waterdrop-awaiting'));
  f.render(both); assert.deepEqual(f.labels(), []);
});

for (const status of ['error', 'sent']) test(`waterdrop: ${status} removes waiting immediately even before a view refresh`, () => {
  const f = fixture(), accepted = [message('one')];
  f.observe([], accepted); f.render(accepted); assert.equal(f.labels().length, 1);
  f.observe(accepted, [message('one', {status})]); assert.deepEqual(f.labels(), []);
});

test('waterdrop: retry uses the existing message and starts waiting without replaying its arrival', () => {
  const f = fixture(), failed = [message('one', {status: 'error'})], pending = [message('one')];
  f.render(failed); f.observe(failed, pending); f.render(pending);
  assert.deepEqual(f.labels(), [{id: 'one', text: '等待回复'}]); assert.equal(f.animations.length, 0);
});

test('waterdrop: each newly received message animates once across repeated state and composer refreshes', () => {
  const f = fixture(), old = [message('old', {status: 'sent'})], fresh = [...old, message('reply-a', {sender: 'assistant', status: 'sent'}), message('reply-b', {sender: 'assistant', status: 'sent'})];
  f.observe(old, fresh); f.observe(fresh, fresh); f.render(fresh); f.render(fresh);
  assert.deepEqual(f.animations.map(item => item.id), ['reply-a', 'reply-b']);
  assert.deepEqual(f.animations.map(item => item.options.delay), [0, 35]);
});

test('waterdrop: switching chats and returning cannot revive previous typing, waiting or arrivals', () => {
  const f = fixture(), first = [message('one')], second = [...first, message('other', {roleId: 'bob', status: 'sent'})];
  f.observe([], first); f.render(second, 'bob'); f.render(first);
  assert.deepEqual(f.labels(), []); assert.equal(f.animations.length, 0);
});

test('waterdrop: stream disconnect and page hiding clear live feedback without replay on reconnection', () => {
  for (const interrupt of ['disconnect', 'hidden', 'pagehide']) {
    const f = fixture(), accepted = [message('one')]; f.observe([], accepted); f.render(accepted);
    if (interrupt === 'disconnect') f.engine.setConnected(false);
    else if (interrupt === 'hidden') {f.document.hidden = true; f.events.get('visibilitychange')();}
    else f.events.get('pagehide')();
    f.document.hidden = false; f.engine.setConnected(true); f.render(accepted);
    assert.deepEqual(f.labels(), [], interrupt); assert.equal(f.animations.length, 1, interrupt);
  }
});

test('waterdrop: custom wallpaper is inherited by the whole chat and clearing it restores the shared default', () => {
  const f = fixture(); f.list.style.backgroundImage = 'url("data:image/png;base64,aA==")'; f.render([]);
  assert.equal(f.properties.get('--waterdrop-chat-wallpaper'), f.list.style.backgroundImage);
  f.list.style.backgroundImage = ''; f.render([]); assert.ok(!f.properties.has('--waterdrop-chat-wallpaper'));
});

test('waterdrop: reduced motion preserves the real waiting text and skips arrival motion', () => {
  const f = fixture({reduced: true}), accepted = [message('one')]; f.observe([], accepted); f.render(accepted);
  assert.equal(f.labels()[0].text, '等待回复'); assert.equal(f.animations.length, 0);
});

test('classic skin receives no waterdrop DOM, custom wallpaper property or arrival animation', () => {
  const f = fixture({skin: 'classic'}), accepted = [message('one')];
  f.list.style.backgroundImage = 'url("data:image/png;base64,aA==")';
  f.observe([], accepted); f.render(accepted); f.typing(true);
  assert.deepEqual(f.labels(), []); assert.equal(f.animations.length, 0); assert.equal(f.properties.size, 0); assert.equal(f.classes.size, 0);
});
