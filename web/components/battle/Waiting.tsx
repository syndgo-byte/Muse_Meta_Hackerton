// components/battle/Waiting.tsx — 네트워크 대기·타임아웃·연결 표시 (§14).
"use client";
import { useEffect, useRef } from "react";
import { ACCEPT_WAIT_S } from "@/lib/battle/timer";

export type ConnState = "online" | "weak" | "offline";

const DOT: Record<ConnState, string> = { online: "#4ade80", weak: "#ffb020", offline: "#ff5a5a" };

export default function Waiting({
  active,
  elapsed,
  round,
  conn,
  onRetry,
  onSolo,
  onCancel,
  acceptTimeoutS = ACCEPT_WAIT_S,
  onAcceptTimeout,
}: {
  active: boolean;
  elapsed: number;
  round: number;
  conn: ConnState;
  onRetry: () => void;
  onSolo: () => void;
  onCancel: () => void;
  /** BT-T: 수락 대기 제한(초). 지나면 자동 취소 1회. */
  acceptTimeoutS?: number;
  onAcceptTimeout?: () => void;
}) {
  const firedRef = useRef(false);
  const acceptExpired = active && elapsed >= acceptTimeoutS;
  useEffect(() => {
    if (acceptExpired && !firedRef.current) {
      firedRef.current = true;
      onAcceptTimeout?.();
    }
    if (!acceptExpired) firedRef.current = false;
  }, [acceptExpired, onAcceptTimeout]);
  if (!active) return null;
  const timeout = elapsed >= 10;
  return (
    <div className="glass-toast" style={{ position: "relative", color: "#fff", padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
        <span
          aria-label={conn}
          style={{ width: 10, height: 10, borderRadius: 5, background: DOT[conn], flexShrink: 0 }}
        />
        {timeout ? "상대 응답이 없습니다" : `상대를 기다리는 중입니다 …${elapsed}초`}
      </div>
      {conn === "offline" && !timeout && (
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
          연결이 끊겨 혼자 진행합니다. 연결이 돌아오면 다음 배틀부터 다시 매칭 모드.
        </div>
      )}
      {timeout && acceptExpired && (
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>수락 시간 초과 — 자동 취소합니다.</div>
      )}
      {timeout && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {round < 3 && (
            <button onClick={onRetry} className="glass-btn" style={{ flex: 1, fontSize: 12 }}>
              다시 기다리기 (남은 {3 - round}회)
            </button>
          )}
          <button onClick={onSolo} className="glass-btn" style={{ flex: 1, fontSize: 12 }}>
            혼자 대결 (AI 상대)
          </button>
          <button onClick={onCancel} className="glass-btn" style={{ flex: 1, fontSize: 12 }}>
            취소
          </button>
        </div>
      )}
    </div>
  );
}
