import { NextRequest, NextResponse } from "next/server";
import { decideScan, endEncounter } from "@/lib/encounter/store";

// 스캔 조우 판정 (BATTLE_DESIGN §15-1).
// POST {label, confidence, caughtIds, fainted, demo?} → encounter|exp|none.
// POST {action:"end", speciesId, result} → 조우 종료 기록. 배틀 버튼은 붙이지 않는다.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    if (body.action === "end") {
      const speciesId = typeof body.speciesId === "string" ? body.speciesId : "";
      const result = body.result;
      if (!speciesId || (result !== "win" && result !== "lose" && result !== "flee")) {
        return NextResponse.json({ error: "invalid end params" }, { status: 400 });
      }
      const state = await endEncounter(speciesId, result);
      return NextResponse.json({ ok: true, state });
    }
    const label = typeof body.label === "string" ? body.label.slice(0, 200) : "";
    const confidence = typeof body.confidence === "number" ? body.confidence : NaN;
    const caughtIds = Array.isArray(body.caughtIds)
      ? body.caughtIds.filter((x): x is string => typeof x === "string").slice(0, 64)
      : [];
    const fainted = body.fainted === true;
    const demo = body.demo === true || body.demo === 1;
    const r = await decideScan({ label, confidence, caughtIds, fainted, demo });
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
