// app/api/hud/route.ts — PF-1: 휴대폰→/hud 한 줄 알림 (E1 폴링 방식).
// data/hud-notice.json 1건. 30초 지나면 GET이 null을 돌려준다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NextResponse } from "next/server";

export type HudNotice = {
  kind: "meet" | "battle" | "ask";
  /** 결과 화면 한 줄 (14자 이내 권장, /hud가 자른다). */
  text: string;
  me: string;
  foe: string;
  at: number;
};

const EXPIRE_MS = 30 * 1000;

function noticePath(): string {
  const override = process.env.HUD_NOTICE_PATH;
  if (override && override.length > 0) return override;
  return join(process.cwd(), "data", "hud-notice.json");
}

const ID_RE = /^[A-Za-z0-9-]{1,32}$/;

function valid(n: unknown): n is Omit<HudNotice, "at"> {
  if (!n || typeof n !== "object" || Array.isArray(n)) return false;
  const v = n as Record<string, unknown>;
  return (
    (v.kind === "meet" || v.kind === "battle" || v.kind === "ask") &&
    typeof v.text === "string" && v.text.length > 0 && v.text.length <= 40 &&
    typeof v.me === "string" && ID_RE.test(v.me) &&
    typeof v.foe === "string" && ID_RE.test(v.foe)
  );
}

function readNotice(): HudNotice | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(noticePath(), "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const v = raw as Record<string, unknown>;
    if (!valid(v)) return null;
    // valid()는 at을 뺀 모양으로 좁히므로 at은 원본에서 읽는다 (값 동일, 타입만).
    const at: unknown = (raw as Record<string, unknown>).at;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    if (Date.now() - at > EXPIRE_MS) return null;
    return { kind: v.kind as HudNotice["kind"], text: v.text as string, me: v.me as string, foe: v.foe as string, at };
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json({ notice: readNotice() });
}

export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!valid(body)) {
    return NextResponse.json({ ok: false, error: "invalid notice" }, { status: 400 });
  }
  const out: HudNotice = { ...body, at: Date.now() };
  try {
    const p = noticePath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, p);
  } catch {
    return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
