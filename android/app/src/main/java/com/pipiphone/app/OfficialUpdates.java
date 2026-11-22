package com.pipiphone.app;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Downloads Android updates only through the server captured from the current login. */
final class OfficialUpdates {
    static final class ReleaseChangedException extends IOException {
        ReleaseChangedException() { super("安卓安装包版本已变化，请重新检查后下载"); }
    }
    interface SessionReader {
        String currentOrigin();
        String currentCookie();
    }
    private static final long MAX_APK_BYTES = 512L * 1024 * 1024;
    private static final Pattern APK_NAME = Pattern.compile("pipi-phone-android-([0-9]+(?:\\.[0-9]+){1,3})-([1-9][0-9]{0,9})\\.apk");
    private final String origin, cookie;
    private final SessionReader reader;

    OfficialUpdates(TrustedOrigin origin, String cookie, SessionReader reader) throws IOException {
        this.origin = origin.value; this.cookie = sessionCookie(cookie); this.reader = reader;
        assertCurrentSession();
    }

    String sessionId() { return CompatNotificationBinding.cookieDigest(cookie); }

    void assertCurrentSession() throws IOException {
        if (!origin.equals(reader.currentOrigin()) || !cookie.equals(sessionCookie(reader.currentCookie())))
            throw new IOException("服务器或登录会话已改变，请重新检查安卓更新");
    }

    private static String sessionCookie(String cookie) throws IOException {
        if (cookie != null) for (String entry : cookie.split(";")) {
            String value = entry.trim();
            if (value.matches("pipi_session=[a-f0-9]{64}")) return value;
        }
        throw new IOException("当前没有有效的服务器登录，请先登录小手机");
    }

    static final class Transfer {
        volatile boolean cancelled;
        volatile HttpURLConnection connection;
        void cancel() { cancelled = true; HttpURLConnection active = connection; if (active != null) active.disconnect(); }
        void check() throws InterruptedIOException { if (cancelled) throw new InterruptedIOException("已取消"); }
    }

    static final class Release {
        final String name, versionName, sha256;
        final long versionCode, size;
        Release(String name, String versionName, long versionCode, String sha256, long size) {
            this.name = name; this.versionName = versionName; this.versionCode = versionCode;
            this.sha256 = sha256; this.size = size;
        }
        JSONObject saved() throws Exception {
            return new JSONObject().put("name",name).put("versionName",versionName).put("versionCode",versionCode)
                    .put("size",size).put("sha256",sha256);
        }
    }

