// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Runs independently of Android, Google Play, Firebase credentials or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const jdk=process.env.JAVA_HOME;if(!jdk)throw Error('Set JAVA_HOME to a JDK before the isolated FCM routing test.');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-fcm-policy-'));
const harness=path.join(output,'FcmBindingHarness.java');
fs.writeFileSync(harness,`package com.pipiphone.app;
public final class FcmBindingHarness {
  static void check(boolean enabled,String current,String stored,String scope,String hash,String currentHash,String messageOrigin,String messageScope,boolean expected){
    if(FcmBinding.matches(enabled,current,stored,scope,hash,currentHash,messageOrigin,messageScope)!=expected)throw new AssertionError("FCM binding accepted an old or invalid notification");
  }
  public static void main(String[] args){
    check(true,"https://a.test","https://a.test","scope-a","cookie-a","cookie-a","https://a.test","scope-a",true);
    check(false,"https://a.test","https://a.test","scope-a","cookie-a","cookie-a","https://a.test","scope-a",false);
    check(true,"https://b.test","https://a.test","scope-a","cookie-a","cookie-a","https://a.test","scope-a",false);
    check(true,"https://a.test","https://a.test","scope-b","cookie-a","cookie-a","https://a.test","scope-a",false);
    check(true,"https://a.test","https://a.test","scope-a","cookie-a","cookie-b","https://a.test","scope-a",false);
    check(true,"https://a.test","https://a.test","scope-a","cookie-a","cookie-a",null,"scope-a",false);
    check(true,"https://a.test","https://a.test","scope-a","cookie-a","cookie-a","https://a.test",null,false);
    check(true,"https://a.test","https://a.test","","cookie-a","cookie-a","https://a.test","",false);
    check(true,"https://a.test","https://a.test","scope-a","","","https://a.test","scope-a",false);
    System.out.print("PASS FCM cold-start routing: 9 isolated cases");
  }
}`);
execFileSync(path.join(jdk,'bin','javac'),['-encoding','UTF-8','-d',output,path.resolve(__dirname,'../android/app/src/fcm/java/com/pipiphone/app/FcmBinding.java'),harness],{stdio:'inherit'});
const result=execFileSync(path.join(jdk,'bin','java'),['-cp',output,'com.pipiphone.app.FcmBindingHarness'],{encoding:'utf8'});assert.match(result,/9 isolated cases/);console.log(result);
