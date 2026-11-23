package com.pipiphone.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.webkit.CookieManager;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.HashMap;
import java.util.Map;

/** Explicitly enabled self-hosted notification transport; no push vendor SDK. */
public final class PhoneNotifications {
    static final String PREFS = "pipi_phone_notifications";
    static final String CONNECTION_CHANNEL = "pipi_background_connection";
    static final String MESSAGE_CHANNEL = "pipi_chat_messages_v2";
    static final int CONNECTION_ID = 2001;
    static final int JOB_ID = 2002;
    static final Object SYNC_LOCK = new Object();
    static final Object STATE_LOCK = new Object();
    private static volatile boolean visible;
    interface RunningCheck { boolean isRunning(); }

    private PhoneNotifications() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String origin(Context context) {
        return context.getSharedPreferences("pipi_phone_android", Context.MODE_PRIVATE)
                .getString("server_origin", "http://127.0.0.1:18766");
    }

    private static boolean allowedOrigin(String value) {
        try { TrustedOrigin.parse(value); return true; }
        catch (IllegalArgumentException invalid) { return false; }
    }

    static String cookie(String serverOrigin) {
        String value = CookieManager.getInstance().getCookie(serverOrigin);
        return value != null && value.matches("(?:.*;\\s*)?pipi_session=[a-f0-9]{64}(?:;.*)?") ? value : null;
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean("enabled", false);
    }

    public static boolean preference(Context context) {
        SharedPreferences settings = prefs(context);
        return settings.getBoolean("user_enabled", settings.getBoolean("enabled", true));
    }

    public static void rememberPreference(Context context, boolean enabled) {
        prefs(context).edit().putBoolean("user_enabled", enabled).apply();
    }

    public static String status(Context context) {
        return prefs(context).getString("status", "已关闭");
    }

    public static boolean setEnabled(Activity activity, boolean enabled) {
        rememberPreference(activity, enabled);
        if (!enabled) {
            disable(activity, "已关闭");
            return true;
        }
        String serverOrigin = origin(activity);
        if (!allowedOrigin(serverOrigin)) {
            Toast.makeText(activity, "请先填写有效的小手机服务器地址", Toast.LENGTH_LONG).show();
            return false;
        }
        if (!canNotify(activity)) {
            Toast.makeText(activity, "请先允许小手机发送通知", Toast.LENGTH_LONG).show();
            return false;
        }
        String sessionCookie = cookie(serverOrigin);
        if (sessionCookie == null) {
            Toast.makeText(activity, "请先在小手机内登录服务器", Toast.LENGTH_LONG).show();
            return false;
        }
        synchronized (STATE_LOCK) {
            SharedPreferences settings = prefs(activity);
            settings.edit().putBoolean("enabled", true).putString("enabled_origin", serverOrigin)
                    .putLong("generation", settings.getLong("generation", 0) + 1)
                    .putString("click_key", CompatNotificationBinding.newKey()).putString("click_instance", CompatNotificationBinding.newInstance())
                    .putString("click_cookie_digest", CompatNotificationBinding.cookieDigest(sessionCookie))
                    .remove("cursor").putString("status", "正在建立后台连接").apply();
        }
        channels(activity);
        schedule(activity);
        startRealtime(activity);
        return true;
    }

    public static void setVisible(Context context, boolean isVisible) {
        synchronized (STATE_LOCK) {
            visible = isVisible;
            if (isVisible) clearMessages(context);
            if (isVisible && isEnabled(context)) prepareClickBinding(context);
        }
        if (isVisible) {
            if (isEnabled(context) && !PhoneNotificationsService.running) {
                onPageFinished(context);
                if (isEnabled(context)) {
                    schedule(context);
                    startRealtime(context);
                }
            }
        }
    }

    public static void onServerChanged(Context context) {
        disable(context, "服务器已切换，请登录后重新开启后台通知");
    }

    public static void onPageFinished(Context context) {
        if (isEnabled(context) && (!origin(context).equals(prefs(context).getString("enabled_origin", ""))
                || cookie(origin(context)) == null)) {
            disable(context, "登录已退出，后台通知已关闭");
        }
    }

    static void disable(Context context, String reason) {
        synchronized (STATE_LOCK) {
            SharedPreferences settings = prefs(context);
            settings.edit().putBoolean("enabled", false).putString("status", reason)
                    .putLong("generation", settings.getLong("generation", 0) + 1)
                    .remove("cursor").remove("enabled_origin").remove("click_key").remove("click_instance").remove("click_cookie_digest").apply();
            context.getSystemService(JobScheduler.class).cancel(JOB_ID);
            context.stopService(new Intent(context, PhoneNotificationsService.class));
            clearMessages(context);
        }
        FcmTransport.disable(context);
    }

    static boolean active(Context context, String serverOrigin, long generation) {
        SharedPreferences settings = prefs(context);
        return settings.getBoolean("enabled", false) && settings.getLong("generation", 0) == generation
                && !FcmTransport.active(context)
                && serverOrigin.equals(origin(context))
                && serverOrigin.equals(settings.getString("enabled_origin", ""));
    }

