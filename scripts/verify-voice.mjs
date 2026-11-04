// scripts/verify-voice.mjs — VC-1 검증 (음성 인식 오류 안내 문구·해제).
// 실행: node scripts/verify-voice.mjs (종료 코드만 본다).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let failures = 0;
let passes = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passes += 1;
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const pov = readFileSync(join(ROOT, "app", "pov", "page.tsx"), "utf8");
const vc = pov.match(/function voiceCapture\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
check("vc1-onerror", vc.includes("rec.onerror"));
check("vc1-onend", vc.includes("rec.onend"));
check("vc1-not-allowed", vc.includes("마이크 권한을 허용해 주세요"));
check("vc1-network", vc.includes("음성 인식 서버에 연결할 수 없어요"));
check("vc1-no-speech", vc.includes("잘 안 들렸어요. 다시 눌러 주세요"));
check("vc1-code-suffix", vc.includes("(${err})"));
check("vc1-listening-off", (vc.match(/setListening\(false\)/g) ?? []).length >= 3);
console.log(`verify-voice: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
