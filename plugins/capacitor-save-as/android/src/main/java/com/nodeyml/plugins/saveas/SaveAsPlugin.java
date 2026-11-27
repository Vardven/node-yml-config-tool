package com.nodeyml.plugins.saveas;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Opens Android's system "Save as" picker (Storage Access Framework,
 * ACTION_CREATE_DOCUMENT) so the user chooses where a generated file is
 * stored (Downloads, Documents, SD card, ...) in the file manager UI.
 * Payload arrives as base64.
 *
 * The decoded bytes are staged to a cache file (its path kept in
 * SharedPreferences) BEFORE the picker opens. If the system kills the app
 * process while the picker is in front — common on aggressive OEM ROMs
 * when the WebView holds hundreds of rendered nodes — the restored plugin
 * instance can still find the staged bytes and finish the write, instead
 * of silently leaving behind the 0-byte file the picker created.
 */
@CapacitorPlugin(name = "SaveAs")
public class SaveAsPlugin extends Plugin {

    private static final String PREFS = "saveas_pending";
    private static final String KEY_PATH = "path";
    private static final String STAGE_NAME = "saveas_pending.bin";

    private byte[] pendingBytes;

    @PluginMethod
    public void saveAs(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename", "config.yaml");
        String contentType = call.getString("contentType", "text/plain");
        if (data == null) {
            call.reject("missing data");
            return;
        }
        try {
            pendingBytes = Base64.decode(data, Base64.DEFAULT);
            stageToDisk(pendingBytes);
        } catch (Throwable e) {
            call.reject("invalid base64 data");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(contentType);
            intent.putExtra(Intent.EXTRA_TITLE, filename);
            startActivityForResult(call, intent, "onSavePicked");
        } catch (Throwable e) {
            call.reject("cannot open save picker: " + e.getMessage());
        }
    }

    /**
     * Writes the file straight into the public Downloads folder via
     * MediaStore (Android 10+). No picker, no leaving the app, no activity
     * result — so the OEM process-kill problem of the SAF flow cannot lose
     * the file. This is the preferred save path; saveAs() stays as the
     * fallback for older systems / when this rejects.
     */
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename", "config.yaml");
        String contentType = call.getString("contentType", "text/plain");
        if (data == null) {
            call.reject("missing data");
            return;
        }
        if (Build.VERSION.SDK_INT < 29) {
            call.reject("needs Android 10+");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (Throwable e) {
            call.reject("invalid base64 data");
            return;
        }
        Uri uri = null;
        try {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, contentType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("cannot create download entry");
                return;
            }
            OutputStream out = resolver.openOutputStream(uri);
            if (out == null) {
                resolver.delete(uri, null, null);
                call.reject("cannot open output stream");
                return;
            }
            out.write(bytes);
            out.flush();
            out.close();
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Throwable e) {
            if (uri != null) {
                try { getContext().getContentResolver().delete(uri, null, null); } catch (Throwable ignored) {}
            }
            call.reject("write failed: " + e.getMessage());
        }
    }

    private void stageToDisk(byte[] bytes) {
        try {
            File f = new File(getContext().getCacheDir(), STAGE_NAME);
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(bytes);
            fos.close();
            SharedPreferences.Editor ed = getContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
            ed.putString(KEY_PATH, f.getAbsolutePath());
            ed.apply();
        } catch (Throwable ignored) {
            // Staging is best-effort; the in-memory copy covers the normal path.
        }
    }

    private byte[] readStaged() {
        try {
            String path = getContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PATH, null);
            if (path == null) return null;
            File f = new File(path);
            if (!f.exists()) return null;
            InputStream in = new FileInputStream(f);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
            in.close();
            return bos.toByteArray();
        } catch (Throwable e) {
            return null;
        }
    }

    private void clearStaged() {
        try {
            SharedPreferences prefs = getContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String path = prefs.getString(KEY_PATH, null);
            if (path != null) {
                File f = new File(path);
                if (f.exists()) f.delete();
            }
            prefs.edit().remove(KEY_PATH).apply();
        } catch (Throwable ignored) {}
    }

    @ActivityCallback
    private void onSavePicked(PluginCall call, ActivityResult result) {
        try {
            byte[] bytes = pendingBytes;
            pendingBytes = null;
            if (bytes == null) bytes = readStaged();
            if (result.getResultCode() != Activity.RESULT_OK
                    || result.getData() == null
                    || result.getData().getData() == null) {
                clearStaged();
                call.reject("cancelled");
                return;
            }
            if (bytes == null) {
                clearStaged();
                call.reject("lost file content (app was restarted)");
                return;
            }
            Uri uri = result.getData().getData();
            OutputStream out = getContext().getContentResolver().openOutputStream(uri);
            if (out == null) {
                clearStaged();
                call.reject("cannot open output stream");
                return;
            }
            out.write(bytes);
            out.flush();
            out.close();
            clearStaged();
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Throwable e) {
            clearStaged();
            call.reject("write failed: " + e.getMessage());
        }
    }
}
