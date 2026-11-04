import { NextRequest, NextResponse } from "next/server";
import { credit } from "@/lib/token/ledger";
import { battleStats } from "@/lib/stats";
import { healToMax, isSpeciesId, readCreatureStatus } from "@/lib/status/store";

// 시연용 "매장 결제 완료" 신호 흉내. 실제 결제 연동 아님.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const res = await credit({
      signalId: body.signalId,
      storeName: body.storeName,
      category: body.category,
      amountKrw: body.amountKrw,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    // D4-3: 실제 적립 1회 → 체력 최대치 회복 + 기절 해제. duplicate 신호는 회복 없음.
    if (!res.duplicate) {
      const mineIdRaw = typeof body.mineId === "string" && body.mineId ? body.mineId.slice(0, 32) : "fire-01";
      if (!isSpeciesId(mineIdRaw)) return NextResponse.json({ error: "invalid mineId" }, { status: 400 });
      const st = await readCreatureStatus(mineIdRaw);
      await healToMax(battleStats(mineIdRaw, st.level).maxHp, mineIdRaw);
    }
    return NextResponse.json({
      ok: true,
      duplicate: res.duplicate,
      tokens: res.tokens,
      balance: res.balance,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
