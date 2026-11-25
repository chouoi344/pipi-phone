package com.pipiphone.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.IOException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Android-only updater. Website updates remain in the website's separate workflow. */
final class AppUpdater {
    interface Host extends OfficialUpdates.SessionReader {
        boolean trustedPage();
        void checkpoint(Runnable completed);
    }
    private enum AppState { CHECKING, CURRENT, UNAVAILABLE, AVAILABLE, DOWNLOADING, VERIFYING, READY, PERMISSION, INSTALLING, DONE, FAILED }
    private static final int ALLOW_SOURCE = 1701, INSTALL_APK = 1702;
    // Old combined-update journals are deliberately never read or replayed.
    private static final String JOURNAL = "android_update_v3", VISIBLE = "android_update_visible_v3";
    private final Activity activity;
    private final Host host;
    private final SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService appWorker = Executors.newSingleThreadExecutor();
    private OfficialUpdates source;
    private OfficialUpdates.Transfer appTransfer;
    private OfficialUpdates.Release release;
    private AlertDialog dialog;
    private TextView status;
    private ProgressBar progress;
    private AppState appState = AppState.UNAVAILABLE;
    private String appMessage = "", appOrigin = "", appSession = "";
    private int appGeneration, downloadPercent;
    private boolean foreground, confirmed, waitingForSource, continueAfterSource, restoreVisible, userClosed;

    AppUpdater(Activity activity, Host host) {
        this.activity = activity; this.host = host;
        prefs = activity.getSharedPreferences("pipi_phone_android",Activity.MODE_PRIVATE);
    }

    void show() {
        if (dialog != null && dialog.isShowing()) return;
        createDialog();
        if (confirmed && unfinished()) resume();
        else checkApp();
    }

    private void createDialog() {
        userClosed = false;
        LinearLayout content = new LinearLayout(activity); content.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24); content.setPadding(pad,dp(14),pad,dp(10));
        status = new TextView(activity); status.setTextSize(15); status.setTextColor(0xff252932);
        status.setLineSpacing(0, 1.35f);
        content.addView(status,new LinearLayout.LayoutParams(-1,-2));
        progress = new ProgressBar(activity,null,android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        ColorStateList accent = ColorStateList.valueOf(Color.rgb(7, 193, 96));
        progress.setProgressTintList(accent);
        progress.setIndeterminateTintList(accent);
        LinearLayout.LayoutParams bar = new LinearLayout.LayoutParams(-1,dp(5)); bar.topMargin = dp(16);
        content.addView(progress,bar);
        dialog = new AlertDialog.Builder(activity).setTitle("更新安卓版").setView(content)
                .setNegativeButton("关闭",null).setPositiveButton("更新安卓版",null).create();
        dialog.setOnDismissListener(ignored -> {
            dialog = null; userClosed = true; restoreVisible = false; waitingForSource = false; continueAfterSource = false;
            cancelApp();
            if (appState == AppState.DOWNLOADING || appState == AppState.VERIFYING) {
                appState = release == null ? AppState.UNAVAILABLE : AppState.AVAILABLE;
                appMessage = "本次下载已取消，可以稍后重试。";
            }
            persist();
        });
        dialog.setOnShowListener(ignored -> {
            Window window = dialog.getWindow();
            if (window != null) {
                GradientDrawable bg = new GradientDrawable();
                bg.setColor(Color.WHITE);
                bg.setCornerRadius(dp(22));
                window.setBackgroundDrawable(bg);
            }
            Button pos = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            Button neg = dialog.getButton(AlertDialog.BUTTON_NEGATIVE);
            if (pos != null) {
                pos.setTextColor(Color.rgb(7, 133, 68));
                pos.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
                pos.setOnClickListener(view -> primary());
            }
            if (neg != null) neg.setTextColor(Color.rgb(102, 110, 122));
        });
        dialog.show(); render();
    }

    private void render() {
        if (dialog == null) return;
        status.setText(appMessage + (appState == AppState.AVAILABLE ? "\n\n安装时，手机会请你确认。" : ""));
        boolean appBusy = appState == AppState.DOWNLOADING || appState == AppState.VERIFYING;
        boolean busy = appBusy || appState == AppState.CHECKING;
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        progress.setIndeterminate(appState != AppState.DOWNLOADING);
        if (appState == AppState.DOWNLOADING) progress.setProgress(downloadPercent);
        boolean canAct = appState == AppState.AVAILABLE || appState == AppState.READY || appState == AppState.PERMISSION
                || appState == AppState.FAILED || appState == AppState.UNAVAILABLE;
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setVisibility(canAct ? View.VISIBLE : View.GONE);
        String action = appState == AppState.AVAILABLE ? "更新安卓版"
                : appState == AppState.FAILED ? "重试"
                : appState == AppState.READY || appState == AppState.PERMISSION ? "继续安装" : "重新检查";
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setText(action);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(!busy);
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setText(busy ? "取消" : "关闭");
    }

