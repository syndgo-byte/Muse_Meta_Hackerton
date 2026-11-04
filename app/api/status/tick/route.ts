import { NextRequest, NextResponse } from "next/server";
import { isSpeciesId, tickStatus } from "@/lib/status/store";

// 접속 tick (D4-3). 감소·리셋·절감을 적용하고 저장된 수치를 돌려준다.
export async function POST(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("speciesId");
    const speciesId = q === null || q === "" ? undefined : q;
    if (speciesId !== undefined && !isSpeciesId(speciesId)) {
      return NextResponse.json({ error: "invalid speciesId" }, { status: 400 });
    }
    return NextResponse.json(await tickStatus(Date.now(), speciesId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
