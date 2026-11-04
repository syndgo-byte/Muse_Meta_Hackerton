import { NextRequest, NextResponse } from "next/server";
import { isSpeciesId, readCreatureStatus, writeCreatureStatus } from "@/lib/status/store";

// 크리처 수치 읽기·쓰기. 체력(HP)은 다루지 않는다 (배틀 중에만 존재).
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams.get("speciesId");
    const speciesId = q === null || q === "" ? undefined : q;
    if (speciesId !== undefined && !isSpeciesId(speciesId)) {
      return NextResponse.json({ error: "invalid speciesId" }, { status: 400 });
    }
    return NextResponse.json(await readCreatureStatus(speciesId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const res = await writeCreatureStatus(body);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json(res.status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
