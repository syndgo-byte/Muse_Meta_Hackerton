// Companion <-> Unity bridge (Area A/C).
// Companion POSTs the selected partner + cloud status; Unity GETs it.
// Lane key `token` (default "default"); entries expire after 10 minutes.
// Single-process in-memory store (LAN demo). Not a replacement for the
// UGC invention endpoint /api/creature (POST description/image -> design).
import { NextRequest, NextResponse } from "next/server";

type SyncEntry = {
  partnerId: string;
  account: string;
  level: number;
  xp: number;
  fullness: number;
  energy: number;
  affection: number;
  dexCsv: string;
  updatedAt: number;
};

const store = new Map<string, SyncEntry>();
const TTL_MS = 10 * 60 * 1000;
const ID_RE = /^(fire|grass|water|rock|wind)-\d{2}$/;

function laneOf(v: unknown): string {
  const s = String(v ?? "default").slice(0, 64) || "default";
  return s;
}

function num(v: unknown, lo: number, hi: number, fb: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  const token = laneOf(req.nextUrl.searchParams.get("token"));
  const e = store.get(token);
  if (!e || Date.now() - e.updatedAt > TTL_MS) {
    store.delete(token);
    return NextResponse.json({ empty: true, token });
  }
  return NextResponse.json({ empty: false, token, ...e });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const partnerId = String(body.partnerId ?? "");
  if (!ID_RE.test(partnerId)) {
    return NextResponse.json(
      { error: "partnerId must match (fire|grass|water|rock|wind)-NN" },
      { status: 400 }
    );
  }
  const token = laneOf(body.token);
  const entry: SyncEntry = {
    partnerId,
    account: String(body.account ?? "").slice(0, 32),
    level: num(body.level, 1, 99, 1),
    xp: num(body.xp, 0, 999999, 0),
    fullness: num(body.fullness, 0, 100, 50),
    energy: num(body.energy, 0, 100, 80),
    affection: num(body.affection, 0, 100, 20),
    dexCsv: String(body.dexCsv ?? "").slice(0, 512),
    updatedAt: Date.now(),
  };
  store.set(token, entry);
  return NextResponse.json({ ok: true, token, updatedAt: entry.updatedAt });
}
