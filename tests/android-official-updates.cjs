// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Compiles the production updater against small Android platform stubs; HTTP uses real local sockets.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const jar=process.argv[2]||process.env.PIPI_ANDROID_TEST_JSON_JAR,jdk=process.argv[3]||process.env.JAVA_HOME;
if(!jar||!jdk)throw Error('Usage: node tests/android-official-updates.cjs <org.json test jar> <JDK directory>');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-android-updates-')),classes=path.join(output,'classes');
fs.mkdirSync(classes);
const stubs={
 'android/content/Context.java':`package android.content;
public abstract class Context { public abstract java.io.File getCacheDir(); public abstract String getPackageName(); public abstract android.content.pm.PackageManager getPackageManager(); }`,
 'android/content/pm/PackageManager.java':`package android.content.pm;
public abstract class PackageManager { public static final int GET_SIGNING_CERTIFICATES=1,GET_SIGNATURES=2; public abstract PackageInfo getPackageInfo(String name,int flags); public abstract PackageInfo getPackageArchiveInfo(String file,int flags); }`,
 'android/content/pm/ApplicationInfo.java':'package android.content.pm; public class ApplicationInfo { public int minSdkVersion; }',
 'android/content/pm/Signature.java':'package android.content.pm; public final class Signature { final String value; public Signature(String value){this.value=value;} public String toCharsString(){return value;} }',
 'android/content/pm/SigningInfo.java':'package android.content.pm; public class SigningInfo { public Signature[] getApkContentsSigners(){return null;} }',
 'android/content/pm/PackageInfo.java':`package android.content.pm;
public class PackageInfo { public String packageName,versionName; public int versionCode; public ApplicationInfo applicationInfo=new ApplicationInfo(); public Signature[] signatures; public SigningInfo signingInfo; public long getLongVersionCode(){return versionCode;} }`,
 'android/os/Build.java':'package android.os; public final class Build { public static final class VERSION { public static int SDK_INT=35; } }',
 'android/util/Log.java':'package android.util; public final class Log { public static int w(String tag,String value){System.err.println(tag+": "+value);return 0;} }',
 'com/pipiphone/app/TrustedOrigin.java':'package com.pipiphone.app; final class TrustedOrigin { final String value; TrustedOrigin(String value){this.value=value;} }',
 'com/pipiphone/app/BuildConfig.java':'package com.pipiphone.app; final class BuildConfig { static final String VERSION_NAME="0.1.3"; }',
 'com/pipiphone/app/UpdateApkProvider.java':'package com.pipiphone.app; final class UpdateApkProvider { static java.io.File apk(android.content.Context context){return new java.io.File(context.getCacheDir(),"official-update/update.apk");} }'
};
for(const [name,source] of Object.entries(stubs)){
 const file=path.join(output,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);
}
const source=path.resolve(__dirname,'../android/app/src/main/java/com/pipiphone/app');
execFileSync(path.join(jdk,'bin','javac'),['-encoding','UTF-8','-cp',path.resolve(jar),'-d',classes,
 ...Object.keys(stubs).map(name=>path.join(output,name)),path.join(source,'CompatNotificationBinding.java'),
 path.join(source,'OfficialUpdates.java'),path.resolve(__dirname,'../android/tests/OfficialUpdatesTest.java')],{stdio:'inherit'});
process.stdout.write(execFileSync(path.join(jdk,'bin','java'),['--add-modules','jdk.httpserver','-cp',classes+path.delimiter+path.resolve(jar),'com.pipiphone.app.OfficialUpdatesTest'],{encoding:'utf8'}));
console.log('Isolated compilation: '+output);
