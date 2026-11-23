// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;
import com.sun.net.httpserver.HttpServer;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/** Real local HTTP protocol checks. PackageManager stubs separately exercise the install policy. */
public final class OfficialUpdatesTest {
    private static final String COOKIE = "pipi_session=" + "a".repeat(64);
    private static final byte[] APK = "isolated APK bytes, not an installable package".getBytes(StandardCharsets.UTF_8);
    private static int passed;
    interface Checked { void run() throws Exception; }
    static void test(String name, Checked task) throws Exception {
        try { task.run(); passed++; }
        catch (Exception | AssertionError error) { throw new AssertionError(name,error); }
    }
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    static void rejected(String message, Checked task) throws Exception {
        try { task.run(); }
        catch (IOException error) { check(error.getMessage().contains(message)); return; }
        throw new AssertionError("Expected rejection: " + message);
    }
    static String hash(byte[] value) throws Exception {
        return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));
    }
    static JSONObject release() throws Exception {
        return new JSONObject().put("name","pipi-phone-android-0.1.4-5.apk").put("versionName","0.1.4")
                .put("versionCode",5).put("size",APK.length).put("sha256",hash(APK));
    }
    static OfficialUpdates.Transfer transfer() { return new OfficialUpdates.Transfer(); }
    static final class Fixture implements AutoCloseable, OfficialUpdates.SessionReader {
        final HttpServer server;
        final List<String> paths = new ArrayList<>(), cookies = new ArrayList<>();
        String origin, cookie = "extra=not-sent; " + COOKIE, metadata = new JSONObject().put("release",release()).toString();
        String location;
        int metadataStatus = 200, apkStatus = 200;
        boolean changeSession;
        byte[] apk = APK;
        Fixture() throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            origin = "http://127.0.0.1:" + server.getAddress().getPort();
            server.createContext("/",exchange -> {
                String route = exchange.getRequestURI().toString();
                paths.add(exchange.getRequestMethod() + " " + route); cookies.add(exchange.getRequestHeaders().getFirst("Cookie"));
                check(exchange.getRequestHeaders().getFirst("User-Agent").contains("PipiPhoneUpdater/3"));
                boolean latest = route.equals("/api/android-updates/latest");
                if (!latest) check(route.equals("/api/android-updates/apk/5"));
                if (location != null) exchange.getResponseHeaders().set("Location",location);
                if (changeSession) cookie = "pipi_session=" + "b".repeat(64);
                byte[] bytes = latest ? metadata.getBytes(StandardCharsets.UTF_8) : apk;
                exchange.sendResponseHeaders(latest ? metadataStatus : apkStatus,bytes.length);
                try (var out = exchange.getResponseBody()) { out.write(bytes); }
            });
            server.start();
        }
        OfficialUpdates client() throws Exception { return new OfficialUpdates(TrustedOrigin.parse(origin),cookie,this); }
        @Override public String currentOrigin() { return origin; }
        @Override public String currentCookie() { return cookie; }
        @Override public void close() { server.stop(0); }
    }
    static PackageInfo info(int code, String version, String name, String signature) {
        PackageInfo value = new PackageInfo(); value.versionCode = code; value.versionName = version; value.packageName = name;
        value.signatures = new Signature[]{new Signature(signature)};
        value.signingInfo = new SigningInfo(new Signature(signature));
        return value;
    }
    static final class Device extends Context {
        final File cache;
        PackageInfo installed = info(4,"0.1.3","com.pipiphone.app","same-signature");
        PackageInfo incoming = info(5,"0.1.4","com.pipiphone.app","same-signature");
        Device() throws Exception { cache = Files.createTempDirectory("pipi-apk-device-").toFile(); }
        @Override public File getCacheDir() { return cache; }
        @Override public String getPackageName() { return installed.packageName; }
        @Override public PackageManager getPackageManager() {
            return new PackageManager() {
                @Override public PackageInfo getPackageInfo(String name,int flags) { return query(installed, flags); }
                @Override public PackageInfo getPackageArchiveInfo(String file,int flags) {
                    // The Android 9/10 archive parser collects nothing without the legacy flag.
                    if ((Build.VERSION.SDK_INT == 28 || Build.VERSION.SDK_INT == 29) && (flags & GET_SIGNATURES) == 0)
                        return query(incoming, 0);
                    return query(incoming, flags);
                }
                private PackageInfo query(PackageInfo source, int flags) {
                    PackageInfo result = new PackageInfo();
                    result.packageName = source.packageName;
                    result.versionCode = source.versionCode;
                    result.versionName = source.versionName;
                    result.applicationInfo = source.applicationInfo;
                    if ((flags & GET_SIGNATURES) != 0) result.signatures = source.signatures;
                    if (Build.VERSION.SDK_INT >= 28 && (flags & GET_SIGNING_CERTIFICATES) != 0)
                        result.signingInfo = source.signingInfo;
                    return result;
                }
            };
        }
        File contents(byte[] bytes) throws Exception { File file = new File(cache,"candidate.apk"); Files.write(file.toPath(),bytes); return file; }
    }

    public static void main(String[] args) throws Exception {
        test("metadata only gets current server with scoped login",() -> {
            try (Fixture f = new Fixture()) {
                OfficialUpdates.Release found = f.client().latest(transfer());
                check(found.versionCode == 5 && found.versionName.equals("0.1.4") && found.sha256.equals(hash(APK)));
                check(f.paths.equals(List.of("GET /api/android-updates/latest")) && f.cookies.equals(List.of(COOKIE)));
                check(OfficialUpdates.restored(found.saved().toString()).versionCode == 5);
            }
        });
        test("no Android release is a normal empty response",() -> {
            try (Fixture f = new Fixture()) { f.metadata = "{\"release\":null}"; check(f.client().latest(transfer()) == null); }
        });
        test("old server gets website upgrade message",() -> {
            try (Fixture f = new Fixture()) { f.metadataStatus = 404; rejected("请先更新网页程序",() -> f.client().latest(transfer())); }
        });
        test("login failures remain explicit",() -> {
            for (int status : new int[]{401,403}) try (Fixture f = new Fixture()) {
                f.metadataStatus = status; rejected("登录已失效",() -> f.client().latest(transfer()));
            }
        });
        test("no redirects can receive credentials",() -> {
            AtomicInteger foreignRequests = new AtomicInteger();
            HttpServer foreign = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            foreign.createContext("/",e -> { foreignRequests.incrementAndGet(); e.sendResponseHeaders(200,-1); e.close(); }); foreign.start();
            try (Fixture f = new Fixture()) {
                f.metadataStatus = 302; f.location = "http://127.0.0.1:" + foreign.getAddress().getPort() + "/";
                rejected("重定向",() -> f.client().latest(transfer())); check(foreignRequests.get() == 0);
            } finally { foreign.stop(0); }
        });
        test("server switch before request sends nothing",() -> {
            try (Fixture f = new Fixture()) {
                OfficialUpdates client = f.client(); f.origin = "https://different.example.test";
                rejected("已改变",() -> client.latest(transfer())); check(f.paths.isEmpty());
            }
        });
        test("session change during response discards metadata",() -> {
            try (Fixture f = new Fixture()) { f.changeSession = true; rejected("已改变",() -> f.client().latest(transfer())); }
        });
        test("missing session cannot start a request",() -> {
            try (Fixture f = new Fixture()) { f.cookie = "other=1"; rejected("先登录",f::client); check(f.paths.isEmpty()); }
        });
        test("metadata rejects mismatched versions and fractional sizes",() -> {
            for (JSONObject value : List.of(release().put("versionName","0.1.9"),release().put("versionCode",6),
                    release().put("versionCode","5"),release().put("size",1.5),release().put("sha256","invalid"))) {
                try { OfficialUpdates.restored(value.toString()); throw new AssertionError("Accepted invalid release"); }
                catch (IOException expected) {}
            }
        });
        test("download uses fixed version route and verifies before saving",() -> {
            try (Fixture f = new Fixture()) {
                OfficialUpdates client = f.client(); OfficialUpdates.Release found = client.latest(transfer()); Device device = new Device();
                client.download(device,found,transfer(),(count,size) -> check(count <= size));
                check(java.util.Arrays.equals(Files.readAllBytes(UpdateApkProvider.apk(device).toPath()),APK));
                check(f.paths.equals(List.of("GET /api/android-updates/latest","GET /api/android-updates/apk/5")));
                check(f.cookies.stream().allMatch(COOKIE::equals));
            }
        });
        test("APK redirects are rejected",() -> {
            try (Fixture f = new Fixture()) {
                OfficialUpdates client = f.client(); OfficialUpdates.Release found = client.latest(transfer()); Device device = new Device();
                f.apkStatus = 307; f.location = "/api/android-updates/latest";
                rejected("重定向",() -> client.download(device,found,transfer(),(count,size) -> {}));
                check(f.paths.size() == 2 && !UpdateApkProvider.apk(device).exists());
            }
        });
        test("truncated or changed APK cannot become installable cache",() -> {
            try (Fixture f = new Fixture()) {
                OfficialUpdates client = f.client(); OfficialUpdates.Release found = client.latest(transfer()); Device device = new Device();
                f.apk = "short".getBytes(StandardCharsets.UTF_8);
                rejected("大小",() -> client.download(device,found,transfer(),(count,size) -> {}));
                f.apk = APK.clone(); f.apk[0] ^= 1;
                rejected("SHA-256",() -> client.download(device,found,transfer(),(count,size) -> {}));
                check(!UpdateApkProvider.apk(device).exists());
            }
        });
        test("changed server release asks the caller to recheck metadata",() -> {
            try (Fixture f = new Fixture()) {
                OfficialUpdates client = f.client(); OfficialUpdates.Release found = client.latest(transfer()); Device device = new Device();
                f.apkStatus = 409;
                try { client.download(device,found,transfer(),(count,size) -> {}); throw new AssertionError("Accepted stale version"); }
                catch (OfficialUpdates.ReleaseChangedException expected) { check(expected.getMessage().contains("重新检查")); }
                check(!UpdateApkProvider.apk(device).exists());
            }
        });
        test("session change during download cannot publish cache",() -> {
            try (Fixture f = new Fixture()) {
                OfficialUpdates client = f.client(); OfficialUpdates.Release found = client.latest(transfer()); Device device = new Device();
                rejected("已改变",() -> client.download(device,found,transfer(),(count,size) -> f.cookie = "pipi_session=" + "c".repeat(64)));
                check(!UpdateApkProvider.apk(device).exists());
            }
        });
        test("cancelled transfers send no request",() -> {
            try (Fixture f = new Fixture()) {
                OfficialUpdates.Transfer transfer = transfer(); transfer.cancel();
                rejected("已取消",() -> f.client().latest(transfer)); check(f.paths.isEmpty());
            }
        });
        for (int sdk : new int[]{28, 29, 23, 30, 35}) {
            test("official package with the same current signer on API " + sdk, () -> {
                int previous = Build.VERSION.SDK_INT;
                Build.VERSION.SDK_INT = sdk;
                try {
                    Device device = new Device();
                    OfficialUpdates.verify(device, device.contents(APK), OfficialUpdates.restored(release().toString()), transfer());
                } finally { Build.VERSION.SDK_INT = previous; }
            });
        }
        test("package mismatch and different current signing key prevent installation",() -> {
            Device device = new Device(); File file = device.contents(APK); OfficialUpdates.Release found = OfficialUpdates.restored(release().toString());
            device.incoming.packageName = "com.someone.else";
            rejected("名称不匹配",() -> OfficialUpdates.verify(device,file,found,transfer()));
            device.incoming.packageName = device.installed.packageName;
            // The legacy arrays share the oldest certificate. Current signing keys differ.
            device.installed.signingInfo = new SigningInfo(new Signature("installed-key"));
            device.incoming.signingInfo = new SigningInfo(new Signature("other-key"));
            rejected("签名与当前 App 不一致",() -> OfficialUpdates.verify(device,file,found,transfer()));
        });
        test("a multi-signer update must present the same current signer set", () -> {
            Device device = new Device(); File file = device.contents(APK);
            OfficialUpdates.Release found = OfficialUpdates.restored(release().toString());
            Signature first = new Signature("first"), second = new Signature("second");
            device.installed.signingInfo = new SigningInfo(first, second);
            device.incoming.signingInfo = new SigningInfo(second, first);
            OfficialUpdates.verify(device, file, found, transfer());
            device.incoming.signingInfo = new SigningInfo(first);
            rejected("签名与当前 App 不一致", () -> OfficialUpdates.verify(device, file, found, transfer()));
        });
        test("incomplete current signer data cannot fall back to the oldest certificate", () -> {
            Device device = new Device(); File file = device.contents(APK);
            OfficialUpdates.Release found = OfficialUpdates.restored(release().toString());
            device.incoming.signingInfo = null;
            rejected("没有读到完整的签名", () -> OfficialUpdates.verify(device, file, found, transfer()));
            device.incoming.signingInfo = new SigningInfo();
            rejected("没有读到完整的签名", () -> OfficialUpdates.verify(device, file, found, transfer()));
            device.incoming.signingInfo = device.installed.signingInfo;
            device.installed.signingInfo = null;
            rejected("没有读到完整的签名", () -> OfficialUpdates.verify(device, file, found, transfer()));
        });
        test("Android 6 checks the legacy certificate and rejects an unsigned archive", () -> {
            int previous = Build.VERSION.SDK_INT;
            Build.VERSION.SDK_INT = 23;
            try {
                Device device = new Device(); File file = device.contents(APK);
                OfficialUpdates.Release found = OfficialUpdates.restored(release().toString());
                device.incoming.signatures = new Signature[]{new Signature("other-key")};
                rejected("签名与当前 App 不一致", () -> OfficialUpdates.verify(device, file, found, transfer()));
                device.incoming.signatures = null;
                rejected("没有读到完整的签名", () -> OfficialUpdates.verify(device, file, found, transfer()));
            } finally { Build.VERSION.SDK_INT = previous; }
        });
        test("downgrade metadata mismatch and incompatible Android prevent installation",() -> {
            Device device = new Device(); File file = device.contents(APK); OfficialUpdates.Release found = OfficialUpdates.restored(release().toString());
            device.incoming.versionName = "0.1.5"; rejected("版本与发布记录不一致",() -> OfficialUpdates.verify(device,file,found,transfer()));
            device.incoming.versionName = "0.1.4"; device.installed.versionCode = 5;
            rejected("只能安装版本编号更高",() -> OfficialUpdates.verify(device,file,found,transfer()));
            device.installed.versionCode = 4; device.incoming.applicationInfo.minSdkVersion = 36;
            rejected("更高的 Android",() -> OfficialUpdates.verify(device,file,found,transfer()));
        });
        System.out.println("Android relay/update checks: " + passed + " passed");
    }
}
