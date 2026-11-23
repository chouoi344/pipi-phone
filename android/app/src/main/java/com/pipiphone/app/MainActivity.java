package com.pipiphone.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JsPromptResult;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The only native/web integration is a small, fixed set of main-frame evaluations. */
public final class MainActivity extends Activity {
    public static final String SETTINGS_ACTION = "com.pipiphone.app.SETTINGS";
    private static final int PICK_FILE = 101, MICROPHONE = 102, NOTIFICATIONS = 103, SAVE_FILE = 104, NATIVE_MICROPHONE = 105;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private TrustedOrigin origin;
    private AssetBundle assets;
    private WebView web;
    private FrameLayout surface;
    private LinearLayout errorPanel;
    private ProgressBar loading;
    private AlertDialog settingsDialog;
    private FirstConnectionForm connectionForm;
    private Switch notificationsSwitch;
    private TextView notificationStatus, resourceStatus;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest recordingRequest;
    private VoiceCapture voiceCapture;
    private long recordGestureDeadline;
    private boolean recordTouchDown, microphonePermissionOnRelease;
    private BlobDownloads blobDownloads;
    private AppUpdater appUpdater;
    private String updateEntryScript;
    private String pendingRoleId, pendingDownloadUrl, pendingDownloadCookie;
    private Intent pendingNotificationIntent;
    private String bundleStatus = "尚未连接服务器";
    private boolean pageReady, backInFlight, changingNotificationSwitch, initialConnect, paused, notificationsAfterLogin;
    private String notificationPermissionOrigin;
    private int topInset, bottomInset, leftInset, rightInset, connectionGeneration, loginGeneration;
    private float edgeDownX, edgeDownY, edgeProgress;
    private boolean edgePossible, edgeTracking;
    private String edgeSide = "left";
    private Object systemBackCallback;
    private final Runnable refreshSettings = new Runnable() {
        @Override public void run() {
            if (settingsDialog == null || !settingsDialog.isShowing()) return;
            updateSettingsStatus(); handler.postDelayed(this,1000);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("pipi_phone_android", MODE_PRIVATE);
        origin = TrustedOrigin.parse(prefs.getString("server_origin", TrustedOrigin.isEmulator()
                ? TrustedOrigin.DEVELOPMENT : "https://phone.example.com"));
        configureWindow();
        surface = new FrameLayout(this); surface.setBackgroundColor(Color.rgb(237,237,237));
        setContentView(surface);
        appUpdater = new AppUpdater(this,new AppUpdater.Host() {
            @Override public String currentOrigin() { return origin.value; }
            @Override public String currentCookie() { return PhoneNotifications.cookie(currentOrigin()); }
            @Override public boolean trustedPage() { return web != null && origin.isAppPage(web.getUrl()); }
            @Override public void checkpoint(Runnable completed) {
                if (!origin.isAppPage(web.getUrl())) { completed.run(); return; }
                web.evaluateJavascript("window.PipiAndroidPage&&window.PipiAndroidPage.checkpoint()",ignored -> completed.run());
            }
        });
        try (InputStream in = getResources().openRawResource(R.raw.app_update_entry)) {
            ByteArrayOutputStream script = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096]; int count;
            while ((count = in.read(buffer)) != -1) script.write(buffer,0,count);
            updateEntryScript = new String(script.toByteArray(),StandardCharsets.UTF_8);
        } catch (IOException error) { throw new IllegalStateException("Cannot read app update entry",error); }
        createWebView();
        voiceCapture = new VoiceCapture(getCacheDir(), handler, () ->
                web.evaluateJavascript("window.dispatchEvent(new Event('pipi-recording-interrupted'))", null));
        installInsets();
        if (Build.VERSION.SDK_INT >= 25) Api25Shortcuts.install(this);
        if (Build.VERSION.SDK_INT >= 34) systemBackCallback = Api34Back.register(this);
        else if (Build.VERSION.SDK_INT >= 33) systemBackCallback = Api33Back.register(this);
        initialConnect = !prefs.contains("server_origin");
        takeIntent(getIntent());
        if (initialConnect) showFirstConnection(origin, true);
        else connect(state, false);
        appUpdater.restore(state);
    }

    private void configureWindow() {
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setNavigationBarContrastEnforced(false);
            getWindow().setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
    }

