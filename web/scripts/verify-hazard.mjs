// Part K verification: hazard labels, matching, NMS, tracking, sim, deliverables.
// Run: node scripts/verify-hazard.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync, statSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-hazard");
const require = createRequire(import.meta.url);

function compile() {
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  writeFileSync(join(BUILD, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "es2020", module: "commonjs", moduleResolution: "node",
      baseUrl: "../..", paths: { "@/*": ["*"] },
      outDir: "out", rootDir: "../..", skipLibCheck: true, esModuleInterop: true,
    },
    include: ["../../lib/motion/hazard.ts"],
  }));
  execFileSync(process.execPath, [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json",
  ], { cwd: BUILD, stdio: "inherit" });
  const jsFiles = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (p.endsWith(".js")) jsFiles.push(p);
      else {
        try {
          if (readdirSync(p)) walk(p);
        } catch { /* not a dir */ }
      }
    }
  };
  walk(join(BUILD, "out"));
  for (const abs of jsFiles) {
    const f = abs.slice(BUILD.length + 1).replace(/\\/g, "/");
    const depth = f.split("/").length - 3;
    const prefix = "./" + "../".repeat(Math.max(depth, 0));
    writeFileSync(abs, readFileSync(abs, "utf-8").replace(/@\/lib\//g, prefix));
  }
}

compile();
const H = require(join(BUILD, "out", "lib", "motion", "hazard.js"));
const { matchDanger, nms, trackZones, confirmedZones, parseSimHazard,
  simZones, toWorldZones, resetZoneIds } = H;

let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fail += 1;
};
const BOX = (x0 = 0.2, y0 = 0.2, x1 = 0.4, y1 = 0.4) => ({ x0, y0, x1, y1 });
const DET = (label, score = 0.9, box = BOX()) => ({ label, score, box });

// 1. label matching (Korean donors + English COCO aliases)
{
  ok(matchDanger("칼") === "칼", "match 칼");
  ok(matchDanger("Kitchen Knife") === "칼", "match knife (en, case-insensitive)");
  ok(matchDanger("scissors") === "가위", "match scissors");
  ok(matchDanger("bottle") === "약병", "match bottle");
  ok(matchDanger("person") === null && matchDanger("dog") === null, "ignore person/dog");
  ok(matchDanger("") === null && matchDanger("약") === null, "'약' alone is not 약병");
}
// 2. score < 0.5 ignored
{
  resetZoneIds();
  const r = trackZones([], [DET("knife", 0.49)], 0);
  ok(r.length === 0, "fit<0.5 ignored");
}
// 3. NMS 0.6 merges overlaps, keeps the best score
{
  const a = DET("knife", 0.9, BOX(0.2, 0.2, 0.4, 0.4));
  const b = DET("knife", 0.7, BOX(0.22, 0.22, 0.42, 0.42));
  const c = DET("knife", 0.8, BOX(0.7, 0.7, 0.9, 0.9));
  const r = nms([a, b, c]);
  ok(r.length === 2 && r.some((d) => d.score === 0.9) && r.some((d) => d.score === 0.8),
    `NMS merges overlap, keeps far box (got ${r.length})`);
}
// 4. 2s confirm rule across threaded tracks
{
  resetZoneIds();
  let t = trackZones([], [DET("knife")], 0);
  ok(confirmedZones(t).length === 0, "t=0 unconfirmed");
  t = trackZones(t, [DET("knife")], 1);
  ok(confirmedZones(t).length === 0, "t=1 unconfirmed");
  t = trackZones(t, [DET("knife")], 2);
  ok(confirmedZones(t).length === 1, "t=2 confirmed");
}
// 5. widen 20% on confirm (10% of size per side)
{
  resetZoneIds();
  let t = trackZones([], [DET("knife", 0.9, BOX(0.2, 0.2, 0.4, 0.4))], 0);
  t = trackZones(t, [DET("knife", 0.9, BOX(0.2, 0.2, 0.4, 0.4))], 2);
  const z = confirmedZones(t)[0].box;
  ok(Math.abs(z.x0 - 0.18) < 1e-9 && Math.abs(z.x1 - 0.42) < 1e-9,
    `widen 20% (got ${z.x0},${z.x1})`);
}
// 6. approaching: area +25% vs first-seen -> flag + 50% widen
{
  resetZoneIds();
  let t = trackZones([], [DET("knife", 0.9, BOX(0.2, 0.2, 0.4, 0.4))], 0);
  t = trackZones(t, [DET("knife", 0.9, BOX(0.2, 0.2, 0.4, 0.4))], 2);
  t = trackZones(t, [DET("knife", 0.9, BOX(0.15, 0.15, 0.45, 0.45))], 3);
  const z = confirmedZones(t)[0];
  ok(z.approaching === true, "area growth flags approaching");
  ok(z.box.x0 < 0.1 && z.box.x1 > 0.5, `50% widen (got ${z.box.x0},${z.box.x1})`);
}
// 7. expire after 30s unmatched
{
  resetZoneIds();
  let t = trackZones([], [DET("knife")], 0);
  t = trackZones(t, [DET("knife")], 2);
  t = trackZones(t, [], 32.5);
  ok(t.length === 0, "track expires at 30s+ unmatched");
  let u = trackZones([], [DET("knife")], 0);
  u = trackZones(u, [DET("knife")], 2);
  u = trackZones(u, [], 31);
  ok(u.length === 1, "track kept before 30s");
}
// 8. sim parser: 3 donor kinds, bad parts skipped
{
  const d = parseSimHazard("칼:0.2,0.3;가위:0.7,0.5;약병:0.5,0.5");
  ok(d.length === 3 && d[0].label === "칼", `sim parses 3 (got ${d.length})`);
  ok(Math.abs(d[0].box.x0 - 0.1) < 1e-9 && Math.abs(d[0].box.y1 - 0.4) < 1e-9,
    "sim default 0.2 box around center");
  const bad = parseSimHazard("칼:0.2,0.3;xx;person:0.5,0.5;가위:oops");
  ok(bad.length === 1 && bad[0].label === "칼", "sim skips bad/non-danger");
  ok(parseSimHazard(null).length === 0 && parseSimHazard("").length === 0, "sim empty ok");
  const z = simZones("칼:0.2,0.3", 10);
  ok(z.length === 1 && z[0].confirmed, "sim zones pre-confirmed");
}
// 9. screen -> world zones keep ordering + approaching
{
  resetZoneIds();
  const z = simZones("칼:0.2,0.3", 10);
  const w = toWorldZones(z, (x, y) => ({ x: x * 10 - 5, z: y * 4 }));
  ok(w.length === 1 && w[0].x0 < w[0].x1 && w[0].z0 < w[0].z1, "world rect ordered");
  ok(Math.abs(w[0].cx - -3) < 1e-9, `world cx (got ${w[0].cx})`);
  ok(w[0].approaching === false, "approaching passes through");
}
// 10. K deliverables on disk: model file + npm dep
{
  const p = join(ROOT, "public", "models", "vision", "efficientdet_lite0.tflite");
  const size = existsSync(p) ? statSync(p).size : 0;
  ok(size > 1000000, `model file ${(size / 1048576).toFixed(1)}MB at public/models/vision/`);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  ok(Boolean(pkg.dependencies?.["@mediapipe/tasks-vision"]),
    `tasks-vision dep (${pkg.dependencies?.["@mediapipe/tasks-vision"]})`);
}

console.log(fail === 0 ? "ALL HAZARD CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
