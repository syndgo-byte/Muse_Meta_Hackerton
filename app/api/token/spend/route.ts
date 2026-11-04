import { NextRequest, NextResponse } from "next/server";
import { spend } from "@/lib/token/ledger";

// 소비처 차감. 잔량 검사와 기록을 원장에서 한 번에 처리한다.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const res = await spend(body.amount, body.reason);
    if (!res.ok) {
      const status = res.error === "insufficient" ? 409 : 400;
      return NextResponse.json({ error: res.error, balance: res.balance }, { status });
    }
    return NextResponse.json({ ok: true, spent: res.spent, balance: res.balance });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
