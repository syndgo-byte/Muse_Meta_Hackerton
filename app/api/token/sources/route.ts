import { NextResponse } from "next/server";
import { getSourcesSnapshot } from "@/lib/token/sources";

// 충전 안내 표시용 출처 스냅샷 (어댑터 호출은 서버에서만).
export async function GET() {
  try {
    const snap = await getSourcesSnapshot();
    return NextResponse.json(snap);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
