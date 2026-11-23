package com.pipiphone.app;

/** Standalone JVM regression: no device, Android SDK, login or network needed. */
public final class CompatNotificationBindingTest {
    private static int checks;
    private static final String A = "https://a.example", B = "https://b.example", ROLE = "friend-a";
    private static final String COOKIE_A = "pipi_session=" + "a".repeat(64), COOKIE_B = "pipi_session=" + "b".repeat(64);
    private static final class Session {
        boolean enabled = true;
        String origin = A, registeredOrigin = A, key = CompatNotificationBinding.newKey(), instance = CompatNotificationBinding.newInstance();
        long generation = 7;
        String bound = CompatNotificationBinding.cookieDigest(COOKIE_A), current = bound;
        String sign() { return CompatNotificationBinding.sign(key, instance, generation, origin, bound, ROLE); }
        boolean accept(String role, String messageOrigin, String messageInstance, String proof) {
            return CompatNotificationBinding.matches(enabled, origin, registeredOrigin, generation, instance, key, bound, current,
                    role, messageOrigin, messageInstance, proof);
        }
        void renew() { generation++;key=CompatNotificationBinding.newKey();instance=CompatNotificationBinding.newInstance();bound=current; }
    }
    private static void check(boolean value, String label) {
        checks++;if(!value)throw new AssertionError(label);
    }
    public static void main(String[] args) {
        Session session = new Session();
        String proof = session.sign(), instance = session.instance, key = session.key;
        String identity = CompatNotificationBinding.identity(instance, session.generation);
        check(session.accept(ROLE,A,instance,proof),"current notification opens");
        check(session.accept(ROLE,A,instance,proof),"persisted binding survives process restart");
        check(!session.accept(ROLE,null,instance,proof),"launcher extra without origin rejected");
        check(!session.accept(ROLE,A,null,proof),"launcher extra without app instance rejected");
        check(!session.accept(ROLE,A,instance,null),"unsigned role rejected");
        check(!session.accept("another-friend",A,instance,proof),"role cannot be retargeted");
        check(!session.accept(ROLE,B,instance,proof),"foreign server rejected");
        check(!session.accept(ROLE,A,instance,"0".repeat(64)),"forged proof rejected");
        session.enabled=false;check(!session.accept(ROLE,A,instance,proof),"disabled notification rejected");
        session.enabled=true;session.renew();
        check(!session.accept(ROLE,A,instance,proof),"old notification stays invalid after re-enable");
        check(session.accept(ROLE,A,session.instance,session.sign()),"new notification works after re-enable");
        check(!identity.equals(CompatNotificationBinding.identity(session.instance,session.generation)),"new PendingIntent identity cannot update old handle");
        check(!key.equals(session.key)&&!instance.equals(session.instance),"enable uses fresh private key and random instance");
        proof=session.sign();instance=session.instance;
        session.current="";check(!session.accept(ROLE,A,instance,proof),"logout rejected");
        session.current=CompatNotificationBinding.cookieDigest(COOKIE_B);
        check(!session.accept(ROLE,A,instance,proof),"same-origin re-login rejected before refresh");
        session.renew();
        check(!session.accept(ROLE,A,instance,proof),"same-origin old session remains rejected after refresh");
        check(session.accept(ROLE,A,session.instance,session.sign()),"new session notification works");
        proof=session.sign();instance=session.instance;
        session.origin=B;session.registeredOrigin=B;session.renew();
        check(!session.accept(ROLE,A,instance,proof),"switch server rejected");
        session.origin=A;session.registeredOrigin=A;session.renew();
        check(!session.accept(ROLE,A,instance,proof),"switch back does not revive old notification");
        check(session.accept(ROLE,A,session.instance,session.sign()),"new notification after switching back works");
        proof=session.sign();instance=session.instance;session.generation++;
        check(!session.accept(ROLE,A,instance,proof),"switching transport invalidates previous compatible generation");
        check(session.accept(ROLE,A,instance,session.sign()),"resumed compatible transport signs current generation");
        session.key="";session.instance="";session.bound="";
        check(!session.accept(ROLE,A,null,null),"enabled pre-upgrade state rejects legacy unsigned notification");
        session.renew();
        check(session.accept(ROLE,A,session.instance,session.sign()),"migrated enabled state accepts next newly issued notification");
        check(CompatNotificationBinding.cookieDigest("other=1; "+COOKIE_A+"; another=2").equals(CompatNotificationBinding.cookieDigest(COOKIE_A)),"unrelated cookie order does not invalidate login");
        check(CompatNotificationBinding.cookieDigest(null).isEmpty(),"absent login has no digest");
        check(CompatNotificationBinding.cookieDigest("other=1").isEmpty(),"non-login cookie has no digest");
        check(!session.sign().contains("b".repeat(64)),"proof does not carry cookie bytes");
        for (String persisted : new String[]{"http://203.0.113.23:18766", "https://phone.example.com:8443", "https://[2001:db8:0:0:0:0:0:1]:8443"}) {
            Session saved = new Session(); saved.origin=persisted;saved.registeredOrigin=persisted;
            check(saved.accept(ROLE,persisted,saved.instance,saved.sign()),"unchanged persisted server binding remains usable");
        }
        Session ip = new Session(); ip.origin="http://203.0.113.23:18766";ip.registeredOrigin=ip.origin;
        for (String foreign : new String[]{"http://203.0.113.24:18766", "http://203.0.113.23:18767", "https://203.0.113.23:18766"}) {
            check(!ip.accept(ROLE,foreign,ip.instance,ip.sign()),"IP notification cannot cross host, port or scheme");
            ip.registeredOrigin=foreign;
            check(!ip.accept(ROLE,ip.origin,ip.instance,ip.sign()),"old registered server cannot reuse current origin proof");
        }
        System.out.println("PASS: "+checks+" notification binding scenarios");
    }
}
