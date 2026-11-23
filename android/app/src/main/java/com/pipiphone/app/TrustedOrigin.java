package com.pipiphone.app;

import android.os.Build;
import android.net.Uri;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.util.Locale;

/** One configured server. HTTP is supported for literal IP addresses. */
final class TrustedOrigin {
    static final String DEVELOPMENT = "http://127.0.0.1:18766";
    final String value;
    private final URI uri;

    private TrustedOrigin(URI uri, String value) { this.uri = uri; this.value = value; }

    static TrustedOrigin parse(String input) {
        final URI parsed;
        String address = input.trim();
        boolean bare = !address.contains("://");
        try { parsed = new URI(bare ? "http://" + address : address); }
        catch (Exception error) { throw new IllegalArgumentException("请填写 HTTPS 网址或 HTTP IP 地址"); }
        String scheme = parsed.getScheme(), host = parsed.getHost(), path = parsed.getRawPath();
        if (scheme == null || host == null || parsed.getRawUserInfo() != null || parsed.getRawQuery() != null
                || parsed.getRawFragment() != null || (path != null && !path.isEmpty() && !path.equals("/"))
                || parsed.getRawAuthority().endsWith(":") || parsed.getPort() == 0 || parsed.getPort() > 65535)
            throw new IllegalArgumentException("只填写服务器地址，不包含路径、参数或登录信息");
        scheme = scheme.toLowerCase(Locale.ROOT);
        host = canonicalHost(host);
        boolean literal = host.startsWith("[") || ipv4(host);
        int port = parsed.getPort();
        // The public installer serves HTTPS on 443. Keep local and explicit legacy HTTP addresses usable.
        if (bare && literal && (port == 443 || port == -1 && !isLocalAddress(host))) scheme = "https";
        if (!scheme.equals("https") && !(scheme.equals("http") && literal))
            throw new IllegalArgumentException("域名请填写完整 HTTPS 网址；IP 地址支持 HTTP");
        if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
        String normalized = scheme + "://" + host + (port == -1 ? "" : ":" + port);
        return new TrustedOrigin(URI.create(normalized), normalized);
    }

    boolean owns(Uri candidate) {
        if (candidate == null) return false;
        try { return owns(new URI(candidate.toString())); }
        catch (Exception invalid) { return false; }
    }

    private boolean owns(URI candidate) {
        if (candidate.getRawUserInfo() != null || candidate.getHost() == null) return false;
        int port = candidate.getPort();
        if (("https".equalsIgnoreCase(candidate.getScheme()) && port == 443)
                || ("http".equalsIgnoreCase(candidate.getScheme()) && port == 80)) port = -1;
        return uri.getScheme().equalsIgnoreCase(candidate.getScheme())
                && uri.getHost().equals(canonicalHost(candidate.getHost())) && uri.getPort() == port;
    }

    /** Every native caller uses the same origin and keeps redirects disabled. */
    HttpURLConnection open(String path) throws IOException {
        URI target = uri.resolve(path);
        if (!owns(target)) throw new IOException("请求已离开当前服务器，已停止连接");
        HttpURLConnection connection = (HttpURLConnection)target.toURL().openConnection();
        connection.setInstanceFollowRedirects(false);
        return connection;
    }

    private static boolean isLocalAddress(String literal) {
        try {
            InetAddress ip = InetAddress.getByName(literal);
            byte[] bytes = ip.getAddress();
            boolean uniqueLocal = bytes.length == 16 && (bytes[0] & 0xfe) == 0xfc;
            return uniqueLocal || ip.isSiteLocalAddress() || ip.isLoopbackAddress() || ip.isLinkLocalAddress();
        } catch (java.net.UnknownHostException invalid) {
            throw new IllegalArgumentException("IP 地址格式不正确", invalid);
        }
    }

    private static boolean ipv4(String host) {
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String part : parts) {
            if (!part.matches("0|[1-9][0-9]{0,2}") || Integer.parseInt(part) > 255) return false;
        }
        return true;
    }

    private static String canonicalHost(String host) {
        host = host.toLowerCase(Locale.ROOT);
        if (!host.startsWith("[")) {
            if (host.matches("[0-9.]+") && !ipv4(host)) throw new IllegalArgumentException("IP 地址格式不正确");
            return host;
        }
        if (host.indexOf('%') >= 0) throw new IllegalArgumentException("IPv6 地址请去掉网络接口标记");
        final byte[] bytes;
        try { bytes = InetAddress.getByName(host.substring(1,host.length()-1)).getAddress(); }
        catch (IOException invalid) { throw new IllegalArgumentException("IPv6 地址格式不正确"); }
        // Java returns four bytes for IPv4-mapped IPv6; keep its IPv6 URL form.
        int[] groups = new int[8];
        if (bytes.length == 4) {
            groups[5] = 65535;
            groups[6] = (bytes[0] & 255) << 8 | bytes[1] & 255;
            groups[7] = (bytes[2] & 255) << 8 | bytes[3] & 255;
        } else for (int i=0; i<8; i++) groups[i] = (bytes[i*2] & 255) << 8 | bytes[i*2+1] & 255;
        int start = -1, length = 1;
        for (int i=0; i<8;) {
            if (groups[i] != 0) { i++; continue; }
            int end = i;
            while (end < 8 && groups[end] == 0) end++;
            if (end-i > length) { start=i; length=end-i; }
            i=end;
        }
        StringBuilder value = new StringBuilder("[");
        for (int i=0; i<8;) {
            if (i == start) { value.append("::"); i+=length; continue; }
            if (value.length()>1 && value.charAt(value.length()-1) != ':') value.append(':');
            value.append(Integer.toHexString(groups[i++]));
        }
        return value.append(']').toString();
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
