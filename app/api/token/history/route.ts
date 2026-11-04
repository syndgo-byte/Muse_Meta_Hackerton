import { NextResponse } from "next/server";
import { readHistory } from "@/lib/token/ledger";

// 토큰 내역 조회 (§2-1). GET /api/token/history?limit=N, 최신순.
// limit 기본 5, 최대 50. 읽기 전용.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("limit");
    let limit = 5;
    if (raw != null && raw !== "") {
      const p = Number.parseInt(raw, 10);
      limit = Number.isFinite(p) ? Math.min(50, Math.max(1, p)) : 5;
    }
    return NextResponse.json({ entries: await readHistory(limit) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
