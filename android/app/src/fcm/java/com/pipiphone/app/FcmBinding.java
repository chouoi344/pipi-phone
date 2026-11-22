// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

/** Pure comparison boundary shared by cold-start notification routing and JVM tests. */
final class FcmBinding {
    static boolean matches(boolean enabled,String currentOrigin,String registeredOrigin,String scope,String storedCookieHash,String currentCookieHash,String messageOrigin,String messageScope) {
        return enabled&&!scope.isEmpty()&&!storedCookieHash.isEmpty()&&currentOrigin.equals(registeredOrigin)
                &&currentOrigin.equals(messageOrigin)&&scope.equals(messageScope)&&storedCookieHash.equals(currentCookieHash);
    }
}
