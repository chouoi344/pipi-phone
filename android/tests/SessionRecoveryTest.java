// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

import android.app.Activity;
import android.webkit.CookieManager;
import com.sun.net.httpserver.HttpServer;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.util.List;
import java.util.Map;

/** Real production policy/network; isolated Android OS boundaries. */
public final class SessionRecoveryTest {
    private static final String A="pipi_session="+"a".repeat(64),B="pipi_session="+"b".repeat(64);
    private static final String ATTR="; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000";
    private static final CookieManager cookies=CookieManager.getInstance();
    private static int passed;
    interface Checked { void run() throws Exception; }
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static Activity enabled(String origin){cookies.reset();FcmTransport.enabled=false;Activity a=new Activity();a.getSharedPreferences("pipi_phone_android",0).edit().putString("server_origin",origin).apply();cookies.value=A;check(PhoneNotifications.setEnabled(a,true),"initial enable");return a;}
    static long generation(Activity a){return PhoneNotifications.prefs(a).getLong("generation",0);}
    static boolean pending(Activity a){return PhoneNotifications.prefs(a).getBoolean("resume_after_login",false);}
    static void test(String name,Checked task)throws Exception {try{task.run();passed++;}catch(Exception|AssertionError e){throw new AssertionError(name,e);}}
    static HttpURLConnection headers(String origin,String... values)throws Exception{return new HttpURLConnection(new URL(origin)){public Map<String,List<String>>getHeaderFields(){return Map.of("sEt-CoOkIe",List.of(values));}public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){}};}
    public static void main(String[] args)throws Exception {
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        final int[] status={200};final String[] cookie={A+ATTR};
        server.createContext("/api/android/notifications",exchange->{byte[] body="{\"revision\":1,\"cursor\":\"next\",\"conversations\":[],\"messages\":[]}".getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().add("Set-Cookie",cookie[0]);exchange.sendResponseHeaders(status[0],body.length);try(java.io.OutputStream out=exchange.getResponseBody()){out.write(body);}});server.start();
        String origin="http://127.0.0.1:"+server.getAddress().getPort();
        try {
            test("HTTP notification sync persists same-session renewal and flushes to disk",()->{Activity a=enabled(origin);check(PhoneNotifications.sync(a,origin,generation(a),()->true)==1,"sync revision");check(cookies.writes==1&&cookies.flushes==1&&cookies.lastSet.equals(A+ATTR),"renewal not persisted");check(cookies.value.equals(A),"token changed");});
            test("cookie boundary rejects changed token, foreign domain and malformed cookies",()->{Activity a=enabled(origin);for(String c:List.of(B+ATTR,A+ATTR+"; Domain=example.com",A+"; Path=/",A+ATTR+"\r\nX: bad"))PhoneNotifications.saveSessionCookie(a,headers(origin,c),origin,A,generation(a));check(cookies.writes==0&&cookies.value.equals(A),"untrusted cookie installed");});
            test("late renewal cannot revive manual off or replace a fresh login",()->{Activity a=enabled(origin);long old=generation(a);PhoneNotifications.setEnabled(a,false);PhoneNotifications.saveSessionCookie(a,headers(origin,A+ATTR),origin,A,old);check(cookies.writes==0,"disabled response installed");PhoneNotifications.setEnabled(a,true);old=generation(a);cookies.value=B;PhoneNotifications.saveSessionCookie(a,headers(origin,A+ATTR),origin,A,old);check(cookies.value.equals(B)&&cookies.writes==0,"late old token replaced login");});
            test("401 pauses notifications and a new login resumes once",()->{Activity a=enabled(origin);long old=generation(a);status[0]=401;try{PhoneNotifications.sync(a,origin,old,()->true);throw new AssertionError("401 accepted");}catch(PhoneNotifications.AuthenticationExpired expected){PhoneNotifications.authenticationExpired(a,origin,old,A,"expired");}finally{status[0]=200;}check(!PhoneNotifications.isEnabled(a)&&pending(a),"401 did not mark resume");check(!PhoneNotifications.resumeAfterLogin(a)&&pending(a),"same rejected cookie restarted notifications");cookies.value=B;check(PhoneNotifications.resumeAfterLogin(a),"new login did not resume");check(PhoneNotifications.isEnabled(a)&&!pending(a),"resume marker remains");long current=generation(a);check(!PhoneNotifications.resumeAfterLogin(a)&&generation(a)==current,"duplicate bridge restarted notifications");});
            test("missing cookie pauses until login without starting unauthorized transport",()->{Activity a=enabled(origin);cookies.value=null;PhoneNotifications.onPageFinished(a);check(pending(a)&&!PhoneNotifications.isEnabled(a),"missing cookie not paused");check(!PhoneNotifications.resumeAfterLogin(a),"resumed without login");cookies.value=B;check(PhoneNotifications.resumeAfterLogin(a),"missing-cookie recovery failed");});
            test("manual off clears pending resume and never auto-enables",()->{Activity a=enabled(origin);PhoneNotifications.authenticationExpired(a,origin,generation(a),A,"expired");PhoneNotifications.setEnabled(a,false);cookies.value=B;check(!pending(a)&&!PhoneNotifications.preference(a)&&!PhoneNotifications.resumeAfterLogin(a),"manual off revived");});
            test("late 401 from previous cookie or generation cannot pause new login",()->{Activity a=enabled(origin);long old=generation(a);cookies.value=B;PhoneNotifications.authenticationExpired(a,origin,old,A,"expired");check(PhoneNotifications.isEnabled(a)&&!pending(a),"old cookie disabled new login");PhoneNotifications.setEnabled(a,false);PhoneNotifications.setEnabled(a,true);PhoneNotifications.authenticationExpired(a,origin,old,B,"expired");check(PhoneNotifications.isEnabled(a)&&!pending(a),"old generation disabled current run");});
            test("server change and notification permission loss never resume automatically",()->{Activity a=enabled(origin);PhoneNotifications.authenticationExpired(a,origin,generation(a),A,"expired");a.getSharedPreferences("pipi_phone_android",0).edit().putString("server_origin","http://127.0.0.1:18888").apply();check(!PhoneNotifications.resumeAfterLogin(a),"different server resumed");PhoneNotifications.onServerChanged(a);check(!pending(a),"server change left pending");a=enabled(origin);a.permitted=false;try{PhoneNotifications.sync(a,origin,generation(a),()->true);throw new AssertionError("permission ignored");}catch(SecurityException expected){PhoneNotifications.disable(a,"permission");}check(!pending(a)&&!PhoneNotifications.resumeAfterLogin(a),"permission loss treated as login expiry");});
            test("optional FCM authentication loss shares pending recovery without overriding manual preference",()->{Activity a=enabled(origin);FcmTransport.enabled=true;PhoneNotifications.authenticationExpired(a,origin,generation(a),A,"expired");check(pending(a)&&!FcmTransport.enabled,"FCM auth loss did not pause");cookies.value=B;check(PhoneNotifications.resumeAfterLogin(a),"FCM loss did not restore notifications");PhoneNotifications.setEnabled(a,false);PhoneNotifications.authenticationExpired(a,origin,generation(a),B,"late FCM");check(!pending(a)&&!PhoneNotifications.resumeAfterLogin(a),"late FCM restored manual off");});
        }finally{server.stop(0);}
        System.out.println("PASS session recovery: "+passed+" controlled cases");
    }
}
