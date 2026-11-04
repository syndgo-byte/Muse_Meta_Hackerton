package com.oishie.app;

import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// PKG-2: PC 허브 연결용 래퍼. LanTrust 등록 + 자체 서명 WebViewClient + 안경 HFP SCO(보호됨).
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LanTrust.class);
        super.onCreate(savedInstanceState);
        try {
            getBridge().setWebViewClient(new LanWebViewClient(getBridge(), this));
        } catch (Exception e) {
            // 기본 클라이언트 유지
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        enableBtScoIfHeadset();
    }

    // 안경 HFP 입력용 SCO 라우팅. BT 오디오 장치가 물려 있을 때만, 전부 보호 호출.
    // 실기기 미검증(1차) — 실패해도 폰 마이크 경로에 영향 없음.
    private void enableBtScoIfHeadset() {
        try {
            if (Build.VERSION.SDK_INT >= 31
                && checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
                    != PackageManager.PERMISSION_GRANTED) {
                return;
            }
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null || am.isBluetoothScoOn()) return;
            boolean btAudio = false;
            AudioDeviceInfo[] outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            for (AudioDeviceInfo d : outs) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                    || t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                    || t == AudioDeviceInfo.TYPE_BLE_HEADSET
                    || t == AudioDeviceInfo.TYPE_BLE_SPEAKER) {
                    btAudio = true;
                    break;
                }
            }
            if (!btAudio) return;
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            am.startBluetoothSco();
        } catch (Exception e) {
            // 무시: BT 없으면 폰 마이크 그대로
        }
    }
}
