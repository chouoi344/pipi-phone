// SPDX-License-Identifier: AGPL-3.0-only
package com.pipiphone.app;

import android.content.Intent;
import android.os.Handler;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

/** Production lifecycle; latches hold old I/O until the new login has been delivered. */
public final class PhoneNotificationsServiceTest {
    static int passed;
    interface Checked { void run() throws Exception; }
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static void until(BooleanSupplier ready) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        while (!ready.getAsBoolean()) {
            if (System.nanoTime()>deadline) throw new AssertionError("Timed out waiting for service");
            Thread.sleep(5);
        }
    }
    static void test(String name, Checked task) throws Exception {
        PhoneNotifications.reset(); Handler.drain();
        try { task.run(); passed++; }
        catch (Exception | AssertionError error) { throw new AssertionError(name,error); }
    }
    static PhoneNotificationsService start() throws Exception {
        PhoneNotificationsService service=new PhoneNotificationsService();
        service.onStartCommand(new Intent(),0,1);
        until(()->PhoneNotifications.open.get()==1 && PhoneNotifications.status.startsWith("实时连接中"));
        return service;
    }
    static void destroy(PhoneNotificationsService service) throws Exception {
        PhoneNotifications.closeGate=null; service.onDestroy();
        until(()->PhoneNotifications.open.get()==0); Handler.drain();
        check(!PhoneNotificationsService.running,"destroy must clear the running marker");
    }
    public static void main(String[] args) throws Exception {
        test("duplicate start preserves the current session and one long connection",()->{
            PhoneNotificationsService service=start();
            try {
                service.onStartCommand(new Intent(),0,2);
                check(PhoneNotifications.syncs.get()==1 && PhoneNotifications.connections.get()==1,"duplicate start created another connection");
                check(PhoneNotifications.open.get()==1 && service.stops==0,"duplicate start stopped the current connection");
            } finally { destroy(service); }
        });
        test("same-origin relogin takes over while old disconnect stays off the main thread",()->{
            PhoneNotificationsService service=start();
            CountDownLatch gate=new CountDownLatch(1); PhoneNotifications.closeGate=gate;PhoneNotifications.closing=new CountDownLatch(1);
            try {
                PhoneNotifications.generation=2;PhoneNotifications.cookie="login-b";
                CountDownLatch returned=new CountDownLatch(1);
                new Thread(()->{service.onStartCommand(new Intent(),0,2);returned.countDown();},"test-main-dispatch").start();
                check(returned.await(1,TimeUnit.SECONDS),"start blocked on old I/O");
                check(PhoneNotifications.closing.await(1,TimeUnit.SECONDS),"old connection was not cancelled");
                check(PhoneNotifications.connections.get()==1,"new worker overlapped old connection");
                gate.countDown();
                until(()->PhoneNotifications.connections.get()==2 && PhoneNotifications.open.get()==1);
                Handler.drain();
                check(service.stops==0 && PhoneNotificationsService.running,"old worker stopped the new login");
                check(PhoneNotifications.synced.equals(List.of(1L,2L)) && PhoneNotifications.maxOpen.get()==1,"handover duplicated or skipped a connection");
            } finally { gate.countDown(); destroy(service); }
        });
        test("late old authentication error cannot disable a newer or queued login",()->{
            CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
            PhoneNotifications.synchronization=(generation,check)->{
                if(generation==1){entered.countDown();PhoneNotifications.await(release);throw new PhoneNotifications.AuthenticationExpired();}
                return 42;
            };
            PhoneNotificationsService service=new PhoneNotificationsService();
            try {
                service.onStartCommand(new Intent(),0,1);check(entered.await(1,TimeUnit.SECONDS),"initial sync not entered");
                PhoneNotifications.generation=2;PhoneNotifications.cookie="login-b";service.onStartCommand(new Intent(),0,2);
                PhoneNotifications.generation=3;PhoneNotifications.cookie="login-c";service.onStartCommand(new Intent(),0,3);
                release.countDown();
                until(()->PhoneNotifications.open.get()==1);Handler.drain();
                check(PhoneNotifications.disables.get()==0 && PhoneNotifications.enabled,"late old response disabled the new login");
                check(PhoneNotifications.synced.equals(List.of(1L,3L)) && PhoneNotifications.connections.get()==1,"obsolete queued session opened a stream");
                check(service.stops==0,"obsolete completion stopped the latest service");
            } finally { release.countDown(); destroy(service); }
        });
        test("a changed login cookie takes over even when the generation has not changed yet",()->{
            PhoneNotificationsService service=start();
            try {
                PhoneNotifications.cookie="login-b";service.onStartCommand(new Intent(),0,2);
                until(()->PhoneNotifications.connections.get()==2 && PhoneNotifications.open.get()==1);Handler.drain();
                check(service.stops==0 && PhoneNotifications.maxOpen.get()==1,"cookie rotation lost or duplicated the stream");
            } finally { destroy(service); }
        });
        test("late successful old response cannot open an obsolete stream or stop its replacement",()->{
            CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
            PhoneNotifications.synchronization=(generation,check)->{
                if(generation==1){entered.countDown();PhoneNotifications.await(release);}
                return 42;
            };
            PhoneNotificationsService service=new PhoneNotificationsService();
            try {
                service.onStartCommand(new Intent(),0,1);check(entered.await(1,TimeUnit.SECONDS),"initial sync not entered");
                PhoneNotifications.generation=2;PhoneNotifications.cookie="login-b";service.onStartCommand(new Intent(),0,2);
                release.countDown();until(()->PhoneNotifications.open.get()==1);Handler.drain();
                check(PhoneNotifications.synced.equals(List.of(1L,2L)) && PhoneNotifications.connections.get()==1,"late response opened an obsolete stream");
                check(service.stops==0 && PhoneNotifications.status.startsWith("实时连接中"),"late response stopped or overwrote the new session");
            } finally { release.countDown(); destroy(service); }
        });
        test("stop action disables and destroys the service without reviving a connection",()->{
            PhoneNotificationsService service=start();
            try {
                service.onStartCommand(new Intent().setAction("stop"),0,2);
                check(!PhoneNotifications.enabled && service.stops==1,"stop action did not stop the service");
            } finally { destroy(service); }
            check(PhoneNotifications.connections.get()==1,"stopping started another connection");
        });
        test("system timeout cancels the current stream and keeps its final status",()->{
            PhoneNotificationsService service=start();
            try {
                service.onTimeout(1,1);
                until(()->PhoneNotifications.open.get()==0);Handler.drain();
                check(service.stops>=1 && PhoneNotifications.status.startsWith("系统已结束实时连接"),"timeout failed or late worker overwrote status");
            } finally { destroy(service); }
            check(PhoneNotifications.connections.get()==1,"timeout revived a connection");
        });
        System.out.println("PASS notification service handover: "+passed+" controlled lifecycle cases");
    }
}
