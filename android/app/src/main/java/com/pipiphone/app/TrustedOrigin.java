package com.pipiphone.app;

import android.os.Build;
import android.net.Uri;
import java.net.URI;
import java.util.Locale;

/** One configured server. Cleartext is restricted to an emulator's adb reverse. */
final class TrustedOrigin {
    static final String DEVELOPMENT = "http://127.0.0.1:18766";
    final String value;
    private final URI uri;

    private TrustedOrigin(URI uri, String value) { this.uri = uri; this.value = value; }

    static TrustedOrigin parse(String input) {
        final URI parsed;
        try { parsed = new URI(input.trim()); }
        catch (Exception error) { throw new IllegalArgumentException("请输入完整的 HTTPS 服务器地址"); }
        String scheme = parsed.getScheme(), host = parsed.getHost(), path = parsed.getRawPath();
        if (scheme == null || host == null || parsed.getRawUserInfo() != null || parsed.getRawQuery() != null
                || parsed.getRawFragment() != null || (path != null && !path.isEmpty() && !path.equals("/"))
                || parsed.getPort() == 0 || parsed.getPort() > 65535)
            throw new IllegalArgumentException("只填写服务器地址，例如 https://phone.example.com，不包含路径和登录信息");
        scheme = scheme.toLowerCase(Locale.ROOT);
        host = host.toLowerCase(Locale.ROOT);
        int port = parsed.getPort();
        if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
        String normalized = scheme + "://" + host + (port == -1 ? "" : ":" + port);
        if (!scheme.equals("https") && !(normalized.equals(DEVELOPMENT) && isEmulator()))
            throw new IllegalArgumentException("服务器需使用受信任的 HTTPS；本地 HTTP 仅供模拟器开发使用");
        return new TrustedOrigin(URI.create(normalized), normalized);
    }

    boolean owns(Uri candidate) {
        if (candidate == null || candidate.getUserInfo() != null) return false;
        int port = candidate.getPort();
        if (("https".equalsIgnoreCase(candidate.getScheme()) && port == 443)
                || ("http".equalsIgnoreCase(candidate.getScheme()) && port == 80)) port = -1;
        return uri.getScheme().equalsIgnoreCase(candidate.getScheme())
                && uri.getHost().equalsIgnoreCase(candidate.getHost()) && uri.getPort() == port;
    }

    boolean isAppPage(String url) {
        if (url == null) return false;
        Uri candidate = Uri.parse(url);
        String path = candidate.getPath();
        return owns(candidate) && (path == null || path.equals("") || path.equals("/") || path.equals("/index.html"));
    }

    static boolean isEmulator() {
        String markers = (Build.FINGERPRINT + " " + Build.MODEL + " " + Build.HARDWARE).toLowerCase(Locale.ROOT);
        return markers.contains("generic") || markers.contains("emulator") || markers.contains("sdk_gphone")
                || markers.contains("goldfish") || markers.contains("ranchu")
                || (Build.HARDWARE.equals("vivo") && Build.SUPPORTED_ABIS.length > 0
                    && Build.SUPPORTED_ABIS[0].equals("x86_64"));
    }
}
