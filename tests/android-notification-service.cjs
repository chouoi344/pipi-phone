// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Runs the production Service lifecycle with controllable Android/network boundaries.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const jar=process.argv[2]||process.env.PIPI_ANDROID_TEST_JSON_JAR,jdk=process.argv[3]||process.env.JAVA_HOME;
if(!jar||!jdk)throw Error('Usage: node tests/android-notification-service.cjs <org.json test jar> <JDK directory>');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'pipi-notification-service-')),classes=path.join(output,'classes');
fs.mkdirSync(classes);
const stubs={
 'android/app/Service.java':`package android.app; public class Service {
 public static final int START_NOT_STICKY=2,STOP_FOREGROUND_REMOVE=1; public volatile int stops,foregroundStarts; public volatile int stoppedId=-1;
 public int onStartCommand(android.content.Intent intent,int flags,int startId){return START_NOT_STICKY;}
 public void startForeground(int id,Notification value){foregroundStarts++;} public void startForeground(int id,Notification value,int type){foregroundStarts++;}
 public void stopForeground(int mode){} public void stopSelf(){stops++;} public boolean stopSelfResult(int id){stoppedId=id;stops++;return true;}
 public void onTimeout(int startId,int type){} public void onDestroy(){} public android.os.IBinder onBind(android.content.Intent intent){return null;} }`,
 'android/app/Notification.java':`package android.app; public class Notification { public static final int PRIORITY_LOW=-1;
 public static class Builder { public Builder setGroup(String v){return this;} public Builder setSmallIcon(int v){return this;}
 public Builder setContentTitle(String v){return this;} public Builder setContentText(String v){return this;} public Builder setPriority(int v){return this;}
 public Builder setOnlyAlertOnce(boolean v){return this;} public Builder setContentIntent(PendingIntent v){return this;}
 public Builder setOngoing(boolean v){return this;} public Builder setShowWhen(boolean v){return this;} public Builder addAction(Action v){return this;} public Notification build(){return new Notification();} }
 public static class Action { public static class Builder { public Builder(Object icon,String title,PendingIntent action){} public Action build(){return new Action();} } } }`,
 'android/app/PendingIntent.java':'package android.app; public class PendingIntent { public static final int FLAG_UPDATE_CURRENT=1,FLAG_IMMUTABLE=2; public static PendingIntent getService(Object context,int id,android.content.Intent intent,int flags){return new PendingIntent();} }',
 'android/content/Intent.java':'package android.content; public class Intent { private String action; public Intent(){} public Intent(Object source,Class<?> target){} public Intent setAction(String value){action=value;return this;} public String getAction(){return action;} }',
 'android/content/pm/ServiceInfo.java':'package android.content.pm; public class ServiceInfo { public static final int FOREGROUND_SERVICE_TYPE_DATA_SYNC=1; }',
 'android/os/Build.java':'package android.os; public class Build { public static class VERSION { public static final int SDK_INT=35; } }',
 'android/os/IBinder.java':'package android.os; public interface IBinder {}',
 'android/os/Looper.java':'package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }',
 'android/os/Handler.java':`package android.os; public class Handler { private static final java.util.Queue<Runnable> pending=new java.util.concurrent.ConcurrentLinkedQueue<>();
 public Handler(Looper looper){} public boolean post(Runnable task){return pending.add(task);} public static boolean hasPending(){return !pending.isEmpty();}
 public static void drain(){Runnable task;while((task=pending.poll())!=null)task.run();} }`,
 'android/annotation/TargetApi.java':'package android.annotation; public @interface TargetApi { int value(); }',
 'android/R.java':'package android; public class R { public static class drawable { public static final int sym_action_chat=1; } }',
 'com/pipiphone/app/PhoneNotifications.java':`package com.pipiphone.app;
import java.net.*;import java.io.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
final class PhoneNotifications {
 static final Object STATE_LOCK=new Object(); static final int CONNECTION_ID=1; static final String CONNECTION_CHANNEL="test";
 static volatile boolean enabled=true; static volatile long generation=1; static volatile String origin="http://203.0.113.23:18766",cookie="login-a",status="";
 static final AtomicInteger syncs=new AtomicInteger(),disables=new AtomicInteger(),connections=new AtomicInteger(),open=new AtomicInteger(),maxOpen=new AtomicInteger();
 static final List<Long> synced=new CopyOnWriteArrayList<>(); static volatile CountDownLatch closing,closeGate;
 interface RunningCheck { boolean isRunning(); } interface Sync { long run(long generation,RunningCheck check) throws IOException; }
 static volatile Sync synchronization=(generation,check)->42;
 static class Settings { long getLong(String key,long fallback){return generation;} } static Settings prefs(Object context){return new Settings();}
 static boolean isEnabled(Object context){return enabled;} static String origin(Object context){return origin;} static String cookie(String server){return cookie;}
 static boolean active(Object context,String server,long version){return enabled&&server.equals(origin)&&version==generation;}
 static void channels(Object context){} static android.app.PendingIntent openApp(Object context,String role){return new android.app.PendingIntent();}
 static android.app.Notification.Builder builder(Object context,String channel){return new android.app.Notification.Builder();}
 static void rememberPreference(Object context,boolean value){}
 static void authenticationExpired(Object context,String server,long version,String sentCookie,String text){if(active(context,server,version)&&java.util.Objects.equals(cookie,sentCookie))disable(context,text);}
 static void saveSessionCookie(Object context,HttpURLConnection connection,String server,String sentCookie,long version){}
 static void connectionStatus(Object context,String text){status=text;} static void disable(Object context,String text){disables.incrementAndGet();enabled=false;generation++;status=text;}
 static class AuthenticationExpired extends IOException {}
 static long sync(Object context,String server,long version,RunningCheck check) throws IOException,org.json.JSONException {syncs.incrementAndGet();synced.add(version);return synchronization.run(version,check);}
 static HttpURLConnection connect(String server,String path,String cookie,String type) throws IOException {connections.incrementAndGet();return new StreamConnection();}
 static void await(CountDownLatch gate){if(gate==null)return;boolean interrupted=false;for(;;){try{gate.await();break;}catch(InterruptedException e){interrupted=true;}}if(interrupted)Thread.currentThread().interrupt();}
 static final class StreamConnection extends HttpURLConnection {
  boolean started,closed; StreamConnection() throws MalformedURLException {super(new URL(origin+"/api/events"));}
  public synchronized int getResponseCode() throws IOException {if(closed)throw new IOException("closed");started=true;int n=open.incrementAndGet();maxOpen.accumulateAndGet(n,Math::max);return 200;}
  public InputStream getInputStream(){return new InputStream(){public int read() throws IOException {synchronized(StreamConnection.this){while(!closed){try{StreamConnection.this.wait();}catch(InterruptedException e){throw new IOException("cancelled",e);}}throw new IOException("closed");}}};}
  public void disconnect(){CountDownLatch entered=closing,gate=closeGate;if(entered!=null)entered.countDown();await(gate);synchronized(this){if(!closed){closed=true;if(started)open.decrementAndGet();notifyAll();}}}
  public void connect(){} public boolean usingProxy(){return false;}
 }
 static void reset(){enabled=true;generation=1;origin="http://203.0.113.23:18766";cookie="login-a";status="";syncs.set(0);disables.set(0);connections.set(0);open.set(0);maxOpen.set(0);synced.clear();closing=null;closeGate=null;synchronization=(generation,check)->42;}
}`
};
for(const [name,source] of Object.entries(stubs)){const file=path.join(output,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);}
const production=process.env.PIPI_ANDROID_SERVICE_SOURCE||path.resolve(__dirname,'../android/app/src/main/java/com/pipiphone/app/PhoneNotificationsService.java');
execFileSync(path.join(jdk,'bin','javac'),['-encoding','UTF-8','-cp',path.resolve(jar),'-d',classes,...Object.keys(stubs).map(name=>path.join(output,name)),production,path.resolve(__dirname,'../android/tests/PhoneNotificationsServiceTest.java')],{stdio:'inherit'});
process.stdout.write(execFileSync(path.join(jdk,'bin','java'),['-cp',classes+path.delimiter+path.resolve(jar),'com.pipiphone.app.PhoneNotificationsServiceTest'],{encoding:'utf8'}));
console.log('Isolated service compilation: '+output);
