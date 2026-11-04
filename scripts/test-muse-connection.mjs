// Minimal Muse / Meta Model API connection check (no deps, Node 18+).
// Reads MODEL_API_KEY from env or D:\Meta_hackerton\.env .
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(root, ".env");

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadDotEnv(envPath);

const key = process.env.MODEL_API_KEY;
if (!key) {
  console.log("META_API_KEY missing");
  console.log("Fix: copy .env.example to .env and set MODEL_API_KEY,");
  console.log("or PowerShell: $env:MODEL_API_KEY=\"m...\"");
  process.exit(2);
}

const base = "https://api.meta.ai/v1";
try {
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  console.log(`GET /models -> ${res.status}`);
  const body = await res.text();
  console.log(body.slice(0, 800));
  if (!res.ok) process.exit(1);
  console.log("connection OK (key accepted)");
} catch (e) {
  console.error(`connection FAILED: ${e.message}`);
  process.exit(1);
}
