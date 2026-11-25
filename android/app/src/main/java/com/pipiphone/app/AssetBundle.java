package com.pipiphone.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import org.json.JSONObject;
import org.json.JSONException;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/** Local static files require a whole-bundle match or an exact audited replacement. */
final class AssetBundle {
    private final Context context;
    private final SharedPreferences prefs;
    private final TrustedOrigin origin;
    private final String hash;
    private final boolean cachedMatch;
    volatile boolean enabled;
    private volatile String microphoneToken;
    private volatile boolean verifiedMatch, serverChanged;

    AssetBundle(Context context, SharedPreferences prefs, TrustedOrigin origin) throws Exception {
        this.context = context; this.prefs = prefs; this.origin = origin;
        try (InputStream stream = context.getAssets().open("phone/bundle.json")) {
            hash = new JSONObject(readUtf8(stream, 4096)).getString("sha256");
        }
        if (!hash.matches("[a-f0-9]{64}")) throw new IOException("APK 内置页面清单无效");
        cachedMatch = origin.value.equals(prefs.getString("verified_origin", ""))
                && hash.equals(prefs.getString("verified_bundle", ""));
        enabled = cachedMatch;
    }

    boolean hasVerifiedCache() { return cachedMatch; }
    boolean serverChanged() { return serverChanged; }
    void useVerifiedMode() { enabled = verifiedMatch; }

    /** Offline startup can reuse a prior match, scoped to this exact origin and APK. */
    String verify() {
        HttpURLConnection connection = null;
        try {
            connection = origin.open("/api/android-shell-manifest");
            connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
            connection.setRequestProperty("Accept", "application/json");
            if (connection.getResponseCode() != 200) {
                invalidate(); return cachedMatch ? "服务器未提供版本清单，下次连接使用服务器资源"
                        : "服务器未提供版本清单，使用服务器资源";
            }
            String remote;
            try (InputStream stream = connection.getInputStream()) {
                remote = new JSONObject(readUtf8(stream, 4096)).getString("sha256");
            }
            verifiedMatch = BundleCompatibility.accepts(hash, remote); serverChanged = !verifiedMatch;
            prefs.edit().putString("verified_origin", verifiedMatch ? origin.value : "")
                    .putString("verified_bundle", verifiedMatch ? hash : "").apply();
            return verifiedMatch ? (hash.equals(remote) ? "使用同版本本地页面" : "使用 App 内置的兼容页面") : cachedMatch
                    ? "服务器页面已更新，下次连接使用服务器资源" : "服务器页面已更新，使用服务器资源";
        } catch (JSONException invalidManifest) {
            invalidate(); return cachedMatch ? "服务器版本清单无效，下次连接使用服务器资源"
                    : "服务器版本清单无效，使用服务器资源";
        } catch (IOException offline) {
            verifiedMatch = cachedMatch;
            return cachedMatch ? "离线：使用上次核对的本地页面" : "未核对本地版本，使用服务器页面";
        } finally { if (connection != null) connection.disconnect(); }
    }

    private void invalidate() {
        verifiedMatch=false; serverChanged=true;
        prefs.edit().remove("verified_origin").remove("verified_bundle").apply();
    }

    WebResourceResponse intercept(WebResourceRequest request) {
        if (request.isForMainFrame()) microphoneToken = null;
        Uri uri = request.getUrl();
        String scheme = uri.getScheme();
        if ("file".equalsIgnoreCase(scheme) || "content".equalsIgnoreCase(scheme)) return blocked();
        if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && !origin.owns(uri))
            return blocked();
        if (!enabled || !request.getMethod().equals("GET") || !origin.owns(uri)) return null;
        String path = uri.getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        if (path.contains("..") || path.contains("\\") || path.contains("//") || path.indexOf('\0') >= 0
                || path.equals("/bundle.json") || path.startsWith("/api/") || path.startsWith("/media/")) return null;
        try {
            InputStream stream = context.getAssets().open("phone" + path);
            boolean localDocument = request.isForMainFrame() && path.equals("/index.html");
            String scriptPolicy = "'self'";
            if (localDocument) {
                String token = UUID.randomUUID().toString();
                String html;
                try (InputStream source = stream) { html = readUtf8(source, 256 * 1024); }
                html = html.replace("<head>", "<head><meta name=\"pipi-recording\" content=\"" + token + "\">")
                        .replace("<script ", "<script nonce=\"" + token + "\" ");
                stream = new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8));
                microphoneToken = token;
                scriptPolicy = "'nonce-" + token + "'";
            }
            String type = mime(path);
            Map<String,String> headers = new HashMap<>();
            headers.put("Cache-Control", localDocument ? "no-store" : "no-cache"); headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "default-src 'self'; script-src " + scriptPolicy + "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'");
            return new WebResourceResponse(type, isText(type) ? "UTF-8" : null, 200, "OK", headers, stream);
        } catch (IOException absent) {
            if (path.equals("/index.html") || path.endsWith(".js")) return blocked();
            return null;
        }
    }

    boolean ownsMicrophoneToken(String token) {
        return enabled && token.equals(microphoneToken);
    }

    static String readUtf8(InputStream stream, int maximum) throws IOException {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        byte[] buffer = new byte[2048]; int count;
        while ((count = stream.read(buffer)) != -1) {
            if (result.size() + count > maximum) throw new IOException("服务器响应过大");
            result.write(buffer, 0, count);
        }
        return result.toString("UTF-8");
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", new HashMap<>(),
                new ByteArrayInputStream("Blocked outside configured server".getBytes(StandardCharsets.UTF_8)));
    }

    private static boolean isText(String type) { return type.startsWith("text/") || type.contains("javascript") || type.contains("json") || type.contains("svg"); }
    private static String mime(String path) {
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "html": return "text/html";
            case "css": return "text/css";
            case "js": case "mjs": return "application/javascript";
            case "json": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "avif": return "image/avif";
            case "ico": return "image/x-icon";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            case "mp3": return "audio/mpeg";
            case "ogg": return "audio/ogg";
            case "wav": return "audio/wav";
            case "mp4": return "video/mp4";
            default: return "application/octet-stream";
        }
    }
}
