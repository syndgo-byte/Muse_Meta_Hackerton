"use client";
import { useState } from "react";
import type { Creature } from "@/components/CaptureBox";
import { fmtFeed } from "@/lib/format";

export default function FeedBox({ mine }: { mine: Creature | null }) {
  const [food, setFood] = useState("매운 떡볶이");
  const [out, setOut] = useState("아직 없음");
  const [busy, setBusy] = useState(false);

  async function feed() {
    if (!mine) {
      setOut("먼저 크리처를 포획해주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creature: `${mine.name} (${mine.element})`,
          food,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      const f = fmtFeed(data);
      setOut(`${f.title}\n${f.lines.join("\n")}`);
    } catch (e) {
      setOut(`실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label htmlFor="food">먹이 (실제 먹은 음식 적기)</label>
      <input id="food" value={food} onChange={(e) => setFood(e.target.value)} />
      <button onClick={feed} disabled={busy}>
        {busy ? "먹이는 중..." : "밥 주기"}
      </button>
      <pre>{out}</pre>
    </div>
  );
}
