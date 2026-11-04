// 작업 1c 검증: 의도된 변경(1c-1/1c-2/1c-3) 외의 모든 값은 기준 스냅샷과 비트 단위 동일.
// 실행: node scripts/verify-emotes.mjs
// golden-poses.json은 재생성하지 않는다 (1b 기준 유지).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-1b");
const GOLDEN = join(ROOT, "scratch", "golden-poses.json");

// 의도된 변경 목록: 이 감정의 값은 golden과 다를 수 있다 (정보 표시만).
// 여기에 없는 감정·케이스는 Object.is 비트 동일이어야 한다.
const INTENDED_POSE = {
  beg: "1c-2 + 1c-3", want: "1c-2 + 1c-3", hungry: "1c-2", happy: "1c-2",
  cry: "1c-2 + 1c-4", hurt: "1c-2 + 1c-4", sleep: "1c-2", eat: "1c-2 + 1c-9", chomp: "1c-2",
  greet: "1c-2", drowsy: "1c-2", zoomies: "1c-2",
  pat: "1c-2", cuddle: "1c-2 + 1c-3",
  // 제외(비트 동일): idle(표 항목 없음), attack(pulse 전용이라 e 무관·미수정),
  // dance·ateez(beat 축 유지). roam·fetch는 아래 채널 한정 검사를 적용.
};
// 채널 한정 검사: 지정 인덱스만 달라질 수 있고 나머지는 비트 동일해야 한다.
// pose 값 배치: [rx0..6, ry0..6, rz0..6, sx, sy, sz] → 8 = 머리 ry, 0 = 몸통 rx.
const POSE_SCOPED = { roam: [8], fetch: [0, 8] };
const INTENDED_PUPPET = {
  beg: "1c-2 + 1c-3", want: "1c-2 + 1c-3", hungry: "1c-2", happy: "1c-2",
  cry: "1c-2 + 1c-4", hurt: "1c-2 + 1c-4", sleep: "1c-2 + 1c-8", eat: "1c-2", chomp: "1c-2",
  greet: "1c-2", roam: "1c-2 + 1c-10", attack: "1c-1 수정(rx 부호; z는 0 유지)",
  drowsy: "1c-2 + 1c-8", zoomies: "1c-2 + 1c-7", pat: "1c-2", cuddle: "1c-2 + 1c-3",
  // 제외(비트 동일): idle(표 항목 없음), dance(beat 축 유지). fetch는 채널 한정 검사.
};
// puppet 값 배치: [y, z, rx, ry, rz] → fetch는 y·rx만 변경, z·ry·rz 동일.
const PUPPET_SCOPED = { fetch: [0, 2] };

const reviver = (_k, v) => (v === "@-0" ? -0 : v);

