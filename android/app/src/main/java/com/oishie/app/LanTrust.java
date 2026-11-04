package com.oishie.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// PKG-2: 런처가 입력한 PC 호스트를 네이티브에 저장 (자체 서명 승인 판단용).
// JS: Capacitor.Plugins.LanTrust.setHost({ host }) — 실패해도 무시된다.
@CapacitorPlugin(name = "LanTrust")
public class LanTrust extends Plugin {

    static final String PREFS = "oishie_lan";
    static final String KEY_HOST = "trusted_host";

    @PluginMethod
    public void setHost(PluginCall call) {
        String host = call.getString("host", "");
        if (host == null || host.isEmpty()) {
            call.reject("host required");
            return;
        }
        getContext()
            .getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_HOST, host.toLowerCase(java.util.Locale.ROOT))
            .apply();
        JSObject ret = new JSObject();
        ret.put("host", host);
        call.resolve(ret);
    }
}
