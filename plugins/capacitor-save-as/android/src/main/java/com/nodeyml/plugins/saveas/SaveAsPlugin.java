package com.nodeyml.plugins.saveas;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/**
 * Opens Android's system "Save as" picker (Storage Access Framework,
 * ACTION_CREATE_DOCUMENT) so the user chooses where a generated file is
 * stored (Downloads, Documents, SD card, ...) in the file manager UI.
 * Payload arrives as base64; files handled here are small (YAML/JSON/TXT).
 */
@CapacitorPlugin(name = "SaveAs")
public class SaveAsPlugin extends Plugin {

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
        } catch (IllegalArgumentException e) {
            call.reject("invalid base64 data");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(contentType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "onSavePicked");
    }

    @ActivityCallback
    private void onSavePicked(PluginCall call, ActivityResult result) {
        byte[] bytes = pendingBytes;
        pendingBytes = null;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null || bytes == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            OutputStream out = getContext().getContentResolver().openOutputStream(uri);
            if (out == null) {
                call.reject("cannot open output stream");
                return;
            }
            out.write(bytes);
            out.close();
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage());
        }
    }
}