function compile() {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  execFileSync(process.execPath, [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    "lib/autoRig.ts", "lib/puppetRig.ts",
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

function main() {
  compile();
  const req = createRequire(import.meta.url);
  const THREE = req("three");
  const { poseFor } = req(join(BUILD, "autoRig.js"));
  const { rigObject } = req(join(BUILD, "puppetRig.js"));
  const emotes = req(join(BUILD, "motion", "emotes.js"));
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8"), reviver);

  let failures = 0;
  let shown = 0;
  const fail = (msg) => {
    failures++;
    if (shown < 12) { console.error(`FAIL: ${msg}`); shown++; }
  };
  // golden 격자에는 e가 없으므로 k = e/DUR 관계로 복원한다 (k=1이면 e=DUR).
  const eOf = (emote, k) => (emote === "idle" ? 0 : k * emotes.EMOTE_DUR[emote]);

  // 1. pose: 의도된 감정·채널 외 비트 동일.
  let pIntTotal = 0, pIntChanged = 0, pIntMax = 0, pExact = 0;
  const pByEmote = {};
  const pScopedDiff = {};
  for (const [key, g] of Object.entries(golden.pose)) {
    const { head, parts } = parseKey(key);
    let input;
    let intended = false;
    let k = 0;
    if (head === "dance" || head === "ateez") {
      input = {
        emote: "idle", k: 0.5, t: 1.0, e: 0, walkAmp: 0, walkPhase: 0,
        hug: false, dancing: head === "dance", beat: parseFloat(parts.b),
        ateez: head === "ateez" || undefined,
      };
    } else {
      k = parseFloat(parts.k);
      input = {
        emote: head, k, t: parseFloat(parts.t), e: eOf(head, k),
        walkAmp: parseFloat(parts.w), walkPhase: parseFloat(parts.ph),
        hug: parts.h === "1", dancing: false, beat: 0,
      };
      intended = head in INTENDED_POSE;
    }
    const p = poseFor(input);
    const vals = [...p.rx, ...p.ry, ...p.rz, p.sx, p.sy, p.sz];
    const olds = [...g.rx, ...g.ry, ...g.rz, g.sx, g.sy, g.sz];
    const scoped = POSE_SCOPED[head];
    if (scoped !== undefined) {
      for (let i = 0; i < vals.length; i++) {
        if (scoped.includes(i)) {
          if (!Object.is(vals[i], olds[i])) {
            const sk = `${head}:${i}`;
            pScopedDiff[sk] = (pScopedDiff[sk] ?? 0) + 1;
          }
        } else if (!Object.is(vals[i], olds[i])) {
          fail(`${key} [${i}]: ${vals[i]} !== ${olds[i]} (scoped: only ${head} [${scoped}] may change)`);
          break;
        }
      }
    } else if (intended) {
      pIntTotal++;
      let diff = false;
      for (let i = 0; i < vals.length; i++) {
        const d = Math.abs(vals[i] - olds[i]);
        if (d > pIntMax) pIntMax = d;
        if (!Object.is(vals[i], olds[i])) diff = true;
      }
      if (diff) { pIntChanged++; pByEmote[head] = (pByEmote[head] ?? 0) + 1; }
    } else {
      pExact++;
      for (let i = 0; i < vals.length; i++) {
        if (!Object.is(vals[i], olds[i])) {
          fail(`${key} [${i}]: ${vals[i]} !== ${olds[i]} (must stay bitwise identical)`);
          break;
        }
      }
    }
    // 1c-4·1c-6 핀: 새 동작의 형태 고정.
    if (head === "fetch") {
      if (Math.abs(p.rx[2]) > 0.6 || Math.abs(p.rx[3]) > 0.6) {
        fail(`${key}: fetch leg |rx| over 0.6 (${p.rx[2]}, ${p.rx[3]})`);
      }
      if (k === 0 && !Object.is(p.rx[0], 0)) fail(`${key}: fetch torso rx at k=0 must be +0, got ${p.rx[0]}`);
    }
    if (head === "hurt") {
      if (k === 0 && (p.rx[0] !== 0 || p.rx[4] !== 0)) fail(`${key}: hurt flinch at k=0 must be 0`);
      if (k === 0.5) {
        if (!Object.is(p.rx[0], -0.25)) fail(`${key}: hurt torso at k=0.5 must be -0.25, got ${p.rx[0]}`);
        if (!Object.is(p.rx[4], -0.5)) fail(`${key}: hurt arm at k=0.5 must be -0.5, got ${p.rx[4]}`);
        if (Math.abs(p.rx[1] + 0.15) >= 1e-6) fail(`${key}: hurt head at k=0.5 must be ≈-0.15, got ${p.rx[1]}`);
      }
      if (k === 1 && (Math.abs(p.rx[0]) >= 1e-9 || Math.abs(p.rx[4]) >= 1e-9)) {
        fail(`${key}: hurt flinch at k=1 must decay to ~0`);
      }
    }
    if (head === "cry") {
      if (!Object.is(p.rx[4], p.rx[5])) fail(`${key}: cry arms must heave in phase`);
      if (k === 0 && Math.abs(p.rx[1] - 0.3) >= 1e-6) fail(`${key}: cry head at k=0 must be ≈0.3, got ${p.rx[1]}`);
    }
    // 1c-9 핀: eat reach가 pulse(0→1→0)여야 한다 (비허그 키만).
    if (head === "eat" && parts.h === "0") {
      if (k === 0) {
        for (const i of [0, 1, 2, 3, 4, 5]) {
          if (!Object.is(p.rx[i], 0)) fail(`${key}: eat reach at k=0 must be +0, rx[${i}]=${p.rx[i]}`);
        }
      }
      if (k === 0.5) {
        if (Math.abs(p.rx[2] - 0.18) >= 1e-6) fail(`${key}: eat leg at k=0.5 must be ≈0.18, got ${p.rx[2]}`);
        if (Math.abs(p.rx[0] - 0.3) >= 1e-6) fail(`${key}: eat torso at k=0.5 must be ≈0.3, got ${p.rx[0]}`);
        if (!(p.rx[4] < 0)) fail(`${key}: eat arm at k=0.5 must be < 0, got ${p.rx[4]}`);
        if (!(p.rx[1] > 0.2)) fail(`${key}: eat head at k=0.5 must be > 0.2, got ${p.rx[1]}`);
      }
      if (k === 1 && (Math.abs(p.rx[2]) >= 1e-9 || Math.abs(p.rx[3]) >= 1e-9)) {
        fail(`${key}: eat reach at k=1 must decay to ~0`);
      }
    }
  }
  console.log(`pose: exactChecked=${pExact} intendedTotal=${pIntTotal} intendedChanged=${pIntChanged} intendedMaxDiff=${pIntMax}`);
  console.log(`pose intended changed by emote: ${JSON.stringify(pByEmote)}`);
  console.log(`pose scoped diffs: ${JSON.stringify(pScopedDiff)}`);
  if (pIntChanged === 0) fail("pose: no intended key changed — is e wired?");
  for (const [e, idxs] of Object.entries(POSE_SCOPED)) {
    for (const i of idxs) {
      if ((pScopedDiff[`${e}:${i}`] ?? 0) === 0) fail(`pose scoped ${e}[${i}]: never differed — is the new branch wired?`);
    }
  }

  // 2. puppet: 의도된 감정·채널 외 비트 동일.
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  group.updateMatrixWorld(true);
  const rig = rigObject(group);
  if (!rig) throw new Error("rigObject returned null");
  let uIntTotal = 0, uIntChanged = 0, uIntMax = 0, uExact = 0;
  const uByEmote = {};
  const uScopedDiff = {};
  const hurtY = {};
  const flatY = {};
  for (const [key, g] of Object.entries(golden.puppet)) {
    const { head, parts } = parseKey(key);
    let intended = false;
    let k = 0;
    if (head === "dance") {
      rig.update({ emote: "idle", k: 0, t: 1.0, e: 0, dancing: true, beat: parseFloat(parts.b), amp: parseFloat(parts.a) });
    } else {
      k = parseFloat(parts.k);
      rig.update({ emote: head, k, t: parseFloat(parts.t), e: eOf(head, k), dancing: false, beat: 0 });
      intended = head in INTENDED_PUPPET;
    }
    const cur = [
      rig.group.position.y, rig.group.position.z,
      rig.group.rotation.x, rig.group.rotation.y, rig.group.rotation.z,
    ];
    const olds = [g.y, g.z, g.rx, g.ry, g.rz];
    // 1c-1 수정: attack z는 항상 0 (월드 이동은 액터 레이어만 담당).
    if (head === "attack" && !Object.is(cur[1], 0)) {
      fail(`puppet ${key} z: ${cur[1]} !== 0 (attack z must stay 0)`);
    }
    const scoped = PUPPET_SCOPED[head];
    if (scoped !== undefined) {
      for (let i = 0; i < cur.length; i++) {
        if (scoped.includes(i)) {
          if (!Object.is(cur[i], olds[i])) {
            const sk = `${head}:${i}`;
            uScopedDiff[sk] = (uScopedDiff[sk] ?? 0) + 1;
          }
        } else if (!Object.is(cur[i], olds[i])) {
          fail(`puppet ${key} [${i}]: ${cur[i]} !== ${olds[i]} (scoped: only ${head} [${scoped}] may change)`);
          break;
        }
      }
    } else if (intended) {
      uIntTotal++;
      let diff = false;
      for (let i = 0; i < cur.length; i++) {
        const d = Math.abs(cur[i] - olds[i]);
        if (d > uIntMax) uIntMax = d;
        if (!Object.is(cur[i], olds[i])) diff = true;
      }
      if (diff) { uIntChanged++; uByEmote[head] = (uByEmote[head] ?? 0) + 1; }
    } else {
      uExact++;
      for (let i = 0; i < cur.length; i++) {
        if (!Object.is(cur[i], olds[i])) {
          fail(`puppet ${key} [${i}]: ${cur[i]} !== ${olds[i]} (must stay bitwise identical)`);
          break;
        }
      }
    }
    // 1c-4 핀: 움찔·흐느낌 형태 고정.
    if (head === "hurt") {
      hurtY[`${parts.t}|${k}`] = cur[0];
      if (k === 0.5 && !Object.is(cur[2], -0.15)) fail(`${key}: hurt rx at k=0.5 must be -0.15, got ${cur[2]}`);
      if (k === 0 && cur[2] !== 0) fail(`${key}: hurt rx at k=0 must be 0`);
    }
    if (head === "cry" && k === 0 && !Object.is(cur[2], 0.1)) {
      fail(`${key}: cry rx at k=0 must be 0.1, got ${cur[2]}`);
    }
    // 1c-7 핀: zoomies P ry 제거 → ry는 항상 +0.
    if (head === "zoomies" && !Object.is(cur[3], 0)) {
      fail(`${key}: zoomies puppet ry must be +0 (1c-7), got ${cur[3]}`);
    }
    // 1c-8·1c-10: y 딥 제거 → y는 k 무관(호흡만).
    if (head === "sleep" || head === "drowsy" || head === "roam") {
      flatY[`${head}|${parts.t}|${k}`] = cur[0];
    }
  }
  console.log(`puppet: exactChecked=${uExact} intendedTotal=${uIntTotal} intendedChanged=${uIntChanged} intendedMaxDiff=${uIntMax}`);
  console.log(`puppet intended changed by emote: ${JSON.stringify(uByEmote)}`);
  console.log(`puppet scoped diffs: ${JSON.stringify(uScopedDiff)}`);
  if (uIntChanged === 0) fail("puppet: no intended key changed — is e wired?");
  for (const [e, idxs] of Object.entries(PUPPET_SCOPED)) {
    for (const i of idxs) {
      if ((uScopedDiff[`${e}:${i}`] ?? 0) === 0) fail(`puppet scoped ${e}[${i}]: never differed — is the new branch wired?`);
    }
  }
  // hurt 움찔 1회: 같은 t에서 k=0.5가 k=0보다 낮아야 한다.
  for (const t of ["0.5", "1", "1.7"]) {
    const y0 = hurtY[`${t}|0`];
    const y1 = hurtY[`${t}|0.5`];
    if (!(y1 < y0)) fail(`puppet hurt dip at t=${t}: y(k=0.5)=${y1} should be < y(k=0)=${y0}`);
  }
  for (const e of ["sleep", "drowsy", "roam"]) {
    for (const t of ["0.5", "1", "1.7"]) {
      const a = flatY[`${e}|${t}|0`];
      const b = flatY[`${e}|${t}|0.5`];
      const c = flatY[`${e}|${t}|1`];
      if (!Object.is(a, b) || !Object.is(b, c)) {
        fail(`puppet ${e} y at t=${t} must be k-independent (dip removed): ${a}/${b}/${c}`);
      }
    }
  }

  // 3. 표정/이동/지속시간 표 정합 (1c-1~3에서 변경 없음).
  const DUR = {
    idle: Infinity, beg: 2.0, want: 2.0, hungry: 2.2, happy: 1.8, cry: 2.0,
    hurt: 1.3, sleep: 4.0, eat: 1.6, chomp: 2.4, fetch: 1.8, greet: 1.6, roam: 6.0, attack: 1.1,
    drowsy: 4.0, zoomies: 3.2, pat: 2.2, cuddle: 2.6,
  };
  for (const [e, d] of Object.entries(DUR)) {
    if (!Object.is(emotes.EMOTE_DUR[e], d)) fail(`EMOTE_DUR[${e}]: ${emotes.EMOTE_DUR[e]} !== ${d}`);
  }
  const FACE = {
    beg: ["heart", "smile"], want: ["heart", "smile"], hungry: ["sad", "flat"],
    happy: ["happy", "smile"], cry: ["sad", "flat"], hurt: ["closed", "flat"],
    sleep: ["closed", "baked"], attack: ["wow", "open"], greet: ["happy", "smile"],
    fetch: ["wow", "baked"], zoomies: ["wow", "smile"],
    pat: ["happy", "smile"], cuddle: ["heart", "smile"],
  };
  for (const [e, [eyes, mouth]] of Object.entries(FACE)) {
    const f = emotes.faceFor(e, { emoteT: 0.7, hug: false, dancing: false });
    if (!f || f.eyes !== eyes || f.mouth !== mouth) {
      fail(`faceFor(${e}): got ${JSON.stringify(f)}, want [${eyes}, ${mouth}]`);
    }
  }
  const dyn = [
    ["eat", false, 10, "happy"], ["chomp", false, 9, "wow"],
  ];
  for (const [e, hug, f, eyes] of dyn) {
    const open = emotes.faceFor(e, { emoteT: Math.PI / 2 / f, hug, dancing: false });
    const flat = emotes.faceFor(e, { emoteT: (3 * Math.PI) / 2 / f, hug, dancing: false });
    if (open.mouth !== "open" || flat.mouth !== "flat" || open.eyes !== eyes) {
      fail(`faceFor(${e}) toggle: ${JSON.stringify(open)} / ${JSON.stringify(flat)}`);
    }
    const hb = emotes.faceFor(e, { emoteT: 0.7, hug: true, dancing: false });
    if (hb.eyes !== "happy" || hb.mouth !== "baked") fail(`faceFor(${e}, hug): ${JSON.stringify(hb)}`);
  }
  const dz1 = emotes.faceFor("drowsy", { emoteT: Math.PI / 2 / 3, hug: false, dancing: false });
  const dz2 = emotes.faceFor("drowsy", { emoteT: 0, hug: false, dancing: false });
  if (dz1.mouth !== "open" || dz2.mouth !== "baked") fail(`faceFor(drowsy): ${dz1.mouth}/${dz2.mouth}`);
  if (emotes.faceFor("idle", { emoteT: 0, hug: false, dancing: false }) !== null) {
    fail("faceFor(idle, calm) should be null (caller blink machine)");
  }
  // 1c-5: roam 얼굴은 idle 매핑.
  if (emotes.faceFor("roam", { emoteT: 0.7, hug: false, dancing: false }) !== null) {
    fail("faceFor(roam, calm) should be null (idle machine)");
  }
  const rm = emotes.faceFor("roam", { emoteT: 0, hug: false, dancing: true });
  if (!rm || rm.eyes !== "baked" || rm.mouth !== "baked") fail("faceFor(roam, dancing) should be baked/baked");
  const id = emotes.faceFor("idle", { emoteT: 0, hug: false, dancing: true });
  if (!id || id.eyes !== "baked" || id.mouth !== "baked") fail("faceFor(idle, dancing) should be baked/baked");
  const unk = emotes.faceFor("nope", { emoteT: 0, hug: false, dancing: false });
  if (!unk || unk.eyes !== "baked" || unk.mouth !== "baked") fail("faceFor(unknown) should be baked/baked");
  for (const e of Object.keys(DUR)) {
    const want = e === "roam" || e === "fetch";
    if (emotes.emoteLocomotion(e) !== want) fail(`emoteLocomotion(${e}) !== ${want}`);
  }
  if (emotes.emoteLocomotion("nope") !== false) fail("emoteLocomotion(unknown) should be false");
  console.log("tables: dur/face/loco checked");

  rmSync(BUILD, { recursive: true, force: true });
  if (failures > 0) {
    if (failures > shown) console.error(`... and ${failures - shown} more`);
    console.error(`RESULT: FAIL (${failures} failures)`);
    process.exit(1);
  }
  console.log("RESULT: PASS");
}

main();
