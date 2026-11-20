'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {generateKeyPairSync} = require('node:crypto');
const {createIssuerServer} = require('../scripts/waterdrop-issuer.cjs');
const {verifyCode} = require('../lib/waterdrop-activation.cjs');

test('本地签发与请求隔离', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipi-issuer-'));
  const {privateKey, publicKey} = generateKeyPairSync('ed25519');
  const privateKeyPath = path.join(dir, 'private.pem');
  const publicKeyPath = path.join(dir, 'public.pem');
  fs.writeFileSync(privateKeyPath, privateKey.export({type:'pkcs8', format:'pem'}));
  fs.writeFileSync(publicKeyPath, publicKey.export({type:'spki', format:'pem'}));
  const server = createIssuerServer({port:0, privateKeyPath, publicKeyPath});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, {recursive:true});
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const id = '11111111-2222-3333-4444-555555555555';
  function request(url, {method='POST', headers={}, body=JSON.stringify({installationId:id})} = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({hostname:'127.0.0.1', port, path:url, method, headers:{Origin:origin, 'Content-Type':'application/json', ...headers}}, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => text += chunk);
        res.on('end', () => resolve({status:res.statusCode, headers:res.headers, text}));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  const issued = await request('/api/issue');
  assert.equal(issued.status, 200);
  const result = JSON.parse(issued.text);
  assert.equal(result.installationId, id);
  assert.equal(verifyCode(id, result.code, publicKey), true);
  assert.equal(verifyCode('99999999-2222-3333-4444-555555555555', result.code, publicKey), false);
  for (const body of ['', '{', '{}', 'null', JSON.stringify({installationId:''})]) {
    assert.equal((await request('/api/issue', {body})).status, 400);
  }
  assert.equal((await request('/api/issue', {body:'x'.repeat(2049)})).status, 413);
  assert.equal((await request('/api/issue', {headers:{Origin:'https://other.example'}})).status, 403);
  assert.equal((await request('/api/issue', {headers:{Origin:''}})).status, 403);
  assert.equal((await request('/api/issue', {headers:{Host:`other.example:${port}`}})).status, 403);
  assert.equal((await request('/api/issue', {headers:{'Content-Type':'text/plain'}})).status, 415);
  assert.equal((await request('/api/issue', {method:'GET'})).status, 405);
  for (const url of ['/waterdrop-v1.pem', '/private.pem', '/../lib/waterdrop-public.pem', '/api/issue?x=1']) {
    const response = await request(url, {method:'GET'});
    assert.equal(response.status, 404);
    assert.equal(response.text.includes('PRIVATE KEY'), false);
    assert.equal(response.text.includes(dir), false);
  }
  const page = await request('/', {method:'GET'});
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['access-control-allow-origin'], undefined);
  assert.equal(page.text.includes('PRIVATE KEY'), false);
  assert.equal((await request('/', {method:'HEAD'})).text, '');
  assert.throws(() => createIssuerServer({privateKeyPath:path.join(dir,'missing.pem'), publicKeyPath}), /缺少签发密钥/);
  const otherKey = generateKeyPairSync('ed25519').publicKey;
  fs.writeFileSync(publicKeyPath, otherKey.export({type:'spki', format:'pem'}));
  assert.throws(() => createIssuerServer({privateKeyPath, publicKeyPath}), /不匹配/);
});
