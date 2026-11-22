package com.pipiphone.app;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONException;
import java.io.IOException;

/** Periodic delayed catch-up, including after the real-time service times out. */
public final class PhoneNotificationsJobService extends JobService {
    private volatile int runId;
    private Thread worker;

    @Override public boolean onStartJob(JobParameters params) {
        if (!PhoneNotifications.isEnabled(this) || PhoneNotificationsService.running) return false;
        int current = ++runId;
        String serverOrigin = PhoneNotifications.origin(this);
        long generation = PhoneNotifications.prefs(this).getLong("generation", 0);
        worker = new Thread(() -> {
            try {
                long revision = PhoneNotifications.sync(this, serverOrigin, generation, () -> runId == current);
                if (revision >= 0 && runId == current && !PhoneNotificationsService.running && PhoneNotifications.active(this, serverOrigin, generation)) PhoneNotifications.connectionStatus(this, "系统延迟检查已完成；下次检查时间由系统决定");
            } catch (PhoneNotifications.AuthenticationExpired | SecurityException error) {
                if (runId == current && PhoneNotifications.active(this, serverOrigin, generation)) PhoneNotifications.disable(this, "登录或通知权限已失效，请重新开启");
            } catch (IOException | JSONException error) {
                if (runId == current && !PhoneNotificationsService.running && PhoneNotifications.active(this, serverOrigin, generation)) PhoneNotifications.connectionStatus(this, "系统延迟检查暂未连接成功，将在系统下次检查时重试");
            }
            new Handler(Looper.getMainLooper()).post(() -> { if (current == runId) jobFinished(params, false); });
        }, "pipi-notification-catch-up");
        worker.start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        runId++;
        if (worker != null) worker.interrupt();
        return PhoneNotifications.isEnabled(this);
    }
}
