// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** Background notification payloads are displayed by FCM; foreground uses the page banner. */
public final class FcmMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) { FcmTransport.onNewToken(this); }
    @Override public void onMessageReceived(RemoteMessage message) {
        // The server sends only generic system notifications. The foreground
        // page receives its authenticated state independently and owns its banner.
    }
}
