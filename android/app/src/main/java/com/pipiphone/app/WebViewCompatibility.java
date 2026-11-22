package com.pipiphone.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Blocks only browsers missing functions actually used by the bundled page. */
final class WebViewCompatibility {
    private static final int CHECKING = 1, READY = 2;
    private static final Map<WebView,Integer> checks = new WeakHashMap<>();
    private WebViewCompatibility() {}

    static boolean allow(Activity activity, WebView web, Runnable resume) {
        Integer state = checks.get(web);
        if (state != null) return state == READY;
        checks.put(web, CHECKING);
        web.evaluateJavascript(WebViewRequirements.FEATURES, features -> {
            if (activity.isDestroyed()) return;
            if (!WebViewRequirements.passed(features)) { blocked(activity, web, resume); return; }
            web.evaluateJavascript(WebViewRequirements.SYNTAX, syntax -> {
                if (activity.isDestroyed()) return;
                if (!WebViewRequirements.passed(syntax)) { blocked(activity, web, resume); return; }
                checks.put(web, READY);
                resume.run();
            });
        });
        return false;
    }

    private static void blocked(Activity activity, WebView web, Runnable resume) {
        Matcher version = Pattern.compile("Chrome/([0-9.]+)").matcher(web.getSettings().getUserAgentString());
        String description = version.find() ? "当前组件版本：" + version.group(1) + "。\n\n" : "";
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("请更新系统网页组件")
                .setMessage(description + "网页组件是 App 里面打开页面的工具。当前组件缺少屁屁机需要的功能，更新后才能继续。\n\n"
                        + "请在手机自带的应用商店或系统更新中，更新 Android System WebView 或当前使用的 Chrome。没有 Google 服务的手机，可使用厂商提供的网页组件更新。\n\n"
                        + "更新后重新打开屁屁机，或点“重新检测”。如果手机已无法更新该组件，需要升级到仍能更新的系统。服务器资料会保留。")
                .setPositiveButton("打开组件设置", null)
                .setNeutralButton("重新检测", (ignored, which) -> { checks.remove(web); resume.run(); })
                .setNegativeButton("关闭 App", (ignored, which) -> activity.finish())
                .create();
        dialog.setCancelable(false);
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
            Intent settings;
            PackageInfo provider = Build.VERSION.SDK_INT >= 26 ? Api26.currentProvider() : null;
            if (provider != null) settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + provider.packageName));
            else settings = new Intent(Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS);
            if (settings.resolveActivity(activity.getPackageManager()) == null) settings = new Intent(Settings.ACTION_SETTINGS);
            // Keep the explanation visible when returning from system settings.
            activity.startActivity(settings);
        }));
        dialog.show();
    }

    @android.annotation.TargetApi(26)
    private static final class Api26 {
        static PackageInfo currentProvider() { return WebView.getCurrentWebViewPackage(); }
    }
}
