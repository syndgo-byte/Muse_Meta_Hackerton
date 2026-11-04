// scripts/verify-mic.mjs — MC-1 검증 (장치 우선순위·기억·대체 + 벤더·핀·문서).
// 실행: node scripts/verify-mic.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-mic");
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

// lib/audio/micSource.ts를 컴파일해서 순수 함수를 직접 검사한다.
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
writeFileSync(join(BUILD, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "es2020", module: "commonjs", moduleResolution: "node",
    outDir: "out", rootDir: "../..", skipLibCheck: true, esModuleInterop: true,
  },
  include: ["../../lib/audio/micSource.ts"],
}));
execFileSync(process.execPath, [
  join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json",
], { cwd: BUILD, stdio: "pipe" });
const M = require(join(BUILD, "out", "lib", "audio", "micSource.js"));

// 1. 장치 라벨 우선순위 정렬: 안경 > 블루투스/헤드셋 > 기본.
{
  const devs = [
    { deviceId: "a", label: "Microphone (Realtek)" },
    { deviceId: "b", label: "Ray-Ban Meta" },
    { deviceId: "c", label: "WH-1000XM4 Hands-Free" },
    { deviceId: "d", label: "" },
    { deviceId: "e", label: "oakley smart glasses" },
    { deviceId: "f", label: "Bluetooth Headset HFP" },
  ];
  const ranked = M.rankDevices(devs).map((d) => d.deviceId);
  check("rank-glasses-first", ranked[0] === "b" && ranked[1] === "e", ranked.join(","));
  check("rank-headset-next", ranked[2] === "c" && ranked[3] === "f", ranked.join(","));
  check("rank-default-stable", ranked[4] === "a" && ranked[5] === "d", ranked.join(","));
  check("rank-tier", M.deviceTier("Meta AI Glasses") === 0 && M.deviceTier("HFP device") === 1
    && M.deviceTier("내장 마이크") === 2 && M.deviceTier("") === 2);
}
// 2. 기억된 deviceId 복원 + 장치 없을 때 대체.
{
  const devs = [
    { deviceId: "a", label: "Mic", kind: "audioinput" },
    { deviceId: "x", label: "Cam", kind: "videoinput" },
  ];
  check("pick-saved", M.pickDevice(devs, "a")?.deviceId === "a");
  check("pick-saved-missing", M.pickDevice(devs, "zzz")?.deviceId === "a");
  check("pick-kind-filter", M.pickDevice([{ deviceId: "x", label: "Cam", kind: "videoinput" }], null) === null);
  check("pick-empty", M.pickDevice([], "a") === null);
}
// 3. localStorage 기억 (node에는 없어도 조용히, 있으면 왕복).
{
  check("recall-no-storage", M.recallDevice() === null);
  let threw = false;
  try { M.rememberDevice("a"); } catch { threw = true; }
  check("remember-no-throw", !threw);
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  M.rememberDevice("dev-1");
  check("storage-roundtrip", M.recallDevice() === "dev-1");
  check("asked-flag", M.micAsked() === false);
  M.markMicAsked();
  check("asked-mark", M.micAsked() === true);
  delete globalThis.localStorage;
}
// 4. 마이크 제약: sampleRate 강제 없음, 모노 + 보정 3종.
{
  const c = M.micConstraints("dev-1");
  check("constraints-no-samplerate", !("sampleRate" in c), Object.keys(c).join(","));
  check("constraints-mono-fx", c.channelCount === 1 && c.echoCancellation === true
    && c.noiseSuppression === true && c.autoGainControl === true);
  check("constraints-device-exact", JSON.stringify(c.deviceId) === JSON.stringify({ exact: "dev-1" }));
  check("constraints-no-device", !("deviceId" in M.micConstraints(undefined)));
}
// 5. 리샘플 + WAV 인코딩.
{
  const src = new Float32Array(480);
  for (let i = 0; i < 480; i++) src[i] = Math.sin((i / 480) * Math.PI * 4);
  const down = M.resampleMono(src, 48000, 16000);
  check("resample-length", down.length === 160, String(down.length));
  check("resample-shape", Math.abs(down[40]) < 0.12 && down[20] > 0.5,
    `${down[20]?.toFixed(3)},${down[40]?.toFixed(3)}`);
  const same = M.resampleMono(src, 16000, 16000);
  check("resample-identity", same.length === 480 && same[100] === src[100]);
  check("resample-guard", M.resampleMono(new Float32Array(0), 8000).length === 0
    && M.resampleMono(src, 0).length === 0);
  const wav = M.encodeWav16(new Float32Array([0, 0.5, -0.5, 1]), 16000);
  const v = new DataView(wav);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(wav, o, n));
  check("wav-header", str(0, 4) === "RIFF" && str(8, 4) === "WAVE" && str(12, 4) === "fmt "
    && v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1
    && v.getUint32(24, true) === 16000 && v.getUint16(34, true) === 16);
  check("wav-data", wav.byteLength === 44 + 8 && v.getInt16(44 + 4, true) < 0);
}
// 6. /api/voice 응답 읽기 + 전송 1건 (fetch 스텁).
{
  check("parse-text", M.parseVoiceText({ result: { text: "공격" } }) === "공격");
  check("parse-alt", M.parseVoiceText({ result: { transcription: "잡아" } }) === "잡아");
  check("parse-garbage", M.parseVoiceText(null) === "" && M.parseVoiceText({}) === ""
    && M.parseVoiceText({ result: { text: 3 } }) === "");
  let seenUrl = "";
  let seenName = "";
  globalThis.fetch = async (url, opts) => {
    seenUrl = String(url);
    const fd = opts?.body;
    seenName = fd?.get?.("audio")?.name ?? "";
    return { json: async () => ({ result: { text: "웃어" } }) };
  };
  const r = await M.sendToVoiceApi(new Blob(["x"], { type: "audio/wav" }));
  check("voice-post", seenUrl === "/api/voice" && seenName === "voice.wav" && r.text === "웃어"
    && r.fallback === false, `${seenUrl},${seenName},${r.text}`);
  globalThis.fetch = async () => ({ json: async () => ({ result: { text: "" }, fallback: true }) });
  const off = await M.sendToVoiceApi(new Blob(["x"], { type: "audio/wav" }));
  check("voice-offline", off.text === "" && off.fallback === true);
  delete globalThis.fetch;
}
// 7. 벤더 파일 (오프라인 동작).
{
  const files = ["silero_vad_v5.onnx", "vad.worklet.bundle.min.js",
    "ort-wasm-simd.wasm", "ort-wasm-simd-threaded.wasm"];
  for (const f of files) {
    const p = join(ROOT, "public", "vendor", "vad", f);
    check(`vendor-${f}`, existsSync(p) && statSync(p).size > 1000, p);
  }
}
// 8. 패키지 정확 고정 + 문서.
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  check("pin-vad", pkg.dependencies?.["@ricky0123/vad-web"] === "0.0.31",
    pkg.dependencies?.["@ricky0123/vad-web"]);
  check("pin-ort", pkg.dependencies?.["onnxruntime-web"] === "1.17.3",
    pkg.dependencies?.["onnxruntime-web"]);
  const reg = readFileSync(join(ROOT, "lib", "external", "registry.ts"), "utf8");
  check("registry-vad", reg.includes('id: "vad-local"') && !reg.includes("MC-1 예정"));
  check("registry-voice-wav", reg.includes("16kHz 모노 WAV"));
  const lic = readFileSync(join(ROOT, "public", "vendor", "LICENSES.md"), "utf8");
  check("licenses-vad", lic.includes("vad/") && lic.includes("0.0.31") && lic.includes("1.17.3"));
  const btn = readFileSync(join(ROOT, "components", "MicButton.tsx"), "utf8");
  check("button-vad-path", btn.includes('"/vendor/vad/"') && btn.includes('model: "v5"'));
  check("button-no-title", !/title\s*=\s*["'{]/.test(btn));
  check("button-icons", btn.includes("MicIcon") && btn.includes("GlassesIcon")
    && btn.includes("PhoneIcon") && !btn.includes(">마이크<"));
}

rmSync(BUILD, { recursive: true, force: true });
console.log(`\nverify-mic: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
