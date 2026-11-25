package com.pipiphone.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/**
 * Private read-only provider exposing JPEG files transcoded from Android HEIC/HEIF gallery picks
 * so Chromium WebView can read them seamlessly. Restricted strictly to cache/picked-images/<uuid>.jpg.
 */
public final class PickedImageProvider extends ContentProvider {
    private static final String NAME_PATTERN = "^[a-f0-9-]{36}\\.jpg$";

    static File directory(Context context) {
        File dir = new File(context.getCacheDir(), "picked-images");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    static void clearCache(Context context) {
        File dir = new File(context.getCacheDir(), "picked-images");
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isFile()) file.delete();
        }
    }

    static Uri uriFor(Context context, String fileName) {
        return Uri.parse("content://" + context.getPackageName() + ".picked.image/" + fileName);
    }

    private File resolveFile(Uri uri) throws FileNotFoundException {
        String path = uri.getPath();
        if (path == null || !path.startsWith("/") || uri.getQuery() != null || uri.getFragment() != null)
            throw new FileNotFoundException("Invalid picked image path");
        String name = path.substring(1);
        if (!name.matches(NAME_PATTERN)) throw new FileNotFoundException("Unknown picked image");
        File file = new File(directory(getContext()), name);
        if (!file.isFile()) throw new FileNotFoundException("Picked image missing");
        return file;
    }

    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "image/jpeg"; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Picked image is read-only");
        return ParcelFileDescriptor.open(resolveFile(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        File file;
        try { file = resolveFile(uri); } catch (FileNotFoundException missing) { return null; }
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = file.getName();
            else if (OpenableColumns.SIZE.equals(columns[i])) row[i] = file.length();
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException(); }
}
