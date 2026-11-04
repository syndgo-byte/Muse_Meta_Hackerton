import { NextRequest, NextResponse } from "next/server";
import { callMuseJson } from "@/lib/muse";
import { ASK_UNKNOWN, filterPlaces, validateAskJson } from "@/lib/ask/intents";
import { pickHipSpots, type HipZone } from "@/lib/places/hip";
import { searchYoutubeSpots, type YoutubeSpot } from "@/lib/places/youtube";
import { TOKEN_ZONES, distM } from "@/lib/token/simZones";

// POST /api/muse/ask — VA-1: 받아쓴 문장 → 뮤즈 AI 구조화 이해 → { intent, args, reply }.
// 음성 문장 전체는 로그에 남기지 않는다(길이만). 키 없음·실패 → 200 + fallback:true (EX-2 규칙).

export type AskSpot = { name: string; kind: string; distM: number | null; source: string };

type AskInput = {
  text: string;
  screen: "battle" | "encounter" | "idle";
  driving: boolean;
  partner: { speciesId: string; name: string; element: string; role: string };
  skills: Array<{ slot: number; name: string; type: string }>;
  loc: { mode: "sim" | "cam"; env?: string; lat?: number; lon?: number };
  balance: number;
  lang: string;
};

const BATTLE_INTENTS = ["skill", "battle_start", "flee", "capture"];
const DRIVING_REFUSE = "운전 중엔 안 돼!";
const UNKNOWN_LINE = "음, 잘 모르겠어.";

// sim 구역 대표 좌표 (유튜브 위치 검색용).
const ZONE_CENTER: Record<string, { lat: number; lon: number }> = {
  street: { lat: 37.5663, lon: 126.921 },
  cafe: { lat: 37.557, lon: 126.925 },
  home: { lat: 37.5445, lon: 127.0557 },
};

function tokenSpots(loc: AskInput["loc"]): AskSpot[] {
  const seen = new Map<string, { distM: number; source: string }>();
  const hasGeo = loc.mode === "cam" && Number.isFinite(loc.lat) && Number.isFinite(loc.lon);
  for (const z of TOKEN_ZONES) {
    if (loc.mode === "sim" && (loc.env === "street" || loc.env === "cafe") && z.video !== loc.env) continue;
    if (seen.has(z.store)) continue;
    const d = hasGeo ? Math.round(distM(loc.lat as number, loc.lon as number, z.lat, z.lon)) : z.distM;
    seen.set(z.store, { distM: d, source: z.partner ? "제휴 매장" : "TOKEN_ZONES" });
  }
  return Array.from(seen.entries())
    .map(([name, v]) => ({ name, kind: "token", distM: v.distM, source: v.source }))
    .sort((a, b) => (a.distM ?? 0) - (b.distM ?? 0))
    .slice(0, 3);
}

function hipZone(loc: AskInput["loc"]): HipZone | null {
  if (loc.mode === "sim" && (loc.env === "street" || loc.env === "cafe")) return loc.env;
  return null;
}

function wantsYoutube(text: string): boolean {
  return /유튜브|유투브|youtube|힙한|핫플|놀러|hot/i.test(text);
}

function fallback() {
  return NextResponse.json({ ...ASK_UNKNOWN, model: "offline", fallback: true });
}

const SYSTEM = `Virtual pet brain. Understand the sentence. Output JSON only, no other text:
{"intent":skill|battle_start|flee|capture|care|ask_token_spots|ask_hip_spots|chat|unknown,"args":{},"reply":""}
skill args:{"by":"slot","slot":0-3}|{"by":"type","type":attack|ranged|buff|debuff}|{"by":"name","name":name}.
care:{"kind":feed|praise|sleep|play}. ask_hip_spots:{"platform":instagram|youtube|any,"places":[names]}.
ask_token_spots:{"places":[names]}. else {}.
reply: 1st person as pet, Korean ("en" lang: English), max 2 short sentences.
ask_* places ONLY from given lists, never invent. Unsure: "unknown".`;

// VA-2: 출력 토큰 절감(2500→1200; 800 이하는 모델이 빈 문자열 반환 실측) + 서버 타임아웃 10초.
const ASK_MAX_TOKENS = 1200;
const ASK_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const gate = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error("ask timeout")), ms);
  });
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    gate,
  ]) as Promise<T>;
}

