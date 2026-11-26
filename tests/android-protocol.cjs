// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Compile the real asset/protocol/origin implementation against Android boundary
// stubs. The handshake peer is an ephemeral loopback HTTP server, never a model.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),jdk=process.env.PIPI_ANDROID_TEST_JDK||process.env.JAVA_HOME||'C:/Program Files/Eclipse Adoptium/jdk-17.0.21.10002-hotspot',jar=process.env.PIPI_ANDROID_TEST_JSON_JAR||'C:/Users/34483/.codex/standalone-android/json-20240303.jar',binary=name=>path.join(jdk,'bin',name+(process.platform==='win32'?'.exe':''));
const output=path.join(root,'outputs/integrated-optimization/batch-b/android/contracts',String(Date.now())),classes=path.join(output,'classes');fs.mkdirSync(classes,{recursive:true});
const stubs={
 'android/content/Context.java':'package android.content; public abstract class Context {public abstract android.content.res.AssetManager getAssets();}',
 'android/content/res/AssetManager.java':'package android.content.res; public abstract class AssetManager {public abstract java.io.InputStream open(String name) throws java.io.IOException;}',
 'android/content/SharedPreferences.java':'package android.content; public interface SharedPreferences {String getString(String key,String fallback); Editor edit(); interface Editor {Editor putString(String key,String value);Editor remove(String key);void apply();}}',
 'android/net/Uri.java':'package android.net; public final class Uri {final java.net.URI value;private Uri(String text){value=java.net.URI.create(text);}public static Uri parse(String text){return new Uri(text);}public String getScheme(){return value.getScheme();}public String getHost(){return value.getHost();}public int getPort(){return value.getPort();}public String getPath(){return value.getPath();}public String toString(){return value.toString();}}',
 'android/os/Build.java':'package android.os;public final class Build {public static String FINGERPRINT="production",MODEL="phone",HARDWARE="arm64";public static String[] SUPPORTED_ABIS={"arm64-v8a"};}',
 'android/webkit/WebResourceRequest.java':'package android.webkit;public interface WebResourceRequest {android.net.Uri getUrl();String getMethod();boolean isForMainFrame();}',
 'android/webkit/WebResourceResponse.java':'package android.webkit;public final class WebResourceResponse {public final int status;public final java.io.InputStream data;public final java.util.Map<String,String> headers;public WebResourceResponse(String type,String encoding,int status,String reason,java.util.Map<String,String> headers,java.io.InputStream data){this.status=status;this.data=data;this.headers=headers;}}'
};
for(const[name,content]of Object.entries(stubs)){const file=path.join(output,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
const production=path.join(root,'android/app/src/main/java/com/pipiphone/app');
execFileSync(binary('javac'),['-encoding','UTF-8','-cp',jar,'-d',classes,...Object.keys(stubs).map(name=>path.join(output,name)),...['TrustedOrigin.java','BundleCompatibility.java','AssetBundle.java'].map(name=>path.join(production,name)),path.join(root,'android/tests/AssetBundleProtocolTest.java')],{stdio:'inherit'});
execFileSync(binary('java'),['--add-modules','jdk.httpserver','-cp',classes+path.delimiter+jar,'com.pipiphone.app.AssetBundleProtocolTest',...(process.argv.includes('--local-first-only')?['local-first']:[])],{stdio:'inherit'});
console.log('Compiled real Android contract sources: '+output);
