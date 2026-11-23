package com.pipiphone.app;

/** Allow the bundled page to use only explicitly reviewed older servers. */
final class BundleCompatibility {
    static final String SERVER_0_13_11 = "d778b7ae7be4461b62cdbdef5e60f36cbdbd23e10fa4d5e6cc6c6c7a3b5700a4";
    static final String EARLIER_LOCAL_83 = "584ae6ee785ae12b2570cc7522b81d8c6e3aa232a7d7b9b2070c9edc7cf71567";
    static final String PRE_UI_NATIVE_VOICE = "38659185cd370c07921a26111bcb531efdce05216386de3e0bed461f3ca42776";
    static final String PRE_CONTROL_FIT = "064ff814d28a005785d4e5cdb16a35076ce840894773d4e6cc378b24734dc4a7";
    static final String SERVER_0_13_12 = "375e57fe5cb72d753bfa2d71d1eb1d1f66d066eb76f30d8f749c5da8efa00b99";
    static final String WEBVIEW_83_BUNDLE = "17b3700d74390ff4bb240ff3dddfb72e8c853e8ca6cfbe779fb3182c918ceca2";
    private BundleCompatibility() {}

    static boolean accepts(String localHash, String serverHash) {
        return localHash.equals(serverHash)
                || WEBVIEW_83_BUNDLE.equals(localHash) && (SERVER_0_13_11.equals(serverHash)
                    || EARLIER_LOCAL_83.equals(serverHash) || PRE_UI_NATIVE_VOICE.equals(serverHash)
                    || PRE_CONTROL_FIT.equals(serverHash) || SERVER_0_13_12.equals(serverHash));
    }
}