    @SuppressWarnings("deprecation") private void createWebView() {
        web = new WebView(this); web.setBackgroundColor(Color.rgb(237,237,237));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        settings.setBuiltInZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " PipiPhoneAndroid/1.0 PipiPhoneUpdater/3 PipiPhoneApp/" + BuildConfig.VERSION_NAME);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new PhoneWebClient());
        web.setWebChromeClient(new PhoneChromeClient());
        web.setOnTouchListener((view, event) -> {
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_DOWN) {
                recordTouchDown = true;
                recordGestureDeadline = SystemClock.uptimeMillis() + 1500;
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                recordTouchDown = false;
                if (microphonePermissionOnRelease && action == MotionEvent.ACTION_UP) askForVoicePermission();
                microphonePermissionOnRelease = false;
            }
            return false;
        });
        web.setOnKeyListener((view, code, event) -> {
            if (event.getAction() == KeyEvent.ACTION_DOWN && (code == KeyEvent.KEYCODE_ENTER
                    || code == KeyEvent.KEYCODE_SPACE || code == KeyEvent.KEYCODE_DPAD_CENTER))
                recordGestureDeadline = SystemClock.uptimeMillis() + 1500;
            return false;
        });
        blobDownloads=new BlobDownloads(this,web,network,handler,new BlobDownloads.Host(){
            @Override public boolean trusted(){return !isDestroyed()&&origin.isAppPage(web.getUrl());}
            @Override public void chooseDestination(String name,String mime){chooseDownloadDestination(name,mime);}
            @Override public void notice(String message){toast(message);}
        });
        web.setDownloadListener((url, ua, disposition, mime, length) -> beginDownload(url, disposition, mime));
        surface.addView(web, new FrameLayout.LayoutParams(-1,-1));
        loading = new ProgressBar(this);
        FrameLayout.LayoutParams spinner = new FrameLayout.LayoutParams(dp(40),dp(40),Gravity.CENTER);
        surface.addView(loading,spinner); loading.setVisibility(View.GONE);
    }

    private void connect(Bundle savedState) { connect(savedState, false); }

    private void connect(Bundle savedState, boolean enterChats) {
        if (!WebViewCompatibility.allow(this, web, () -> connect(savedState, enterChats))) return;
        final int generation = ++connectionGeneration;
        final TrustedOrigin destination = origin;
        pageReady = false; loading.setVisibility(View.VISIBLE); hideError();
        try { assets = new AssetBundle(this,prefs,destination); }
        catch (Exception error) { showError("安装包页面资源有问题：" + error.getMessage()); return; }
        final AssetBundle nextAssets = assets;
        final boolean loadImmediately = nextAssets.hasVerifiedCache();
        if (loadImmediately) {
            bundleStatus = "使用上次核对的本地页面，正在后台检查版本";
            loadConnectedPage(savedState,destination,enterChats);
        }
        network.execute(() -> {
            String result = nextAssets.verify();
            handler.post(() -> {
                if (isDestroyed() || generation != connectionGeneration) return;
                bundleStatus = result;
                updateSettingsStatus();
                if (loadImmediately) {
                    if (nextAssets.serverChanged()) toast("服务器页面已更新，下次连接时使用新版；当前草稿继续保留");
                } else {
                    nextAssets.useVerifiedMode(); loadConnectedPage(savedState,destination,enterChats);
                }
            });
        });
    }

    private void loadConnectedPage(Bundle savedState,TrustedOrigin destination,boolean enterChats) {
        if (savedState != null && destination.value.equals(savedState.getString("server_origin"))
                && web.restoreState(savedState.getBundle("web_state")) != null) return;
        web.loadUrl(destination.value + (enterChats ? "/?android_entry=chats" : "/"));
    }

    private final class PhoneWebClient extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assets == null ? null : assets.intercept(request);
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return routeNavigation(request.getUrl(),request.isForMainFrame(),request.hasGesture());
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view,String url) {
            return routeNavigation(Uri.parse(url),true,true);
        }
        @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon) {
            voiceCapture.cancel();
            recordGestureDeadline = 0;
            recordTouchDown = microphonePermissionOnRelease = false;
            if (!origin.owns(Uri.parse(url))) {
                view.stopLoading();showError("页面离开了已配置的服务器，请重新连接");return;
            }
            pageReady = false; loading.setVisibility(View.VISIBLE); hideError();
            blobDownloads.cancel();
            if (recordingRequest != null) { recordingRequest.deny(); recordingRequest = null; }
            if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        }
        @Override public void onPageCommitVisible(WebView view,String url) { applyInsets(); }
        @Override public void onPageFinished(WebView view,String url) {
            loading.setVisibility(View.GONE);
            if (!origin.isAppPage(url)) return;
            final int generation = connectionGeneration;
            view.evaluateJavascript(WebViewRequirements.PAGE_STARTED, started -> {
                if (isDestroyed() || generation != connectionGeneration || !url.equals(view.getUrl()) || errorPanel != null) return;
                if (!WebViewRequirements.passed(started)) {
                    pageReady = false;
                    showError("页面没有正常启动。" + (assets != null && assets.enabled
                            ? "App 内置页面未能运行，请更新 App 或系统网页组件后重新连接。"
                            : "服务器提供的页面可能与当前系统网页组件不兼容，或页面脚本没有加载成功。请更新服务器网页程序或系统网页组件后重新连接。"));
                    return;
                }
                pageReady = true; applyInsets(); PhoneNotifications.onPageFinished(MainActivity.this);
                web.evaluateJavascript(updateEntryScript,null);
                appUpdater.onPageReady();
                blobDownloads.install();
                FcmTransport.onPageFinished(MainActivity.this);
                openPendingChat();
                enableLoginNotifications();
            });
        }
        @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error) {
            if (request.isForMainFrame()) showError("连接失败：" + error.getDescription());
        }
        @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse error) {
            if (request.isForMainFrame() && error.getStatusCode() >= 400)
                showError("服务器返回 " + error.getStatusCode() + "，请检查连接地址");
        }
        @Override public void onReceivedSslError(WebView view,SslErrorHandler action,SslError error) {
            action.cancel(); showError("服务器 HTTPS 证书不受信任，请修复证书后重试");
        }
    }

    private boolean routeNavigation(Uri url,boolean mainFrame,boolean userGesture) {
        if (origin.owns(url)) {
            if (mainFrame && "/__android/update".equals(url.getPath())) {
                if (userGesture && url.getQuery() == null && url.getFragment() == null && origin.isAppPage(web.getUrl())) appUpdater.show();
                return true;
            }
            if(mainFrame&&"/__android/network-download".equals(url.getPath())) {
                if(origin.isAppPage(web.getUrl())) {
                    String target=url.getQueryParameter("url"),name=url.getQueryParameter("name");
                    if(target!=null&&name!=null&&target.length()<=4096&&name.length()<=200) {
                        String extension=android.webkit.MimeTypeMap.getFileExtensionFromUrl(name);
                        requestDownload(target,name,android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension));
                    }
                }
                return true;
            }
            if(mainFrame&&"/__android/download".equals(url.getPath())) {
                if(origin.isAppPage(web.getUrl())&&pendingDownloadUrl==null)blobDownloads.request(url.getQueryParameter("token"));
                return true;
            }
            if (mainFrame && "/__android/settings".equals(url.getPath()) && url.getQuery() == null
                    && origin.isAppPage(web.getUrl())) { showSettings(); return true; }
            return false;
        }
        String scheme = url.getScheme();
        if (mainFrame && userGesture && ("https".equals(scheme) || "http".equals(scheme)
                || "mailto".equals(scheme) || "tel".equals(scheme))) {
            try { startActivity(new Intent(Intent.ACTION_VIEW,url).addCategory(Intent.CATEGORY_BROWSABLE)); }
            catch (ActivityNotFoundException missing) { toast("手机中没有能打开这个链接的应用"); }
        }
        return true;
    }

    private final class PhoneChromeClient extends WebChromeClient {
        @Override public boolean onJsPrompt(WebView view, String url, String message, String command, JsPromptResult result) {
            if (!message.startsWith("pipi-recording:")) return super.onJsPrompt(view, url, message, command, result);
            String reply;
            if (!pageReady || paused || !view.hasWindowFocus() || !origin.isAppPage(url)
                    || !origin.isAppPage(view.getUrl()) || assets == null
                    || !assets.ownsMicrophoneToken(message.substring("pipi-recording:".length()))) {
                reply = "请在小手机聊天页重新按住说话";
            } else try {
                switch (command) {
                    case "start":
                        if (SystemClock.uptimeMillis() > recordGestureDeadline) {
                            reply = "请亲自按住说话"; break;
                        }
                        recordGestureDeadline = 0;
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            if (recordTouchDown) microphonePermissionOnRelease = true;
                            else askForVoicePermission();
                            reply = "permission"; break;
                        }
                        voiceCapture.start(); reply = "ok"; break;
                    case "finish": reply = "audio:" + voiceCapture.finish(); break;
                    case "cancel": voiceCapture.cancel(); reply = "ok"; break;
                    default: reply = "未知录音操作";
                }
            } catch (IOException | RuntimeException failure) {
                android.util.Log.w("PipiVoice", "Microphone operation failed", failure);
                reply = "录音未完成，请重新按住说话";
            }
            result.confirm(reply);
            return true;
        }
        @Override public void onProgressChanged(WebView view,int progress) {
            if (progress == 100) loading.setVisibility(View.GONE);
        }
        @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params) {
            if (!origin.isAppPage(view.getUrl())) return false;
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent choose = params.createIntent();
            choose.addCategory(Intent.CATEGORY_OPENABLE);
            choose.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivityForResult(choose,PICK_FILE); }
            catch (ActivityNotFoundException error) { fileCallback.onReceiveValue(null); fileCallback = null; toast("手机没有可用的文件选择器"); }
            return true;
        }
        @Override public void onPermissionRequest(PermissionRequest request) {
            String[] requested = request.getResources();
            if (!origin.isAppPage(web.getUrl()) || !origin.owns(request.getOrigin()) || requested.length != 1
                    || !PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(requested[0])) { request.deny(); return; }
            if (recordingRequest != null) recordingRequest.deny();
            recordingRequest = request;
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); recordingRequest = null;
            } else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},MICROPHONE);
        }
        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            if (recordingRequest == request) recordingRequest = null;
        }
    }

    private void askForVoicePermission() {
        // Allow WebView to finish dispatching this touch and its JS callback before Android takes focus.
        handler.post(() -> {
            if (!isDestroyed() && !paused && pageReady && web.hasWindowFocus())
                requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, NATIVE_MICROPHONE);
        });
    }

    private void installInsets() {
        surface.setOnApplyWindowInsetsListener((view,insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                topInset=bars.top; bottomInset=insets.isVisible(WindowInsets.Type.ime()) ? 0 : bars.bottom;
                leftInset=bars.left; rightInset=bars.right;
                FrameLayout.LayoutParams params=(FrameLayout.LayoutParams)web.getLayoutParams();
                int keyboard=insets.isVisible(WindowInsets.Type.ime()) ? ime.bottom : 0;
                if (params.bottomMargin != keyboard) { params.bottomMargin=keyboard; web.setLayoutParams(params); }
            } else {
                topInset=insets.getSystemWindowInsetTop(); bottomInset=insets.getSystemWindowInsetBottom();
                leftInset=insets.getSystemWindowInsetLeft(); rightInset=insets.getSystemWindowInsetRight();
            }
            applyInsets(); return insets;
        });
        surface.requestApplyInsets();
    }

    private void applyInsets() {
        if (!origin.isAppPage(web.getUrl())) return;
        float density=getResources().getDisplayMetrics().density;
        String script="(function(){var r=document.documentElement;if(!r)return;r.dataset.pipiAndroid='true';"
                + "r.dataset.pipiAndroidVersion="+JSONObject.quote(BuildConfig.VERSION_NAME)+";"
                + "r.dataset.pipiAndroidVersionCode='"+BuildConfig.VERSION_CODE+"';"
                + "r.style.setProperty('--pipi-system-top','"+(topInset/density)+"px');"
                + "r.style.setProperty('--pipi-system-bottom','"+(bottomInset/density)+"px');"
                + "r.style.setProperty('--pipi-system-left','"+(leftInset/density)+"px');"
                + "r.style.setProperty('--pipi-system-right','"+(rightInset/density)+"px');"
                + "window.dispatchEvent(new Event('pipi:android-insets'));})()";
        web.evaluateJavascript(script,null);
    }

    private void checkpoint() {
        if (origin.isAppPage(web.getUrl())) web.evaluateJavascript("window.PipiAndroidPage&&window.PipiAndroidPage.checkpoint()",null);
    }

    private void backStage(String stage,float progress,String edge) {
        if (!origin.isAppPage(web.getUrl())) return;
        web.evaluateJavascript("window.PipiAndroidPage&&window.PipiAndroidPage.back("
                +JSONObject.quote(stage)+","+Math.max(0,Math.min(1,progress))+","+JSONObject.quote(edge)+")",null);
    }

    private void commitBack() {
        if (backInFlight) return;
        if (appUpdater.dismiss()) return;
        if (connectionForm != null && connectionForm.isShowing()) { cancelFirstConnection(); return; }
        if (settingsDialog != null && settingsDialog.isShowing()) { settingsDialog.dismiss(); return; }
        if (!origin.isAppPage(web.getUrl())) { fallbackBack(); return; }
        backInFlight=true;
        String call="(function(){var p=window.PipiAndroidPage;if(!p||!p.back)return 'missing';"
                + "window.__pipiAndroidBackResult='pending';Promise.resolve(p.back('commit',1,"
                +JSONObject.quote(edgeSide)+")).then(function(v){window.__pipiAndroidBackResult=v?'handled':'root'},"
                + "function(e){window.__pipiAndroidBackResult='error:'+String(e&&e.message||e)});return 'pending';})()";
        web.evaluateJavascript(call,result -> {
            String value=jsonString(result);
            if (value.equals("missing")) { backInFlight=false; fallbackBack(); }
            else pollBack(0);
        });
    }

    private void pollBack(int attempt) {
        if (!backInFlight || isDestroyed()) return;
        if (!origin.isAppPage(web.getUrl())) { backInFlight=false; return; }
        web.evaluateJavascript("window.__pipiAndroidBackResult",result -> {
            String value=jsonString(result);
            if (value.equals("pending") && attempt < 250) handler.postDelayed(() -> pollBack(attempt+1),20);
            else {
                backInFlight=false;
                if (value.equals("root")) { checkpoint(); moveTaskToBack(true); }
                else if (value.startsWith("error:")) toast("页面返回失败："+value.substring(6));
                else if (value.equals("pending")) toast("页面返回仍在等待，请稍后再试");
            }
        });
    }

    private void fallbackBack() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
    }

    @Override public void onBackPressed() { commitBack(); }

    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        if (Build.VERSION.SDK_INT >= 33 || !pageReady) return super.dispatchTouchEvent(event);
        float width=surface.getWidth(), x=event.getX(), y=event.getY();
        switch(event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                edgeDownX=x; edgeDownY=y; edgeProgress=0; edgeTracking=false;
                edgePossible=(x<dp(24)||x>width-dp(24)) && y>topInset && y<surface.getHeight()-bottomInset;
                edgeSide=x<width/2 ? "left":"right"; break;
            case MotionEvent.ACTION_MOVE:
                if (!edgePossible) break;
                float dx=(edgeSide.equals("left")?x-edgeDownX:edgeDownX-x),dy=Math.abs(y-edgeDownY);
                if (!edgeTracking && dy>dp(16) && dy>Math.abs(dx)) { edgePossible=false; break; }
                if (!edgeTracking && dx>dp(14) && dx>dy*1.2f) {
                    edgeTracking=true; backStage("start",0,edgeSide);
                    MotionEvent cancel=MotionEvent.obtain(event); cancel.setAction(MotionEvent.ACTION_CANCEL);
                    super.dispatchTouchEvent(cancel); cancel.recycle();
                }
                if (edgeTracking) {
                    edgeProgress=Math.max(0,Math.min(1,dx/(width*.7f)));
                    backStage("progress",edgeProgress,edgeSide); return true;
                } break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                if (edgeTracking) {
                    edgeTracking=false; edgePossible=false;
                    if (event.getActionMasked()==MotionEvent.ACTION_UP && edgeProgress>.28f) commitBack();
                    else backStage("cancel",0,edgeSide);
                    return true;
                }
                edgePossible=false; break;
        }
        return super.dispatchTouchEvent(event);
    }

    @android.annotation.TargetApi(33)
    private static final class Api33Back {
        static Object register(MainActivity activity) {
            android.window.OnBackInvokedCallback callback=activity::commitBack;
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,callback);
            return callback;
        }
    }
    @android.annotation.TargetApi(25)
    private static final class Api25Shortcuts {
        static void install(MainActivity activity) {
            android.content.pm.ShortcutManager manager=activity.getSystemService(android.content.pm.ShortcutManager.class);
            android.content.pm.ShortcutInfo settings=new android.content.pm.ShortcutInfo.Builder(activity,"server-settings")
                    .setShortLabel(activity.getString(R.string.server_settings))
                    .setIcon(android.graphics.drawable.Icon.createWithResource(activity,com.pipiphone.app.R.drawable.ic_settings))
                    .setIntent(new Intent(activity,MainActivity.class).setAction(SETTINGS_ACTION)).build();
            manager.setDynamicShortcuts(java.util.Collections.singletonList(settings));
        }
    }
    @android.annotation.TargetApi(34)
    private static final class Api34Back {
        static Object register(MainActivity activity) {
            android.window.OnBackAnimationCallback callback=new android.window.OnBackAnimationCallback() {
                @Override public void onBackStarted(android.window.BackEvent event) {
                    activity.edgeSide=event.getSwipeEdge()==android.window.BackEvent.EDGE_RIGHT?"right":"left";
                    activity.backStage("start",event.getProgress(),activity.edgeSide);
                }
                @Override public void onBackProgressed(android.window.BackEvent event) { activity.backStage("progress",event.getProgress(),activity.edgeSide); }
                @Override public void onBackCancelled() { activity.backStage("cancel",0,activity.edgeSide); }
                @Override public void onBackInvoked() { activity.commitBack(); }
            };
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,callback);
            return callback;
        }
    }

    private void showSettings() {
        if (connectionForm != null && connectionForm.isShowing()) return;
        if (initialConnect) { showFirstConnection(origin, true); return; }
        if (settingsDialog != null && settingsDialog.isShowing()) return;
        LinearLayout form=new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(24),dp(12),dp(24),dp(8));
        TextView label=text("服务器地址",16); form.addView(label);
        EditText address=new EditText(this); address.setSingleLine(true); address.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("HTTPS 网址或 IP:端口");
        address.setText(origin.value);
        address.setSelectAllOnFocus(true); form.addView(address,new LinearLayout.LayoutParams(-1,-2));
        form.addView(text("填写这部小手机的网址。聊天记录和设置保存在服务器上。",13));
        notificationsSwitch=new Switch(this); notificationsSwitch.setText("新消息提醒");
        notificationsSwitch.setPadding(0,dp(20),0,dp(12)); notificationsSwitch.setChecked(PhoneNotifications.isEnabled(this));
        form.addView(notificationsSwitch,new LinearLayout.LayoutParams(-1,-2));
        TextView notificationInfo=text("离开 App 也能收到提醒。有时会晚一点。",13);
        form.addView(notificationInfo); notificationStatus=text(PhoneNotifications.status(this),13);form.addView(notificationStatus);
        FcmTransport.addSettings(this,form);
        resourceStatus=text(bundleStatus,13);form.addView(resourceStatus);
        form.addView(text("下次可在「我 → 设置 → App 连接设置」打开；也可在手机桌面长按屁屁机图标，选择「服务器设置」。",13));
        notificationsSwitch.setOnCheckedChangeListener((button,checked)->{
            if(changingNotificationSwitch)return;
            PhoneNotifications.rememberPreference(this,checked);
            if(checked) enableOrRequestNotifications();
            else PhoneNotifications.setEnabled(this,false);
            updateSettingsStatus();
        });
        ScrollView scroll=new ScrollView(this); scroll.addView(form);
        AlertDialog.Builder builder=new AlertDialog.Builder(this).setTitle("App 连接设置").setView(scroll)
                .setPositiveButton("保存连接",null).setNegativeButton("返回",null);
        settingsDialog=builder.create(); settingsDialog.setCanceledOnTouchOutside(true);
        settingsDialog.setOnDismissListener(dialog->handler.removeCallbacks(refreshSettings));
        settingsDialog.setOnShowListener(dialog->{
            handler.removeCallbacks(refreshSettings);handler.post(refreshSettings);
            settingsDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view->{
            final TrustedOrigin next;
            try { next=TrustedOrigin.parse(address.getText().toString()); }
            catch(IllegalArgumentException invalid) {address.setError(invalid.getMessage());return;}
            if(!origin.value.equals(next.value)) {
                new AlertDialog.Builder(this).setTitle("更换服务器？")
                        .setMessage("新服务器登录成功后，会清除这台设备保存的聊天副本和文字草稿，原服务器上的资料保留。登录失败或取消时，继续使用原连接。")
                        .setNegativeButton("取消",null).setPositiveButton("更换服务器",(confirm,which)->showFirstConnection(next,false)).show();
            } else {
                settingsDialog.dismiss();
                if(!pageReady)connect(null);
            }
            });
        });
        settingsDialog.show();
    }

    private void showFirstConnection(TrustedOrigin suggested, boolean first) {
        if (connectionForm != null && connectionForm.isShowing()) return;
        String address = first && !TrustedOrigin.isEmulator() ? "" : suggested.value;
        connectionForm = new FirstConnectionForm(this,address,PhoneNotifications.preference(this),first?"退出":"返回",new FirstConnectionForm.Listener() {
            @Override public void submit(String address, String password, boolean notifications) {
                loginConnection(address,password,notifications);
            }
            @Override public void cancel() { cancelFirstConnection(); }
            @Override public void notificationsChanged(boolean enabled) { PhoneNotifications.rememberPreference(MainActivity.this,enabled); }
        });
        connectionForm.show();
    }

    private void cancelFirstConnection() {
        loginGeneration++;
        if (connectionForm != null) { connectionForm.dismiss(); connectionForm = null; }
        if (initialConnect) finish();
    }

    private void loginConnection(String address,String password,boolean notifications) {
        final FirstConnectionForm form = connectionForm;
        final TrustedOrigin next;
        try { next = TrustedOrigin.parse(address); }
        catch (IllegalArgumentException invalid) { form.showError("address",invalid.getMessage()); return; }
        final int generation = ++loginGeneration;
        form.setBusy(true);
        network.execute(() -> {
            try {
                ServerLogin.Session session = ServerLogin.login(next,password);
                handler.post(() -> {
                    if (!currentLogin(form,generation)) return;
                    CookieManager cookies = CookieManager.getInstance();
                    cookies.setCookie(next.value + "/",session.setCookie,accepted -> {
                        if (!currentLogin(form,generation)) return;
                        if (!accepted || !session.installed(cookies.getCookie(next.value + "/"))) {
                            form.setBusy(false); form.showError("form","登录信息没有保存成功，请再试一次。"); return;
                        }
                        cookies.flush();
                        Runnable commit = () -> {
                            if (currentLogin(form,generation)) finishLoginConnection(next,notifications);
                        };
                        if (!origin.value.equals(next.value) && origin.isAppPage(web.getUrl())) {
                            web.evaluateJavascript("window.PipiAndroidPage&&window.PipiAndroidPage.forgetDeviceCache&&window.PipiAndroidPage.forgetDeviceCache()",ignored -> commit.run());
                        } else commit.run();
                    });
                });
            } catch (ServerLogin.Failure error) {
                handler.post(() -> {
                    if (!currentLogin(form,generation)) return;
                    form.setBusy(false); form.showError(error.field,error.getMessage());
                });
            }
        });
    }

    private boolean currentLogin(FirstConnectionForm form,int generation) {
        return !isDestroyed() && !isFinishing() && connectionForm == form && form.isShowing() && generation == loginGeneration;
    }

    private void finishLoginConnection(TrustedOrigin next,boolean notifications) {
        boolean changed = !origin.value.equals(next.value);
        if (changed) {
            blobDownloads.cancel(); PhoneNotifications.onServerChanged(this); clearPendingNotification();
            prefs.edit().remove("verified_origin").remove("verified_bundle").apply();
        }
        prefs.edit().putString("server_origin",next.value).apply();
        origin = next; initialConnect = false;
        PhoneNotifications.rememberPreference(this,notifications);
        if (!notifications) PhoneNotifications.setEnabled(this,false);
        notificationsAfterLogin = notifications;
        if (settingsDialog != null) settingsDialog.dismiss();
        connectionForm.dismiss(); connectionForm = null;
        web.stopLoading(); web.clearHistory(); connect(null,true);
    }

    private void enableLoginNotifications() {
        if (!notificationsAfterLogin || paused || !pageReady || errorPanel != null || !origin.isAppPage(web.getUrl())) return;
        notificationsAfterLogin = false;
        enableOrRequestNotifications();
    }

    private void enableOrRequestNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (notificationPermissionOrigin != null) return;
            notificationPermissionOrigin = origin.value;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},NOTIFICATIONS);
        } else PhoneNotifications.setEnabled(this,true);
        updateSettingsStatus();
    }

    private void syncNotificationSwitch(boolean enabled) {
        if(notificationsSwitch==null)return;
        changingNotificationSwitch=true;notificationsSwitch.setChecked(enabled);changingNotificationSwitch=false;
    }

    private void updateSettingsStatus() {
        String currentStatus=PhoneNotifications.status(this);
        if(notificationStatus!=null&&!notificationStatus.getText().toString().equals(currentStatus))notificationStatus.setText(currentStatus);
        if(resourceStatus!=null&&!resourceStatus.getText().toString().equals(bundleStatus))resourceStatus.setText(bundleStatus);
        syncNotificationSwitch(PhoneNotifications.isEnabled(this));
    }

    private void takeIntent(Intent intent) {
        if(intent==null)return;
        if(!FcmTransport.acceptIntent(this,intent))return;
        if(SETTINGS_ACTION.equals(intent.getAction())) handler.post(this::showSettings);
        if(notificationTargetsCurrentSession(intent)) {
            pendingRoleId=intent.getStringExtra("roleId"); pendingNotificationIntent=new Intent(intent);
        }
    }

    private boolean notificationTargetsCurrentSession(Intent intent) {
        if(intent==null||!FcmTransport.acceptIntent(this,intent))return false;
        String role=intent.getStringExtra("roleId");
        return role!=null&&!role.isEmpty()&&role.length()<=200&&origin.value.equals(intent.getStringExtra("notificationOrigin"))
                &&(intent.hasExtra("appSessionScope")||PhoneNotifications.acceptIntent(this,intent));
    }

    private void clearPendingNotification() { pendingRoleId=null;pendingNotificationIntent=null; }

    private void openPendingChat() {
        if(paused||pendingRoleId==null||!pageReady||!origin.isAppPage(web.getUrl()))return;
        Intent candidate=pendingNotificationIntent;
        if(!notificationTargetsCurrentSession(candidate)){clearPendingNotification();return;}
        if(!candidate.hasExtra("appSessionScope")) {
            // Do not hand a compatible notification to the page's cross-login
            // pending-chat queue. Wait for this session's boot, then recheck.
            web.evaluateJavascript("(function(){var view=document.getElementById('view');if(view&&view.getAttribute('data-route')==='auth')return 'auth';return window.Pipi&&window.Pipi.getState&&window.Pipi.getState()||view&&view.getAttribute('data-route')==='android-offline'?'ready':'wait';})()",result->{
                if(isDestroyed()||pendingNotificationIntent!=candidate)return;
                if("\"ready\"".equals(result)) dispatchPendingNotification(candidate);
                else if("\"auth\"".equals(result)) clearPendingNotification();
                else if(!paused) handler.postDelayed(this::openPendingChat,100);
            });
            return;
        }
        dispatchPendingNotification(candidate);
    }

    private void dispatchPendingNotification(Intent candidate) {
        if(pendingNotificationIntent!=candidate||!notificationTargetsCurrentSession(candidate)){clearPendingNotification();return;}
        String role=pendingRoleId;clearPendingNotification();
        String open="window.PipiAndroidPage&&window.PipiAndroidPage.openChat("+JSONObject.quote(role)+")";
        if(!candidate.hasExtra("appSessionScope")) open="(function(){var view=document.getElementById('view');if(!(window.Pipi&&window.Pipi.getState&&window.Pipi.getState())&&!(view&&view.getAttribute('data-route')==='android-offline'))return false;return "+open+";})()";
        web.evaluateJavascript(open,null);
    }

    @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent);setIntent(intent);takeIntent(intent);openPendingChat(); }
    @Override protected void onResume() { super.onResume();paused=false;appUpdater.setVisible(true);web.onResume();PhoneNotifications.setVisible(this,true);FcmTransport.setVisible(this,true);openPendingChat();enableLoginNotifications(); }
    @Override protected void onPause() {
        recordGestureDeadline = 0;
        recordTouchDown = microphonePermissionOnRelease = false;
        voiceCapture.cancel();
        paused=true;appUpdater.setVisible(false);
        if(origin.isAppPage(web.getUrl())) {
            web.evaluateJavascript("window.PipiAndroidPage&&window.PipiAndroidPage.checkpoint()",ignored->{
                if(paused&&!isDestroyed())web.onPause();
            });
        } else web.onPause();
        CookieManager.getInstance().flush();PhoneNotifications.setVisible(this,false);FcmTransport.setVisible(this,false);super.onPause();
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        appUpdater.save(out);checkpoint();Bundle history=new Bundle();web.saveState(history);out.putBundle("web_state",history);out.putString("server_origin",origin.value);super.onSaveInstanceState(out);
    }
    @Override public void onConfigurationChanged(Configuration config) {super.onConfigurationChanged(config);configureWindow();surface.requestApplyInsets();}
    @Override public boolean onKeyUp(int key,KeyEvent event) {if(key==KeyEvent.KEYCODE_MENU){showSettings();return true;}return super.onKeyUp(key,event);}
    @Override protected void onDestroy() {
        voiceCapture.cancel();
        appUpdater.close();
        connectionGeneration++;loginGeneration++;blobDownloads.cancel();network.shutdown();handler.removeCallbacksAndMessages(null);
        if(connectionForm!=null)connectionForm.dismiss();
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        if(recordingRequest!=null)recordingRequest.deny();
        if(Build.VERSION.SDK_INT>=33 && systemBackCallback!=null)
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((android.window.OnBackInvokedCallback)systemBackCallback);
        surface.removeView(web);web.destroy();super.onDestroy();
    }

    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants) {
        super.onRequestPermissionsResult(request,permissions,grants);
        boolean allowed=grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED;
        if(request==NATIVE_MICROPHONE) {
            toast(allowed ? "麦克风已开启，可以按住说话了" : "麦克风未开启，可在系统应用设置中允许录音");
        } else if(request==MICROPHONE && recordingRequest!=null) {
            if(allowed && origin.isAppPage(web.getUrl()) && origin.owns(recordingRequest.getOrigin())) recordingRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else {recordingRequest.deny();toast("录音权限未开启，可在系统应用设置中允许麦克风");}
            recordingRequest=null;
        } else if(request==NOTIFICATIONS) {
            boolean sameServer=origin.value.equals(notificationPermissionOrigin);
            notificationPermissionOrigin=null;
            if(allowed&&sameServer&&PhoneNotifications.preference(this))PhoneNotifications.setEnabled(this,true);
            else if(!allowed&&sameServer)toast("新消息提醒还没开启，之后可在「App 连接设置」中打开。");
            updateSettingsStatus();
        }
    }

    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (appUpdater.result(request,result)) return;
        if(request==PICK_FILE && fileCallback!=null) {
            ArrayList<Uri> selected=new ArrayList<>();
            if(result==RESULT_OK && data!=null) {
                ClipData clips=data.getClipData();
                if(clips!=null)for(int i=0;i<clips.getItemCount();i++)addSelectedUri(selected,clips.getItemAt(i).getUri());
                else addSelectedUri(selected,data.getData());
            }
            fileCallback.onReceiveValue(selected.isEmpty()?null:selected.toArray(new Uri[0]));fileCallback=null;
        } else if(request==SAVE_FILE) {
            Uri destination=result==RESULT_OK&&data!=null?data.getData():null;
            if(blobDownloads.pending())blobDownloads.save(destination);
            else if(destination!=null && pendingDownloadUrl!=null)
                saveDownload(data.getData(),pendingDownloadUrl,pendingDownloadCookie);
            pendingDownloadUrl=null;pendingDownloadCookie=null;
        }
    }

    private void addSelectedUri(ArrayList<Uri> files,Uri selected) {
        if(selected!=null && "content".equals(selected.getScheme()) && !getPackageName().equals(selected.getAuthority())) files.add(selected);
    }

    private void beginDownload(String url,String disposition,String mime) {
        requestDownload(url,android.webkit.URLUtil.guessFileName(url,disposition,mime),mime);
    }

    private void requestDownload(String url,String name,String mime) {
        if(!origin.isAppPage(web.getUrl()))return;
        if(blobDownloads.pending()||pendingDownloadUrl!=null){toast("请先完成当前文件的保存");return;}
        if(url.startsWith("blob:"+origin.value+"/")){blobDownloads.capture(url,name);return;}
        if(!origin.owns(Uri.parse(url))) {toast("此下载需要在手机浏览器中打开");return;}
        pendingDownloadUrl=url;pendingDownloadCookie=CookieManager.getInstance().getCookie(origin.value);
        String filename=name.replaceAll("[\\\\/:*?\"<>|]","_");
        chooseDownloadDestination(filename.isEmpty()?"download":filename,mime);
    }

    private void chooseDownloadDestination(String name,String mime) {
        Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime==null?"application/octet-stream":mime).putExtra(Intent.EXTRA_TITLE,name);
        try {startActivityForResult(save,SAVE_FILE);}
        catch(ActivityNotFoundException missing){pendingDownloadUrl=null;blobDownloads.cancel();toast("手机没有可用的文件保存器");}
    }

    private void saveDownload(Uri target,String url,String cookie) {
        network.execute(()->{
            HttpURLConnection connection=null;
            try {
                connection=origin.open(url);
                connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
                if(cookie!=null)connection.setRequestProperty("Cookie",cookie);
                if(connection.getResponseCode()!=200)throw new IOException("服务器返回 "+connection.getResponseCode());
                try(InputStream in=connection.getInputStream();OutputStream out=getContentResolver().openOutputStream(target,"w")) {
                    if(out==null)throw new IOException("无法写入选择的位置");
                    byte[] buffer=new byte[32768];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);
                }
                handler.post(()->toast("文件已保存"));
            } catch(Exception error) {handler.post(()->toast("保存失败："+error.getMessage()));}
            finally {if(connection!=null)connection.disconnect();}
        });
    }

    private void showError(String message) {
        loading.setVisibility(View.GONE);hideError();
        errorPanel=new LinearLayout(this);errorPanel.setOrientation(LinearLayout.VERTICAL);errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setBackgroundColor(Color.rgb(237,237,237));errorPanel.setPadding(dp(28),dp(28),dp(28),dp(28));
        errorPanel.addView(text(message,16));errorPanel.addView(text(origin.value,13));
        Button retry=new Button(this);retry.setText("重新连接");retry.setOnClickListener(view->connect(null));errorPanel.addView(retry);
        Button settings=new Button(this);settings.setText("App 连接设置");settings.setOnClickListener(view->showSettings());errorPanel.addView(settings);
        surface.addView(errorPanel,new FrameLayout.LayoutParams(-1,-1));
    }
    private void hideError(){if(errorPanel!=null){surface.removeView(errorPanel);errorPanel=null;}}
    private TextView text(String value,int size){TextView label=new TextView(this);label.setText(value);label.setTextSize(size);label.setTextColor(Color.rgb(55,55,55));label.setPadding(0,dp(8),0,dp(8));return label;}
    private int dp(int amount){return Math.round(amount*getResources().getDisplayMetrics().density);}
    private void toast(String message){Toast.makeText(this,message,Toast.LENGTH_LONG).show();}
    private static String jsonString(String result){try{return new JSONArray("["+result+"]").getString(0);}catch(JSONException invalid){return "";}}
}
