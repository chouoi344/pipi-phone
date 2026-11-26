// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Explicit artifact acceptance: run after building the standalone QA APK.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createApp}=require('../server.cjs'),{inspectApk,applicationId}=require('../scripts/build-standalone-android.cjs');
const root=path.resolve(__dirname,'..');
async function evidence(){return JSON.parse(await fs.readFile(process.env.PIPI_STANDALONE_ANDROID_EVIDENCE||path.join(root,'outputs/standalone-batch1/android-build-latest.json'),'utf8'));}
test('standalone debug APK contains every current original-project web file with identical bytes',async()=>{
  const build=await evidence(),actual=await inspectApk(build.apk);assert.equal(build.project,root);assert.equal(build.applicationId,applicationId);assert.equal(applicationId,'com.pipiphone.app.standaloneqa');assert.equal(build.debugOnly,true);assert.equal(build.officialSigningRead,false);assert.equal(actual.webBuildId,build.webBuildId);assert.equal(actual.publicFileCount,build.publicFileCount);assert.deepEqual(actual.files,build.files);
});
test('standalone APK packaged identity matches the original server public manifest',async t=>{
  const build=await evidence(),dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'pipi-standalone-assets-')),app=createApp({dataDir,host:'127.0.0.1',port:0,providerUrlAllowlist:[],fcm:{credentialFile:''},mediaTimers:false,updates:{fetchImpl:async()=>{throw Error('No network in standalone asset tests');}},androidUpdates:{fetchImpl:async()=>{throw Error('No network in standalone asset tests');}}});
  t.after(async()=>{await app.close();await fs.rm(dataDir,{recursive:true,force:true});});await app.listen();const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/android-shell-manifest');assert.equal(response.status,200);assert.deepEqual(await response.json(),{sha256:build.webBuildId});
});
