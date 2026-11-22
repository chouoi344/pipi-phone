package com.pipiphone.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;

/** User-visible, time-limited real-time SSE connection. Never starts at boot. */
public final class PhoneNotificationsService extends Service {
    static volatile boolean running;
    private volatile boolean stopping;
    private volatile HttpURLConnection stream;
    private Thread worker;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            PhoneNotifications.disable(this, "已关闭");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!PhoneNotifications.isEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;
        PhoneNotifications.channels(this);
        Notification notification = connectionNotification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(PhoneNotifications.CONNECTION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(PhoneNotifications.CONNECTION_ID, notification);
        running = true;
        stopping = false;
        String serverOrigin = PhoneNotifications.origin(this);
        long generation = PhoneNotifications.prefs(this).getLong("generation", 0);
        worker = new Thread(() -> receive(serverOrigin, generation), "pipi-notification-connection");
        worker.start();
        return START_NOT_STICKY;
    }

    private Notification connectionNotification() {
        PendingIntent stop = PendingIntent.getService(this, 0,
                new Intent(this, PhoneNotificationsService.class).setAction("stop"),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return PhoneNotifications.builder(this, PhoneNotifications.CONNECTION_CHANNEL)
                .setGroup("pipi.connection")
                .setSmallIcon(android.R.drawable.sym_action_chat).setContentTitle("小手机后台连接")
                .setContentText("正在后台接收好友消息")
                .setPriority(Notification.PRIORITY_LOW).setOnlyAlertOnce(true)
                .setContentIntent(PhoneNotifications.openApp(this, null)).setOngoing(true)
                .setShowWhen(false).addAction(new Notification.Action.Builder(null, "停止后台通知", stop).build()).build();
    }

    private void updateStatus(String serverOrigin, long generation, String text) {
        synchronized (PhoneNotifications.STATE_LOCK) {
            if (stopping || !PhoneNotifications.active(this, serverOrigin, generation)) return;
            PhoneNotifications.connectionStatus(this, text);
        }
    }

    private void receive(String serverOrigin, long generation) {
        int reconnectSeconds = 2;
        while (!stopping && PhoneNotifications.active(this, serverOrigin, generation)) {
            try {
                long revision = PhoneNotifications.sync(this, serverOrigin, generation, () -> !stopping);
                if (revision < 0) break;
                String sessionCookie = PhoneNotifications.cookie(serverOrigin);
                if (sessionCookie == null) throw new PhoneNotifications.AuthenticationExpired();
                HttpURLConnection connection = PhoneNotifications.connect(serverOrigin, "/api/events", sessionCookie, "text/event-stream");
                stream = connection;
                int code = connection.getResponseCode();
                if (code == 401) throw new PhoneNotifications.AuthenticationExpired();
                if (code != 200) throw new IOException("HTTP " + code);
                if (stopping || !PhoneNotifications.active(this, serverOrigin, generation)) break;
                updateStatus(serverOrigin, generation, "实时连接中；系统另有延迟补收");
                reconnectSeconds = 2;
                try (BufferedReader input = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String event = "", data = "", line;
                    while (!stopping && (line = input.readLine()) != null) {
                        if (line.length() > 8192) throw new IOException("通知事件过大");
                        if (line.startsWith("event:")) event = line.substring(6).trim();
                        else if (line.startsWith("data:")) data = line.substring(5).trim();
                        else if (line.isEmpty()) {
                            if ("revision".equals(event) && new JSONObject(data).getLong("revision") != revision) {
                                revision = PhoneNotifications.sync(this, serverOrigin, generation, () -> !stopping);
                                if (revision < 0) break;
                            }
                            event = ""; data = "";
                        }
                    }
                } finally {
                    connection.disconnect();
                    stream = null;
                }
            } catch (PhoneNotifications.AuthenticationExpired | SecurityException error) {
                if (PhoneNotifications.active(this, serverOrigin, generation)) PhoneNotifications.disable(this, "登录或通知权限已失效，请重新开启");
                break;
            } catch (IOException | JSONException error) {
                if (!stopping && PhoneNotifications.active(this, serverOrigin, generation)) {
                    updateStatus(serverOrigin, generation, "连接中断，正在重试；系统另有延迟检查");
                }
            } finally {
                HttpURLConnection connection = stream;
                if (connection != null) connection.disconnect();
                stream = null;
            }
            if (stopping || !PhoneNotifications.active(this, serverOrigin, generation)) break;
            try { Thread.sleep(reconnectSeconds * 1000L); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); break; }
            reconnectSeconds = Math.min(reconnectSeconds * 2, 60);
        }
        stopSelf();
    }

    @android.annotation.TargetApi(35)
    @Override public void onTimeout(int startId, int fgsType) {
        stopping = true;
        PhoneNotifications.connectionStatus(this, "系统已结束实时连接；仍会在联网时延迟检查。打开应用可恢复实时连接");
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        stopping = true;
        running = false;
        HttpURLConnection connection = stream;
        if (connection != null) connection.disconnect();
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
