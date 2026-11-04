import { NextRequest, NextResponse } from "next/server";
import { careStatus, useCare } from "@/lib/token/care";
import { touchCareAt } from "@/lib/status/store";

// 기본 교감 1회 사용 (무료 횟수 → 소진 시 토큰 추가 구매, 원자 처리).
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const res = await useCare(body.action);
    if (!res.ok) {
      const status = res.error === "insufficient" ? 409 : 400;
      return NextResponse.json(
        { error: res.error, locked: res.locked, balance: res.balance },
        { status }
      );
    }
    // D4-3: 교감 성공 1회 → lastCareAt 갱신.
    await touchCareAt(Date.now());
    return NextResponse.json({
      ok: true,
      free: res.free,
      remainingFree: res.remainingFree,
      balance: res.balance,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// 무료 잔여 횟수 + 잔량 조회.
export async function GET() {
  try {
    const st = await careStatus();
    return NextResponse.json({ date: st.date, remaining: st.remaining, balance: st.balance });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
