package com.pipiphone.app;

/** Exact browser probes, kept independent of Android for isolated verification. */
final class WebViewRequirements {
    private WebViewRequirements() {}
    // ES5 syntax is intentional: old engines must be able to report false.
    static final String FEATURES = "(function(){return typeof Object.fromEntries==='function'&&typeof Object.hasOwn==='function'&&typeof Array.prototype.at==='function'&&typeof Array.prototype.findLast==='function'&&typeof ResizeObserver==='function'&&typeof AbortController==='function'&&typeof fetch==='function'&&typeof URL==='function'&&typeof FormData==='function';})()";
    // evaluateJavascript runs this directly; no eval()/Function() is needed,
    // so the page's Content Security Policy does not produce a false failure.
    static final String SYNTAX = "(function(){let value={n:1};let n=value?.n??0;n&&=1;return n===1;})()";
    static boolean passed(String result) { return "true".equals(result); }
}
