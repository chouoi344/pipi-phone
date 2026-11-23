package com.pipiphone.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** User-visible, time-limited real-time SSE connection. Never starts at boot. */
public final class PhoneNotificationsService extends Service {
    static volatile boolean running;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> new Thread(task, "pipi-notification-connection"));
    private volatile ConnectionRun current;

    private final class ConnectionRun {
        final String origin, cookie;
        final long generation;
        int startId;
        volatile boolean cancelled;
        volatile boolean finished;
        volatile HttpURLConnection stream;
        Thread thread;
        ConnectionRun(String origin, long generation, String cookie, int startId) {
            this.origin=origin; this.generation=generation; this.cookie=cookie; this.startId=startId;
        }
        boolean active() {
            return !cancelled && current == this && PhoneNotifications.active(PhoneNotificationsService.this,origin,generation)
                    && cookie.equals(PhoneNotifications.cookie(origin));
        }
        boolean matches(String origin, long generation, String cookie) {
            return this.origin.equals(origin) && this.generation == generation && this.cookie.equals(cookie)
                    && !cancelled && !finished;
        }
        void cancel() {
            synchronized (this) {
                if (cancelled) return;
                cancelled=true;
                if (thread != null) thread.interrupt();
            }
            HttpURLConnection connection=stream;
            if (connection != null) new Thread(connection::disconnect,"pipi-notification-close").start();
        }
    }

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
        String serverOrigin = PhoneNotifications.origin(this);
        long generation = PhoneNotifications.prefs(this).getLong("generation", 0);
        String cookie = PhoneNotifications.cookie(serverOrigin);
        if (cookie == null) {
            PhoneNotifications.disable(this, "登录已退出，后台通知已关闭");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (current != null && current.matches(serverOrigin,generation,cookie)) {
            current.startId=startId;
            return START_NOT_STICKY;
        }
        if (current != null) current.cancel();
        PhoneNotifications.channels(this);
        Notification notification = connectionNotification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(PhoneNotifications.CONNECTION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        else startForeground(PhoneNotifications.CONNECTION_ID, notification);
        running = true;
        ConnectionRun next = new ConnectionRun(serverOrigin,generation,cookie,startId);
        current=next;
        worker.execute(() -> {
            synchronized (next) { next.thread=Thread.currentThread(); }
            try { receive(next); }
            finally {
                synchronized (next) { next.thread=null; next.finished=true; }
                handler.post(() -> { if (current == next) stopSelfResult(next.startId); });
            }
        });
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

    private void updateStatus(ConnectionRun run, String text) {
        synchronized (PhoneNotifications.STATE_LOCK) {
            if (!run.active()) return;
            PhoneNotifications.connectionStatus(this, text);
        }
    }

    private void receive(ConnectionRun run) {
        int reconnectSeconds = 2;
        while (run.active()) {
            try {
                long revision = PhoneNotifications.sync(this, run.origin, run.generation, run::active);
                if (revision < 0 || !run.active()) break;
                HttpURLConnection connection = PhoneNotifications.connect(run.origin, "/api/events", run.cookie, "text/event-stream");
                run.stream = connection;
                if (!run.active()) break;
                int code = connection.getResponseCode();
                if (code == 401) throw new PhoneNotifications.AuthenticationExpired();
                if (code != 200) throw new IOException("HTTP " + code);
                if (!run.active()) break;
                updateStatus(run, "实时连接中；系统另有延迟补收");
                reconnectSeconds = 2;
                try (BufferedReader input = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String event = "", data = "", line;
                    while (run.active() && (line = input.readLine()) != null) {
                        if (line.length() > 8192) throw new IOException("通知事件过大");
                        if (line.startsWith("event:")) event = line.substring(6).trim();
                        else if (line.startsWith("data:")) data = line.substring(5).trim();
                        else if (line.isEmpty()) {
                            if ("revision".equals(event) && new JSONObject(data).getLong("revision") != revision) {
                                revision = PhoneNotifications.sync(this, run.origin, run.generation, run::active);
                                if (revision < 0) break;
                            }
                            event = ""; data = "";
                        }
                    }
                } finally {
                    connection.disconnect();
                    run.stream = null;
                }
            } catch (PhoneNotifications.AuthenticationExpired | SecurityException error) {
                synchronized (PhoneNotifications.STATE_LOCK) {
                    if (run.active()) PhoneNotifications.disable(this, "登录或通知权限已失效，请重新开启");
                }
                break;
            } catch (IOException | JSONException error) {
                updateStatus(run, "连接中断，正在重试；系统另有延迟检查");
            } finally {
                HttpURLConnection connection = run.stream;
                if (connection != null) connection.disconnect();
                run.stream = null;
            }
            if (!run.active()) break;
            try { Thread.sleep(reconnectSeconds * 1000L); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); break; }
            reconnectSeconds = Math.min(reconnectSeconds * 2, 60);
        }
    }

    @android.annotation.TargetApi(35)
    @Override public void onTimeout(int startId, int fgsType) {
        if (current != null) current.cancel();
        PhoneNotifications.connectionStatus(this, "系统已结束实时连接；仍会在联网时延迟检查。打开应用可恢复实时连接");
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        ConnectionRun previous=current; current=null;
        running = false;
        if (previous != null) previous.cancel();
        worker.shutdownNow();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
