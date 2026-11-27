/* SPDX-License-Identifier: AGPL-3.0-only */
package com.pipiphone.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** One private file for an interrupted chat photo picker, consumed by its original page. */
final class RecoveredChatPhoto {
    static final String PREFIX = "/__android/picked-photo/";
    final File file;
    private boolean consumed;

    private RecoveredChatPhoto(File file) { this.file = file; }
    static RecoveredChatPhoto restore(Context context, String name) {
        if (name == null || !name.matches("[a-f0-9-]{36}\\.photo")) return null;
        File file = new File(PickedImageProvider.directory(context), name);
        return file.isFile() ? new RecoveredChatPhoto(file) : null;
    }
    static RecoveredChatPhoto copy(Context context, Uri uri) throws IOException {
        File target = new File(PickedImageProvider.directory(context), UUID.randomUUID() + ".photo");
        try (InputStream in = context.getContentResolver().openInputStream(uri);
             FileOutputStream out = new FileOutputStream(target)) {
            if (in == null) throw new IOException("无法打开所选照片");
            byte[] buffer = new byte[65536];
            int count, total = 0;
            while ((count = in.read(buffer)) != -1) {
                total += count;
                if (total > 64 * 1024 * 1024) throw new IOException("照片超过 64 MB");
                out.write(buffer, 0, count);
            }
            if (total == 0) throw new IOException("照片内容为空");
        } catch (IOException | RuntimeException error) {
            target.delete();
            throw error;
        }
        return new RecoveredChatPhoto(target);
    }
    String path() { return PREFIX + file.getName(); }
    synchronized WebResourceResponse consume(String path) {
        if (!path().equals(path) || consumed) return missing();
        try {
            FileInputStream input = new FileInputStream(file);
            consumed = true;
            file.delete(); // Android keeps the open stream readable until WebView closes it.
            Map<String,String> headers = new HashMap<>();
            headers.put("Cache-Control","no-store");
            headers.put("X-Content-Type-Options","nosniff");
            return new WebResourceResponse("application/octet-stream",null,200,"OK",headers,input);
        } catch (IOException error) { return missing(); }
    }
    static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<>(),new ByteArrayInputStream(new byte[0]));
    }
}
