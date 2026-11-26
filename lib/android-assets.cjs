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

async function fingerprint(directory = root) {
  const hash = createHash('sha256');
  for (const name of (await filesUnder(directory)).sort()) {
    hash.update(name + '\n');
    const bytes = await fs.readFile(path.join(directory, name));
    // Git can check the same web source out with CRLF on Windows and LF on Linux.
    // latin1 maps each byte to one character, so only those newline pairs change.
    if (textAsset.test(name) && bytes.includes(13)) hash.update(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    else hash.update(bytes);
    hash.update('\n');
  }
  return {sha256: hash.digest('hex')};
}

let cached;
function manifest() {
  if (!cached) {
    cached = fingerprint().catch(error => {
      cached = null;
      throw error;
    });
  }
  return cached;
}
module.exports = {fingerprint, manifest};
