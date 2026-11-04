// scripts/verify-calm.mjs — CALM-1 검증 (docs/CALM_FIELD_ORDER.md).
// 실행: node scripts/verify-calm.mjs (종료 코드만 본다).
// - lib/calm.ts 단일 상수 값, page.tsx 게이트·PovCreature 범위 적용 확인.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const calm = readFileSync(join(ROOT, "lib/calm.ts"), "utf8");
const pov = readFileSync(join(ROOT, "app/pov/page.tsx"), "utf8");
const pvc = readFileSync(join(ROOT, "components/PovCreature.tsx"), "utf8");

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

const val = (n) => {
  const m = calm.match(new RegExp(`export const ${n} = ([0-9.]+);`));
  return m ? Number(m[1]) : NaN;
};
check("emote gap 20s", val("CALM_EMOTE_MIN_GAP_S") === 20);
check("random 1/min", val("CALM_RANDOM_PER_MIN") === 1 && val("CALM_RANDOM_WINDOW_S") === 60);
check("roam gap 15s", val("CALM_ROAM_MIN_GAP_S") === 15);
check("bubble gap 15s", val("CALM_BUBBLE_MIN_GAP_S") === 15);
check("range scale 0.5", val("CALM_ROAM_RANGE_SCALE") === 0.5);
check("pov imports calm", pov.includes('from "@/lib/calm"'));
check("ambient timer uses gap", pov.includes("CALM_EMOTE_MIN_GAP_S * 1000"));
check("old 8-15s timer gone", !pov.includes("8000 + Math.random() * 7000"));
check("say gated", /function say\(text: string, opts\?: \{ interactive\?: boolean(; sticky\?: boolean)? \}\) \{[\s\S]{0,600}?lastBubbleAtRef\.current < CALM_BUBBLE_MIN_GAP_S/.test(pov));
check("interactive bypasses gate", /function say\(text: string, opts\?: \{ interactive\?: boolean(; sticky\?: boolean)? \}\) \{[\s\S]{0,600}?!opts\?\.interactive && nowS - lastBubbleAtRef\.current < CALM_BUBBLE_MIN_GAP_S/.test(pov));
// AF-3 후속: VA-2 sticky 추가 + 상호작용 28곳(음성·먹이·수면·인사·배틀·레벨업·발견 — 전수 확인).
check("ambient stays gated", (pov.match(/interactive: true/g) || []).length === 28
  && (pov.match(/say\(SLEEPY_LINE\);/g) || []).length === 1
  && pov.includes('say("냠냠... 배불러!");')
  && pov.includes("say(out.balloon);") && pov.includes("say(wBalloon);"));
check("pvc imports calm", pvc.includes('from "@/lib/calm"'));
check("roam/zoomies scaled", (pvc.match(/CALM_ROAM_RANGE_SCALE/g) || []).length >= 7);
check("depthExcursion span param", pvc.includes("back: number, span = 1"));

console.log(`calm: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
