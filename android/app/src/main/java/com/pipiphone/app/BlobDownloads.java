package com.pipiphone.app;

import android.app.Activity;
import android.net.Uri;
import android.os.Handler;
import android.util.Base64;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;

/** Saves only a page-owned Blob to a destination explicitly chosen in Android. */
final class BlobDownloads {
    interface Host {
        boolean trusted();
        void chooseDestination(String name,String mime);
        void notice(String message);
    }
    private static final int CHUNK=192*1024;
    private final Activity activity;
    private final WebView web;
    private final ExecutorService io;
    private final Handler handler;
    private final Host host;
    private Download current;
    private boolean preparing;
    private int generation;

    private static final class Download {
        final String token;
        final long size;
        long offset;
        OutputStream stream;
        Download(String token,long size){this.token=token;this.size=size;}
    }

    BlobDownloads(Activity activity,WebView web,ExecutorService io,Handler handler,Host host) {
        this.activity=activity;this.web=web;this.io=io;this.handler=handler;this.host=host;
    }

    void install() {
        if(!host.trusted())return;
        web.evaluateJavascript("(function(){if(window.__pipiAndroidCaptureDownload)return;window.__pipiAndroidDownloads=Object.create(null);"
                +"var blobs=new Map(),create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);"
                +"URL.createObjectURL=function(blob){var url=create(blob);if(blob instanceof Blob)blobs.set(url,blob);return url};"
                +"URL.revokeObjectURL=function(url){blobs.delete(url);revoke(url)};"
                +"window.__pipiAndroidCaptureDownload=function(url,name){if(!url.startsWith('blob:'+location.origin+'/'))return;"
                +"var token='b'+Date.now().toString(36)+Math.random().toString(36).slice(2),blob=blobs.get(url),item={name:String(name||'download').slice(0,160),blob:blob,error:blob?'':'导出内容已失效，请重新操作'};"
                +"window.__pipiAndroidDownloads[token]=item;location.href='/__android/download?token='+token};"
                +"document.addEventListener('click',function(event){var a=event.target.closest&&event.target.closest('a[download]');"
                +"if(!a)return;if(a.href.startsWith('blob:'+location.origin+'/')){event.preventDefault();window.__pipiAndroidCaptureDownload(a.href,a.download)}"
                +"else{var url=new URL(a.href,location.href);if(url.origin===location.origin&&(url.protocol==='http:'||url.protocol==='https:')){"
                +"event.preventDefault();location.href='/__android/network-download?url='+encodeURIComponent(url.href)+'&name='+encodeURIComponent(a.download)}}},true)})()",null);
    }

    void capture(String url,String name) {
        if(host.trusted())web.evaluateJavascript("window.__pipiAndroidCaptureDownload&&window.__pipiAndroidCaptureDownload("
                +JSONObject.quote(url)+","+JSONObject.quote(name)+")",null);
    }

    boolean pending(){return preparing||current!=null;}

