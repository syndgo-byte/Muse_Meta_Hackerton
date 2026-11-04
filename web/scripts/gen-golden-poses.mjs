// 작업 1b 기준 스냅샷 생성기: 현재 poseFor / puppet.update 출력을 고정한다.
// 실행: node scripts/gen-golden-poses.mjs
// lib/*.ts를 tsc로 임시 컴파일한 뒤 node에서 직접 실행한다 (새 의존성 없음).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-1b");
const OUT = join(ROOT, "scratch", "golden-poses.json");

export const EMOTES = [
  "idle", "beg", "want", "hungry", "happy", "cry", "hurt", "sleep",
  "eat", "chomp", "fetch", "greet", "roam", "attack", "drowsy",
  "zoomies", "pat", "cuddle",
];
const TS = [0.5, 1.0, 1.7];
const KS = [0, 0.5, 1];
const WS = [0, 0.5, 1];
const PHS = [0.7, 2.9];
const HUGS = [false, true];
const BEATS = [0, 0.5, 3.7, 7.99, 8];

const isNegZero = (v) => v === 0 && 1 / v === -Infinity;
const enc = (v) => {
  if (typeof v !== "number") throw new Error(`non-number in pose: ${v}`);
  if (!Number.isFinite(v)) throw new Error(`non-finite in pose: ${v}`);
  return isNegZero(v) ? "@-0" : v;
};

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

function main() {
  compile();
  const req = createRequire(import.meta.url);
  const THREE = req("three");
  const { poseFor } = req(join(BUILD, "autoRig.js"));
  const { rigObject } = req(join(BUILD, "puppetRig.js"));

  const pose = {};
  for (const emote of EMOTES) {
    for (const t of TS) for (const k of KS) for (const w of WS) {
      for (const ph of PHS) for (const hug of HUGS) {
        const p = poseFor({
          emote, k, t, walkAmp: w, walkPhase: ph, hug,
          dancing: false, beat: 0,
        });
        pose[`${emote}|t${t}|k${k}|w${w}|ph${ph}|h${hug ? 1 : 0}`] = {
          rx: [...p.rx].map(enc), ry: [...p.ry].map(enc), rz: [...p.rz].map(enc),
          sx: enc(p.sx), sy: enc(p.sy), sz: enc(p.sz),
        };
      }
    }
  }
  for (const b of BEATS) {
    const pd = poseFor({
      emote: "idle", k: 0.5, t: 1.0, walkAmp: 0, walkPhase: 0,
      hug: false, dancing: true, beat: b,
    });
    pose[`dance|b${b}`] = {
      rx: [...pd.rx].map(enc), ry: [...pd.ry].map(enc), rz: [...pd.rz].map(enc),
      sx: enc(pd.sx), sy: enc(pd.sy), sz: enc(pd.sz),
    };
    const pa = poseFor({
      emote: "idle", k: 0.5, t: 1.0, walkAmp: 0, walkPhase: 0,
      hug: false, dancing: false, beat: b, ateez: true,
    });
    pose[`ateez|b${b}`] = {
      rx: [...pa.rx].map(enc), ry: [...pa.ry].map(enc), rz: [...pa.rz].map(enc),
      sx: enc(pa.sx), sy: enc(pa.sy), sz: enc(pa.sz),
    };
  }

  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  group.updateMatrixWorld(true);
  const rig = rigObject(group);
  if (!rig) throw new Error("rigObject returned null");
  const puppet = {};
  const snapPuppet = (key) => {
    const g = rig.group;
    puppet[key] = {
      y: enc(g.position.y), z: enc(g.position.z),
      rx: enc(g.rotation.x), ry: enc(g.rotation.y), rz: enc(g.rotation.z),
    };
  };
  for (const emote of EMOTES) {
    for (const t of TS) for (const k of KS) {
      rig.update({ emote, k, t, dancing: false, beat: 0 });
      snapPuppet(`${emote}|t${t}|k${k}`);
    }
  }
  for (const b of BEATS.slice(0, 4)) for (const amp of [1, 1.4]) {
    rig.update({ emote: "idle", k: 0, t: 1.0, dancing: true, beat: b, amp });
    snapPuppet(`dance|b${b}|a${amp}`);
  }

  const doc = {
    meta: {
      generator: "scripts/gen-golden-poses.mjs (task 1b baseline)",
      createdAt: new Date().toISOString(),
      emotes: EMOTES, t: TS, k: KS, walkAmp: WS, walkPhase: PHS, hug: HUGS, beats: BEATS,
      poseCases: Object.keys(pose).length,
      puppetCases: Object.keys(puppet).length,
    },
    pose,
    puppet,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(doc));
  rmSync(BUILD, { recursive: true, force: true });
  console.log(`wrote ${OUT}: pose=${doc.meta.poseCases} puppet=${doc.meta.puppetCases}`);
}

main();
