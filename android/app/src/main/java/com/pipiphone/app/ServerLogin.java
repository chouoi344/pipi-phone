// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import javax.net.ssl.SSLException;

/** Passwords only travel to this exact server; the returned cookie stays HttpOnly. */
final class ServerLogin {
    static final class Failure extends Exception {
        final String field;
        Failure(String field, String message) { super(message); this.field = field; }
    }

    static final class Session {
        final String setCookie;
        private final String requestCookie;
        Session(String value) { setCookie = value; requestCookie = value.split(";", 2)[0]; }
        boolean installed(String cookies) {
            if (cookies == null) return false;
            for (String cookie : cookies.split(";")) if (requestCookie.equals(cookie.trim())) return true;
            return false;
        }
    }

    private ServerLogin() {}

    static Session login(TrustedOrigin origin, String password) throws Failure {
        if (password.isEmpty()) throw new Failure("password", "请先输入小手机密码。");
        if (password.length() > 256) throw new Failure("password", "密码太长了，请检查后再试。");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection)new URL(origin.value + "/api/login").openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Origin", origin.value);
            byte[] body = new JSONObject().put("password", password).toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            finally { java.util.Arrays.fill(body, (byte)0); }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400)
                throw new Failure("address", "这个网址会跳转到其他地址。请填写小手机最终打开的网址。");
            if (status == 401) throw new Failure("password", "密码不对，请再试一次。");
            if (status == 429) throw new Failure("form", "试的次数太多了，请过一会儿再试。");
            if (status != 200) {
                String code = errorCode(connection);
                if ("SETUP_REQUIRED".equals(code))
                    throw new Failure("form", "这部小手机还没设置密码，请先用浏览器打开这个网址，设置好密码后再来登录。");
                if (status == 404) throw new Failure("address", "这个网址没有找到小手机，请检查网址是否填对。");
                throw new Failure("form", "这部小手机暂时无法登录，请稍后再试。（" + status + "）");
            }
            // Successful login includes the complete history. Only its response
            // headers are needed here, so no history is copied into native memory.
            for (Map.Entry<String,List<String>> entry : connection.getHeaderFields().entrySet()) {
                if (!"Set-Cookie".equalsIgnoreCase(entry.getKey())) continue;
                for (String cookie : entry.getValue()) {
                    if (validSessionCookie(cookie)) return new Session(cookie);
                }
            }
            throw new Failure("form", "服务器没有提供有效的登录凭据，请检查小手机服务后重试。");
        } catch (SSLException unsafe) {
            throw new Failure("address", "这个网址的安全证书有问题，请修好证书后再连接。");
        } catch (UnknownHostException missing) {
            throw new Failure("address", "找不到这个网址，请检查网址和网络。");
        } catch (SocketTimeoutException timeout) {
            throw new Failure("form", "连接花的时间太久了，请检查网络后再试。");
        } catch (IOException offline) {
            throw new Failure("form", "暂时连不上这部小手机，请检查网址和网络后再试。");
        } catch (JSONException invalid) {
            throw new IllegalStateException("Unable to encode login request", invalid);
        } finally { if (connection != null) connection.disconnect(); }
    }

    private static boolean validSessionCookie(String cookie) {
        if (cookie.length() > 4096 || cookie.indexOf('\r') >= 0 || cookie.indexOf('\n') >= 0) return false;
        String[] parts = cookie.split(";");
        if (!parts[0].matches("pipi_session=[a-f0-9]{64}")) return false;
        boolean httpOnly = false, rootPath = false;
        for (int i=1; i<parts.length; i++) {
            String attribute = parts[i].trim();
            if (attribute.equalsIgnoreCase("HttpOnly")) httpOnly = true;
            if (attribute.equalsIgnoreCase("Path=/")) rootPath = true;
            if (attribute.regionMatches(true,0,"Domain=",0,7)) return false;
        }
        return httpOnly && rootPath;
    }

    private static String errorCode(HttpURLConnection connection) throws IOException {
        InputStream stream = connection.getErrorStream();
        if (stream == null) return "";
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 8192) return "";
                output.write(buffer,0,count);
            }
            try { return new JSONObject(output.toString("UTF-8")).optString("code"); }
            catch (JSONException nonJson) { return ""; }
        }
    }
}
