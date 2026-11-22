// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Only builds invalid synthetic client identifiers. Never installs/runs the APK.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
if(!process.env.JAVA_HOME||!process.env.ANDROID_HOME)throw Error('Set JAVA_HOME and ANDROID_HOME for the optional isolated build check.');
const output=path.resolve(process.env.PIPI_ANDROID_FCM_BUILD_OUTPUT||path.join(__dirname,'../test-results/android-fcm-build')),android=path.resolve(__dirname,'../android');fs.mkdirSync(output,{recursive:true});
const gradleHome=process.env.PIPI_GRADLE?path.dirname(path.resolve(process.env.PIPI_GRADLE)):android;
let launcher=path.join(gradleHome,'gradle/wrapper/gradle-wrapper.jar'),mainClass='org.gradle.wrapper.GradleWrapperMain';
if(!fs.existsSync(launcher)){
 const gradleLib=path.resolve(gradleHome,'../lib'),jars=fs.readdirSync(gradleLib);
 const jar=jars.find(name=>/^gradle-gradle-cli-main-[\d.]+\.jar$/.test(name))||jars.find(name=>/^gradle-launcher-[\d.]+\.jar$/.test(name));
 assert.ok(jar,'PIPI_GRADLE must name a Gradle wrapper or an installed Gradle bin/gradle executable');
 launcher=path.join(gradleLib,jar);mainClass='org.gradle.launcher.GradleMain';
}
if(process.argv.includes('--check-tools')){
 const result=cp.spawnSync(path.join(process.env.JAVA_HOME,'bin','java'),['-classpath',launcher,mainClass,'--version','--console=plain'],{cwd:android,encoding:'utf8'});
 assert.equal(result.status,0,(result.stdout||'')+(result.stderr||''));
 console.log('PASS optional FCM build entry',JSON.stringify({output,gradleVersion:(result.stdout||'').match(/Gradle [\d.]+/)?.[0]}));
 process.exit(0);
}
const temp=fs.mkdtempSync(path.join(output,'synthetic-'));
const config={project_info:{project_number:'123456789012',project_id:'pipi-synthetic-never-send'},client:[{client_info:{mobilesdk_app_id:'1:123456789012:android:00000000000000000000000000000000',android_client_info:{package_name:'com.pipiphone.app'}},api_key:[{current_key:'AIzaSySYNTHETICNOTAREALKEY000000000000000'}]}]};
const valid=path.join(temp,'google-services.json'),secret=path.join(temp,'not-a-service-account.json'),wrong=path.join(temp,'wrong-package.json');
fs.writeFileSync(valid,JSON.stringify(config));fs.writeFileSync(secret,JSON.stringify({...config,private_key:'SYNTHETIC-INVALID-NOT-A-REAL-KEY'}));const wrongConfig=structuredClone(config);wrongConfig.client[0].client_info.android_client_info.package_name='invalid.package';fs.writeFileSync(wrong,JSON.stringify(wrongConfig));
function run(name,args,expected){
  const result=cp.spawnSync(path.join(process.env.JAVA_HOME,'bin','java'),['-classpath',launcher,mainClass,...args,'-PpipiFcmBuildDir='+path.join(output,'gradle-fcm'),'--console=plain'],{cwd:android,encoding:'utf8',maxBuffer:32*1024*1024});
  const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(path.join(output,name+'.log'),log);assert.equal(result.status===0,expected,name+' failed: '+log.slice(-5000));return log;
}
const runtime=run('default-no-firebase',[':app:dependencies','--configuration','previewRuntimeClasspath'],true);assert.doesNotMatch(runtime,/com\.google\.(firebase|android\.gms):/);
const missing=run('missing-config',['help','-PpipiFcm=true'],false);assert.match(missing,/pipiGoogleServices/);
const privateKey=run('reject-private-key',[':app:generatePreviewPipiFcmResources','-PpipiFcm=true','-PpipiGoogleServices='+secret],false);assert.match(privateKey,/private_key|google-services\.json/);
const mismatch=run('reject-package-mismatch',[':app:generatePreviewPipiFcmResources','-PpipiFcm=true','-PpipiGoogleServices='+wrong],false);assert.match(mismatch,/com\.pipiphone\.app/);
run('synthetic-fcm-assemble',[':app:assemblePreview','-PpipiFcm=true','-PpipiGoogleServices='+valid],true);
const results={defaultNoFirebaseDependency:true,missingConfigRejected:true,privateKeyRejected:true,packageMismatchRejected:true,syntheticFcmBuild:true,installedOrSent:false,syntheticConfigDirectory:temp};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS optional FCM build checks',JSON.stringify(results));
