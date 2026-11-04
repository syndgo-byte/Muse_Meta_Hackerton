// Hero test: external image-to-3D (Stable Fast 3D public demo).
// Mirrors the UI flow in one session: upload -> requires_bg_remove ->
// run_button("Remove Background") -> run_button("Run").
// Saves to aiconfirm/hero/ (review only, never touches public/models).
// Usage: node scripts/ext3d-hero.mjs <roster-id>
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SPACE = "https://stabilityai-stable-fast-3d.hf.space";

const id = process.argv[2] || "fire-01";
const portrait = path.join(ROOT, "public", "dex", `${id}.jpg`);
const outDir = path.join(ROOT, "aiconfirm", "hero");

function extractCfg(t, marker) {
  const i = t.indexOf(marker) + marker.length;
  const raw = t.slice(i).replace(/\\"/g, '"').replace(/\\n/g, "");
  let depth = 0, end = -1;
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] === "{") depth++;
    else if (raw[k] === "}") { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  return JSON.parse(raw.slice(0, end));
}

async function callFn(fnIndex, data, sessionHash, budgetMs, tag) {
  const joinRes = await fetch(SPACE + "/queue/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, fn_index: fnIndex, session_hash: sessionHash }),
  });
  const join = await joinRes.json().catch(() => ({}));
  if (joinRes.status !== 200 || join.event_id === undefined) {
    throw new Error(`[${tag}] join rejected: http=` + joinRes.status + " " + JSON.stringify(join).slice(0, 200));
  }
  const res = await fetch(`${SPACE}/queue/data?session_hash=${sessionHash}`);
  if (!res.ok || !res.body) throw new Error(`[${tag}] sse connect ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const t0 = Date.now();
  try {
    while (true) {
      if (Date.now() - t0 > budgetMs) throw new Error(`[${tag}] queue timeout`);
      const { value, done } = await reader.read();
      if (done) throw new Error(`[${tag}] stream closed without result`);
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let msg = null;
        try { msg = JSON.parse(line.slice(6)); } catch { continue; }
        if (msg.msg === "estimation" || msg.msg === "progress") {
          console.log(`[${tag}]`, msg.msg, msg.rank ?? "", msg.rank_eta ?? "");
        } else if (msg.msg === "process_completed") {
          if (msg.success === false) throw new Error(`[${tag}] failed: ` + JSON.stringify(msg).slice(0, 500));
          return msg.output?.data ?? msg.data;
        } else if (msg.msg === "process_failed" || msg.msg === "error") {
          throw new Error(`[${tag}] error: ` + JSON.stringify(msg).slice(0, 500));
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function saveFile(f, destHint) {
  let url = f.url || f.path;
  if (url.startsWith("/")) url = SPACE + url;
  const ext = ((f.orig_name || url).split(".").pop() || "bin").split("?")[0];
  const dest = path.join(outDir, `${id}-${destHint}.${ext}`);
  const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
  await fs.writeFile(dest, bin);
  console.log("saved", dest, bin.length + "B");
  return dest;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const cfgText = await (await fetch(SPACE + "/")).text();
  const cfg = extractCfg(cfgText, "window.gradio_config = ");
  const fnOf = (api) => (cfg.dependencies || []).findIndex((d) => d.api_name === api);
  const fnBg = fnOf("requires_bg_remove"), fnRun = fnOf("run_button");
  console.log("fn requires_bg_remove=" + fnBg, "run_button=" + fnRun);
  if (fnBg < 0 || fnRun < 0) throw new Error("endpoints not found");

  const img = await fs.readFile(portrait);
  const fd = new FormData();
  fd.append("files", new Blob([img], { type: "image/jpeg" }), `${id}.jpg`);
  const up = await (await fetch(SPACE + "/upload", { method: "POST", body: fd })).json();
  const serverPath = Array.isArray(up) ? up[0] : up.path || up;
  const fileData = {
    path: serverPath, url: SPACE + "/file=" + serverPath, size: img.length,
    orig_name: `${id}.jpg`, mime_type: "image/jpeg", meta: { _type: "gradio.FileData" },
  };
  console.log("uploaded", serverPath);
  const sessionHash = Math.random().toString(36).slice(2);

  const out1 = await callFn(fnBg, [fileData, 0.85], sessionHash, 3 * 60 * 1000, "bg-check");
  console.log("bg-check outputs:", JSON.stringify(out1).slice(0, 300));

  const collect = (out) => {
    const found = [];
    for (const x of Array.isArray(out) ? out : []) {
      if (x && (x.url || x.path)) found.push(x);
      else if (x && x.value && (x.value.url || x.value.path)) found.push(x.value);
    }
    return found;
  };
  const out2 = await callFn(fnRun, ["Remove Background", fileData, null, 0.85, "None", -1, 1024], sessionHash, 5 * 60 * 1000, "rm-bg");
  const imgs2 = collect(out2);
  console.log(`rm-bg files: ${imgs2.length}`);
  for (let i = 0; i < imgs2.length; i++) await saveFile(imgs2[i], `step2-${i}`);

  const out3 = await callFn(fnRun, ["Run", fileData, null, 0.85, "None", -1, 1024], sessionHash, 7 * 60 * 1000, "run");
  const files3 = collect(out3);
  console.log(`run files: ${files3.length}`, JSON.stringify(out3).slice(0, 300));
  for (let i = 0; i < files3.length; i++) await saveFile(files3[i], `sf3d-${i}`);
  if (!files3.length) throw new Error("run returned no files");
}

main().catch((e) => { console.error("FAILED:", e.message || e); process.exit(1); });
