// AR HUD 오버레이 (마스터 지침 §2). Presentational only.
// F&B 탐지 타겟팅(target) → Quota 충전 흡수(charge) 2상 연출.
// 탐지 로직은 갖지 않는다. POV 페이지가 phase만 전달한다.
import type { CSSProperties } from "react";

export type HudPhase = "target" | "charge";

const DOTS = 14;

export default function HudOverlay({
  phase,
  shop,
  amount,
}: {
  phase: HudPhase | null;
  shop: string;
  amount: number;
}) {
  if (!phase) return null;
  return (
    <div className="hud-layer" aria-hidden>
      {phase === "target" ? (
        <>
          <div className="hud-ring" />
          <div className="hud-lock" />
          <div className="hud-cross" />
          <div className="hud-tag">[F&B 제휴 감지: {shop}]</div>
        </>
      ) : (
        <>
          <div className="hud-ring charge" />
          <div className="hud-burst">
            {Array.from({ length: DOTS }, (_, i) => (
              <span
                key={i}
                style={
                  {
                    "--a": `${(i / DOTS) * 360}deg`,
                    "--d": `${(i % 5) * 0.08}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="hud-tag hud-charge">
            +{amount} AI Quota Charged
          </div>
        </>
      )}
    </div>
  );
}
