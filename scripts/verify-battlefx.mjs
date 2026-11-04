// scripts/verify-battlefx.mjs — G2 배틀 연출 검증 (BATTLE_DESIGN §10·§10-1·§13·§13-1·§14).
// 실행: node scripts/verify-battlefx.mjs (dev 서버 3000 사용, 끄지 않음).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-battlefx-"));
const req = createRequire(join(ROOT, "package.json"));

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

async function main() {
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      join(ROOT, "components", "battle", "fx.ts"),
      "--outDir", BUILD,
      "--module", "commonjs",
      "--target", "es2021",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
  const fx = req(join(BUILD, "fx.js"));

  // 플로터: 보통
  let r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 20, element: "none", crit: false, effect: "normal" }]);
  check("fx-normal", r.items.length === 1 && r.items[0].text === "-20" && r.items[0].color === "#ffffff" && r.flags.shakeWild === 1 && r.flags.flashWild);
  // 효과 좋음
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 32, element: "fire", crit: false, effect: "good" }]);
  check("fx-good", r.items.length === 2 && r.items[1].text === "약점 공략!" && r.items[1].color === "#fb923c" && r.items[1].badge === "good" && r.items[0].badge === "none" && r.flags.shakeWild === 2 && r.bursts.length === 1 && r.bursts[0].color === "#ff7a45" && r.bursts[0].count === 12);
  // 별로
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 8, element: "fire", crit: false, effect: "bad" }]);
  check("fx-bad", r.items[1].text === "버텼다" && r.items[1].badge === "bad" && r.flags.shakeWild === 0 && r.bursts.length === 0);
  // 급소
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 45, element: "fire", crit: true, effect: "good" }]);
  check("fx-crit", r.items[0].text === "-45!" && r.items[0].big && r.items[0].color === "#ffd84a" && r.flags.vignette && r.items.length === 3 && r.items[1].text === "치명타!" && r.items[1].badge === "crit");
  // 빗나감·회복
  r = fx.fxFromEvents([{ type: "miss", target: "wild" }]);
  check("fx-miss", r.items[0].text === "빗나감" && r.items[0].color === "#dbe3ec" && r.items[0].badge === "miss");
  r = fx.fxFromEvents([{ type: "heal", target: "mine", value: 18 }]);
  check("fx-heal", r.items[0].text === "+18" && r.items[0].color === "#4ade80" && r.bursts[0].dir === "up");
  // 단계·저항
  r = fx.fxFromEvents([{ type: "stage", target: "mine", stat: "ATK", delta: 1 }]);
  check("fx-stage-up", r.items[0].text === "공격↑" && r.items[0].color === "#22d3ee" && r.items[0].badge === "buff");
  r = fx.fxFromEvents([{ type: "stage", target: "wild", stat: "DEF", delta: -1 }]);
  check("fx-stage-down", r.items[0].text === "방어↓" && r.items[0].color === "#c084fc" && r.items[0].badge === "debuff");
  r = fx.fxFromEvents([{ type: "resist", target: "mine", element: "fire", delta: 2 }]);
  check("fx-resist", r.items[0].text === "불저항 ▲" && r.items[0].color === "#ff7a45");
  // 상태 이상
  r = fx.fxFromEvents([{ type: "status-apply", target: "wild", status: "burn" }]);
  check("fx-status", r.items[0].text === "그슬림!" && r.items[0].color === "#ff7a45");
  r = fx.fxFromEvents([{ type: "status-tick", target: "wild", status: "burn", value: 6 }]);
  check("fx-tick", r.items[0].text === "-6" && r.items[0].small && r.bursts[0].count === 1);
  r = fx.fxFromEvents([{ type: "faint", target: "wild" }]);
  check("fx-faint", r.items[0].text === "쓰러짐" && r.flags.faintWild);
  // 9-E: 공격 입자는 때린 쪽에서 날아간다 + 디버프 링
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 32, element: "fire", crit: false, effect: "good" }]);
  check("fx-from", r.bursts[0].from === "mine" && r.bursts[0].color === "#ff7a45");
  r = fx.fxFromEvents([{ type: "damage", target: "mine", value: 10, element: "none", crit: false, effect: "normal" }]);
  check("fx-normal-burst", r.bursts.length === 1 && r.bursts[0].from === "wild");
  r = fx.fxFromEvents([{ type: "stage", target: "wild", stat: "DEF", delta: -1 }]);
  check("fx-ring-stage", r.rings.length === 1 && r.rings[0].side === "wild");
  r = fx.fxFromEvents([{ type: "status-apply", target: "mine", status: "burn" }]);
  check("fx-ring-status", r.rings.length === 1 && r.rings[0].element === "fire");
  // stagger 250ms + 좌우 ±12px
  r = fx.fxFromEvents([
    { type: "damage", target: "wild", value: 32, element: "fire", crit: false, effect: "good" },
    { type: "damage", target: "wild", value: 45, element: "fire", crit: true, effect: "good" },
  ]);
  check("fx-stagger", r.items.map((i) => i.delayMs).join(",") === "0,250,500,750,1000" && r.items.map((i) => i.dx).join(",") === "-12,12,-12,12,-12", JSON.stringify(r.items.map((i) => [i.delayMs, i.dx])));
  // 울음 조건
  check("fx-cry", fx.shouldPlayAttackCry([{ type: "damage", target: "wild" }]) === true && fx.shouldPlayAttackCry([{ type: "damage", target: "mine" }]) === false && fx.shouldPlayAttackCry([{ type: "miss", target: "wild" }]) === true);
  // 음성 파싱
  check("voice-num", fx.parseSkillNumber("2번") === 1 && fx.parseSkillNumber("4호") === 3 && fx.parseSkillNumber("3") === 2 && fx.parseSkillNumber("두 번째") === 1 && fx.parseSkillNumber("5번") === null && fx.parseSkillNumber("hello") === null);
  check("voice-name", fx.matchSkillName("콩콩 들이받기", ["콩콩 들이받기", "불씨 톡톡"]) === 0 && fx.matchSkillName("불씨 톡톡", ["콩콩 들이받기", "불씨 톡톡"]) === 1 && fx.matchSkillName("없는기술명", ["콩콩 들이받기", "불씨 톡톡"]) === null && fx.matchSkillName("a", ["콩콩 들이받기"]) === null);

  // J-2: 4종 연출 호출 검사
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 20, element: "fire", crit: false, effect: "normal", kind: "melee" }]);
  check("j2-melee", r.bursts.filter((b) => b.shape === "lunge").length === 2 && r.bursts.some((b) => !b.shape) && r.flags.shakeWild === 1 && r.items[0].text === "-20", JSON.stringify(r.bursts.map((b) => b.shape ?? "-")));
  r = fx.fxFromEvents([{ type: "miss", target: "wild", kind: "melee" }]);
  check("j2-melee-miss", r.bursts.length === 2 && r.bursts.every((b) => b.shape === "lunge") && r.flags.shakeWild === 0);
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 20, element: "fire", crit: false, effect: "normal", kind: "ranged" }]);
  check("j2-ranged", r.bursts.some((b) => b.shape === "fireball" && b.from === "mine") && r.bursts.some((b) => !b.shape && b.delayMs > 0) && r.flags.shakeWild === 1, JSON.stringify(r.bursts.map((b) => [b.shape ?? "-", b.delayMs])));
  r = fx.fxFromEvents([{ type: "miss", target: "wild", kind: "ranged" }]);
  check("j2-ranged-miss", r.bursts.length === 1 && r.bursts[0].shape === "fireball" && r.flags.shakeWild === 0);
  r = fx.fxFromEvents([{ type: "stage", target: "mine", stat: "ATK", delta: 1, element: "grass", kind: "buff" }]);
  check("j2-buff", r.rings.length === 1 && r.rings[0].element === "grass" && r.bursts.some((b) => b.shape === "ring-up" && b.color === "#66bb6a") && !r.bursts.some((b) => b.color === "#f59e0b"));
  r = fx.fxFromEvents([{ type: "stage", target: "mine", stat: "ATK", delta: 1, kind: "buff" }]);
  check("j2-buff-noelement", r.rings.length === 1 && r.rings[0].element === undefined && r.bursts.some((b) => b.shape === "ring-up" && b.color === "#ffffff"));
  r = fx.fxFromEvents([{ type: "stage", target: "wild", stat: "DEF", delta: -1, kind: "debuff", skill: "콩콩 들이받기" }]);
  check("j2-debuff", r.rings.length === 1 && /^debuff[012]$/.test(r.rings[0].element ?? "") && r.bursts.some((b) => b.shape === "ring-down" && b.color === fx.ELEMENT_FX_COLOR[r.rings[0].element]) && r.bursts.filter((b) => !b.shape).every((b) => b.color === fx.ELEMENT_FX_COLOR[r.rings[0].element]));
  r = fx.fxFromEvents([{ type: "stage", target: "wild", stat: "DEF", delta: -1, kind: "debuff", skill: "콩콩 들이받기" }]);
  const hueA = r.rings[0].element;
  r = fx.fxFromEvents([{ type: "stage", target: "wild", stat: "DEF", delta: -1, kind: "debuff", skill: "불씨 톡톡" }]);
  check("j2-debuff-hue", typeof hueA === "string" && /^debuff[012]$/.test(r.rings[0].element ?? ""));
  r = fx.fxFromEvents([
    { type: "damage", target: "wild", value: 20, element: "none", crit: false, effect: "normal" },
    { type: "stage", target: "wild", stat: "DEF", delta: -1 },
    { type: "status-apply", target: "mine", status: "burn" },
  ]);
  check("j2-compat", r.bursts.every((b) => b.shape === undefined) && r.rings.length === 2);
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 20, element: "fire", crit: false, effect: "normal", kind: "ranged" }]);
  check("j2-cap", r.bursts.reduce((s, b) => s + b.count, 0) <= 60 && r.bursts.every((b) => b.count > 0 && b.count <= 60));
  // BP-2: fireball에 속성 전달 + 착탄 350ms 동기
  check("bp2-fireball-element", r.bursts.some((b) => b.shape === "fireball" && b.element === "fire"), JSON.stringify(r.bursts.map((b) => [b.shape ?? "-", b.element ?? "-"])));
  check("bp2-impact-350", r.bursts.filter((b) => !b.shape).every((b) => b.delayMs >= 350), JSON.stringify(r.bursts.map((b) => b.delayMs)));

  // 정적 검사
  const dir = join(ROOT, "components", "battle");
  const files = readdirSync(dir);
  const src = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  check("static-cap60", src.includes("MAX_PARTICLES = 60"));
  check("j2-swap", readFileSync(join(dir, "Particles.tsx"), "utf8").includes("J-1 SWAP POINT") && src.includes("spawnProjectile"));
  // BP-2: 투사체 파일 5종 (GLB 50KB 이하 + 스프라이트) + 렌더 배선
  const projDir = join(ROOT, "public", "models", "projectiles");
  const projOk = ["fire", "grass", "rock", "wind", "water"].every((el) => {
    try {
      const g = join(projDir, `proj_${el}.glb`);
      const p = join(projDir, `proj_${el}.png`);
      return existsSync(g) && statSync(g).size <= 50 * 1024 && existsSync(p) && statSync(p).size > 0;
    } catch {
      return false;
    }
  });
  check("bp2-files", projOk);
  const partSrc = readFileSync(join(dir, "Particles.tsx"), "utf8");
  check("bp2-sprite", partSrc.includes("proj_${element}.png") && partSrc.includes("PROJ_FLIGHT_MS = 350") && partSrc.includes("drawImage(f.img"));
  check("static-cry", src.includes('playCry(mine.id, "attack")'));
  check("static-no3d", !/three|webgl|WebGL/i.test(src));
  check("static-floater-spec", src.includes("translateY(-40px)") && src.includes("0.8s"));
  check("static-files", ["fx.ts", "fx.css", "Floaters.tsx", "Particles.tsx", "HpBar.tsx", "Chips.tsx", "SkillButtons.tsx", "SkillModal.tsx", "DistanceBar.tsx", "Waiting.tsx", "BattleStage.tsx", "CaptureShutter.tsx"].every((f) => files.includes(f)), files.join(","));
  // 9-G: 포획 셔터 연출 (자체 제작, capture.ts 로직 유지, 한국어 문구 KO-1)
  const cap9g = readFileSync(join(dir, "CaptureShutter.tsx"), "utf8");
  check("9g-phases", ["gather", "finder", "flash", "polaroid", "data-phase"].every((k) => cap9g.includes(k)));
  const fx9g = readFileSync(join(dir, "fx.css"), "utf8");
  check("9g-finder-hud", /bracket/i.test(cap9g) && /tick/i.test(cap9g) && cap9g.includes("셔터") && fx9g.includes("cap-arc") && fx9g.includes("0.6s"));
  check("9g-gather-05s", fx9g.includes("cap-spark") && fx9g.includes("0.5s"));
  check("9g-flash-60ms", cap9g.includes("60") && cap9g.includes("flash"));
  check("9g-english", /시도/.test(cap9g) && /포획/.test(cap9g) && /셔터/.test(cap9g) && /다시 찍기/.test(cap9g));
  check("9g-logic-kept", cap9g.includes("captureRate") && cap9g.includes("CAPTURE_ATTEMPTS") && cap9g.includes("onDone"));
  const pov9g = readFileSync(join(ROOT, "app", "pov", "page.tsx"), "utf8");
  check("9g-pov-swap", pov9g.includes("<CaptureShutter"));
  // 9-F: +/- 스테퍼 제거·원형 스킬 버튼·영어 문구·거리 도망 판정·야생 HP 간소화
  const db9f = readFileSync(join(dir, "DistanceBar.tsx"), "utf8");
  const sb9f = readFileSync(join(dir, "SkillButtons.tsx"), "utf8");
  const bs9f = readFileSync(join(dir, "BattleStage.tsx"), "utf8");
  const hb9f = readFileSync(join(dir, "HpBar.tsx"), "utf8");
  check("9f-no-steppers", !db9f.includes("onStep") && !db9f.includes("＋") && !db9f.includes("aria-label=\"가까이\""));
  check("9f-skill-circles", sb9f.includes("50%") && !sb9f.includes("SkillModal"));
  check("9f-skill-korean", ["공격", "버프", "디버프"].every((k) => sb9f.includes(k))); // UI-2 확정: 9-H 영어 대체
  check("9f-flee-status", bs9f.includes("fleeStatus") && !bs9f.includes(">= 90"));
  check("9f-wild-simple", hb9f.includes("simple") && bs9f.includes("simple"));
  check("9f-flee-button", />\s*도망\s*</.test(bs9f)); // UI-2 확정: 한글
  // UI-2: 십자 스킬 패드·조우 연출·흰 베일·거리 문구
  check("ui2-skill-pad", sb9f.includes("skill-pad") && sb9f.includes("54, top: 0") && sb9f.includes("54, top: 108") && sb9f.includes("left: 0, top: 54") && sb9f.includes("108, top: 54"));
  const srUi2 = readFileSync(join(dir, "ScanReveal.tsx"), "utf8");
  check("ui2-scan-reveal", ["finder", "scanned", "found", "스캔 완료:", "이 물건에서", "onDone"].every((k) => srUi2.includes(k)));
  check("ui2-veil", pov9g.includes("battle-veil") && pov9g.includes("#ffffff") && !/battle-veil[\s\S]{0,200}살색/.test(pov9g));
  check("ui2-distance-ko", db9f.includes("기준점") && db9f.includes("도망!") && db9f.includes("경고") && !db9f.includes("Far"));
  // UI-3 수정: 결과 카드 제거·2.5초 연출 텍스트·자동 복귀
  const brUi3 = existsSync(join(dir, "BattleResultText.tsx")) ? readFileSync(join(dir, "BattleResultText.tsx"), "utf8") : "";
  check("ui3-no-back-button", !/>\s*뒤로\s*</.test(pov9g));
  check("ui3-result-text", brUi3.includes("battle-result-text") && brUi3.includes("pointerEvents") && ["승리!", "패배…", "도망쳤다"].every((k) => brUi3.includes(k)));
  check("ui3-exp-hidden", brUi3.includes("exp > 0"));
  check("ui3-auto-return", pov9g.includes("setTimeout(endBattle, UI3_RESULT_MS)"));
  // UI-4 수정: HUD 토큰·HP 비율색·레벨 배지·캡슐·안전 문구
  const cssUi4 = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  check("ui4-tokens", ["--battle-panel", "--battle-edge", "--battle-radius", "--battle-hp-high", "--battle-hp-mid", "--battle-hp-low"].every((k) => cssUi4.includes(k)));
  check("ui4-hp-ratio", hb9f.includes("pct >= 50") && hb9f.includes("pct >= 25") && hb9f.includes("linear-gradient"));
  check("ui4-level-badge", hb9f.includes("레벨"));
  // MF-0: 도망은 운전/연출 잠금과 무관 (fleeOff = fled), 도주 시 남은 연출 정리
  check("mf0-flee-always", /const fleeOff = fled;/.test(bs9f));
  const fleeFn = pov9g.match(/function fleeBattle\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  check("mf0-flee-clears-timers", fleeFn.includes("clearBattleTimers()"));
  // BP-2: kind 스탬프 + shoot 액션 배선
  check("bp2-stamp", pov9g.includes("slotKind") && pov9g.includes("(e as { kind?:"));
  const povCreat = readFileSync(join(ROOT, "components", "PovCreature.tsx"), "utf8");
  const motSrc = readFileSync(join(ROOT, "lib", "motion", "battleMotion.ts"), "utf8");
  check("bp2-shoot", pov9g.includes('"shoot"') && povCreat.includes("battleShootMove") && motSrc.includes("battleShootMove")
    && povCreat.includes('"shoot"'));
  check("ui4-distance-capsule", db9f.includes("999") && db9f.includes("fleeStatus") && db9f.includes("기준점"));
  check("ui4-flee-capsule", bs9f.includes("999") && bs9f.includes("bfx-flee-warn") && fx9g.includes("bfx-flee-pulse"));
  check("ui4-safety-line", pov9g.includes("걸음을 멈추고"));
  // BP-3: 타격감 (움츠림·히트스톱·흔들림·잔상·치명타 노랑·진동·차분).
  check("bp3-windup", pov9g.includes("BP3_WINDUP_MS") && pov9g.includes("windup: atk"));
  check("bp3-hitstop", pov9g.includes("BP3_HITSTOP_MS") && pov9g.includes("holdFx={bp3.hold}") && bs9f.includes("holdFx"));
  check("bp3-shake-css", fx9g.includes("bp3-shake") && fx9g.includes("--bp3-px") && fx9g.includes("bp3-zoom"));
  check("bp3-ghost", hb9f.includes("hp-ghost") && hb9f.includes("BP3_GHOST_MS"));
  const fxTsBp3 = readFileSync(join(dir, "fx.ts"), "utf8");
  check("bp3-crit-yellow", (fxTsBp3.match(/`-\$\{v\}!`, "#ffd84a"/g) || []).length === 3);
  check("bp3-vibrate", pov9g.includes("vibrate(BP3_VIB_MS)"));
  check("bp3-calm", pov9g.includes("bp3Calm()") && fx9g.includes("prefers-reduced-motion"));
  // BP-4: 효과 말풍선 배지 6종 (약점·치명·버팀·빗나감·버프·디버프).
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 45, element: "fire", crit: true }]);
  check("bp4-crit", r.items.length === 2 && r.items[1].text === "치명타!" && r.items[1].badge === "crit" && r.items[1].color === "#ffd84a");
  r = fx.fxFromEvents([{ type: "damage", target: "wild", value: 45, element: "fire", crit: true, effect: "good" }]);
  check("bp4-stack", r.items.length === 3 && r.items[1].stack === 0 && r.items[2].stack === 1 && r.items[2].badge === "good", JSON.stringify(r.items.map((i) => [i.text, i.stack])));
  r = fx.fxFromEvents([{ type: "stage", target: "mine", stat: "ATK", delta: 1 }]);
  check("bp4-buff", r.items[0].badge === "buff" && r.items[0].stack === 0);
  check("bp4-css", fx9g.includes("bfx-badge-float") && fx9g.includes("1.2s") && fx9g.includes("var(--battle-panel)") && fx9g.includes("bfx-badge-good::before"));
  const flBp4 = readFileSync(join(dir, "Floaters.tsx"), "utf8");
  check("bp4-floaters", flBp4.includes("BADGE_DY") && flBp4.includes("bfx-badge-${"));

  // 스크린샷 4장
  const shotDir = join(ROOT, "scratch", "battlefx");
  mkdirSync(shotDir, { recursive: true });
  const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  let shots = 0;
  if (existsSync(chrome)) {
    for (const s of ["normal", "super", "buff", "status"]) {
      const out = join(shotDir, `fx-${s}.png`);
      try {
        execFileSync(chrome, [
          "--headless=new", "--disable-gpu", "--hide-scrollbars",
          "--window-size=700,900", "--virtual-time-budget=6000",
          `--screenshot=${out}`,
          `http://localhost:3000/battle-demo?battlefx=demo&scene=${s}&hold=1`,
        ], { timeout: 90000, stdio: "pipe" });
        if (existsSync(out) && statSync(out).size > 0) shots++;
      } catch (e) { console.log(`  shot ${s} 오류: ${String(e).slice(0, 100)}`); }
    }
  }
  check("shots-4", shots === 4, `${shots}/4`);

  rmSync(BUILD, { recursive: true, force: true });
  console.log(`\nverify-battlefx: ${passes} PASS, ${failures} FAIL`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
