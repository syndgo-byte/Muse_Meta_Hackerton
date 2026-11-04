package com.oishie.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.net.URI;
import java.util.Locale;

// PKG-2: 디버그 빌드에서만, 런처에 입력한 PC 주소의 자체 서명 인증서를 허용한다.
// 저장된 호스트가 없으면 사설 LAN 대역만 허용(플러그인 미등록 대비 예비책).
public class LanWebViewClient extends BridgeWebViewClient {

    private final Context appContext;

    public LanWebViewClient(Bridge bridge, Context appContext) {
        super(bridge);
        this.appContext = appContext.getApplicationContext();
    }

    private boolean isDebuggable() {
        return (appContext.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private String trustedHost() {
        return appContext
            .getSharedPreferences(LanTrust.PREFS, Context.MODE_PRIVATE)
            .getString(LanTrust.KEY_HOST, "");
    }

    private static String hostOf(String url) {
        try {
            String h = new URI(url).getHost();
            return h == null ? "" : h.toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return "";
        }
    }

    private static boolean isPrivateLan(String host) {
        if (host.endsWith(".local")) return true;
        String[] p = host.split("\\.");
        if (p.length != 4) return false;
        try {
            int a = Integer.parseInt(p[0]);
            int b = Integer.parseInt(p[1]);
            if (a == 10) return true;
            if (a == 172 && b >= 16 && b <= 31) return true;
            if (a == 192 && b == 168) return true;
        } catch (NumberFormatException e) {
            return false;
        }
        return false;
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        if (!isDebuggable()) {
            super.onReceivedSslError(view, handler, error);
            return;
        }
        String failing = hostOf(error.getUrl());
        String trusted = trustedHost();
        if (!failing.isEmpty() && failing.equals(trusted)) {
            handler.proceed();
            return;
        }
        if (trusted.isEmpty() && isPrivateLan(failing)) {
            handler.proceed();
            return;
        }
        super.onReceivedSslError(view, handler, error);
    }
}
