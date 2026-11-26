// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {createHash}=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const {fingerprint}=require('../lib/android-assets.cjs');
const project=path.resolve(__dirname,'..'),applicationId='com.pipiphone.app.standaloneqa';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function filesUnder(directory,prefix=''){
  const files=[];
  for(const entry of await fsp.readdir(directory,{withFileTypes:true})){
    if(entry.isDirectory())files.push(...await filesUnder(path.join(directory,entry.name),prefix+entry.name+'/'));
    else if(entry.isFile())files.push(prefix+entry.name);
  }
  return files.sort();
}
function zipEntries(file){
  const bytes=fs.readFileSync(file),end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(end<0)throw Error('APK ZIP directory is missing');
  const result=new Map(),count=bytes.readUInt16LE(end+10);let offset=bytes.readUInt32LE(end+16);
  for(let index=0;index<count;index++){
    if(bytes.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid APK ZIP directory');
    const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),length=bytes.readUInt32LE(offset+20),nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42),name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8');
    if(flags&1)throw Error('Encrypted APK entry: '+name);
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),data=bytes.subarray(start,start+length);
    if(method!==0&&method!==8)throw Error('Unsupported APK ZIP method: '+method);
    result.set(name,method===8?zlib.inflateRawSync(data):data);offset+=46+nameLength+extraLength+commentLength;
  }
  return result;
}
async function inspectApk(apk){
  const entries=zipEntries(apk),publicRoot=path.join(project,'public'),names=await filesUnder(publicRoot),packaged=[...entries.keys()].filter(name=>name.startsWith('assets/phone/')&&name!=='assets/phone/bundle.json').map(name=>name.slice('assets/phone/'.length)).sort();
  if(JSON.stringify(names)!==JSON.stringify(packaged))throw Error('APK web file list differs from original project public/');
  const files=[];
  for(const name of names){const source=await fsp.readFile(path.join(publicRoot,name)),included=entries.get('assets/phone/'+name);if(!source.equals(included))throw Error('APK web bytes differ: '+name);files.push({path:name,sha256:hash(source),size:source.length});}
  const bundle=JSON.parse(entries.get('assets/phone/bundle.json').toString('utf8')),current=await fingerprint(publicRoot);
  if(bundle.sha256!==current.sha256)throw Error('APK bundle identity differs from current server assets');
  return {webBuildId:bundle.sha256,publicFileCount:names.length,exactAssetHashesMatch:true,files};
}
async function main(){
  const cache=path.resolve(process.env.PIPI_STANDALONE_ANDROID_CACHE||path.join(os.homedir(),'.codex','standalone-android')),jdk=path.resolve(process.env.PIPI_STANDALONE_JDK||'C:/Program Files/Eclipse Adoptium/jdk-17.0.21.10002-hotspot'),sdk=path.resolve(process.env.PIPI_STANDALONE_SDK||path.join(os.homedir(),'AppData','Local','Android','Sdk')),gradleHome=path.resolve(process.env.PIPI_STANDALONE_GRADLE_HOME||path.join(os.homedir(),'.gradle'));
  for(const tool of [path.join(jdk,'bin/java.exe'),path.join(jdk,'bin/keytool.exe'),path.join(sdk,'platforms/android-35/android.jar'),path.join(sdk,'build-tools/35.0.0/aapt.exe')])if(!fs.existsSync(tool))throw Error('Standalone Android tool is missing: '+tool);
  const evidenceRoot=path.resolve(process.env.PIPI_ANDROID_OUTPUT_ROOT||path.join(project,'outputs','standalone-batch1')),buildApplicationId=process.env.PIPI_ANDROID_APPLICATION_ID||applicationId;
  const relative=path.relative(path.join(project,'outputs'),evidenceRoot);
  if(relative.startsWith('..')||path.isAbsolute(relative)||!['com.pipiphone.app.standaloneqa','com.pipiphone.app.integratedqa'].includes(buildApplicationId))throw Error('Android evidence must use project outputs and an isolated QA applicationId');
  const output=path.join(evidenceRoot,process.env.PIPI_ANDROID_OUTPUT_ROOT?'builds':'android',String(Date.now()));await fsp.mkdir(output,{recursive:true});await fsp.mkdir(cache,{recursive:true});
  const env={...process.env,JAVA_HOME:jdk,ANDROID_HOME:sdk,ANDROID_SDK_ROOT:sdk,GRADLE_USER_HOME:gradleHome,Path:path.dirname(process.execPath)+';'+path.join(jdk,'bin')+';'+process.env.Path};
  delete env.PIPI_ANDROID_KEYSTORE;delete env.PIPI_ANDROID_KEY_PASSWORD;
  const keystore=path.join(cache,'standalone-debug.keystore');
  if(!fs.existsSync(keystore))execFileSync(path.join(jdk,'bin/keytool.exe'),['-genkeypair','-keystore',keystore,'-storepass','android','-keypass','android','-alias','androiddebugkey','-dname','CN=Pipi standalone local test,O=Local tests,C=ZZ','-keyalg','RSA','-keysize','2048','-validity','3650','-noprompt'],{env,stdio:'pipe'});
  const literal=value=>JSON.stringify(value.replace(/\\/g,'/')),init=path.join(output,'standalone.init.gradle');
  await fsp.writeFile(init,`gradle.beforeProject { p ->
    p.layout.buildDirectory.set(new File(${literal(output)}, p.path == ':' ? 'root-build' : 'app-build'))
    p.pluginManager.withPlugin('com.android.application') {
        p.extensions.getByName('androidComponents').finalizeDsl { android ->
            android.buildTypes.getByName('debug').applicationIdSuffix = ${literal(buildApplicationId.slice('com.pipiphone.app'.length))}
            def signing = android.signingConfigs.getByName('debug')
            signing.storeFile = new File(${literal(keystore)})
            signing.storePassword = 'android'
            signing.keyAlias = 'androiddebugkey'
            signing.keyPassword = 'android'
            android.buildTypes.getByName('debug').signingConfig = signing
        }
    }
}
`);
  const args=['-classpath',path.join(project,'android/gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain','--offline','--no-daemon','--console=plain','--max-workers=2','--project-cache-dir',path.join(cache,'project-cache'),'--init-script',init,':app:assembleDebug'],log=path.join(output,'gradle.log'),stream=fs.createWriteStream(log);
  const exitCode=await new Promise((resolve,reject)=>{const child=spawn(path.join(jdk,'bin/java.exe'),args,{cwd:path.join(project,'android'),env,windowsHide:true});child.stdout.on('data',bytes=>{stream.write(bytes);process.stdout.write(bytes);});child.stderr.on('data',bytes=>{stream.write(bytes);process.stderr.write(bytes);});child.on('error',reject);child.on('close',resolve);});
  await new Promise(resolve=>stream.end(resolve));
  if(exitCode!==0){await fsp.writeFile(path.join(output,'build-failure.json'),JSON.stringify({exitCode,log,jdk,sdk,gradleHome},null,2)+'\n');process.exitCode=exitCode;return;}
  const apk=path.join(output,buildApplicationId==='com.pipiphone.app.integratedqa'?'pipi-phone-integratedqa-debug.apk':'pipi-phone-standaloneqa-debug.apk');await fsp.copyFile(path.join(output,'app-build/outputs/apk/debug/app-debug.apk'),apk);
  // Windows aapt cannot open this workspace's Chinese path. Inspect an exact
  // byte copy in the ASCII-only developer cache; retain both as evidence.
  const apkSha256=hash(await fsp.readFile(apk)),inspectionDir=path.join(cache,'apk-inspection',apkSha256);await fsp.mkdir(inspectionDir,{recursive:true});
  const inspectionApk=path.join(inspectionDir,'standalone.apk');await fsp.copyFile(apk,inspectionApk);
  const assets=await inspectApk(apk),badging=execFileSync(path.join(sdk,'build-tools/35.0.0/aapt.exe'),['dump','badging',inspectionApk],{encoding:'utf8',env}),match=/package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(badging);
  if(!match||match[1]!==buildApplicationId)throw Error('The test APK applicationId is not isolated');
  const signing=execFileSync(path.join(jdk,'bin/java.exe'),['-jar',path.join(sdk,'build-tools/35.0.0/lib/apksigner.jar'),'verify','--print-certs',inspectionApk],{encoding:'utf8',env});
  await fsp.writeFile(path.join(output,'apk-badging.txt'),badging);await fsp.writeFile(path.join(output,'apk-signing.txt'),signing);
  const result={builtAt:new Date().toISOString(),project,apk,apkSha256,inspectionApk,applicationId:match[1],versionCode:Number(match[2]),versionName:match[3],webVersion:require('../package.json').version,...assets,debugOnly:true,officialSigningRead:false,signing:'Independent locally generated debug key in standalone developer cache',jdk,sdk,gradleHome,gradle:'8.9',androidGradlePlugin:'8.7.3',command:{executable:path.join(jdk,'bin/java.exe'),args,cwd:path.join(project,'android')},exitCode,network:'Gradle --offline; no product/core/Python dependency',log};
  await fsp.writeFile(path.join(output,'build-evidence.json'),JSON.stringify(result,null,2)+'\n');await fsp.writeFile(path.join(evidenceRoot,'android-build-latest.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({apk,applicationId:result.applicationId,webBuildId:result.webBuildId,publicFileCount:result.publicFileCount,apkSha256:result.apkSha256}));
}
module.exports={inspectApk,zipEntries,applicationId,build:main};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
