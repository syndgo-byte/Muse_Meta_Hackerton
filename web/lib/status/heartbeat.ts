// 접속 하트비트 (D4-3). 앱이 열려 있으면 1분마다 tick을 보내 lastTickAt을 저장한다.
// 각 화면 마운트 때 시작하고 언마운트 때 멈춘다.
import { TICK_INTERVAL_MS } from "./decay";

export function startStatusHeartbeat(): () => void {
  let stop = false;
  const beat = () => {
    if (stop) return;
    try {
      void fetch("/api/status/tick", { method: "POST", cache: "no-store" }).catch(() => {});
    } catch {
      /* ignore (SSR 포함) */
    }
  };
  beat();
  const iv = window.setInterval(beat, TICK_INTERVAL_MS);
  return () => {
    stop = true;
    window.clearInterval(iv);
  };
}