    private void checkApp() {
        cancelApp(); appTransfer = new OfficialUpdates.Transfer(); final OfficialUpdates.Transfer transfer = appTransfer;
        release = null; source = null; confirmed = false;
        final int token = appGeneration;
        if (BuildConfig.CUSTOM_PUSH_BUILD) {
            appState = AppState.UNAVAILABLE; appMessage = "此推送版由部署者提供同一推送项目、同一签名的更新包。";
            update(); return;
        }
        try {
            source = new OfficialUpdates(TrustedOrigin.parse(host.currentOrigin()),host.currentCookie(),host);
            appOrigin = host.currentOrigin(); appSession = source.sessionId();
        } catch (Exception error) {
            appState = AppState.UNAVAILABLE; appMessage = error.getMessage(); update(); return;
        }
        final OfficialUpdates client = source;
        appState = AppState.CHECKING; appMessage = "正在通过当前服务器检查安卓更新…"; update();
        appWorker.execute(() -> {
            try {
                OfficialUpdates.Release found = client.latest(transfer);
                postApp(token,() -> {
                    try { client.assertCurrentSession(); }
                    catch (IOException changed) { appState = AppState.UNAVAILABLE; appMessage = changed.getMessage(); update(); return; }
                    if (found == null) { appState = AppState.UNAVAILABLE; appMessage = "暂未发布可用的安卓更新。"; }
                    else if (found.versionCode <= BuildConfig.VERSION_CODE) {
                        appState = AppState.CURRENT; appMessage = "v" + BuildConfig.VERSION_NAME + "，已是最新版本。";
                    } else {
                        release = found; appState = AppState.AVAILABLE;
                        appMessage = "v" + BuildConfig.VERSION_NAME + " → v" + found.versionName + "，安装包 " + megabytes(found.size) + " MB。";
                    }
                    update();
                });
            } catch (Exception error) { postApp(token,() -> { appState = AppState.UNAVAILABLE; appMessage = "检查失败：" + error.getMessage(); update(); }); }
        });
    }

    private void primary() {
        if (appState == AppState.CHECKING || appState == AppState.DOWNLOADING || appState == AppState.VERIFYING) return;
        if (release == null) { checkApp(); return; }
        confirmed = true; persist();
        host.checkpoint(() -> {
            if (dialog == null) return;
            try { ensureBinding(); }
            catch (Exception changed) {
                release = null; source = null; confirmed = false;
                appState = AppState.UNAVAILABLE; appMessage = changed.getMessage(); update(); return;
            }
            if (appState == AppState.READY) prepareInstall();
            else if (appState == AppState.PERMISSION) openSourceSettings();
            else downloadApp();
        });
    }

    private void ensureBinding() throws Exception {
        if (!appOrigin.equals(host.currentOrigin())) throw new IOException("服务器已切换，请重新检查安卓更新");
        if (source == null) source = new OfficialUpdates(TrustedOrigin.parse(appOrigin),host.currentCookie(),host);
        if (!appSession.equals(source.sessionId())) throw new IOException("登录会话已改变，请重新检查安卓更新");
        source.assertCurrentSession();
    }

    private void downloadApp() {
        final OfficialUpdates.Release candidate = release;
        final OfficialUpdates client = source;
        cancelApp(); appTransfer = new OfficialUpdates.Transfer(); final OfficialUpdates.Transfer transfer = appTransfer;
        final int token = appGeneration; downloadPercent = 0;
        appState = AppState.DOWNLOADING; appMessage = "服务器正在准备 v" + candidate.versionName + " 安装包，准备好后开始下载…"; update();
        appWorker.execute(() -> {
            try {
                final long[] last = {0};
                client.download(activity,candidate,transfer,(count,size) -> {
                    long now = SystemClock.elapsedRealtime();
                    if (count != size && now - last[0] < 150) return;
                    last[0] = now;
                    postApp(token,() -> {
                        downloadPercent = (int)(count * 100 / size);
                        appMessage = "正在下载 " + megabytes(count) + " / " + megabytes(size) + " MB";
                        if (count == size) { appState = AppState.VERIFYING; appMessage = "正在核对安装包和签名…"; }
                        render();
                    });
                });
                postApp(token,() -> {
                    try { ensureBinding(); }
                    catch (Exception changed) { appState = AppState.FAILED; appMessage = changed.getMessage(); update(); return; }
                    appState = AppState.READY; appMessage = "v" + candidate.versionName + " 已下载并通过校验。"; update();
                    if (foreground && dialog != null) prepareInstall();
                });
            } catch (Exception error) { appFailure(token,"安卓更新失败：",error); }
        });
    }

