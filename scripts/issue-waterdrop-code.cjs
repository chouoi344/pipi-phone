// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createPrivateKey, createPublicKey} = require('node:crypto');
const {normalizeInstallationId, signCode} = require('../lib/waterdrop-activation.cjs');

const installationId = normalizeInstallationId(process.argv[2]);
if (!installationId || process.argv.length !== 3) {
  console.error('用法：node scripts/issue-waterdrop-code.cjs <安装编号>');
  process.exit(1);
}

const privateKeyPath = path.join(os.homedir(), '.pipi-phone-issuer', 'waterdrop-v1.pem');
if (!fs.existsSync(privateKeyPath)) {
  console.error(`缺少签发密钥：${privateKeyPath}`);
  process.exit(1);
}

const privateKey = createPrivateKey(fs.readFileSync(privateKeyPath));
const bundledKey = createPublicKey(fs.readFileSync(path.join(__dirname, '../lib/waterdrop-public.pem')));
const publicDer = {type: 'spki', format: 'der'};
if (!createPublicKey(privateKey).export(publicDer).equals(bundledKey.export(publicDer))) {
  console.error('签发密钥与本版小手机的验证密钥不匹配。');
  process.exit(1);
}

console.log(signCode(installationId, privateKey));
