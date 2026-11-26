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

/** The local shell starts independently; server protocol gates its business APIs. */
final class AssetBundle {
    private final Context context;
    private final TrustedOrigin origin;
    private final String hash;
    volatile boolean enabled;
    private volatile String microphoneToken;
    private volatile String compatibilityState = "checking";

    AssetBundle(Context context, SharedPreferences prefs, TrustedOrigin origin) throws Exception {
        this.context = context; this.origin = origin;
        try (InputStream stream = context.getAssets().open("phone/bundle.json")) {
            hash = new JSONObject(readUtf8(stream, 4096)).getString("sha256");
        }
        if (!hash.matches("[a-f0-9]{64}")) throw new IOException("APK 内置页面清单无效");
        // An old verified hash must never authorize a new protocol or an offline
        // write. Shared-page persistence is scoped by the frontend session.
        enabled = true;
    }

    boolean requiresServerPage() { return "server-page".equals(compatibilityState); }
    void useServerMode() { enabled = false; microphoneToken = null; }
    boolean allowsBusiness() {
        String state = compatibilityState;
        return "protocol-v1".equals(state) || "legacy-audited".equals(state);
    }
    String compatibilityJson() {
        String state = compatibilityState;
        return "{\"state\":\"" + state + "\",\"legacyAllowed\":" + "legacy-audited".equals(state) + "}";
    }
    String queryCompatibility(String token, String command, String requestUrl, String pageUrl, String nativeToken) {
        return queryCompatibility(token, command, requestUrl, pageUrl, nativeToken, null);
    }
    String queryCompatibility(String token, String command, String requestUrl, String pageUrl, String nativeToken, Runnable retryVerification) {
        boolean issuedToken = token != null && !token.isEmpty()
                && (ownsMicrophoneToken(token) || token.equals(nativeToken));
        if (!"get".equals(command) || !origin.isAppPage(requestUrl) || !origin.isAppPage(pageUrl) || !issuedToken)
            return "{\"state\":\"unsupported\",\"legacyAllowed\":false}";
        if (retryVerification != null && beginReverification()) retryVerification.run();
        return compatibilityJson();
    }
    synchronized boolean beginReverification() {
        if (!"offline".equals(compatibilityState) && !"unsupported".equals(compatibilityState)) return false;
        compatibilityState = "checking";
        return true;
    }

    /** Only the native HTTP result can grant the readonly legacy permission. */
    String verify() {
        compatibilityState = "checking";
        HttpURLConnection connection = null;
        try {
            connection = origin.open("/api/android-shell-manifest");
            connection.setConnectTimeout(2000); connection.setReadTimeout(3000);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status == 404 || status == 405) {
                compatibilityState = "server-page";
                return "旧服务器未提供协议清单，使用其服务器页面";
            }
            if (status != 200) {
                compatibilityState = status >= 500 ? "offline" : "unsupported";
                return "暂时无法核对服务器协议，请重试连接";
            }
            JSONObject manifest;
            try (InputStream stream = connection.getInputStream()) {
                manifest = new JSONObject(readUtf8(stream, 16384));
            }
            // A declared but incompatible protocol cannot use the legacy path,
            // even when its resource hash happens to equal the local bundle.
            if (manifest.has("clientProtocol")) {
                if (!BundleCompatibility.supportsClientProtocol(manifest.opt("clientProtocol"))) {
                    compatibilityState = "unsupported";
                    return "服务器协议不兼容，请更新 App 或服务器";
                }
                compatibilityState = "protocol-v1";
                return "使用 App 内置页面，服务器协议已兼容";
            }
            String remote = manifest.getString("sha256");
            if (!remote.matches("[a-f0-9]{64}")) {
                compatibilityState = "unsupported";
                return "服务器旧版清单无效，请更新服务器";
            }
            if (BundleCompatibility.accepts(hash, remote)) {
                compatibilityState = "legacy-audited";
                return "使用已核对兼容的旧版服务器";
            }
            compatibilityState = "server-page";
            return "旧服务器尚未与此内置页面核对，使用其服务器页面";
        } catch (JSONException invalidManifest) {
            compatibilityState = "unsupported";
            return "服务器协议清单无效，请更新服务器或重试";
        } catch (IOException offline) {
            compatibilityState = "offline";
            return "离线：页面可启动，服务器业务暂不可用";
        } finally { if (connection != null) connection.disconnect(); }
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
                html = html.replace("<head>", "<head><meta name=\"pipi-client-compat\" content=\"1\"><meta name=\"pipi-recording\" content=\"" + token + "\">")
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