    private void prepareInstall() {
        final OfficialUpdates.Release candidate = release;
        cancelApp(); appTransfer = new OfficialUpdates.Transfer(); final OfficialUpdates.Transfer transfer = appTransfer;
        final int token = appGeneration;
        appState = AppState.VERIFYING; appMessage = "正在再次核对安装包…"; update();
        appWorker.execute(() -> {
            try {
                OfficialUpdates.verify(activity,UpdateApkProvider.apk(activity),candidate,transfer);
                postApp(token,() -> {
                    try { ensureBinding(); }
                    catch (Exception changed) { appState = AppState.FAILED; appMessage = changed.getMessage(); update(); return; }
                    appState = AppState.READY; appMessage = "安装包已保留，点击「继续安装」继续。"; update();
                    if (!foreground || dialog == null) return;
                    if (canInstall()) launchInstaller();
                    else {
                        appState = AppState.PERMISSION;
                        appMessage = "请在系统设置中允许屁屁机安装应用，返回后继续系统确认。"; update();
                        openSourceSettings();
                    }
                });
            } catch (Exception error) { appFailure(token,"安装前校验失败：",error); }
        });
    }

    @SuppressWarnings("deprecation") private boolean canInstall() {
        return Build.VERSION.SDK_INT >= 26 ? activity.getPackageManager().canRequestPackageInstalls()
                : Settings.Secure.getInt(activity.getContentResolver(),Settings.Secure.INSTALL_NON_MARKET_APPS,0) == 1;
    }

