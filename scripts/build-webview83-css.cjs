'use strict';
// Rebuild after changing linked stylesheets: node scripts/build-webview83-css.cjs
// --check is read-only and fails when the checked-in legacy sheet has drifted.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const normalizeLF = text => text.replace(/\r\n?/g, '\n');

// Split only outside strings, brackets and functions (calc(), data URLs, etc.).
function split(text, separator) {
  const result = []; let start = 0, depth = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (!depth && c === separator) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  result.push(text.slice(start).trim());
  return result;
}

function clean(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

// This project has flat qualified rules inside media/supports blocks, without nesting.
function rules(css) {
  css = clean(css); const result = []; let start = 0, depth = 0, quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth) continue;
    if (c === ';') { start = i + 1; continue; }
    if (c !== '{') continue;
    const selector = css.slice(start, i).trim(), bodyStart = ++i;
    let braces = 1;
    for (; i < css.length; i++) {
      const d = css[i];
      if (d === '\\') { i++; continue; }
      if (quote) { if (d === quote) quote = ''; continue; }
      if (d === '"' || d === "'") { quote = d; continue; }
      if (d === '{') braces++;
      if (d === '}' && !--braces) break;
    }
    if (braces) throw new Error('Unclosed CSS rule: ' + selector);
    result.push({selector, body: css.slice(bodyStart, i)}); start = i + 1;
  }
  return result;
}

function selectors(selector) {
  const match = /:(?:is|where)\(/.exec(selector);
  if (!match) return [selector];
  const start = match.index + match[0].length; let i = start, depth = 1, quote = '';
  for (; depth && i < selector.length; i++) {
    const c = selector[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
  }
  if (depth) throw new Error('Unclosed selector: ' + selector);
  // Complex branches currently occur after a descendant combinator; fail on new
  // attached complex branches instead of producing a selector with different meaning.
  const before = selector.slice(0, match.index), after = selector.slice(i);
  return split(selector.slice(start, i - 1), ',').flatMap(branch => {
    if (before && !/[\s>+~]$/.test(before) && split(branch, ' ').length > 1) {
      throw new Error('Review attached complex :is branch: ' + selector);
    }
    return selectors(before + branch + after);
  });
}

function sides(value) {
  const v = split(value, ' ').filter(Boolean);
  if (v.length > 4) throw new Error('Invalid inset: ' + value);
  return [v[0], v[1] || v[0], v[2] || v[0], v[3] || v[1] || v[0]];
}

function declarations(body) {
  return split(body, ';').filter(Boolean).flatMap(declaration => {
    const colon = declaration.indexOf(':');
    if (colon < 0) throw new Error('Invalid declaration: ' + declaration);
    const name = declaration.slice(0, colon).trim();
    const important = /\s*!important\s*$/.test(declaration) ? '!important' : '';
    let value = declaration.slice(colon + 1).replace(/\s*!important\s*$/, '').trim();
    value = value.replace(/\b(\d*\.?\d+)dvh\b/g, '$1vh').replace(/\b(\d*\.?\d+)dvw\b/g, '$1vw');
    if (name === 'inset') return sides(value).map((v, i) => ['top', 'right', 'bottom', 'left'][i] + ':' + v + important);
    const logical = /^(padding|margin|border)-(inline|block)$/.exec(name);
    if (logical) {
      const directions = logical[2] === 'inline' ? ['left', 'right'] : ['top', 'bottom'];
      const values = logical[1] === 'border' ? [value, value] : split(value, ' ').filter(Boolean);
      return directions.map((side, i) => logical[1] + '-' + side + ':' + (values[i] || values[0]) + important);
    }
    // Native status uses a 24px line box. The newer lh unit has no parser in 83.
    value = value.replace(/\b1lh\b/g, '24px');
    return name + ':' + value + important;
  }).join(';');
}

function compile(css) {
  return rules(css).map(({selector, body}) => {
    if (/^@(?:media|supports)\b/.test(selector)) return selector + '{' + compile(body) + '}';
    // Fonts and keyframes remain in the originals; neither needs selector rewriting.
    if (selector.startsWith('@')) return '';
    const states = {
      '>.model-sheet': '.has-model-sheet',
      '>.usage-sheet': '.has-usage-sheet',
      '>.pt-settings-sheet.page-editor': '.has-settings-editor',
      '>.overlay-mask': '.has-overlay-mask',
      '>.conversation.swiped': '.conversation-swiped'
    };
    const list = split(selector, ',').flatMap(selectors)
      .map(s => s.replace(/:has\(([^()]*)\)/g, (match, child) => states[child.replace(/\s+/g, '')] || match))
      .filter(s => !/:has\(|:focus-visible|:popover-open/.test(s));
    return list.length ? list.join(',') + '{' + declarations(body) + '}\n' : '';
  }).join('');
}

function build(readText = file => fs.readFileSync(file, 'utf8')) {
  const read = file => normalizeLF(readText(file));
  const html = read(path.join(root, 'public/index.html'));
  const files = [...html.matchAll(/<link\b[^>]*>/g)].filter(m => /\brel="stylesheet"/.test(m[0]))
    .map(m => /(?:\s)href="\/([^"?]+)(?:\?[^"\s]*)?"/.exec(m[0])?.[1])
    .filter(file => file && !file.startsWith('vendor/') && !file.startsWith('fonts/') && file !== 'webview83.css');
  const sources = files.map(file => [file, read(path.join(root, 'public', file))]);
  sources.push(['webview83-fallbacks.css', read(path.join(root, 'scripts/webview83-fallbacks.css'))]);
  const hash = crypto.createHash('sha256').update(JSON.stringify(sources)).digest('hex');
  // Replay in source order, including unchanged declarations: a tail-only patch of
  // early :is rules would otherwise wrongly override later skin rules.
  return '/* Generated by scripts/build-webview83-css.cjs; do not edit.\n' +
    ' * Source SHA-256: ' + hash + '\n * Modern engines keep their existing styles.\n */\n' +
    '@supports not selector(:is(*)){\n' + sources.map(([file, css]) => {
      const notices = css.match(/^(?:\s*\/\*[\s\S]*?\*\/)*/)[0].trim();
      return '/* ' + file + ' */\n' + (notices ? notices + '\n' : '') + compile(css);
    }).join('') + '}\n';
}

if (require.main === module) {
  const target = path.join(root, 'public/webview83.css'), output = build();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || normalizeLF(fs.readFileSync(target, 'utf8')) !== output) {
      throw new Error('webview83.css is stale; run node scripts/build-webview83-css.cjs');
    }
    console.log('webview83.css matches linked source stylesheets');
  } else { fs.writeFileSync(target, output); console.log('Wrote webview83.css (' + Buffer.byteLength(output) + ' bytes)'); }
}
module.exports = {split, rules, selectors, declarations, compile, build, normalizeLF};
