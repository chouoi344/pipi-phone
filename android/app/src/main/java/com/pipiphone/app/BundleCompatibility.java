package com.pipiphone.app;

import org.json.JSONArray;
import org.json.JSONObject;

/** Protocol compatibility and the separate, explicitly reviewed legacy gate. */
final class BundleCompatibility {
    static final String SERVER_0_13_11 = "d778b7ae7be4461b62cdbdef5e60f36cbdbd23e10fa4d5e6cc6c6c7a3b5700a4";
    static final String EARLIER_LOCAL_83 = "584ae6ee785ae12b2570cc7522b81d8c6e3aa232a7d7b9b2070c9edc7cf71567";
    static final String PRE_UI_NATIVE_VOICE = "38659185cd370c07921a26111bcb531efdce05216386de3e0bed461f3ca42776";
    static final String PRE_CONTROL_FIT = "064ff814d28a005785d4e5cdb16a35076ce840894773d4e6cc378b24734dc4a7";
    static final String SERVER_0_13_12 = "375e57fe5cb72d753bfa2d71d1eb1d1f66d066eb76f30d8f749c5da8efa00b99";
    // Server 0.13.14 only changed its installer and uses the same page as 0.13.13.
    static final String SERVER_0_13_13 = "f7ec36c35f16519ac6f6e6f14eb4db3213b036928a8869c56a77a6fad81a92f0";
    static final String PRE_CHAT_PHOTO_FIX = "65902fa6fc397750d9183c388c3f72df0a1eda45f5956cd39b8091c0ddd4ddad";
    static final String SERVER_0_13_15 = "ecfa9734011d1bab1de2d0fb62a8afddb43b158ce0a62888940a6d9261057845";
    static final String WEBVIEW_83_BUNDLE = "7acc1768fedd84b1cabab23199e09b927f694a0fff1754f9d4254cf9d9b89067";
    private BundleCompatibility() {}

    static boolean supportsClientProtocol(Object value) {
        if (!(value instanceof JSONObject)) return false;
        JSONObject protocol = (JSONObject) value;
        if (!"pipi-phone".equals(protocol.opt("name"))) return false;
        Object version = protocol.opt("version");
        if (!(version instanceof Integer || version instanceof Long) || ((Number) version).longValue() != 1) return false;
        Object features = protocol.opt("features");
        if (!(features instanceof JSONArray)) return false;
        JSONArray values = (JSONArray) features;
        boolean state = false, progress = false;
        for (int i = 0; i < values.length(); i++) {
            Object feature = values.opt(i);
            if (!(feature instanceof String)) return false;
            state |= "state-v1".equals(feature);
            progress |= "chat-progress-v1".equals(feature);
        }
        return state && progress;
    }

    static boolean accepts(String localHash, String serverHash) {
        return localHash.equals(serverHash)
                || WEBVIEW_83_BUNDLE.equals(localHash) && (SERVER_0_13_11.equals(serverHash)
                    || EARLIER_LOCAL_83.equals(serverHash) || PRE_UI_NATIVE_VOICE.equals(serverHash)
                    || PRE_CONTROL_FIT.equals(serverHash) || SERVER_0_13_12.equals(serverHash)
                    || SERVER_0_13_13.equals(serverHash) || PRE_CHAT_PHOTO_FIX.equals(serverHash)
                    || SERVER_0_13_15.equals(serverHash));
    }
}
