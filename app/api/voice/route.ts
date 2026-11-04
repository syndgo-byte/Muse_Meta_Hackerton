import { NextRequest, NextResponse } from "next/server";
import { recordExternal } from "@/lib/external/stats";

// EX-2: 오프라인 대체 결과 (같은 모양: { result: { text }, model } + fallback 플래그).
function voiceFallback() {
  return NextResponse.json({
    result: { text: "" },
    model: "offline",
    fallback: true,
    note: "오프라인: 전사 불가",
  });
}

export async function POST(req: NextRequest) {
  let attempted = false;
  const t0 = Date.now();
  try {
    const key = process.env.MODEL_API_KEY;
    if (!key) return voiceFallback();
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: "audio required" }, { status: 400 });
    }
    const model =
      process.env.MUSE_MODEL_VOICE ?? "muse-voice-transcribe-1.0";
    const out = new FormData();
    out.append("model", model);
    out.append("file", audio, "voice.webm");
    // [EXT:meta-voice] 외부 호출 — 끊기면: 200 + 대체 결과(fallback:true, 빈 전사 + 안내)
    attempted = true;
    const res = await fetch("https://api.meta.ai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    });
    recordExternal("meta-voice", res.ok, Date.now() - t0);
    attempted = false; // 이후 단계(본문 파싱) 실패는 외부 호출 실패가 아님.
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error(`[api/voice] upstream ${res.status}: ${t.slice(0, 200)}`);
      return voiceFallback();
    }
    return NextResponse.json({ result: await res.json(), model });
  } catch (e) {
    // EX-3: 외부 시도 후 실패면 카운터에 기록 (요청 파싱 실패는 제외).
    if (attempted) recordExternal("meta-voice", false, Date.now() - t0);
    console.error(`[api/voice] error: ${e instanceof Error ? e.message : "unknown"}`);
    return voiceFallback();
  }
}
