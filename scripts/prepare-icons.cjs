// SPDX-License-Identifier: GPL-3.0-only
// Adapt the pinned fake-world SVGs for external CSS masks. Originals stay intact.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vendor = path.join(__dirname, '..', 'public', 'vendor');
const groups = [
  [path.join(vendor, 'fake-world', 'icons'), path.join(vendor, 'fake-world', 'masks')],
  [path.join(vendor, 'native-icons', 'originals'), path.join(vendor, 'native-icons')]
];
let count = 0;
for (const [source, destination] of groups) {
fs.mkdirSync(destination, { recursive: true });
for (const name of fs.readdirSync(source).filter(name => name.endsWith('.svg')).sort()) {
  const original = fs.readFileSync(path.join(source, name), 'utf8');
  const adapted = original.replace(/<svg\b[^>]*>/i, root => {
    if (/\sfill\s*=/.test(root)) return root.replace(/\sfill\s*=\s*(["'])none\1/i, ' fill="black"');
    return root.replace(/>$/, ' fill="black">');
  });
  fs.writeFileSync(path.join(destination, name), adapted);
  count += 1;
}
}
console.log(`Prepared ${count} CSS mask SVGs; original assets unchanged.`);