    static boolean canNotify(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED)
                && (Build.VERSION.SDK_INT < 24 || context.getSystemService(NotificationManager.class).areNotificationsEnabled());
    }

    static void connectionStatus(Context context, String text) {
        prefs(context).edit().putString("status", text).apply();
    }

    private static void schedule(Context context) {
        if(FcmTransport.active(context))return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, PhoneNotificationsJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L).setPersisted(true).build();
        if (context.getSystemService(JobScheduler.class).schedule(job) != JobScheduler.RESULT_SUCCESS) {
            connectionStatus(context, "系统暂未接受延迟检查；打开应用后可重新开启");
        }
    }

    private static void startRealtime(Context context) {
        if(FcmTransport.active(context))return;
        try {
            Intent intent = new Intent(context, PhoneNotificationsService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (IllegalStateException | SecurityException error) {
            // Background-start restrictions are recoverable: the persisted job
            // remains enabled, and the actual mode is visible in native settings.
            connectionStatus(context, "实时连接未获系统允许；已启用系统延迟检查");
        }
    }

    static void channels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel connection = new NotificationChannel(CONNECTION_CHANNEL, "后台连接状态", NotificationManager.IMPORTANCE_LOW);
        connection.setDescription("显示用户主动开启的后台连接，可随时停止");
        connection.setShowBadge(false);
        NotificationChannel messages = new NotificationChannel(MESSAGE_CHANNEL, "好友新消息", NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("只提示新消息数量，不显示聊天正文");
        messages.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(connection);
        manager.createNotificationChannel(messages);
    }

    static void useFcm(Context context, String cursor) {
        synchronized(STATE_LOCK){
            SharedPreferences settings=prefs(context);
            settings.edit().putString("cursor",cursor).putString("status","FCM 系统推送已注册")
                    .putLong("generation",settings.getLong("generation",0)+1).apply();
            context.getSystemService(JobScheduler.class).cancel(JOB_ID);
            context.stopService(new Intent(context,PhoneNotificationsService.class));
        }
    }

    static void resumeCompatible(Context context) {
        if(isEnabled(context)){schedule(context);startRealtime(context);}
    }

    static Notification.Builder builder(Context context, String channel) {
        return Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, channel) : new Notification.Builder(context);
    }

    static PendingIntent openApp(Context context, String roleId) {
        synchronized (STATE_LOCK) {
        prepareClickBinding(context);
        SharedPreferences settings = prefs(context);
        String instance = settings.getString("click_instance", ""), key = settings.getString("click_key", "");
        long generation = settings.getLong("generation", 0);
        Intent intent = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("notificationOrigin", origin(context));
        if (roleId != null) {
            intent.putExtra("roleId", roleId).putExtra("notificationInstance", instance);
            if (!key.isEmpty()) intent.putExtra("notificationProof", CompatNotificationBinding.sign(key, instance, generation,
                    origin(context), settings.getString("click_cookie_digest", ""), roleId));
        }
        // Include the enabled instance in PendingIntent identity: updating a new
        // notification must never revive a handle issued before disable/relogin.
        intent.setData(Uri.parse(CompatNotificationBinding.identity(instance, generation) + Uri.encode(roleId == null ? "connection" : roleId)));
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
    }

    private static void prepareClickBinding(Context context) {
        if (!isEnabled(context)) return;
        SharedPreferences settings = prefs(context);
        String digest = CompatNotificationBinding.cookieDigest(cookie(origin(context)));
        if (digest.isEmpty()) return;
        if (settings.getString("click_key", "").isEmpty() || settings.getString("click_instance", "").isEmpty()
                || !digest.equals(settings.getString("click_cookie_digest", ""))) {
            // Also migrates an already-enabled older APK without requiring its
            // user to toggle notifications. Unsigned old intents remain invalid.
            settings.edit().putString("click_key", CompatNotificationBinding.newKey())
                    .putString("click_instance", CompatNotificationBinding.newInstance()).putString("click_cookie_digest", digest).apply();
        }
    }

    static boolean acceptIntent(Context context, Intent intent) {
        synchronized (STATE_LOCK) {
            SharedPreferences settings = prefs(context);
            return CompatNotificationBinding.matches(isEnabled(context) && !FcmTransport.active(context), origin(context),
                    settings.getString("enabled_origin", ""), settings.getLong("generation", 0),
                    settings.getString("click_instance", ""), settings.getString("click_key", ""),
                    settings.getString("click_cookie_digest", ""), CompatNotificationBinding.cookieDigest(cookie(origin(context))),
                    intent.getStringExtra("roleId"), intent.getStringExtra("notificationOrigin"),
                    intent.getStringExtra("notificationInstance"), intent.getStringExtra("notificationProof"));
        }
    }

    static void clearMessages(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        for (StatusBarNotification notification : manager.getActiveNotifications()) {
            if (notification.getTag() != null && notification.getTag().startsWith("chat:")) {
                manager.cancel(notification.getTag(), notification.getId());
            }
        }
    }

    static HttpURLConnection connect(String serverOrigin, String path, String sessionCookie, String accept) throws IOException {
        HttpURLConnection connection = TrustedOrigin.parse(serverOrigin).open(path);
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(40000);
        connection.setRequestProperty("Cookie", sessionCookie);
        connection.setRequestProperty("Accept", accept);
        return connection;
    }

    static final class AuthenticationExpired extends IOException {}

    /** FGS and scheduled jobs share the cursor and the same serialization lock. */
    static long sync(Context context, String serverOrigin, long generation, RunningCheck stillRunning) throws IOException, JSONException {
        synchronized (SYNC_LOCK) {
            if (!stillRunning.isRunning() || !active(context, serverOrigin, generation)) return -1;
            if (!canNotify(context)) throw new AuthenticationExpired();
            String sessionCookie = cookie(serverOrigin);
            if (sessionCookie == null) throw new AuthenticationExpired();
            String cursor = prefs(context).getString("cursor", "");
            String path = "/api/android/notifications" + (cursor.isEmpty() ? "" : "?cursor=" + Uri.encode(cursor));
            HttpURLConnection connection = connect(serverOrigin, path, sessionCookie, "application/json");
            connection.setReadTimeout(10000);
            JSONObject result;
            try {
                int code = connection.getResponseCode();
                if (code == 401) throw new AuthenticationExpired();
                if (code != 200) throw new IOException("HTTP " + code);
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > 1024 * 1024) throw new IOException("通知响应过大");
                        output.write(buffer, 0, count);
                    }
                    result = new JSONObject(output.toString("UTF-8"));
                }
            } finally {
                connection.disconnect();
            }
            long revision = result.getLong("revision");
            String nextCursor = result.getString("cursor");
            JSONArray roles = result.getJSONArray("conversations"), messages = result.getJSONArray("messages");
            Map<String, JSONObject> conversations = new HashMap<>();
            for (int i = 0; i < roles.length(); i++) {
                JSONObject role = roles.getJSONObject(i);
                role.getString("name"); role.getBoolean("muted"); role.getInt("unread");
                conversations.put(role.getString("id"), role);
            }
            Map<String, Long> incoming = new HashMap<>();
            for (int i = 0; i < messages.length(); i++) {
                JSONObject message = messages.getJSONObject(i);
                message.getString("id"); message.getLong("createdAt");
                String roleId = message.getString("roleId");
                Long previous = incoming.get(roleId);
                incoming.put(roleId, Math.max(previous == null ? 0L : previous, message.getLong("expiresAt")));
            }
            synchronized (STATE_LOCK) {
            if (!stillRunning.isRunning() || !active(context, serverOrigin, generation)) return -1;
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            for (StatusBarNotification existing : manager.getActiveNotifications()) {
                String tag = existing.getTag();
                if (tag == null || !tag.startsWith("chat:")) continue;
                JSONObject role = conversations.get(tag.substring(5));
                if (visible || role == null || role.getBoolean("muted") || role.getInt("unread") == 0) manager.cancel(tag, existing.getId());
            }
            if (!visible) {
                for (Map.Entry<String, Long> entry : incoming.entrySet()) {
                    JSONObject role = conversations.get(entry.getKey());
                    long remaining = entry.getValue() - System.currentTimeMillis();
                    if (role == null || role.getBoolean("muted") || role.getInt("unread") == 0 || remaining <= 0) continue;
                    Notification publicVersion = builder(context, MESSAGE_CHANNEL)
                            .setSmallIcon(android.R.drawable.sym_action_chat).setContentTitle("小手机")
                            .setContentText("收到好友新消息").build();
                    Notification.Builder notification = builder(context, MESSAGE_CHANNEL)
                            .setGroup("pipi.friend." + entry.getKey())
                            .setSmallIcon(android.R.drawable.sym_action_chat).setContentTitle(role.getString("name"))
                            .setContentText("有 " + role.getInt("unread") + " 条未读消息")
                            .setNumber(role.getInt("unread")).setCategory(Notification.CATEGORY_MESSAGE)
                            .setVisibility(Notification.VISIBILITY_PRIVATE).setPublicVersion(publicVersion)
                            .setContentIntent(openApp(context, entry.getKey())).setAutoCancel(true)
                            .setOnlyAlertOnce(true);
                    if (Build.VERSION.SDK_INT >= 26) notification.setTimeoutAfter(remaining);
                    else notification.setDefaults(Notification.DEFAULT_ALL).setPriority(Notification.PRIORITY_HIGH);
                    manager.notify("chat:" + entry.getKey(), 1, notification.build());
                }
            }
            prefs(context).edit().putString("cursor", nextCursor).apply();
            return revision;
            }
        }
    }
}
