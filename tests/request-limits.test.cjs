// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Limits=require('../lib/request-limits.cjs');
test('rate windows return the remaining seconds and allow a request at their exact expiry',()=>{
  let now=1000;const limits=Limits.create({now:()=>now});
  limits.consume('a',1,60000);now+=1001;
  assert.throws(()=>limits.consume('a',1,60000),error=>error.status===429&&error.retryAfter===59);
  limits.consume('b',1,60000);now=61000;limits.consume('a',1,60000);
});
test('checking a password allowance never consumes it and clearing failures resets it',()=>{
  const limits=Limits.create();for(let i=0;i<100;i++)limits.check('password',10);
  for(let i=0;i<10;i++)limits.record('password',900000);
  assert.throws(()=>limits.check('password',10),{code:'RATE_LIMIT'});
  limits.clear('password');limits.check('password',10);
});
test('IPv6 spellings and privacy addresses in one /64 share a failure allowance',()=>{
  assert.equal(Limits.clientKey('2001:db8::1'),Limits.clientKey('2001:0db8:0000:0000:abcd::2'));
  assert.notEqual(Limits.clientKey('2001:db8:0:1::1'),Limits.clientKey('2001:db8::1'));
  assert.equal(Limits.clientKey('192.0.2.1'),'192.0.2.1');
});
