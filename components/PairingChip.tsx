// SEC-5: PC 허브용 페어링 코드 칩. 루프백에서 LAN 페어링이 켜져 있을 때만 보인다.
"use client";
import { useEffect, useState } from "react";

export default function PairingChip() {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/pairing", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j && j.pairing === true && typeof j.code === "string") setCode(j.code);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!code) return null;
  return (
    <div style={{ fontSize: 12, opacity: 0.75, padding: "4px", textAlign: "center" }}>
      폰 페어링 코드: <span style={{ fontWeight: 800, letterSpacing: 2 }}>{code}</span>
    </div>
  );
}
