import { recordExternal } from "./external/stats";

type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function callMuseChat(opts: {
  model: string;
  system: string;
  user: string;
  imageDataUrl?: string;
  maxTokens?: number;
}) {
  const t0 = Date.now();
  try {
    return await callMuseChatInner(opts);
  } catch (e) {
    recordExternal("meta-chat", false, Date.now() - t0);
    throw e;
  }
}

async function callMuseChatInner(opts: {
  model: string;
  system: string;
  user: string;
  imageDataUrl?: string;
  maxTokens?: number;
}) {
  const t0 = Date.now();
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY missing");
  const content: ChatPart[] = [{ type: "text", text: opts.user }];
  if (opts.imageDataUrl) {
    content.push({
      type: "image_url",
      image_url: { url: opts.imageDataUrl },
    });
  }
  // [EXT:meta-chat] 외부 호출 — 끊기면: 200 + 규칙 기반 대체 결과(fallback:true)
  // MODEL_API_BASE: 테스트용 모의 서버 지점 (기본 api.meta.ai, 동작 변경 없음).
  const res = await fetch(`${process.env.MODEL_API_BASE ?? "https://api.meta.ai"}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        {
          role: "user",
          content: content.length === 1 ? opts.user : content,
        },
      ],
      max_tokens: opts.maxTokens ?? 800,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Meta API ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const text =
    data.choices?.[0]?.message?.content ??
    data.output?.[0]?.content?.[0]?.text ??
    "";
  recordExternal("meta-chat", true, Date.now() - t0);
  return String(text);
}

export async function callMuseImage(prompt: string): Promise<{
  b64?: string;
  url?: string;
  model: string;
}> {
  const t0 = Date.now();
  try {
    return await callMuseImageInner(prompt);
  } catch (e) {
    recordExternal("meta-image", false, Date.now() - t0);
    throw e;
  }
}

async function callMuseImageInner(prompt: string): Promise<{
  b64?: string;
  url?: string;
  model: string;
}> {
  const t0 = Date.now();
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY missing");
  const model = process.env.MUSE_MODEL_IMAGE ?? "muse-image-1.0";
  // [EXT:meta-image] 외부 호출 — 끊기면: 200 + 대체 결과(fallback:true, 이미지 없음 표시)
  const res = await fetch("https://api.meta.ai/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, prompt: prompt.slice(0, 1000) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Meta Image API ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const first = data.data?.[0] ?? {};
  recordExternal("meta-image", true, Date.now() - t0);
  return { b64: first.b64_json, url: first.url, model };
}

export function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const m = src.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("model did not return JSON");
  return JSON.parse(m[0]);
}

export async function callMuseJson(opts: {
  model: string;
  system: string;
  user: string;
  imageDataUrl?: string;
  maxTokens?: number;
}) {
  try {
    return extractJson(await callMuseChat({ maxTokens: 2500, ...opts }));
  } catch {
    const retry = await callMuseChat({
      maxTokens: 2500,
      ...opts,
      user: `${opts.user}\n\nOutput ONLY the JSON object. No other text.`,
    });
    return extractJson(retry);
  }
}
// SEC-3: 외부 API 오류를 클라이언트에 그대로 주지 않는다. 본문은 서버 로그에만.
export function museErrorResponse(e: unknown, route: string): { body: { error: string; status?: number }; status: number } {
  const msg = e instanceof Error ? e.message : "unknown error";
  console.error(`[${route}] muse error: ${msg}`);
  if (msg.includes("MODEL_API_KEY")) return { body: { error: "server_not_configured" }, status: 500 };
  const m = msg.match(/Meta (?:Image )?API (\d{3})/);
  if (m) return { body: { error: "upstream_error", status: Number(m[1]) }, status: 502 };
  return { body: { error: "internal_error" }, status: 500 };
}