    void request(String token) {
        if(!host.trusted()||token==null||!token.matches("b[a-z0-9]{8,64}"))return;
        if(pending()){host.notice("请先完成当前文件的保存");return;}
        preparing=true;final int requestGeneration=generation;
        String script="(function(){var d=window.__pipiAndroidDownloads&&window.__pipiAndroidDownloads["+JSONObject.quote(token)
                +"];return d?JSON.stringify({name:d.name,type:d.blob&&d.blob.type||'application/octet-stream',size:d.blob?d.blob.size:-1,error:d.error||''}):null})()";
        web.evaluateJavascript(script,result->{
            if(requestGeneration!=generation||!host.trusted())return;
            preparing=false;
            try {
                JSONObject meta=jsonObject(result);
                if(!meta.getString("error").isEmpty())throw new IOException(meta.getString("error"));
                long size=meta.getLong("size");if(size<0)throw new IOException("下载内容已失效，请重新导出");
                String name=meta.getString("name").replaceAll("[\\\\/:*?\"<>|]","_");
                String mime=meta.getString("type");
                if(!mime.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+"))mime="application/octet-stream";
                current=new Download(token,size);host.chooseDestination(name.isEmpty()?"download":name,mime);
            } catch(Exception error){discard(token);host.notice("无法导出文件："+error.getMessage());}
        });
    }

    void save(Uri destination) {
        Download download=current;
        if(download==null)return;
        if(destination==null){cancel();return;}
        io.execute(()->{
            try {
                OutputStream output=activity.getContentResolver().openOutputStream(destination,"w");
                if(output==null)throw new IOException("无法写入选择的位置");
                download.stream=output;
                handler.post(()->{
                    if(current==download)read(download);
                });
            } catch(Exception error){handler.post(()->fail(download,error.getMessage()));}
        });
    }

    private void read(Download download) {
        if(current!=download)return;
        if(!host.trusted()){fail(download,"页面已切换，请重新导出");return;}
        if(download.offset>=download.size){finish(download);return;}
        long end=Math.min(download.size,download.offset+CHUNK);
        String script="(function(){var d=window.__pipiAndroidDownloads&&window.__pipiAndroidDownloads["+JSONObject.quote(download.token)
                +"];if(!d||!d.blob)return false;d.chunk={pending:true};var reader=new FileReader();reader.onload=function(){d.chunk={data:reader.result.slice(reader.result.indexOf(',')+1)}};"
                +"reader.onerror=function(){d.chunk={error:'读取导出内容失败'}};reader.readAsDataURL(d.blob.slice("+download.offset+","+end+"));return true})()";
        web.evaluateJavascript(script,result->{
            if(current!=download)return;
            if(!"true".equals(result)){fail(download,"下载内容已失效，请重新导出");return;}
            poll(download,0);
        });
    }

    private void poll(Download download,int attempt) {
        if(current!=download)return;
        if(!host.trusted()){fail(download,"页面已切换，请重新导出");return;}
        web.evaluateJavascript("(function(){var d=window.__pipiAndroidDownloads&&window.__pipiAndroidDownloads["
                +JSONObject.quote(download.token)+"];return d&&d.chunk?JSON.stringify(d.chunk):null})()",result->{
            if(current!=download)return;
            try {
                JSONObject chunk=jsonObject(result);
                if(chunk.optBoolean("pending")){
                    if(attempt>=250)throw new IOException("读取导出内容超时");
                    handler.postDelayed(()->poll(download,attempt+1),20);return;
                }
                if(chunk.has("error"))throw new IOException(chunk.getString("error"));
                String encoded=chunk.getString("data");
                if(encoded.length()>CHUNK*2)throw new IOException("导出数据块无效");
                byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);
                if(bytes.length!=Math.min(CHUNK,download.size-download.offset))throw new IOException("导出数据不完整");
                io.execute(()->{
                    try {download.stream.write(bytes);handler.post(()->{if(current==download){download.offset+=bytes.length;read(download);}});}
                    catch(IOException error){handler.post(()->fail(download,error.getMessage()));}
                });
            } catch(Exception error){fail(download,error.getMessage());}
        });
    }

    private void finish(Download download) {
        io.execute(()->{
            try{closeStream(download);handler.post(()->{if(current==download){current=null;discard(download.token);host.notice("文件已保存");}});}
            catch(IOException error){handler.post(()->fail(download,error.getMessage()));}
        });
    }

    private void fail(Download download,String reason) {
        if(current!=download)return;
        cancel();host.notice("保存失败："+reason+"，目标文件可能未完整写入");
    }

    void cancel() {
        cancel(true);
    }

    void rendererGone() {
        cancel(false);
    }

    private void cancel(boolean discardPageBlob) {
        generation++;preparing=false;Download download=current;current=null;
        if(download==null)return;
        if(discardPageBlob)discard(download.token);
        io.execute(()->{
            try{closeStream(download);}
            catch(IOException error){android.util.Log.e("PipiPhone","关闭导出文件失败",error);}
        });
    }

    private void closeStream(Download download) throws IOException {
        OutputStream output=download.stream;download.stream=null;
        if(output!=null)output.close();
    }

    private void discard(String token) {
        if(host.trusted())web.evaluateJavascript("window.__pipiAndroidDownloads&&delete window.__pipiAndroidDownloads["+JSONObject.quote(token)+"]",null);
    }

    private static JSONObject jsonObject(String raw) throws Exception {
        return new JSONObject(new JSONArray("["+raw+"]").getString(0));
    }
}
