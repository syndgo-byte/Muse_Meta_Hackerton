import { NextResponse } from "next/server";
import { balance } from "@/lib/token/ledger";

// 잔량 조회. 원본은 서버 원장이다.
export async function GET() {
  try {
    return NextResponse.json({ balance: await balance() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
