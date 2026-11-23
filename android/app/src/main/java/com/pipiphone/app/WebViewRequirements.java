package com.pipiphone.app;

/** Exact browser probes, kept independent of Android for isolated verification. */
final class WebViewRequirements {
    private WebViewRequirements() {}
    // ES5 syntax is intentional: old engines must be able to report false.
    static final String FEATURES = "(function(){var missing=[];function need(type,name){if(type!=='function')missing.push(name);}need(typeof Object.fromEntries,'Object.fromEntries');need(typeof fetch,'fetch');need(typeof URL,'URL');need(typeof URLSearchParams,'URLSearchParams');need(typeof FormData,'FormData');need(typeof Promise,'Promise');need(typeof AbortController,'AbortController');return missing;})()";
    // evaluateJavascript runs this directly; no eval()/Function() is needed,
    // so the page's Content Security Policy does not produce a false failure.
    static final String SYNTAX = "(function(){let value={n:1};let n=value?.n??0;return n===1;})()";
    // Called only after onPageFinished: parsing/runtime failure is distinct from
    // a slow API response, which must be allowed to finish inside the page.
    static final String PAGE_STARTED = "(function(){var view=document.getElementById('view');return !!(view&&view.getAttribute('data-route')||window.Pipi&&typeof window.Pipi.getState==='function'&&window.PipiAndroidPage&&typeof window.PipiAndroidPage.connect==='function');})()";
    static boolean passed(String result) { return "true".equals(result) || "[]".equals(result); }
}
