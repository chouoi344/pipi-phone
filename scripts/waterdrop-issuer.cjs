// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createHash, createPrivateKey, createPublicKey} = require('node:crypto');
const {normalizeInstallationId, signCode} = require('../lib/waterdrop-activation.cjs');

function createIssuerServer({port = 51337, privateKeyPath = path.join(os.homedir(), '.pipi-phone-issuer', 'waterdrop-v1.pem'), publicKeyPath = path.join(__dirname, '../lib/waterdrop-public.pem')} = {}) {
  if (!fs.existsSync(privateKeyPath)) throw new Error(`缺少签发密钥：${privateKeyPath}`);
  const privateKey = createPrivateKey(fs.readFileSync(privateKeyPath));
  const publicKey = createPublicKey(fs.readFileSync(publicKeyPath));
  const format = {type: 'spki', format: 'der'};
  if (!createPublicKey(privateKey).export(format).equals(publicKey.export(format))) {
    throw new Error('签发密钥与本版小手机的验证密钥不匹配。');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const reply = (status, error) => {
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({error}));
    };
    const listeningPort = server.address()?.port || port;
    const host = `127.0.0.1:${listeningPort}`;
    if (req.headers.host !== host) return reply(403, '请从本机签发工具地址打开。');
    if (req.url === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        // HTML parsing normalizes line endings before checking inline CSP hashes.
        const html = fs.readFileSync(path.join(__dirname, 'waterdrop-issuer.html'), 'utf8').replace(/\r\n?/g, '\n');
        const hashes = tag => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`).join(' ');
        res.setHeader('Content-Security-Policy', `default-src 'none'; script-src ${hashes('script')}; style-src ${hashes('style')}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        return res.end(req.method === 'HEAD' ? undefined : html);
      } catch {
        return reply(500, '无法读取签发工具页面，请检查工具文件是否完整。');
      }
    }
    if (req.url !== '/api/issue') return reply(404, '找不到此页面。');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(405, '请使用页面上的生成按钮。');
    }
    if (req.headers.origin !== `http://${host}`) return reply(403, '请求来源无效，请重新打开本机签发页面。');
    if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] || '')) return reply(415, '请求必须使用 JSON 格式。');
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) {
          reply(413, '输入内容过长，请只填写安装编号。');
          return;
        }
        chunks.push(chunk);
      }
    } catch {
      return reply(400, '读取请求失败，请重试。');
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return reply(400, '请求内容格式有误。'); }
    const installationId = normalizeInstallationId(input?.installationId);
    if (!installationId) return reply(400, '安装编号格式无效，请复制完整安装编号。');
    try {
      const code = signCode(installationId, privateKey);
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({installationId, code}));
    } catch {
      reply(500, '签发失败，请检查本机签发密钥。');
    }
  });
  return server;
}

if (require.main === module) {
  try {
    const server = createIssuerServer();
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? '签发工具端口 51337 已被占用，请检查是否已经打开工具。' : '签发工具启动失败，请检查本机运行环境。');
      process.exitCode = 1;
    });
    server.listen(51337, '127.0.0.1', () => console.log('水滴兑换码签发工具：http://127.0.0.1:51337'));
  } catch (error) {
    console.error(error.code ? '无法读取签发密钥，请检查密钥文件。' : error.message);
    process.exitCode = 1;
  }
}

module.exports = {createIssuerServer};
