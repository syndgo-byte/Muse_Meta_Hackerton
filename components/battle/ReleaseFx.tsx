// components/battle/ReleaseFx.tsx — F. 홀씨 날려 보내기 (놓아주기, 2초 내).
"use client";

import { useState } from "react";
import Floaters from "./Floaters";
import Particles from "./Particles";
import { RELEASE_EXP } from "@/lib/battle/capture";

export default function ReleaseFx({ onDone }: { onDone: () => void }) {
  const [fxKey, setFxKey] = useState(0);
  const [started, setStarted] = useState(false);

  function release() {
    if (started) return;
    setStarted(true);
    setFxKey((k) => k + 1);
    window.setTimeout(onDone, 2000);
  }

  return (
    <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 12, color: "#fff" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>놓아주기 · EXP {RELEASE_EXP}</div>
      <div style={{ position: "relative", height: 120, background: "#0c120e", borderRadius: 10, overflow: "hidden" }}>
        {started && (
          <>
            <Floaters
              items={[{ id: "rel", side: "mine", text: `+${RELEASE_EXP}`, color: "#4ade80", big: false, small: false, delayMs: 200, dx: 0, badge: "none", stack: 0 }]}
              fxKey={fxKey}
            />
            <Particles
              bursts={[
                { side: "mine", color: "#e8f5e9", count: 20, dir: "up", delayMs: 0 },
                { side: "mine", color: "#a5d6a7", count: 15, dir: "up", delayMs: 300 },
              ]}
              burstKey={fxKey}
            />
          </>
        )}
      </div>
      <button onClick={release} disabled={started} className="glass-btn" style={{ width: "100%", fontSize: 14, marginTop: 8 }}>
        {started ? "날아가는 중…" : "놓아주기"}
      </button>
    </div>
  );
}
