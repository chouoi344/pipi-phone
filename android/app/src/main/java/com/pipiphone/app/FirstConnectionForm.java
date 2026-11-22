package com.pipiphone.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Build;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.text.method.HideReturnsTransformationMethod;
import android.text.method.PasswordTransformationMethod;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

/** Native first connection form. Passwords stay only in the current input and submit callback. */
public final class FirstConnectionForm extends Dialog {
    public interface Listener {
        void submit(String address, String password, boolean notifications);
        void cancel();
        default void notificationsChanged(boolean enabled) {}
    }

    private static final int TEXT = Color.rgb(25, 25, 25);
    private static final int HINT = Color.rgb(96, 104, 101);
    private static final int GREEN = Color.rgb(8, 124, 76);
    private static final int ERROR = Color.rgb(175, 48, 46);
    private final Listener listener;
    private final FrameLayout root;
    private final ScrollView scroll;
    private final LinearLayout content;
    private final EditText address, password;
    private final TextView addressError, passwordError, formError;
    private final Button reveal, enter, exit;
    private final Switch notifications;
    private final LinearLayout notificationRow;
    private boolean busy, passwordVisible;

    public FirstConnectionForm(Activity activity, String initialAddress, boolean initialNotifications,
                               String cancelLabel, Listener listener) {
        super(activity, android.R.style.Theme_Material_Light_NoActionBar);
        this.listener = listener;
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setCanceledOnTouchOutside(false);
        setOnCancelListener(dialog -> listener.cancel());

        root = new FrameLayout(getContext());
        root.setBackgroundColor(Color.WHITE);
        root.setFocusableInTouchMode(true);
        if (Build.VERSION.SDK_INT >= 26)
            root.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        if (Build.VERSION.SDK_INT >= 30)
            root.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);

        scroll = new ScrollView(getContext());
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        root.addView(scroll, new FrameLayout.LayoutParams(-1, -1));

