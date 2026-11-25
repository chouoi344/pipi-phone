// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Optional transport. Only an explicit user switch can request a Firebase token. */
public final class FcmTransport {
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static final String PREFS = "pipi_phone_fcm";
    private static volatile boolean visible, registering;
    private FcmTransport() {}
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS,Context.MODE_PRIVATE); }
    public static boolean active(Context context) { return prefs(context).getBoolean("active",false); }
    private static boolean requested(Context context) { return prefs(context).getBoolean("requested",false); }
    private static boolean hasPlayServices(Context context) {
        try { return context.getPackageManager().getApplicationInfo("com.google.android.gms",0).enabled; }
        catch(PackageManager.NameNotFoundException absent) { return false; }
    }
    private static String installation(Context context) {
        SharedPreferences settings=prefs(context);
        String id=settings.getString("installation",null);
        if(id==null){id=UUID.randomUUID().toString();settings.edit().putString("installation",id).apply();}
        return id;
    }
    private static String cookieHash(String cookie) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(cookie.getBytes(StandardCharsets.UTF_8));
        StringBuilder result=new StringBuilder();for(byte value:digest)result.append(String.format("%02x",value&255));return result.toString();
    }
    private static boolean unchanged(Context context,String origin,long generation,String cookie) {
        return requested(context)&&PhoneNotifications.isEnabled(context)&&origin.equals(PhoneNotifications.origin(context))
                &&prefs(context).getLong("generation",0)==generation&&Objects.equals(cookie,PhoneNotifications.cookie(origin));
    }
    private static JSONObject request(String origin,String path,String cookie,JSONObject body,String csrf) throws Exception {
        HttpURLConnection connection=PhoneNotifications.connect(origin,path,cookie,"application/json");
        connection.setReadTimeout(15000);
        try {
            if(body!=null){
                connection.setRequestMethod("POST");connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Origin",origin);
                connection.setRequestProperty("X-CSRF-Token",csrf);
                byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);
                try(java.io.OutputStream output=connection.getOutputStream()){output.write(bytes);}
            }
            int status=connection.getResponseCode();
            if(status==401)throw new PhoneNotifications.AuthenticationExpired();
            if(status!=200)throw new java.io.IOException("FCM 注册接口返回 "+status);
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] bytes=new byte[4096];int count;
                while((count=input.read(bytes))!=-1){if(output.size()+count>131072)throw new java.io.IOException("FCM 注册响应过大");output.write(bytes,0,count);}
                return new JSONObject(output.toString("UTF-8"));
            }
        }finally{connection.disconnect();}
    }
    private static void connect(Context source) {
        Context context=source.getApplicationContext();
        if(registering||!requested(context)||!PhoneNotifications.isEnabled(context))return;
        registering=true;
        final String origin=PhoneNotifications.origin(context),cookie=PhoneNotifications.cookie(origin);
        final long generation=prefs(context).getLong("generation",0);
        worker.execute(()->{
            try {
                if(cookie==null)throw new PhoneNotifications.AuthenticationExpired();
                if(active(context)&&(!origin.equals(prefs(context).getString("origin",""))||!cookieHash(cookie).equals(prefs(context).getString("cookie_hash",""))))
                    prefs(context).edit().putBoolean("active",false).apply();
                JSONObject capability=request(origin,"/api/android/fcm",cookie,null,null);
                if(!capability.getBoolean("available")){prefs(context).edit().putBoolean("active",false).apply();throw new java.io.IOException("管理员尚未配置服务器 FCM");}
                FirebaseApp firebase=FirebaseApp.getInstance();
                String project=firebase.getOptions().getProjectId(),scope=capability.getString("appSessionScope");
                if(!Objects.equals(project,capability.getString("projectId"))){prefs(context).edit().putBoolean("active",false).apply();throw new java.io.IOException("App 与服务器的 Firebase 项目不一致");}
                if(!scope.matches("[a-f0-9]{64}"))throw new java.io.IOException("服务器会话标识无效");
                if(!unchanged(context,origin,generation,cookie))return;
                FirebaseMessaging messaging=FirebaseMessaging.getInstance();messaging.setAutoInitEnabled(true);
                String token=Tasks.await(messaging.getToken(),20,TimeUnit.SECONDS);
                if(!unchanged(context,origin,generation,cookie))return;
                JSONObject body=new JSONObject().put("token",token).put("installationId",installation(context))
                        .put("packageName",context.getPackageName()).put("projectId",project).put("foreground",visible);
                JSONObject registered=request(origin,"/api/android/fcm/register",cookie,body,capability.getString("csrfToken"));
                if(!registered.getBoolean("registered")||!scope.equals(registered.getString("appSessionScope")))throw new java.io.IOException("FCM 会话注册未确认");
                if(!unchanged(context,origin,generation,cookie))return;
                synchronized(PhoneNotifications.STATE_LOCK){
                    if(!unchanged(context,origin,generation,cookie))return;
                    prefs(context).edit().putBoolean("active",true).putString("origin",origin).putString("scope",scope)
                            .putString("cookie_hash",cookieHash(cookie)).putString("status","已注册当前服务器，使用 FCM 系统推送").apply();
                    PhoneNotifications.channels(context);
                    PhoneNotifications.useFcm(context,registered.getString("cursor"));
                }
            }catch(PhoneNotifications.AuthenticationExpired expired){
                if(prefs(context).getLong("generation",0)==generation)PhoneNotifications.disable(context,"登录已失效，后台通知已关闭");
            }catch(Exception error){
                if(unchanged(context,origin,generation,cookie)){
                    if(active(context)){
                        prefs(context).edit().putString("status","FCM 仍使用已注册通道；本次连接核对未完成："+error.getMessage()).apply();
                    }else{
                        prefs(context).edit().putString("status","注册未完成："+error.getMessage()+"；兼容通知继续运行").apply();
                        PhoneNotifications.connectionStatus(context,"FCM 未注册："+error.getMessage()+"；继续使用兼容后台通知");
                        PhoneNotifications.resumeCompatible(context);
                    }
                }
            }finally{
                registering=false;
                if(requested(context)&&prefs(context).getLong("generation",0)!=generation)connect(context);
            }
        });
    }
    public static void onPageFinished(Context context) {
        if(!requested(context))return;
        if(!PhoneNotifications.isEnabled(context)){disable(context);return;}
        connect(context);
    }
    public static void setVisible(Context context,boolean value) {
        visible=value;
        if(!requested(context))return;
        if(PhoneNotifications.cookie(PhoneNotifications.origin(context))==null){PhoneNotifications.disable(context,"登录已退出，后台通知已关闭");return;}
        connect(context);
    }
    public static void onNewToken(Context context) { if(requested(context))connect(context); }
    public static void disable(Context source) {
        Context context=source.getApplicationContext();SharedPreferences settings=prefs(context);
        if(!requested(context)&&!active(context))return;
        String origin=settings.getString("origin",PhoneNotifications.origin(context)),cookie=PhoneNotifications.cookie(origin),id=installation(context);
        settings.edit().putBoolean("requested",false).putBoolean("active",false).putLong("generation",settings.getLong("generation",0)+1)
                .remove("origin").remove("scope").remove("cookie_hash").putString("status","已关闭 FCM").apply();
        PhoneNotifications.clearMessages(context);
        worker.execute(()->{
            if(cookie!=null){
                try{JSONObject capability=request(origin,"/api/android/fcm",cookie,null,null);request(origin,"/api/android/fcm/unregister",cookie,new JSONObject().put("installationId",id),capability.getString("csrfToken"));}
                catch(Exception error){android.util.Log.w("PipiFCM","服务器暂未确认推送解绑；本机已停用，旧排队泛化提醒最多保留60秒。",error);}
            }
            try{FirebaseMessaging messaging=FirebaseMessaging.getInstance();messaging.setAutoInitEnabled(false);Tasks.await(messaging.deleteToken(),20,TimeUnit.SECONDS);}
            catch(Exception error){android.util.Log.w("PipiFCM","暂未完成设备推送令牌作废；本机已停用。",error);}
        });
    }
    public static boolean acceptIntent(Context context,Intent intent) {
        if(!intent.hasExtra("appSessionScope"))return true;
        SharedPreferences settings=prefs(context);String cookie=PhoneNotifications.cookie(PhoneNotifications.origin(context));
        if(cookie==null)return false;
        try{return FcmBinding.matches(PhoneNotifications.isEnabled(context)&&active(context),PhoneNotifications.origin(context),settings.getString("origin",""),
                settings.getString("scope",""),settings.getString("cookie_hash",""),cookieHash(cookie),intent.getStringExtra("notificationOrigin"),intent.getStringExtra("appSessionScope"));}
        catch(Exception error){android.util.Log.w("PipiFCM","旧通知的会话核对失败。",error);return false;}
    }
    public static void addSettings(Activity activity,LinearLayout form) {
        TextView info=new TextView(activity);info.setTextSize(13);
        info.setText("FCM 系统推送：安装包已配置管理员的 Firebase 项目。设备需有 Google Play 服务，服务器也需单独配置；注册成功才切换通知方式。");form.addView(info);
        Switch toggle=new Switch(activity);toggle.setText("使用可选 FCM 系统推送");toggle.setChecked(requested(activity));form.addView(toggle);
        TextView state=new TextView(activity);state.setTextSize(13);form.addView(state);
        final boolean[] syncing = {false};
        state.post(new Runnable(){@Override public void run(){
            if(!state.isAttachedToWindow())return;
            state.setText(prefs(activity).getString("status","尚未注册此服务器"));
            boolean desired = requested(activity);
            if(toggle.isChecked()!=desired){syncing[0]=true;toggle.setChecked(desired);syncing[0]=false;}
            state.postDelayed(this,1000);
        }});
        toggle.setOnCheckedChangeListener((button,enabled)->{
            if(syncing[0])return;
            if(!enabled){disable(activity);PhoneNotifications.resumeCompatible(activity);return;}
            if(!PhoneNotifications.isEnabled(activity)||!hasPlayServices(activity)){
                Toast.makeText(activity,!PhoneNotifications.isEnabled(activity)?"请先开启后台消息通知":"此设备没有可用的 Google Play 服务，继续使用兼容后台通知",Toast.LENGTH_LONG).show();toggle.setChecked(false);return;
            }
            SharedPreferences settings=prefs(activity);settings.edit().putBoolean("requested",true).putString("status","正在核对服务器并注册 FCM")
                    .putLong("generation",settings.getLong("generation",0)+1).apply();
            PhoneNotifications.connectionStatus(activity,"正在核对服务器并注册 FCM，兼容通知继续运行");connect(activity);
        });
    }
}
