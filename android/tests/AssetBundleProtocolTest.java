package com.pipiphone.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/** Actual asset/origin/protocol code, controlled Android boundaries and real HTTP. */
public final class AssetBundleProtocolTest {
    private static final String HASH = "a".repeat(64), OTHER = "b".repeat(64);
    private static int passed, failed;
    private interface Check {void run() throws Exception;}
    private static void check(boolean ok, String message) {if(!ok)throw new AssertionError(message);}
    private static void test(String name, Check check) {
        try {check.run();passed++;System.out.println("PASS "+name);}
        catch(Throwable error){failed++;System.out.println("FAIL "+name+": "+error);}
    }
    private static final class Preferences implements SharedPreferences, SharedPreferences.Editor {
        final Map<String,String> values=new HashMap<>();
        public String getString(String key,String fallback){return values.getOrDefault(key,fallback);}
        public Editor edit(){return this;}
        public Editor putString(String key,String value){values.put(key,value);return this;}
        public Editor remove(String key){values.remove(key);return this;}
        public void apply(){}
    }
    private static final class Assets extends AssetManager {
        final String hash;
        Assets(String hash){this.hash=hash;}
        public InputStream open(String name) throws IOException {
            String text;
            if(name.equals("phone/bundle.json"))text="{\"sha256\":\""+hash+"\"}";
            else if(name.equals("phone/index.html"))text="<html><head><script src=\"/app.js\"></script></head><body>local shell</body></html>";
            else if(name.equals("phone/app.js"))text="window.localFixture=true;";
            else throw new IOException("absent fixture asset");
            return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
        }
    }
    private static Context context(String hash){return new Context(){public AssetManager getAssets(){return new Assets(hash);}};}
    private record Request(String url,boolean main) implements WebResourceRequest {
        public Uri getUrl(){return Uri.parse(url);}public String getMethod(){return "GET";}public boolean isForMainFrame(){return main;}
    }
    private static final class Peer implements AutoCloseable {
        final HttpServer server;final TrustedOrigin origin;volatile String response;volatile int status=200;
        Peer(String response) throws Exception {
            this.response=response;server=HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),0),0);
            server.createContext("/api/android-shell-manifest",exchange->{byte[] bytes=this.response.getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();});
            server.start();origin=TrustedOrigin.parse("http://127.0.0.1:"+server.getAddress().getPort());
        }
        AssetBundle bundle(String hash,Preferences prefs)throws Exception{return new AssetBundle(context(hash),prefs,origin);}
        public void close(){server.stop(0);}
    }
    private static String manifest(String hash,String protocol){return "{\"sha256\":\""+hash+"\""+(protocol==null?"":",\"clientProtocol\":"+protocol)+"}";}
    private static final String PROTOCOL="{\"name\":\"pipi-phone\",\"version\":1,\"features\":[\"state-v1\",\"chat-progress-v1\",\"sync-v1\",\"messages-v1\"]}";
    private static JSONObject receipt(AssetBundle bundle)throws Exception {
        var method=AssetBundle.class.getDeclaredMethod("compatibilityJson");method.setAccessible(true);return new JSONObject((String)method.invoke(bundle));
    }
    private static void expected(AssetBundle bundle,String state,boolean legacy)throws Exception{
        JSONObject receipt=receipt(bundle);check(state.equals(receipt.getString("state")),"expected "+state+" got "+receipt);check(receipt.getBoolean("legacyAllowed")==legacy,"unexpected legacy permission "+receipt);
    }
    public static void main(String[] args)throws Exception {
        test("first launch serves its local shell before any server/hash verification",()->{
            try(Peer peer=new Peer(manifest(OTHER,PROTOCOL))){AssetBundle bundle=peer.bundle(HASH,new Preferences());WebResourceResponse page=bundle.intercept(new Request(peer.origin.value+"/",true));check(page!=null&&page.status==200,"local shell was gated by remote bundle hash");}
        });
        if(args.length>0){System.out.println("Android protocol contracts: "+passed+" passed, "+failed+" failed");if(failed>0)System.exit(1);return;}
        test("protocol v1 accepts different resource hashes without granting legacy bypass",()->{
            try(Peer peer=new Peer(manifest(OTHER,PROTOCOL))){AssetBundle bundle=peer.bundle(HASH,new Preferences());bundle.verify();expected(bundle,"protocol-v1",false);check(bundle.enabled,"protocol mismatch hid local shell");}
        });
        test("unknown declared protocol cannot fall back through an equal bundle hash",()->{
            try(Peer peer=new Peer(manifest(HASH,PROTOCOL.replace("\"version\":1","\"version\":2")))){AssetBundle bundle=peer.bundle(HASH,new Preferences());bundle.verify();expected(bundle,"unsupported",false);check(bundle.enabled,"unsupported server must retain a usable explanation shell");}
        });
        test("missing required capability and malformed declared protocol fail closed",()->{
            try(Peer peer=new Peer(manifest(HASH,PROTOCOL.replace("chat-progress-v1","unknown")))){AssetBundle bundle=peer.bundle(HASH,new Preferences());bundle.verify();expected(bundle,"unsupported",false);peer.response=manifest(HASH,"null");bundle.verify();expected(bundle,"unsupported",false);}
        });
        test("unversioned equal/audited hashes retain the exact legacy permission gate",()->{
            try(Peer peer=new Peer(manifest(HASH,null))){AssetBundle bundle=peer.bundle(HASH,new Preferences());bundle.verify();expected(bundle,"legacy-audited",true);peer.response=manifest(BundleCompatibility.SERVER_0_13_11,null);bundle=peer.bundle(BundleCompatibility.WEBVIEW_83_BUNDLE,new Preferences());bundle.verify();expected(bundle,"legacy-audited",true);}
        });
        test("unreviewed old server chooses server resources without authorizing new local business",()->{
            try(Peer peer=new Peer(manifest(OTHER,null))){AssetBundle bundle=peer.bundle(HASH,new Preferences());bundle.verify();expected(bundle,"server-page",false);}
        });
        test("missing legacy manifest can use server page but malformed declared data cannot",()->{
            try(Peer peer=new Peer("legacy endpoint missing")){
                peer.status=404;AssetBundle bundle=peer.bundle(HASH,new Preferences());bundle.verify();expected(bundle,"server-page",false);
                peer.status=200;peer.response="{";bundle.verify();expected(bundle,"unsupported",false);
            }
        });
        test("a prior compatibility cache cannot authorize business while disconnected",()->{
            Preferences prefs=new Preferences();TrustedOrigin origin;try(Peer peer=new Peer(manifest(OTHER,PROTOCOL))){origin=peer.origin;AssetBundle bundle=peer.bundle(HASH,prefs);bundle.verify();}
            AssetBundle offline=new AssetBundle(context(HASH),prefs,origin);offline.verify();expected(offline,"offline",false);check(offline.enabled,"offline shell should remain available");
        });
        test("same-page reconnect requests a native handshake after an offline start",()->{
            for(String protocol:new String[]{PROTOCOL,null})try(Peer peer=new Peer(manifest(HASH,protocol))){
                peer.status=503;AssetBundle bundle=peer.bundle(HASH,new Preferences());bundle.verify();expected(bundle,"offline",false);
                String page=peer.origin.value+"/";WebResourceResponse response=bundle.intercept(new Request(page,true));
                String html=new String(response.data.readAllBytes(),StandardCharsets.UTF_8),token=html.split("pipi-recording\" content=\"")[1].split("\"")[0];
                peer.status=200;
                int[] scheduled={0};Runnable retry=()->scheduled[0]++;
                bundle.queryCompatibility("forged","get",page,page,null,retry);check(scheduled[0]==0,"forged token started native retry");expected(bundle,"offline",false);
                JSONObject reconnect=new JSONObject(bundle.queryCompatibility(token,"get",page,page,null,retry));
                check("checking".equals(reconnect.getString("state")),"reconnected page remained permanently "+reconnect);
                check(!bundle.allowsBusiness(),"readonly get itself authorized business before the native HTTP result");
                bundle.queryCompatibility(token,"get",page,page,null,retry);check(scheduled[0]==1,"repeated get duplicated the in-flight handshake");
                bundle.verify();expected(bundle,protocol==null?"legacy-audited":"protocol-v1",protocol==null);check(bundle.allowsBusiness(),"native HTTP result did not restore business on the same asset page");
                check(bundle.ownsMicrophoneToken(token),"reconnect invalidated the current document token");
                bundle.queryCompatibility(token,"get",page,page,null,retry);check(scheduled[0]==1,"healthy connection was reverified on every readonly get");
            }
        });
        test("same-origin interception preserves CSP, per-document recording token and API bypass",()->{
            try(Peer peer=new Peer(manifest(OTHER,PROTOCOL))){AssetBundle bundle=peer.bundle(HASH,new Preferences());WebResourceResponse page=bundle.intercept(new Request(peer.origin.value+"/",true));check(page!=null,"local page absent");String html=new String(page.data.readAllBytes(),StandardCharsets.UTF_8);check(html.contains("<meta name=\"pipi-client-compat\" content=\"1\">"),"new native bridge capability marker absent");String token=html.split("pipi-recording\" content=\"")[1].split("\"")[0];check(bundle.ownsMicrophoneToken(token),"native token not bound to asset page");check(page.headers.get("Content-Security-Policy").contains("'nonce-"+token+"'"),"nonce policy missing");check(bundle.intercept(new Request(peer.origin.value+"/api/state",false))==null,"API intercepted as local asset");check(bundle.intercept(new Request("https://other.invalid/app.js",false)).status==403,"external origin unblocked");bundle.intercept(new Request(peer.origin.value+"/",true));check(!bundle.ownsMicrophoneToken(token),"old page token survived navigation");}
        });
        test("legacy receipt requires native-issued token, both page origins and readonly get command",()->{
            try(Peer peer=new Peer(manifest(HASH,null))){
                AssetBundle bundle=peer.bundle(HASH,new Preferences());bundle.verify();
                String page=peer.origin.value+"/";WebResourceResponse response=bundle.intercept(new Request(page,true));
                String html=new String(response.data.readAllBytes(),StandardCharsets.UTF_8),token=html.split("pipi-recording\" content=\"")[1].split("\"")[0];
                check(new JSONObject(bundle.queryCompatibility(token,"get",page,page,null)).getBoolean("legacyAllowed"),"native verified legacy receipt denied");
                for(String command:new String[]{"set","true","{\"legacyAllowed\":true}"})check(!new JSONObject(bundle.queryCompatibility(token,command,page,page,null)).getBoolean("legacyAllowed"),"page could write its own permission");
                check(!new JSONObject(bundle.queryCompatibility("forged","get",page,page,null)).getBoolean("legacyAllowed"),"forged token accepted");
                check(!new JSONObject(bundle.queryCompatibility(token,"get","https://other.invalid/",page,null)).getBoolean("legacyAllowed"),"wrong caller accepted");
                check(!new JSONObject(bundle.queryCompatibility(token,"get",page,"https://other.invalid/",null)).getBoolean("legacyAllowed"),"wrong current page accepted");
                bundle.intercept(new Request(page,true));check(!new JSONObject(bundle.queryCompatibility(token,"get",page,page,null)).getBoolean("legacyAllowed"),"old document token accepted");expected(bundle,"legacy-audited",true);
            }
        });
        System.out.println("Android protocol contracts: "+passed+" passed, "+failed+" failed");if(failed>0)System.exit(1);
    }
}
