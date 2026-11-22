package com.pipiphone.app;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Pure Java signing boundary for this app's immutable notification intents. */
final class CompatNotificationBinding {
    private static final Pattern SESSION = Pattern.compile("(?:^|;\\s*)pipi_session=([a-f0-9]{64})(?:;|$)");
    private CompatNotificationBinding() {}

    static String newKey() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return hex(bytes);
    }

    static String newInstance() { return UUID.randomUUID().toString(); }

    static String cookieDigest(String cookie) {
        if (cookie == null) return "";
        Matcher session = SESSION.matcher(cookie);
        if (!session.find()) return "";
        try { return hex(MessageDigest.getInstance("SHA-256").digest(session.group(1).getBytes(StandardCharsets.UTF_8))); }
        catch (GeneralSecurityException error) { throw new IllegalStateException("设备缺少 SHA-256", error); }
    }

    static String identity(String instance, long generation) {
        return "pipi-phone://notification/" + instance + "/" + generation + "/";
    }

    static String sign(String key, String instance, long generation, String origin, String cookieDigest, String roleId) {
        String payload = instance + "\n" + generation + "\n" + origin + "\n" + cookieDigest + "\n" + roleId;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return hex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException error) { throw new IllegalStateException("设备缺少 HMAC-SHA256", error); }
    }

    static boolean matches(boolean enabled, String origin, String registeredOrigin, long generation,
            String instance, String key, String storedCookieDigest, String currentCookieDigest,
            String roleId, String messageOrigin, String messageInstance, String proof) {
        if (!enabled || roleId == null || roleId.isEmpty() || roleId.length() > 200 || key.isEmpty()
                || instance.isEmpty() || storedCookieDigest.isEmpty() || currentCookieDigest.isEmpty()
                || !origin.equals(registeredOrigin) || !origin.equals(messageOrigin) || !instance.equals(messageInstance)
                || !storedCookieDigest.equals(currentCookieDigest) || proof == null || proof.length() != 64) return false;
        String expected = sign(key, instance, generation, origin, currentCookieDigest, roleId);
        return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), proof.getBytes(StandardCharsets.UTF_8));
    }

    private static String hex(byte[] bytes) {
        char[] digits = "0123456789abcdef".toCharArray(), result = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) { result[i * 2] = digits[(bytes[i] & 255) >>> 4]; result[i * 2 + 1] = digits[bytes[i] & 15]; }
        return new String(result);
    }
}
