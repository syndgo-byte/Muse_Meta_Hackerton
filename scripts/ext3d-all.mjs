// Batch: external image-to-3D (Stable Fast 3D public demo) for ALL roster creatures.
// Saves DIRECTLY to public/models/<id>.glb (overwrites procedural originals).
// Skips ids that already have a full-size external model (>500KB).
// Progress: aiconfirm/hero/batch-progress.json. Continues past failures.
// Usage: node scripts/ext3d-all.mjs
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SPACE = "https://stabilityai-stable-fast-3d.hf.space";
const MODELS = path.join(ROOT, "public", "models");
const DEX = path.join(ROOT, "public", "dex");
const PROGRESS = path.join(ROOT, "aiconfirm", "hero", "batch-progress.json");

const IDS = [
  "fire-01", "fire-02", "fire-03", "fire-04", "fire-05",
  "grass-01", "grass-02", "grass-03", "grass-04", "grass-05",
  "water-01", "water-02", "water-03", "water-04", "water-05",
  "rock-01", "rock-02", "rock-03", "rock-04",
  "wind-01", "wind-02", "wind-03", "wind-04", "wind-05",
];

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
  const portrait = path.join(DEX, `${id}.jpg`);
  const img = await fs.readFile(portrait);
  const fd = new FormData();
  fd.append("files", new Blob([img], { type: "image/jpeg" }), `${id}.jpg`);
  const up = await (await fetch(SPACE + "/upload", { method: "POST", body: fd })).json();
  const serverPath = Array.isArray(up) ? up[0] : up.path || up;
  const fileData = {
    path: serverPath, url: SPACE + "/file=" + serverPath, size: img.length,
    orig_name: `${id}.jpg`, mime_type: "image/jpeg", meta: { _type: "gradio.FileData" },
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
  const tmp = path.join(MODELS, `${id}.glb.tmp`);
  await fs.writeFile(tmp, bin);
  await fs.rename(tmp, path.join(MODELS, `${id}.glb`));
  return bin.length;
}

async function main() {
  await fs.mkdir(path.dirname(PROGRESS), { recursive: true });
  let progress = {};
  try { progress = JSON.parse(await fs.readFile(PROGRESS, "utf8")); } catch { /* fresh */ }
  const cfg = extractCfg(await (await fetch(SPACE + "/")).text(), "window.gradio_config = ");
  const fnOf = (api) => (cfg.dependencies || []).findIndex((d) => d.api_name === api);
  const fnBg = fnOf("requires_bg_remove"), fnRun = fnOf("run_button");
  if (fnBg < 0 || fnRun < 0) throw new Error("endpoints missing");
  const done = [], failed = [], skipped = [];
  for (const id of IDS) {
    const dest = path.join(MODELS, `${id}.glb`);
    try {
      const cur = await fs.readFile(dest);
      if (cur.length > 500 * 1024 && validGlb(cur)) { skipped.push(id); continue; }
    } catch { /* missing -> convert */ }
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
  console.log(`\nbatch done: ok=${done.length} skipped=${skipped.length} failed=${failed.length}`);
  console.log("ok:", done.join(", "));
  if (failed.length) console.log("failed:", failed.join(" | "));
  if (!done.length && failed.length) process.exit(1);
}

main().catch((e) => { console.error("BATCH FAILED:", e.message || e); process.exit(1); });
