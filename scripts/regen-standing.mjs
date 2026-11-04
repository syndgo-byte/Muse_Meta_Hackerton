// R0: standing-portrait image-to-3D (Stable Fast 3D public demo) for regen species.
// Input:  scratch/regen/<id>-stand.png
// Output: scratch/regen/<id>.glb  (NEVER public/models — reviewer replaces in step 5)
// Progress: scratch/regen/progress.json. Continues past failures.
// Usage: node scripts/regen-standing.mjs [id...]   (default: fire-02 grass-04 wind-04)
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SPACE = "https://stabilityai-stable-fast-3d.hf.space";
const REGEN = path.join(ROOT, "scratch", "regen");
const PROGRESS = path.join(REGEN, "progress.json");

const DEFAULT_IDS = ["fire-02", "grass-04", "wind-04"];

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
    throw new Error(`[${tag}] join rejected: http=` + joinRes.status);
  }
  const res = await fetch(`${SPACE}/queue/data?session_hash=${sessionHash}`);
  if (!res.ok || !res.body) throw new Error(`[${tag}] sse ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const t0 = Date.now();
  try {
    while (true) {
      if (Date.now() - t0 > budgetMs) throw new Error(`[${tag}] timeout`);
      const { value, done } = await reader.read();
      if (done) throw new Error(`[${tag}] stream closed`);
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        let msg = null;
        try { msg = JSON.parse(line.slice(6)); } catch { continue; }
        if (msg.msg === "process_completed") {
          if (msg.success === false) throw new Error(`[${tag}] job failed`);
          return msg.output?.data ?? msg.data;
        }
        if (msg.msg === "process_failed" || msg.msg === "error") throw new Error(`[${tag}] job error`);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const collect = (out) => {
  const found = [];
  for (const x of Array.isArray(out) ? out : []) {
    if (x && (x.url || x.path)) found.push(x);
    else if (x && x.value && (x.value.url || x.value.path)) found.push(x.value);
  }
  return found;
};

function validGlb(b) {
  return b.length > 20 && b.readUInt32LE(0) === 0x46546c67 && b.readUInt32LE(4) === 2 && b.readUInt32LE(8) === b.length;
}

async function convertOne(id, fnBg, fnRun) {
  const portrait = path.join(REGEN, `${id}-stand.png`);
  const img = await fs.readFile(portrait);
  const fd = new FormData();
  fd.append("files", new Blob([img], { type: "image/png" }), `${id}-stand.png`);
  const up = await (await fetch(SPACE + "/upload", { method: "POST", body: fd })).json();
  const serverPath = Array.isArray(up) ? up[0] : up.path || up;
  const fileData = {
    path: serverPath, url: SPACE + "/file=" + serverPath, size: img.length,
    orig_name: `${id}-stand.png`, mime_type: "image/png", meta: { _type: "gradio.FileData" },
  };
  const sessionHash = Math.random().toString(36).slice(2);
  await callFn(fnBg, [fileData, 0.85], sessionHash, 3 * 60 * 1000, id + ":bg");
  await callFn(fnRun, ["Remove Background", fileData, null, 0.85, "None", -1, 1024], sessionHash, 5 * 60 * 1000, id + ":rmbg");
  const out = await callFn(fnRun, ["Run", fileData, null, 0.85, "None", -1, 1024], sessionHash, 8 * 60 * 1000, id + ":run");
  const files = collect(out).filter((f) => /\.(glb|gltf)(\?|$)/i.test(f.url || f.path || ""));
  if (!files.length) throw new Error(id + ": no glb in output");
  let url = files[0].url || files[0].path;
  if (url.startsWith("/")) url = SPACE + url;
  const bin = Buffer.from(await (await fetch(url)).arrayBuffer());
  if (!validGlb(bin)) throw new Error(id + ": invalid glb bytes");
  const tmp = path.join(REGEN, `${id}.glb.tmp`);
  await fs.writeFile(tmp, bin);
  await fs.rename(tmp, path.join(REGEN, `${id}.glb`));
  return bin.length;
}

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const IDS = ids.length ? ids : DEFAULT_IDS;
  let progress = {};
  try { progress = JSON.parse(await fs.readFile(PROGRESS, "utf8")); } catch { /* fresh */ }
  const cfg = extractCfg(await (await fetch(SPACE + "/")).text(), "window.gradio_config = ");
  const fnOf = (api) => (cfg.dependencies || []).findIndex((d) => d.api_name === api);
  const fnBg = fnOf("requires_bg_remove"), fnRun = fnOf("run_button");
  if (fnBg < 0 || fnRun < 0) throw new Error("endpoints missing");
  const done = [], failed = [];
  for (const id of IDS) {
    try {
      const bytes = await convertOne(id, fnBg, fnRun);
      progress[id] = { bytes, at: new Date().toISOString() };
      await fs.writeFile(PROGRESS, JSON.stringify(progress, null, 1));
      done.push(`${id} ${(bytes / 1024).toFixed(0)}KB`);
      console.log(`OK ${id} ${bytes}B`);
    } catch (e) {
      failed.push(`${id}: ${e.message || e}`);
      console.log(`FAIL ${id}: ${e.message || e}`);
    }
  }
  console.log(`\nregen done: ok=${done.length} failed=${failed.length}`);
  console.log("ok:", done.join(", "));
  if (failed.length) console.log("failed:", failed.join(" | "));
  if (!done.length && failed.length) process.exit(1);
}

main().catch((e) => { console.error("REGEN FAILED:", e.message || e); process.exit(1); });