        content = new LinearLayout(getContext());
        content.setOrientation(LinearLayout.VERTICAL);
        FormContainer container = new FormContainer();
        container.addView(content, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL));
        scroll.addView(container, new ScrollView.LayoutParams(-1, -2));

        LinearLayout header = new LinearLayout(getContext());
        header.setGravity(Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(getContext());
        mark.setImageResource(R.drawable.ic_first_connection_chat);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        header.addView(mark, new LinearLayout.LayoutParams(dp(46), dp(46)));
        TextView title = text("连接你的小手机", 23, TEXT);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        if (Build.VERSION.SDK_INT >= 28) title.setAccessibilityHeading(true);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, -2, 1);
        titleParams.leftMargin = dp(12);
        header.addView(title, titleParams);
        LinearLayout.LayoutParams headerParams = new LinearLayout.LayoutParams(-1, -2);
        headerParams.bottomMargin = dp(28);
        content.addView(header, headerParams);

        address = input(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI, "粘贴网址");
        address.setText(initialAddress);
        address.setImeOptions(EditorInfo.IME_ACTION_NEXT | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        addressError = errorText();
        addField("小手机的网址", "打开网页版，把地址栏里的网址复制到这里。", address, address, addressError, 0);

        password = input(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, "输入密码");
        password.setSaveEnabled(false);
        password.setSaveFromParentEnabled(false);
        password.setFilters(new InputFilter[]{new InputFilter.LengthFilter(256)});
        int passwordIme = EditorInfo.IME_ACTION_GO | EditorInfo.IME_FLAG_NO_EXTRACT_UI;
        if (Build.VERSION.SDK_INT >= 26) passwordIme |= EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
        password.setImeOptions(passwordIme);
        password.setTransformationMethod(PasswordTransformationMethod.getInstance());
        password.setPadding(dp(12), dp(11), dp(64), dp(11));
        FrameLayout passwordBox = new FrameLayout(getContext());
        passwordBox.addView(password, new FrameLayout.LayoutParams(-1, -2));
        reveal = button("显示", Color.rgb(56, 93, 76), Color.TRANSPARENT);
        reveal.setTextSize(14);
        reveal.setContentDescription("显示密码");
        reveal.setOnClickListener(view -> showPassword(!passwordVisible));
        passwordBox.addView(reveal, new FrameLayout.LayoutParams(dp(60), -1, Gravity.END));
        passwordError = errorText();
        addField("小手机密码", "就是你第一次打开网页版时设置的密码。", passwordBox, password, passwordError, 19);

        LinearLayout notice = new LinearLayout(getContext());
        notice.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams noticeParams = new LinearLayout.LayoutParams(-1, -2);
        noticeParams.topMargin = dp(23);
        noticeParams.bottomMargin = dp(23);
        content.addView(notice, noticeParams);
        notice.addView(divider(), new LinearLayout.LayoutParams(-1, dp(1)));
        notificationRow = new LinearLayout(getContext());
        notificationRow.setGravity(Gravity.CENTER_VERTICAL);
        notificationRow.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        notificationRow.setPadding(0, dp(16), 0, dp(16));
        LinearLayout copy = new LinearLayout(getContext());
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        TextView noticeTitle = label("新消息提醒");
        copy.addView(noticeTitle, new LinearLayout.LayoutParams(-1, -2));
        TextView noticeHint = text("登录后，去用别的 App 也能收到提醒。有时会晚一点。", 14, HINT);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(-1, -2);
        hintParams.topMargin = dp(3);
        copy.addView(noticeHint, hintParams);
        notificationRow.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));
        notifications = new Switch(getContext());
        notifications.setId(View.generateViewId());
        notifications.setShowText(false);
        notifications.setSwitchMinWidth(dp(46));
        notifications.setMinimumHeight(dp(48));
        notifications.setPadding(0, 0, 0, 0);
        notifications.setThumbTintList(ColorStateList.valueOf(Color.WHITE));
        notifications.setTrackTintList(new ColorStateList(
                new int[][]{new int[]{android.R.attr.state_checked}, new int[]{}},
                new int[]{Color.rgb(7, 135, 82), Color.rgb(119, 126, 122)}));
        notifications.setContentDescription("新消息提醒。登录后，去用别的 App 也能收到提醒。有时会晚一点。");
        notifications.setChecked(initialNotifications);
        notifications.setOnCheckedChangeListener((view, enabled) -> listener.notificationsChanged(enabled));
        notificationRow.setOnClickListener(view -> notifications.toggle());
        LinearLayout.LayoutParams switchParams = new LinearLayout.LayoutParams(-2, -2);
        switchParams.leftMargin = dp(16);
        notificationRow.addView(notifications, switchParams);
        notice.addView(notificationRow, new LinearLayout.LayoutParams(-1, -2));
        notice.addView(divider(), new LinearLayout.LayoutParams(-1, dp(1)));

        enter = button("进入小手机", Color.WHITE, GREEN);
        enter.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        enter.setOnClickListener(view -> submit());
        content.addView(enter, new LinearLayout.LayoutParams(-1, -2));
        exit = button(cancelLabel, Color.rgb(85, 95, 89), Color.TRANSPARENT);
        exit.setOnClickListener(view -> cancel());
        LinearLayout.LayoutParams exitParams = new LinearLayout.LayoutParams(-1, -2);
        exitParams.topMargin = dp(4);
        content.addView(exit, exitParams);
        formError = errorText();
        LinearLayout.LayoutParams formErrorParams = new LinearLayout.LayoutParams(-1, -2);
        formErrorParams.topMargin = dp(6);
        content.addView(formError, formErrorParams);

        clearErrorWhenEdited(address, addressError);
        clearErrorWhenEdited(password, passwordError);
        address.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_NEXT) return false;
            password.requestFocus();
            return true;
        });
        password.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_GO) return false;
            submit();
            return true;
        });
        installInsets();
        setContentView(root);
    }

    @Override public void show() {
        Window window = getWindow();
        window.setBackgroundDrawableResource(android.R.color.white);
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                | WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        window.getDecorView().setSystemUiVisibility(flags);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams params = window.getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(params);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false);
        super.show();
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.requestFocus();
        root.requestApplyInsets();
    }

    @Override public void dismiss() {
        InputMethodManager keyboard = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        keyboard.hideSoftInputFromWindow(password.getWindowToken(), 0);
        password.getText().clear();
        showPassword(false);
        super.dismiss();
    }

    public void setBusy(boolean value) {
        busy = value;
        address.setEnabled(!value);
        password.setEnabled(!value);
        reveal.setEnabled(!value);
        notifications.setEnabled(!value);
        notificationRow.setEnabled(!value);
        enter.setEnabled(!value);
        exit.setEnabled(!value);
        enter.setAlpha(value ? .63f : 1f);
        exit.setAlpha(value ? .63f : 1f);
        reveal.setAlpha(value ? .63f : 1f);
        notifications.setAlpha(value ? .63f : 1f);
        enter.setText(value ? "正在打开…" : "进入小手机");
    }

    /** field is one of address, password, or form. An empty message clears that error. */
    public void showError(String field, String message) {
        TextView target;
        EditText input;
        switch (field) {
            case "address": target = addressError; input = address; break;
            case "password": target = passwordError; input = password; break;
            case "form": target = formError; input = null; break;
            default: throw new IllegalArgumentException("Unknown connection form field: " + field);
        }
        target.setText(message);
        target.setVisibility(message.isEmpty() ? View.GONE : View.VISIBLE);
        if (input != null) input.setBackground(inputBackground(!message.isEmpty()));
        if (message.isEmpty()) return;
        if (input != null) input.requestFocus();
        target.post(() -> target.requestRectangleOnScreen(new Rect(0, 0, target.getWidth(), target.getHeight() + dp(12)), false));
    }

    private void submit() {
        if (busy) return;
        clearErrors();
        String nextAddress = address.getText().toString().trim();
        String secret = password.getText().toString();
        if (nextAddress.isEmpty()) { showError("address", "先把小手机的网址贴在这里。"); return; }
        if (secret.isEmpty()) { showError("password", "请先输入小手机密码。"); return; }
        listener.submit(nextAddress, secret, notifications.isChecked());
    }

    private void showPassword(boolean visible) {
        passwordVisible = visible;
        int start = password.getSelectionStart(), end = password.getSelectionEnd();
        password.setTransformationMethod(visible ? HideReturnsTransformationMethod.getInstance()
                : PasswordTransformationMethod.getInstance());
        if (start >= 0 && end >= 0) password.setSelection(start, end);
        reveal.setText(visible ? "隐藏" : "显示");
        reveal.setContentDescription(visible ? "隐藏密码" : "显示密码");
    }

    private void clearErrors() {
        showError("address", "");
        showError("password", "");
        showError("form", "");
    }

    private void clearErrorWhenEdited(EditText input, TextView error) {
        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence text, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence text, int start, int before, int count) {
                error.setText("");
                error.setVisibility(View.GONE);
                input.setBackground(inputBackground(false));
                formError.setText("");
                formError.setVisibility(View.GONE);
            }
            @Override public void afterTextChanged(Editable text) {}
        });
        input.setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                boolean invalid = error.getVisibility() == View.VISIBLE;
                info.setContentInvalid(invalid);
                if (invalid) info.setError(error.getText());
            }
        });
    }

    private void addField(String name, String hint, View control, EditText input, TextView error, int margin) {
        LinearLayout field = new LinearLayout(getContext());
        field.setOrientation(LinearLayout.VERTICAL);
        TextView label = label(name);
        label.setLabelFor(input.getId());
        field.addView(label, new LinearLayout.LayoutParams(-1, -2));
        TextView detail = text(hint, 14, HINT);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(-1, -2);
        detailParams.topMargin = dp(3);
        detailParams.bottomMargin = dp(8);
        field.addView(detail, detailParams);
        field.addView(control, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout.LayoutParams errorParams = new LinearLayout.LayoutParams(-1, -2);
        errorParams.topMargin = dp(6);
        field.addView(error, errorParams);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(margin);
        content.addView(field, params);
    }

    private EditText input(int type, String placeholder) {
        EditText input = new EditText(getContext());
        input.setId(View.generateViewId());
        input.setTextSize(16);
        input.setTextColor(TEXT);
        input.setHintTextColor(Color.rgb(116, 124, 120));
        input.setHint(placeholder);
        input.setInputType(type);
        input.setSingleLine(true);
        input.setMinimumHeight(dp(48));
        input.setPadding(dp(12), dp(11), dp(12), dp(11));
        input.setBackground(inputBackground(false));
        return input;
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(getContext());
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
        view.setLineSpacing(0, 1.1f);
        return view;
    }

    private TextView label(String value) {
        TextView view = text(value, 16, TEXT);
        view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        return view;
    }

    private TextView errorText() {
        TextView view = text("", 14, ERROR);
        view.setVisibility(View.GONE);
        view.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_ASSERTIVE);
        return view;
    }

    private Button button(String value, int textColor, int background) {
        Button view = new Button(getContext());
        view.setText(value);
        view.setTextSize(16);
        view.setTextColor(textColor);
        view.setAllCaps(false);
        view.setMinHeight(dp(48));
        view.setMinimumHeight(dp(48));
        view.setMinWidth(0);
        view.setMinimumWidth(0);
        view.setPadding(dp(8), dp(10), dp(8), dp(10));
        view.setStateListAnimator(null);
        view.setBackground(new RippleDrawable(ColorStateList.valueOf(Color.rgb(218, 232, 223)),
                rounded(background, 9), rounded(Color.WHITE, 9)));
        return view;
    }

    private Drawable inputBackground(boolean invalid) {
        StateListDrawable states = new StateListDrawable();
        GradientDrawable focused = rounded(Color.WHITE, 9);
        focused.setStroke(dp(2), invalid ? ERROR : Color.rgb(20, 128, 85));
        states.addState(new int[]{android.R.attr.state_focused}, focused);
        GradientDrawable normal = rounded(Color.WHITE, 9);
        normal.setStroke(dp(1), invalid ? ERROR : Color.rgb(198, 206, 201));
        states.addState(new int[]{}, normal);
        return states;
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private View divider() {
        View line = new View(getContext());
        line.setBackgroundColor(Color.rgb(229, 233, 230));
        return line;
    }

    private void installInsets() {
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                left = bars.left; top = bars.top; right = bars.right;
                bottom = Math.max(bars.bottom, keyboard.bottom);
            } else {
                left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            }
            root.setPadding(left, top, right, bottom);
            return insets;
        });
    }

    private int dp(int value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    /** A centered reading width, with no fixed height so large text and the IME can scroll. */
    private final class FormContainer extends FrameLayout {
        FormContainer() { super(FirstConnectionForm.this.getContext()); }
        @Override protected void onMeasure(int widthSpec, int heightSpec) {
            int availableWidth = MeasureSpec.getSize(widthSpec);
            FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) content.getLayoutParams();
            params.width = Math.min(availableWidth, dp(440));
            int side = params.width <= dp(350) ? dp(18) : dp(24);
            int viewportHeight = root.getHeight() - root.getPaddingTop() - root.getPaddingBottom();
            if (viewportHeight == 0) viewportHeight = getResources().getDisplayMetrics().heightPixels;
            int top = Math.max(dp(24), Math.min(dp(52), Math.round(viewportHeight * .06f)));
            content.setPadding(side, top, side, dp(24));
            super.onMeasure(widthSpec, heightSpec);
        }
    }

}
