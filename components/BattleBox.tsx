"use client";
import { useState } from "react";
import type { Creature } from "@/components/CaptureBox";
import { fmtBattle } from "@/lib/format";

export default function BattleBox({ mine }: { mine: Creature | null }) {
  const [wild, setWild] = useState("풀 속성 리피몬 (공격 6, 방어 5)");
  const [out, setOut] = useState("아직 없음");
  const [busy, setBusy] = useState(false);

  async function fight() {
    if (!mine) {
      setOut("먼저 내 크리처를 포획해주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/battle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mine: `${mine.name} (${mine.element}, 공${mine.attack}/방${mine.defense})`,
          wild,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      const f = fmtBattle(data);
      setOut(`${f.title}\n${f.lines.join("\n")}`);
    } catch (e) {
      setOut(`실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label htmlFor="wild">야생 크리처 (새 포획 때 자동 입력 예정)</label>
      <input id="wild" value={wild} onChange={(e) => setWild(e.target.value)} />
      <button onClick={fight} disabled={busy}>
        {busy ? "배틀 중..." : "배틀 시작"}
      </button>
      <pre>{out}</pre>
    </div>
  );
}
