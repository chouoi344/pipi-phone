// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.widget.LinearLayout;

/** No SDK, registration request or external push service in the default APK. */
public final class FcmTransport {
    private FcmTransport() {}
    public static boolean active(Context context) { return false; }
    public static void onPageFinished(Context context) {}
    public static void setVisible(Context context, boolean visible) {}
    public static void disable(Context context) {}
    public static boolean acceptIntent(Context context, Intent intent) { return !intent.hasExtra("appSessionScope"); }
    public static void addSettings(Activity activity, LinearLayout form) {}
}
