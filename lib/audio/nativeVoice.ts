// PKG-2: APK WebView용 네이티브 음성 인식.
// https://github.com/capacitor-community/speech-recognition (MIT)
// WebView에는 Web Speech가 없으므로 Capacitor 플러그인으로 한 문장만 듣는다.
// 실패·미지원이면 "unavailable"(기존 Web Speech 경로로 대체), 말 없으면 "empty".
export function isNativeApp(): boolean {
  try {
    const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    return w.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

type SRPlugin = {
  available?: () => Promise<{ available?: boolean }>;
  requestPermissions?: () => Promise<unknown>;
  requestPermission?: () => Promise<unknown>;
  startListening?: (opts: Record<string, unknown>) => Promise<unknown>;
  stopListening?: () => Promise<unknown>;
  addListener?: (event: string, cb: (d: { matches?: unknown }) => void) => Promise<{ remove: () => void }>;
};

export async function nativeListenOnce(opts: {
  lang: string;
  onText: (t: string) => void;
}): Promise<"ok" | "empty" | "unavailable"> {
  if (!isNativeApp()) return "unavailable";
  let SR: SRPlugin | null = null;
  try {
    const mod = (await import("@capacitor-community/speech-recognition")) as {
      SpeechRecognition?: SRPlugin;
    };
    SR = mod?.SpeechRecognition ?? null;
    if (!SR?.startListening) return "unavailable";
  } catch {
    return "unavailable";
  }
  try {
    const av = await SR.available?.();
    if (av && av.available === false) return "unavailable";
  } catch {
    return "unavailable";
  }
  try {
    if (SR.requestPermissions) await SR.requestPermissions();
    else if (SR.requestPermission) await SR.requestPermission();
  } catch {
    /* 거부돼도 startListening이 판단한다 */
  }
  const heard = await new Promise<string | null>((resolve) => {
    let done = false;
    const subs: Array<{ remove: () => void }> = [];
    const finish = (t: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      for (const s of subs) {
        try {
          s.remove();
        } catch {
          /* ignore */
        }
      }
      resolve(t);
    };
    const timer = window.setTimeout(() => finish(null), 20000);
    try {
      const p1 = SR!.addListener?.("partialResults", (d) => {
        const m = d?.matches;
        if (Array.isArray(m) && typeof m[0] === "string" && m[0]) finish(m[0]);
      });
      if (p1 && typeof (p1 as Promise<unknown>).then === "function") {
        void (p1 as Promise<{ remove: () => void }>).then((h) => subs.push(h)).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    try {
      const r = SR!.startListening?.({
        language: opts.lang,
        maxResults: 1,
        prompt: "말씀하세요",
        partialResults: true,
        popup: false,
      });
      if (r && typeof (r as Promise<unknown>).catch === "function") {
        void (r as Promise<unknown>).catch(() => finish(null));
      }
    } catch {
      finish(null);
    }
  });
  try {
    await SR.stopListening?.();
  } catch {
    /* ignore */
  }
  if (!heard) return "empty";
  opts.onText(heard);
  return "ok";
}
