package com.pipiphone.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** The system installer receives a temporary read grant to this one verified APK. */
public final class UpdateApkProvider extends ContentProvider {
    static File apk(android.content.Context context) {
        return new File(context.getCacheDir(), "official-update/update.apk");
    }

    private void requireApk(Uri uri) {
        if (!"/update.apk".equals(uri.getPath()) || uri.getQuery() != null || uri.getFragment() != null)
            throw new IllegalArgumentException("Unknown update file");
    }

    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { requireApk(uri); return "application/vnd.android.package-archive"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        requireApk(uri);
        if (!"r".equals(mode)) throw new FileNotFoundException("Update APK is read-only");
        return ParcelFileDescriptor.open(apk(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        requireApk(uri);
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor result = new MatrixCursor(columns, 1);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = "pipi-phone-update.apk";
            else if (OpenableColumns.SIZE.equals(columns[i])) row[i] = apk(getContext()).length();
        }
        result.addRow(row); return result;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String where, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String where, String[] args) { throw new UnsupportedOperationException(); }
}
