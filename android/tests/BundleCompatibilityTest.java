package com.pipiphone.app;

public final class BundleCompatibilityTest {
    private static void check(boolean result, String message) {
        if (!result) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        String local = BundleCompatibility.WEBVIEW_83_BUNDLE;
        String remote = BundleCompatibility.SERVER_0_13_11;
        check(local.matches("[a-f0-9]{64}"), "The audited replacement must pin a real local bundle");
        check(remote.matches("[a-f0-9]{64}"), "The official server must pin a real bundle");
        check(!local.equals(remote), "The replacement is distinct from the older server page");
        check(BundleCompatibility.accepts(local, remote), "The audited server can use the compatible local page");
        check(BundleCompatibility.accepts(local, BundleCompatibility.EARLIER_LOCAL_83), "The prior local 0.13.11 ZIP can use native voice");
        check(BundleCompatibility.accepts(local, BundleCompatibility.PRE_UI_NATIVE_VOICE), "The pre-UI native voice server can use the audited new page");
        check(BundleCompatibility.accepts(local, BundleCompatibility.PRE_CONTROL_FIT), "The preceding UI build can use the current local page");
        check(BundleCompatibility.accepts(local, BundleCompatibility.SERVER_0_13_12), "The previous release can use the corrected local layout");
        check(BundleCompatibility.accepts(local, local), "An exact current server bundle still works");
        check(BundleCompatibility.accepts(remote, remote), "Other exact matching bundles still work");
        check(!BundleCompatibility.accepts("0".repeat(64), remote), "A future local edit invalidates the old mapping");
        check(!BundleCompatibility.accepts(local, "0".repeat(64)), "An unknown server cannot use the replacement");
        check(!BundleCompatibility.accepts(remote, local), "Compatibility is directional");
        check(!BundleCompatibility.accepts(local, ""), "A missing remote manifest cannot select the replacement");
        System.out.println("BundleCompatibilityTest passed");
    }
}
