// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

import android.net.Uri;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.InputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import org.json.JSONObject;

/** Actual production parsing, login and native connection policy on isolated sockets. */
public final class TrustedOriginTest {
    static final String COOKIE = "pipi_session=" + "a".repeat(64);
    static int passed;
    interface Checked { void run() throws Exception; }
    static void test(String name, Checked run) throws Exception {
        try { run.run(); passed++; }
        catch (Exception | AssertionError failure) { throw new AssertionError(name, failure); }
    }
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    static void normalized(String input, String expected) { check(TrustedOrigin.parse(input).value.equals(expected)); }
    static void invalid(String input) {
        try { TrustedOrigin.parse(input); throw new AssertionError("Accepted " + input); }
        catch (IllegalArgumentException expected) {}
    }
    static void failure(String field, Checked run) throws Exception {
        try { run.run(); throw new AssertionError("Expected login failure"); }
        catch (ServerLogin.Failure expected) { check(expected.field.equals(field)); }
    }
    static final class LoginServer implements AutoCloseable {
        final HttpServer server;
        final String origin;
        final List<String> passwords = new ArrayList<>(), origins = new ArrayList<>();
        int status = 200;
        String redirect;
        LoginServer(String host) throws Exception {
            server = HttpServer.create(new InetSocketAddress(host,0),0);
            origin = "http://" + (host.contains(":") ? "["+host+"]" : host) + ":" + server.getAddress().getPort();
            server.createContext("/api/login", exchange -> {
                check(exchange.getRequestMethod().equals("POST"));
                String body = new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);
                passwords.add(new JSONObject(body).getString("password"));
                origins.add(exchange.getRequestHeaders().getFirst("Origin"));
                if (redirect != null) exchange.getResponseHeaders().set("Location",redirect);
                if (status == 200) exchange.getResponseHeaders().set("Set-Cookie",COOKIE+"; HttpOnly; Path=/; SameSite=Strict");
                exchange.sendResponseHeaders(status,-1); exchange.close();
            });
            server.start();
        }
        @Override public void close() { server.stop(0); }
    }

    public static void main(String[] args) throws Exception {
        test("HTTP IPv4, bare browser addresses, root slash and HTTPS stay usable on a real-device build", () -> {
            for (String input : List.of("http://203.0.113.23:18766", "203.0.113.23:18766", " 203.0.113.23:18766/ "))
                normalized(input,"http://203.0.113.23:18766");
            normalized("HTTP://203.0.113.23:80/","http://203.0.113.23");
            normalized("203.0.113.23/", "https://203.0.113.23");
            normalized("203.0.113.23:443", "https://203.0.113.23");
            normalized("[2001:db8::1]/", "https://[2001:db8::1]");
            normalized("203.0.113.23:80/", "http://203.0.113.23");
            normalized("192.168.1.10/", "http://192.168.1.10");
            normalized("[::1]/", "http://[::1]");
            normalized("[fd00::20]/", "http://[fd00::20]");
            normalized("HTTPS://Phone.Example.COM:443/","https://phone.example.com");
            normalized("https://phone.example.com:8443/","https://phone.example.com:8443");
            normalized(TrustedOrigin.DEVELOPMENT,TrustedOrigin.DEVELOPMENT);
        });
        test("IPv6 spelling matches the browser origin including mapped literals", () -> {
            normalized("[2001:0DB8:0000:0:0:0:0:1]:18766/","http://[2001:db8::1]:18766");
            normalized("https://[2001:db8:1:2:3:4:5:6]:443/","https://[2001:db8:1:2:3:4:5:6]");
            normalized("http://[::]/","http://[::]");
            normalized("http://[::ffff:192.0.2.1]:80/","http://[::ffff:c000:201]");
            check(TrustedOrigin.parse("[2001:db8::1]:18766").owns(Uri.parse("http://[2001:db8:0:0:0:0:0:1]:18766/api/status")));
        });
        test("ambiguous addresses, credentials, paths and invalid ports are rejected", () -> {
            for (String input : List.of("", "phone.example.com", "http://phone.example.com", "ftp://203.0.113.23", "javascript:alert(1)",
                    "http://user:secret@203.0.113.23:18766", "http://203.0.113.23/app", "203.0.113.23:18766/?x=1", "203.0.113.23:18766/#login",
                    "http://203.0.113.23:0", "203.0.113.23:65536", "203.0.113.23:-1", "203.0.113.23:",
                    "127.1:18766", "2130706433:18766", "0177.0.0.1:18766", "0x7f000001:18766", "256.0.0.1:18766",
                    "2001:db8::1", "[fe80::1%25eth0]:18766", "[2001:db8:::1]:18766", "http://203.0.113.23\\@attacker.test")) invalid(input);
        });
        test("trusted server identity includes scheme, IP, port and no user information", () -> {
            TrustedOrigin origin = TrustedOrigin.parse("203.0.113.23:18766");
            check(origin.owns(Uri.parse("http://203.0.113.23:18766/api/status?x=1")));
            for (String target : List.of("http://203.0.113.24:18766/", "http://203.0.113.23:18767/", "https://203.0.113.23:18766/",
                    "http://user@203.0.113.23:18766/", "http://203.0.113.23.attacker.test:18766/", "file:///index.html"))
                check(!origin.owns(Uri.parse(target)));
            check(TrustedOrigin.parse("https://phone.example.com").owns(Uri.parse("https://PHONE.example.com:443/api/status")));
            check(origin.isAppPage("http://203.0.113.23:18766/?android_entry=chats"));
            check(!origin.isAppPage("http://203.0.113.23:18766/api/status"));
        });
        test("login sends the original password and exact Origin over HTTP IPv4 and IPv6", () -> {
            for (String host : List.of("127.0.0.1", "::1")) try (LoginServer server = new LoginServer(host)) {
                TrustedOrigin origin = TrustedOrigin.parse(server.origin.replace("http://",""));
                ServerLogin.Session session = ServerLogin.login(origin,"隔离密码!123");
                check(session.installed("other=1; " + COOKIE));
                check(server.passwords.equals(List.of("隔离密码!123")) && server.origins.equals(List.of(origin.value)));
                server.status=401;
                failure("password", () -> ServerLogin.login(origin,"wrong-password"));
            }
        });
        test("login redirects never copy passwords or cookies to another port", () -> {
            AtomicInteger outside = new AtomicInteger();
            HttpServer foreign = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            foreign.createContext("/", exchange -> { outside.incrementAndGet(); exchange.sendResponseHeaders(200,-1); exchange.close(); });
            foreign.start();
            try (LoginServer server = new LoginServer("127.0.0.1")) {
                server.redirect="http://127.0.0.1:"+foreign.getAddress().getPort()+"/steal";
                for (int status : new int[]{301,302,303,307,308}) {
                    server.status=status;
                    failure("address", () -> ServerLogin.login(TrustedOrigin.parse(server.origin),"isolated-secret"));
                }
                check(outside.get()==0 && server.passwords.size()==5);
                TrustedOrigin origin = TrustedOrigin.parse(server.origin);
                for (String target : List.of(server.redirect,"//127.0.0.1:"+foreign.getAddress().getPort()+"/steal")) {
                    try { origin.open(target); throw new AssertionError("Opened a foreign origin"); }
                    catch (IOException expected) {}
                }
                HttpURLConnection connection = origin.open("/api/login");
                check(!connection.getInstanceFollowRedirects()); connection.disconnect();
                check(outside.get()==0);
            } finally { foreign.stop(0); }
        });
        test("allowing HTTP preserves HTTPS certificate checks before sending the password", () -> {
            char[] password = "isolated-test".toCharArray();
            KeyStore keys = KeyStore.getInstance("PKCS12");
            try (InputStream in = Files.newInputStream(Path.of(args[0]))) { keys.load(in,password); }
            KeyManagerFactory managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            managers.init(keys,password);
            SSLContext ssl = SSLContext.getInstance("TLS"); ssl.init(managers.getKeyManagers(),null,null);
            AtomicInteger received = new AtomicInteger();
            HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.setHttpsConfigurator(new HttpsConfigurator(ssl));
            server.createContext("/",exchange -> { received.incrementAndGet(); exchange.sendResponseHeaders(200,-1); exchange.close(); });
            server.start();
            try {
                TrustedOrigin origin = TrustedOrigin.parse("https://127.0.0.1:"+server.getAddress().getPort());
                failure("address", () -> ServerLogin.login(origin,"never-received")); check(received.get()==0);
            } finally { server.stop(0); }
        });
        System.out.println("PASS trusted origin/login policy: " + passed + " isolated cases (real HTTP IPv4/IPv6 and untrusted HTTPS)");
    }
}