    private void openSourceSettings() {
        Intent settings = Build.VERSION.SDK_INT >= 26 ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.getPackageName())) : new Intent(Settings.ACTION_SECURITY_SETTINGS);
        try { waitingForSource = true; persist(); activity.startActivityForResult(settings,ALLOW_SOURCE); }
        catch (ActivityNotFoundException missing) {
            waitingForSource = false; appState = AppState.PERMISSION;
            appMessage = "手机没有可用的安装来源设置页，请在系统设置中允许安装后重试。"; update();
        }
    }

    @SuppressWarnings("deprecation") private void launchInstaller() {
        Uri apk = Uri.parse("content://" + activity.getPackageName() + ".update.apk/update.apk");
        Intent install = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(apk,"application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra(Intent.EXTRA_RETURN_RESULT,true);
        install.setClipData(ClipData.newRawUri("App update",apk));
        try {
            appState = AppState.INSTALLING; appMessage = "已打开 Android 安装确认。取消后安装包会保留。"; update();
            activity.startActivityForResult(install,INSTALL_APK);
        } catch (ActivityNotFoundException missing) {
            appState = AppState.FAILED; appMessage = "手机没有可用的 APK 安装器。"; update();
        } catch (SecurityException denied) {
            appState = AppState.PERMISSION; appMessage = "系统尚未允许安装更新，请允许安装来源后重试。"; update();
        }
    }

    boolean result(int request, int result) {
        if (request != ALLOW_SOURCE && request != INSTALL_APK) return false;
        if (request == ALLOW_SOURCE) {
            waitingForSource = false;
            if (canInstall()) {
                continueAfterSource = true;
                if (foreground && dialog != null) { continueAfterSource = false; prepareInstall(); }
            } else { appState = AppState.PERMISSION; appMessage = "安装来源尚未允许，可稍后重试。"; }
        } else if (result == Activity.RESULT_OK) {
            appState = AppState.DONE; appMessage = "安卓更新已安装，重新打开即可使用新版。";
        } else {
            appState = AppState.READY; appMessage = "安装已取消，安装包已保留。";
        }
        update(); return true;
    }

    private boolean unfinished() { return release != null && appState != AppState.CURRENT && appState != AppState.DONE; }

    private void resume() {
        if (!confirmed) { checkApp(); return; }
        if (release != null && release.versionCode <= BuildConfig.VERSION_CODE) {
            appState = AppState.DONE; appMessage = "已更新到 v" + BuildConfig.VERSION_NAME + "。";
        } else if (appState == AppState.DOWNLOADING || appState == AppState.VERIFYING) {
            appState = AppState.AVAILABLE; appMessage = "上次下载已中断，可以重新下载。";
        } else if (appState == AppState.INSTALLING) {
            appState = AppState.READY; appMessage = "安装包已保留，可继续安装。";
        }
        update();
        if (continueAfterSource && foreground && dialog != null) { continueAfterSource = false; prepareInstall(); }
    }

    void save(Bundle out) { out.putBoolean(VISIBLE,dialog != null && dialog.isShowing()); persist(); }

    void restore(Bundle saved) {
        String raw = prefs.getString(JOURNAL,null);
        if (raw == null) return;
        try {
            JSONObject record = new JSONObject(raw);
            confirmed = record.getBoolean("confirmed"); appState = AppState.valueOf(record.getString("appState"));
            appMessage = record.getString("appMessage"); appOrigin = record.getString("appOrigin"); appSession = record.getString("appSession");
            waitingForSource = record.getBoolean("waitingForSource"); userClosed = record.getBoolean("userClosed");
            long targetCode = record.optLong("appTargetCode",0);
            if (targetCode > 0 && targetCode <= BuildConfig.VERSION_CODE) {
                appState = AppState.DONE; appMessage = "已更新到 v" + BuildConfig.VERSION_NAME + "。";
            } else if (record.has("release")) release = OfficialUpdates.restored(record.getJSONObject("release").toString());
            continueAfterSource = waitingForSource && release != null && canInstall();
            restoreVisible = !userClosed && (saved != null && saved.getBoolean(VISIBLE) || confirmed && unfinished());
        } catch (Exception error) {
            android.util.Log.e("PipiUpdate","Could not restore Android update",error);
            release = null; confirmed = false; appState = AppState.UNAVAILABLE;
            appMessage = "上次安卓更新记录无法读取，请重新检查。";
            restoreVisible = saved != null && saved.getBoolean(VISIBLE);
        }
    }

    void onPageReady() {
        if (restoreVisible && foreground && dialog == null) { restoreVisible = false; createDialog(); resume(); }
    }

    void setVisible(boolean visible) {
        foreground = visible;
        if (!visible) return;
        if (host.trustedPage()) onPageReady();
        if (dialog != null && continueAfterSource) { continueAfterSource = false; prepareInstall(); }
    }

    boolean dismiss() { if (dialog == null || !dialog.isShowing()) return false; dialog.dismiss(); return true; }
    void close() {
        persist();
        if (dialog != null) { dialog.setOnDismissListener(null); dialog.dismiss(); dialog = null; }
        cancelApp(); appWorker.shutdown(); handler.removeCallbacksAndMessages(null);
    }
    private void update() { persist(); render(); }
    private void persist() {
        try {
            JSONObject record = new JSONObject().put("confirmed",confirmed).put("appState",appState.name()).put("appMessage",appMessage)
                    .put("appOrigin",appOrigin).put("appSession",appSession).put("waitingForSource",waitingForSource).put("userClosed",userClosed);
            if (release != null) record.put("release",release.saved()).put("appTargetCode",release.versionCode);
            if (!prefs.edit().putString(JOURNAL,record.toString()).commit()) {
                android.util.Log.w("PipiUpdate","Unable to persist Android update journal (low storage)");
            }
        } catch (Exception error) {
            android.util.Log.w("PipiUpdate","Unable to serialize Android update journal",error);
        }
    }
    private void cancelApp() { appGeneration++; if (appTransfer != null) appTransfer.cancel(); }
    private void postApp(int token, Runnable change) { handler.post(() -> { if (token == appGeneration && !activity.isDestroyed()) change.run(); }); }
    private void appFailure(int token, String prefix, Exception error) {
        postApp(token,() -> {
            if (error instanceof OfficialUpdates.ReleaseChangedException) {
                release = null; source = null; confirmed = false; appState = AppState.UNAVAILABLE;
            } else appState = AppState.FAILED;
            appMessage = prefix + error.getMessage(); update();
        });
    }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private static String megabytes(long bytes) { return String.format(Locale.ROOT,"%.1f",bytes / 1048576.0); }
}
