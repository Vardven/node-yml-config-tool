package com.nodeyml.plugins.apptools;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原生能力集合：
 * - startCore / stopCore：拉起随 APK 打包的 mihomo 内核（jniLibs 里的 libmihomo.so）做节点测速
 * - fetchViaProxy：经内核混合端口发请求（测出口国家用）
 * - deviceInfo：CPU 架构列表（软件内更新挑对应架构的 APK 用）
 * - installApk：调起系统安装器安装已下载到缓存的 APK（软件内更新用）
 */
@CapacitorPlugin(name = "AppTools")
public class AppToolsPlugin extends Plugin {

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private Process coreProcess;

    @PluginMethod
    public void startCore(PluginCall call) {
        final String config = call.getString("config");
        final Integer apiPort = call.getInt("apiPort");
        if (config == null || apiPort == null) {
            call.reject("missing config or apiPort");
            return;
        }
        executor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    stopCoreInternal();
                    File dir = new File(getContext().getFilesDir(), "coretest");
                    if (!dir.exists() && !dir.mkdirs()) {
                        call.reject("cannot create work dir");
                        return;
                    }
                    File cfg = new File(dir, "config.yaml");
                    FileOutputStream fos = new FileOutputStream(cfg);
                    fos.write(config.getBytes(StandardCharsets.UTF_8));
                    fos.close();
                    File bin = new File(getContext().getApplicationInfo().nativeLibraryDir, "libmihomo.so");
                    if (!bin.exists()) {
                        call.reject("core binary missing");
                        return;
                    }
                    ProcessBuilder pb = new ProcessBuilder(
                            bin.getAbsolutePath(), "-d", dir.getAbsolutePath(), "-f", cfg.getAbsolutePath());
                    pb.directory(dir);
                    coreProcess = pb.start();
                    drainAsync(coreProcess.getInputStream(), new File(dir, "core.log"));
                    drainAsync(coreProcess.getErrorStream(), null);
                    // 等控制 API 就绪（最多约 9 秒）
                    long deadline = System.currentTimeMillis() + 9000;
                    boolean aliveChecked = Build.VERSION.SDK_INT >= 26;
                    while (System.currentTimeMillis() < deadline) {
                        if (aliveChecked && !coreProcess.isAlive()) break;
                        try {
                            HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + apiPort + "/version").openConnection();
                            c.setConnectTimeout(400);
                            c.setReadTimeout(400);
                            int code = c.getResponseCode();
                            c.disconnect();
                            if (code == 200) {
                                JSObject ret = new JSObject();
                                ret.put("ok", true);
                                call.resolve(ret);
                                return;
                            }
                        } catch (Exception ignored) {
                            // 内核还没起来，继续等
                        }
                        try {
                            Thread.sleep(200);
                        } catch (InterruptedException ignored) {
                        }
                    }
                    stopCoreInternal();
                    call.reject("core start timeout");
                } catch (Exception e) {
                    call.reject("startCore failed: " + e.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void stopCore(PluginCall call) {
        stopCoreInternal();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    private synchronized void stopCoreInternal() {
        if (coreProcess != null) {
            try {
                coreProcess.destroy();
            } catch (Exception ignored) {
            }
            coreProcess = null;
        }
    }

    // 把子进程输出读走（写进日志文件或丢弃），防止管道写满把内核卡死
    private void drainAsync(final InputStream in, final File logFile) {
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                OutputStream out = null;
                try {
                    if (logFile != null) out = new FileOutputStream(logFile, true);
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (out != null) out.write(buf, 0, n);
                    }
                } catch (Exception ignored) {
                } finally {
                    try {
                        if (out != null) out.close();
                    } catch (Exception ignored) {
                    }
                    try {
                        in.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        });
        thread.setDaemon(true);
        thread.start();
    }

    @PluginMethod
    public void fetchViaProxy(PluginCall call) {
        final Integer port = call.getInt("port");
        final String url = call.getString("url");
        if (port == null || url == null) {
            call.reject("missing port or url");
            return;
        }
        executor.execute(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    Proxy proxy = new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", port));
                    c = (HttpURLConnection) new URL(url).openConnection(proxy);
                    c.setConnectTimeout(10000);
                    c.setReadTimeout(10000);
                    c.setRequestProperty("User-Agent", "clash.meta");
                    int code = c.getResponseCode();
                    InputStream in = (code >= 200 && code < 300) ? c.getInputStream() : c.getErrorStream();
                    StringBuilder sb = new StringBuilder();
                    if (in != null) {
                        BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                        char[] buf = new char[4096];
                        int n;
                        while ((n = br.read(buf)) != -1) sb.append(buf, 0, n);
                        br.close();
                    }
                    if (code < 200 || code >= 300) {
                        call.reject("HTTP " + code);
                        return;
                    }
                    JSObject ret = new JSObject();
                    ret.put("text", sb.toString());
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("fetchViaProxy failed: " + e.getMessage());
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        });
    }

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray abis = new JSArray();
        for (String abi : Build.SUPPORTED_ABIS) abis.put(abi);
        ret.put("abis", abis);
        call.resolve(ret);
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("missing path");
            return;
        }
        File file = new File(getContext().getCacheDir(), path);
        if (!file.exists()) {
            call.reject("apk file not found");
            return;
        }
        // Android 8+ 要先允许本应用「安装未知应用」，没允许就送用户去设置页，回来再点一次更新
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                settings.setData(Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
            } catch (Exception ignored) {
            }
            JSObject ret = new JSObject();
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("install failed: " + e.getMessage());
        }
    }
}