export async function POST(req: NextRequest) {
  let body: Partial<AskInput>;
  try {
    body = (await req.json()) as Partial<AskInput>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.slice(0, 500) : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const loc = body.loc && (body.loc.mode === "cam" || body.loc.mode === "sim")
    ? body.loc
    : { mode: "sim" as const };
  const key = process.env.MODEL_API_KEY;
  if (!key) return fallback();

  // 장소 근거 목록 (서버가 넘긴 안에서만 고름).
  const tokens = tokenSpots(loc);
  const zone = hipZone(loc);
  const hips = pickHipSpots(zone, "any", 8).map((s) => ({
    name: s.name, kind: s.kind, distM: s.distM, tags: s.tags.join("+"), source: s.source,
  }));
  let tube: YoutubeSpot[] = [];
  const ytKey = process.env.YOUTUBE_API_KEY ?? "";
  if (ytKey && wantsYoutube(text)) {
    const c = loc.mode === "cam" && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)
      ? { lat: loc.lat as number, lon: loc.lon as number }
      : ZONE_CENTER[loc.env ?? ""] ?? ZONE_CENTER.home;
    try {
      tube = await searchYoutubeSpots({ key: ytKey, lat: c.lat, lon: c.lon, query: "핫플레이스" });
    } catch (e) {
      // 유튜브 실패는 큐레이션으로 계속 (요청 전체 실패 아님).
      console.error(`[api/muse/ask] youtube failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  const model = process.env.MUSE_MODEL_SPARK ?? "muse-spark-1.3";
  const skills = Array.isArray(body.skills) ? body.skills.slice(0, 4) : [];
  const user = JSON.stringify({
    text,
    screen: body.screen ?? "idle",
    driving: body.driving === true,
    partner: body.partner ?? {},
    skills,
    loc: { mode: loc.mode, env: loc.env ?? null },
    tokenSpots: tokens,
    hipSpots: hips,
    youtubeSpots: tube.map((s) => ({ name: s.name, source: s.source })),
    balance: typeof body.balance === "number" ? body.balance : null,
    lang: typeof body.lang === "string" ? body.lang.slice(0, 10) : "ko-KR",
  });
  try {
    // [EXT:meta-chat] 외부 호출 — 끊기면: 200 + 대체 결과(fallback:true, 정규식 경로)
    // VA-2: 출력 토큰 최소화 + 10초 넘으면 타임아웃 → 대체 경로(클라 askFallback + 오프라인 칩).
    const raw = await withTimeout(
      callMuseJson({ model, system: SYSTEM, user, maxTokens: ASK_MAX_TOKENS }),
      ASK_TIMEOUT_MS
    );
    const parsed = validateAskJson(raw);
    if (!parsed) {
      console.error(`[api/muse/ask] schema invalid (textLen=${text.length})`);
      return NextResponse.json({ intent: "unknown", args: {}, reply: UNKNOWN_LINE, model, fallback: true });
    }
    // 운전 잠금: 배틀 행동은 서버에서도 거부.
    if (body.driving === true && BATTLE_INTENTS.includes(parsed.intent)) {
      return NextResponse.json({ intent: "unknown", args: {}, reply: DRIVING_REFUSE, model });
    }
    if (parsed.intent === "ask_token_spots") {
      const names = filterPlaces((parsed.args as { places?: unknown }).places, tokens.map((s) => s.name));
      const spots: AskSpot[] = names
        .map((n) => tokens.find((s) => s.name === n))
        .filter((s): s is AskSpot => !!s);
      return NextResponse.json({ ...parsed, args: { places: names }, spots, model });
    }
    if (parsed.intent === "ask_hip_spots") {
      const allowed = [...hips.map((s) => s.name), ...tube.map((s) => s.name)];
      const names = filterPlaces((parsed.args as { places?: unknown }).places, allowed);
      const spots: AskSpot[] = names.map((n) => {
        const h = hips.find((s) => s.name === n);
        if (h) return { name: h.name, kind: h.kind, distM: h.distM, source: h.source };
        return { name: n, kind: "youtube", distM: null, source: "YouTube Data API v3" };
      });
      return NextResponse.json({
        ...parsed,
        args: { ...(parsed.args as object), places: names },
        spots,
        model,
      });
    }
    return NextResponse.json({ ...parsed, model });
  } catch (e) {
    console.error(`[api/muse/ask] error (textLen=${text.length}): ${e instanceof Error ? e.message : "unknown"}`);
    return fallback();
  }
}