    Release latest(Transfer transfer) throws Exception {
        HttpURLConnection connection = open("/api/android-updates/latest",true,transfer);
        try (InputStream in = connection.getInputStream(); ByteArrayOutputStream body = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) {
                transfer.check(); assertCurrentSession();
                if (body.size() + count > 128 * 1024) throw new IOException("安卓更新资料过大");
                body.write(buffer,0,count);
            }
            assertCurrentSession(); transfer.check();
            JSONObject response = new JSONObject(new String(body.toByteArray(),StandardCharsets.UTF_8));
            if (!response.has("release")) throw new IOException("服务器没有返回安卓更新资料，请先更新网页程序");
            return response.isNull("release") ? null : parseRelease(response.getJSONObject("release"));
        } finally { connection.disconnect(); transfer.connection = null; }
    }

    static Release restored(String json) throws Exception { return parseRelease(new JSONObject(json)); }

    private static Release parseRelease(JSONObject value) throws Exception {
        String name = value.getString("name"), version = value.getString("versionName");
        Matcher match = APK_NAME.matcher(name);
        if (!match.matches() || !match.group(1).equals(version)) throw new IOException("安卓安装包名称与版本不一致");
        Object codeInput = value.get("versionCode"), sizeInput = value.get("size");
        if (!(codeInput instanceof Number) || !(sizeInput instanceof Number)) throw new IOException("安卓更新资料中的版本或大小不正确");
        long code = value.getLong("versionCode"), size = value.getLong("size");
        if (code <= 0 || code > Integer.MAX_VALUE || ((Number)codeInput).doubleValue() != code || code != Long.parseLong(match.group(2)))
            throw new IOException("安卓版本编号不正确");
        if (size <= 0 || size > MAX_APK_BYTES || ((Number)sizeInput).doubleValue() != size) throw new IOException("安卓安装包大小不正确");
        String digest = value.getString("sha256");
        if (!digest.matches("[0-9a-fA-F]{64}")) throw new IOException("发布的安卓安装包缺少有效 SHA-256 校验值");
        return new Release(name,version,code,digest.toLowerCase(Locale.ROOT),size);
    }

    private HttpURLConnection open(String path, boolean metadata, Transfer transfer) throws Exception {
        transfer.check(); assertCurrentSession();
        HttpURLConnection connection = (HttpURLConnection)new URL(origin + path).openConnection();
        transfer.connection = connection;
        try {
            connection.setInstanceFollowRedirects(false); connection.setRequestMethod("GET");
            connection.setConnectTimeout(15000); connection.setReadTimeout(metadata ? 60000 : 15 * 60 * 1000);
            connection.setRequestProperty("User-Agent","PipiPhoneAndroid/1.0 PipiPhoneUpdater/3 PipiPhoneApp/" + BuildConfig.VERSION_NAME);
            connection.setRequestProperty("Accept",metadata ? "application/json" : "application/vnd.android.package-archive");
            connection.setRequestProperty("Accept-Encoding","identity");
            connection.setRequestProperty("Cookie",cookie);
            int status = connection.getResponseCode();
            assertCurrentSession(); transfer.check();
            if (status >= 300 && status < 400) throw new IOException("安卓更新接口发生重定向，已停止请求");
            if (status == 401 || status == 403) throw new IOException("服务器登录已失效，请重新进入小手机后再试");
            if (status == 409) throw new ReleaseChangedException();
            if (status == 404 || status == 405 || status == 501) throw new IOException("当前服务器尚不支持安卓更新，请先更新网页程序");
            if (status != 200) throw new IOException("安卓更新接口返回 " + status + "，请稍后重试");
            return connection;
        } catch (Exception error) {
            connection.disconnect(); transfer.connection = null; throw error;
        }
    }

    interface Progress { void received(long count, long size); }

    void download(Context context, Release release, Transfer transfer, Progress progress) throws Exception {
        File apk = UpdateApkProvider.apk(context), part = new File(apk.getParentFile(), "download.part.apk");
        if (!apk.getParentFile().isDirectory() && !apk.getParentFile().mkdirs()) throw new IOException("无法创建更新缓存目录");
        HttpURLConnection connection = open("/api/android-updates/apk/" + release.versionCode,false,transfer);
        try {
            long declared = connection.getContentLength();
            if (declared >= 0 && declared != release.size) throw new IOException("安装包大小与发布记录不一致");
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[32768]; int count; long total = 0;
                while ((count = in.read(buffer)) != -1) {
                    transfer.check(); assertCurrentSession(); total += count;
                    if (total > release.size) throw new IOException("安装包超过发布记录中的大小");
                    out.write(buffer,0,count); progress.received(total,release.size);
                }
                if (total != release.size) throw new IOException("安装包没有下载完整");
            }
            verify(context,part,release,transfer);
            assertCurrentSession(); transfer.check();
            if (apk.exists() && !apk.delete()) throw new IOException("无法替换旧的更新缓存");
            if (!part.renameTo(apk)) throw new IOException("无法保存已校验的安装包");
        } finally {
            connection.disconnect(); transfer.connection = null;
            if (part.exists() && !part.delete()) android.util.Log.w("PipiUpdate","Could not clear incomplete APK");
        }
    }

    @SuppressWarnings("deprecation") static long code(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation") static void verify(Context context, File file, Release release, Transfer transfer) throws Exception {
        if (file.length() != release.size) throw new IOException("安装包大小校验失败，请重新下载");
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[32768]; int count;
            while ((count = in.read(buffer)) != -1) { transfer.check(); hash.update(buffer,0,count); }
        }
        StringBuilder hex = new StringBuilder(64);
        for (byte value : hash.digest()) hex.append(String.format(Locale.ROOT,"%02x",value & 255));
        if (!hex.toString().equals(release.sha256)) throw new IOException("安装包 SHA-256 校验失败，请重新下载");
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo installed = manager.getPackageInfo(context.getPackageName(),flags);
        PackageInfo update = manager.getPackageArchiveInfo(file.getAbsolutePath(),flags);
        if (update == null || !installed.packageName.equals(update.packageName)) throw new IOException("安装包的应用名称不匹配");
        if (code(update) != release.versionCode || !release.versionName.equals(update.versionName)) throw new IOException("安装包版本与发布记录不一致");
        if (code(update) <= code(installed)) throw new IOException("只能安装版本编号更高的更新");
        if (Build.VERSION.SDK_INT >= 24 && update.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT)
            throw new IOException("此更新需要更高的 Android 系统版本");
        Signature[] current = Build.VERSION.SDK_INT >= 28 && installed.signingInfo != null ? installed.signingInfo.getApkContentsSigners() : installed.signatures;
        Signature[] incoming = Build.VERSION.SDK_INT >= 28 && update.signingInfo != null ? update.signingInfo.getApkContentsSigners() : update.signatures;
        if (current == null || incoming == null || current.length == 0 || current.length != incoming.length)
            throw new IOException("安装包签名无法核对，已停止安装");
        String[] left = new String[current.length], right = new String[incoming.length];
        for (int i = 0; i < left.length; i++) { left[i] = current[i].toCharsString(); right[i] = incoming[i].toCharsString(); }
        Arrays.sort(left); Arrays.sort(right);
        if (!Arrays.equals(left,right)) throw new IOException("安装包签名与当前 App 不一致，已停止安装");
        transfer.check();
    }
}
