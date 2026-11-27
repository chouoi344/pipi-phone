// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');

const root = path.join(__dirname, '..', 'public');
const textAsset = /\.(?:css|js|html|json|md|svg|txt|webmanifest)$|(?:^|[-/])LICENSE$/i;
async function filesUnder(directory, prefix = '') {
  const entries = await fs.readdir(directory, {withFileTypes: true});
  const files = await Promise.all(entries.map(entry => {
    const name = prefix + entry.name;
    if (entry.isDirectory()) return filesUnder(path.join(directory, entry.name), name + '/');
    return entry.isFile() ? [name] : [];
  }));
  return files.flat();
}

async function fingerprint(directory = root, visit) {
  const hash = createHash('sha256');
  for (const name of (await filesUnder(directory)).sort()) {
    hash.update(name + '\n');
    const bytes = await fs.readFile(path.join(directory, name));
    if (visit) visit(name, bytes);
    // Git can check the same web source out with CRLF on Windows and LF on Linux.
    // latin1 maps each byte to one character, so only those newline pairs change.
    if (textAsset.test(name) && bytes.includes(13)) hash.update(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    else hash.update(bytes);
    hash.update('\n');
  }
  return {sha256: hash.digest('hex')};
}

// Freeze the public files for this process so immutable URLs always serve the bytes they identify.
function asset(bytes) {
  return {bytes, version: createHash('sha256').update(bytes).digest('hex').slice(0, 16)};
}

async function loadRelease(directory) {
  const files = new Map();
  const android = await fingerprint(directory, (name, bytes) => files.set('/' + name, asset(bytes)));
  const template = files.get('/index.html').bytes.toString('utf8');
  const page = template.replace(/(\s(?:data-href|href|src)\s*=\s*)(["'])([^"']+)\2/gi, (original, attribute, quote, value) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(value)) return original;
    const url = new URL(value.replaceAll('&amp;', '&'), 'http://localhost');
    const target = files.get(url.pathname);
    if (!target) return original;
    url.searchParams.set('v', target.version);
    return attribute + quote + url.pathname + url.search.replaceAll('&', '&amp;') + url.hash + quote;
  });
  files.set('/index.html', asset(Buffer.from(page)));
  return {android, files};
}

let cached;
function release(directory = root) {
  if (directory !== root) return loadRelease(directory);
  if (!cached) {
    cached = loadRelease(root).catch(error => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

async function manifest() {
  return (await release()).android;
}
module.exports = {fingerprint, manifest, release};
