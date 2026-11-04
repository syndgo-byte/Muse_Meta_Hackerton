// 작업 2 검증: PoseBlender 전환 보간 + 꼬리 스프링.
// 실행: node scripts/verify-blend.mjs
// 완료 조건: ① 감정 불변 시 poseFor와 비트 동일(꼬리 제외) ② 전환 직후=이전, 0.25초 후=목표.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-blend");
const GOLDEN = join(ROOT, "scratch", "golden-poses.json");
const DT = 1 / 60;

const reviver = (_k, v) => (v === "@-0" ? -0 : v);

function compile() {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  execFileSync(process.execPath, [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    "lib/autoRig.ts", "lib/motion/blend.ts",
    "--outDir", BUILD,
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--esModuleInterop",
  ], { cwd: ROOT, stdio: "inherit" });
}

function parseKey(key) {
  const parts = Object.fromEntries(key.split("|").slice(1).map((s) => {
    const m = s.match(/^([a-z]+)(.+)$/);
    return [m[1], m[2]];
  }));
  const head = key.split("|")[0];
  return { head, parts };
}

function flat(p) {
  return [...p.rx, ...p.ry, ...p.rz, p.sx, p.sy, p.sz];
}

function smooth(x) {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

function main() {
  compile();
  const req = createRequire(import.meta.url);
  const { poseFor, B_TAIL } = req(join(BUILD, "autoRig.js"));
  const { PoseBlender, BLEND_DUR } = req(join(BUILD, "motion", "blend.js"));
  const emotes = req(join(BUILD, "motion", "emotes.js"));
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"), reviver);

  let failures = 0;
  let shown = 0;
  const fail = (msg) => {
    failures++;
    if (shown < 12) { console.error(`FAIL: ${msg}`); shown++; }
  };
  const TAIL_IDX = new Set([B_TAIL, 7 + B_TAIL, 14 + B_TAIL]);
  const eOf = (emote, k) => (emote === "idle" ? 0 : k * emotes.EMOTE_DUR[emote]);
  if (BLEND_DUR !== 0.25) fail(`BLEND_DUR must be 0.25, got ${BLEND_DUR}`);

  const inputOf = (key) => {
    const { head, parts } = parseKey(key);
    if (head === "dance" || head === "ateez") {
      return {
        emote: head,
        input: {
          emote: "idle", k: 0.5, t: 1.0, e: 0, walkAmp: 0, walkPhase: 0,
          hug: false, dancing: head === "dance", beat: parseFloat(parts.b),
          ateez: head === "ateez" || undefined,
        },
      };
    }
    const k = parseFloat(parts.k);
    return {
      emote: head,
      input: {
        emote: head, k, t: parseFloat(parts.t), e: eOf(head, k),
        walkAmp: parseFloat(parts.w), walkPhase: parseFloat(parts.ph),
        hug: parts.h === "1", dancing: false, beat: 0,
      },
    };
  };

  // 1. 감정 불변(첫 출력) 시 전 채널 비트 동일 + target 무변경.
  // golden 격자는 입력으로만 재사용한다. 오라클은 현 poseFor (golden은 1b 기준이라 1c 의도 변경과 다름).
  let freshChecked = 0;
  for (const key of Object.keys(golden.pose)) {
    const { emote, input } = inputOf(key);
    const target = poseFor(input);
    const want = flat(poseFor(input));
    const out = new PoseBlender().update(emote, target, DT);
    const vals = flat(out);
    for (let i = 0; i < vals.length; i++) {
      if (!Object.is(vals[i], want[i])) {
        fail(`${key} [${i}]: ${vals[i]} !== ${want[i]} (fresh blender must equal poseFor)`);
        break;
      }
    }
    const cur = flat(target);
    for (let i = 0; i < cur.length; i++) {
      if (!Object.is(cur[i], want[i])) {
        fail(`${key} [${i}]: blender mutated target`);
        break;
      }
    }
    freshChecked++;
  }
  console.log(`fresh: checked=${freshChecked} (full 24ch bitwise + no target mutation)`);

  // 2. 동일 감정 지속 시 꼬리 외 비트 동일.
  const frozenInput = {
    emote: "happy", k: 0.5, t: 1.0, e: 0.9, walkAmp: 0.5, walkPhase: 2.0,
    hug: false, dancing: false, beat: 0,
  };
  const frozen = poseFor(frozenInput);
  const frozenVals = flat(frozen);
  const steady = new PoseBlender();
  let steadyBad = 0;
  for (let i = 0; i < 30; i++) {
    const out = flat(steady.update("happy", frozen, DT));
    if (i >= 20) {
      for (let j = 0; j < out.length; j++) {
        if (!TAIL_IDX.has(j) && !Object.is(out[j], frozenVals[j])) steadyBad++;
      }
    }
  }
  if (steadyBad > 0) fail(`settled happy: ${steadyBad} non-tail mismatches (must be bitwise identical)`);
  else console.log("settled: non-tail bitwise identical after 0.25s+");

  // 3. 전환 직후=이전(dt=0), 이징 중간값, 0.25초 후=목표.
  const PA = poseFor({ emote: "cry", k: 0.5, t: 1.0, e: 1.0, walkAmp: 0, walkPhase: 0, hug: false, dancing: false, beat: 0 });
  const PB = poseFor({ emote: "happy", k: 0.5, t: 1.0, e: 0.9, walkAmp: 0, walkPhase: 0, hug: false, dancing: false, beat: 0 });
  const sw = new PoseBlender();
  for (let i = 0; i < 30; i++) sw.update("cry", PA, DT);
  const prev = flat(sw.update("cry", PA, DT));
  const at0 = flat(sw.update("happy", PB, 0));
  for (let j = 0; j < at0.length; j++) {
    if (!TAIL_IDX.has(j) && !Object.is(at0[j], prev[j])) {
      fail(`switch start [${j}]: ${at0[j]} !== prev ${prev[j]} (must equal previous output)`);
      break;
    }
  }
  const a = smooth(DT / BLEND_DUR);
  const prevVals = prev;
  const pbVals = flat(PB);
  const mid = flat(sw.update("happy", PB, DT));
  for (let j = 0; j < mid.length; j++) {
    if (TAIL_IDX.has(j)) continue;
    const want = prevVals[j] + (pbVals[j] - prevVals[j]) * a;
    // 본 채널은 f32 슬롯이라 f64 수식과 f32 반올림만큼 차이날 수 있다.
    if (Math.abs(mid[j] - want) >= 1e-6) {
      fail(`mid-blend [${j}]: ${mid[j]} !== smoothstep lerp ${want}`);
      break;
    }
  }
  let end = null;
  for (let i = 0; i < 25; i++) end = flat(sw.update("happy", PB, DT));
  for (let j = 0; j < end.length; j++) {
    if (!TAIL_IDX.has(j) && !Object.is(end[j], pbVals[j])) {
      fail(`switch end [${j}]: ${end[j]} !== target ${pbVals[j]} (must equal target after 0.25s)`);
      break;
    }
  }
  console.log("switch: start==prev, mid==smoothstep, end==target (non-tail)");

  // 4. emote → idle 자동 복귀도 같은 보간.
  const PI = poseFor({ emote: "idle", k: 0, t: 1.0, e: 0, walkAmp: 0, walkPhase: 0, hug: false, dancing: false, beat: 0 });
  const rt = new PoseBlender();
  for (let i = 0; i < 30; i++) rt.update("happy", PB, DT);
  const prevR = flat(rt.update("happy", PB, DT));
  const at0R = flat(rt.update("idle", PI, 0));
  for (let j = 0; j < at0R.length; j++) {
    if (!TAIL_IDX.has(j) && !Object.is(at0R[j], prevR[j])) {
      fail(`idle-return start [${j}]: must equal previous output`);
      break;
    }
  }
  let endR = null;
  for (let i = 0; i < 25; i++) endR = flat(rt.update("idle", PI, DT));
  const piVals = flat(PI);
  for (let j = 0; j < endR.length; j++) {
    if (!TAIL_IDX.has(j) && !Object.is(endR[j], piVals[j])) {
      fail(`idle-return end [${j}]: must equal target after 0.25s`);
      break;
    }
  }
  console.log("idle-return: start==prev, end==target (non-tail)");

  // 5. 꼬리 스프링: 수렴 + 오버슛 없음 + 추종 지연 +他 본 무영향.
  const mkPose = () => ({
    rx: new Float32Array(7), ry: new Float32Array(7), rz: new Float32Array(7),
    sx: 1, sy: 1, sz: 1,
  });
  const zero = mkPose();
  const stepT = mkPose();
  stepT.ry[B_TAIL] = 0.5;
  const sp = new PoseBlender();
  sp.update("idle", zero, DT);
  let maxTail = -Infinity;
  let minTail = Infinity;
  let finalTail = 0;
  let tailTouchOther = 0;
  for (let i = 0; i < 180; i++) {
    const o = sp.update("idle", stepT, DT);
    const ty = o.ry[B_TAIL];
    if (ty > maxTail) maxTail = ty;
    if (ty < minTail) minTail = ty;
    finalTail = ty;
    const vals = flat(o);
    const tg = flat(stepT);
    for (let j = 0; j < vals.length; j++) {
      if (!TAIL_IDX.has(j) && !Object.is(vals[j], tg[j])) tailTouchOther++;
    }
  }
  if (Math.abs(finalTail - 0.5) >= 1e-4) fail(`tail convergence: ${finalTail} !== 0.5`);
  if (maxTail - 0.5 >= 0.005) fail(`tail overshoot: max ${maxTail} (critical damping expected)`);
  if (minTail < -0.01) fail(`tail undershoot: min ${minTail}`);
  if (tailTouchOther > 0) fail(`spring touched ${tailTouchOther} non-tail channels`);
  else console.log(`tail-spring: converged=${finalTail} overshoot=${maxTail - 0.5} others-untouched`);

  // 6. 추종 지연: 움직이는 목표에 늦게 따라감 (통과도 아니고 고정도 아님).
  const tr = new PoseBlender();
  tr.update("idle", zero, DT);
  let maxLag = 0;
  for (let i = 0; i < 60; i++) {
    const t = i * DT;
    const tgt = mkPose();
    tgt.ry[B_TAIL] = 0.5 * Math.sin(2 * Math.PI * t);
    const o = tr.update("idle", tgt, DT);
    const lag = Math.abs(o.ry[B_TAIL] - tgt.ry[B_TAIL]);
    if (lag > maxLag) maxLag = lag;
  }
  if (!(maxLag > 1e-6 && maxLag < 0.45)) fail(`tail lag out of range: ${maxLag} (want slight lag)`);
  else console.log(`tail-lag: maxLag=${maxLag}`);

  rmSync(BUILD, { recursive: true, force: true });
  if (failures > 0) {
    if (failures > shown) console.error(`... and ${failures - shown} more`);
    console.error(`RESULT: FAIL (${failures} failures)`);
    process.exit(1);
  }
  console.log("RESULT: PASS");
}

main();
