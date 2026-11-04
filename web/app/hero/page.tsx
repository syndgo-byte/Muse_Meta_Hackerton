"use client";
import dynamic from "next/dynamic";
import type { PovElement } from "@/components/PovCreature";

const PovCreature = dynamic(() => import("@/components/PovCreature"), { ssr: false });

const HEROES: Array<{ id: string; name: string; element: PovElement; glb: string; prev: string }> = [
  { id: "fire-01", name: "모카퐁", element: "fire", glb: "/hero/fire-01-sf3d-0.glb", prev: "/hero/fire-01-step2-0.webp" },
  { id: "grass-01", name: "리피몽", element: "grass", glb: "/hero/grass-01-sf3d-0.glb", prev: "/hero/grass-01-step2-0.webp" },
];

export default function HeroPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#101418", color: "#fff", padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>외부 3D 변환 히어로 2종 리뷰</h1>
      <p style={{ opacity: 0.8, fontSize: 14 }}>
        Stable Fast 3D 공개 데모 · 초상화 → 배경 제거 → image-to-3D. 3D 뷰는 자동 360° 회전합니다.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
        {HEROES.map((h) => (
          <div key={h.id} style={{ border: "1px solid #333", borderRadius: 12, padding: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700 }}>{h.name} ({h.id})</h2>
            <div style={{ position: "relative", height: 420, background: "#1a222b", borderRadius: 8, overflow: "hidden" }}>
              <PovCreature element={h.element} modelUrl={h.glb} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>배경 제거 미리보기:</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={h.prev} alt={`${h.name} 배경 제거`} style={{ marginTop: 4, width: 160, borderRadius: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
