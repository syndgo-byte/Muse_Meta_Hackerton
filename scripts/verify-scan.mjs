// scripts/verify-scan.mjs — G-1 검증 (COCO 라벨 → 종 매핑 순수 함수).
// 실행: node scripts/verify-scan.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-scan-"));
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
      "--outDir", BUILD,
      "--rootDir", join(ROOT, "lib"),
      "--module", "commonjs",
      "--target", "es2021",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--noEmitOnError",
      "lib/battle/scan.ts",
      "lib/encounter/table.ts",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
  const scan = req(join(BUILD, "battle", "scan.js"));

  // 14 COCO 라벨 → 12종
  const cases = [
    ["cup", "fire-01"], ["bottle", "water-01"], ["wine glass", "water-01"],
    ["cat", "fire-02"], ["dog", "grass-04"], ["potted plant", "grass-01"],
    ["umbrella", "grass-03"], ["cake", "fire-05"], ["sandwich", "wind-05"],
    ["train", "fire-03"], ["bench", "grass-04"], ["kite", "wind-03"],
    ["sink", "water-02"], ["refrigerator", "water-05"],
  ];
  for (const [coco, sp] of cases) {
    check(`map-${coco}`, scan.cocoToSpecies(coco, 90) === sp, scan.cocoToSpecies(coco, 90));
  }
  // 라벨 정규화 (대소문자·공백)
  check("norm-case", scan.cocoToSpecies("  Cup ", 90) === "fire-01");
  // 표 밖·빈 라벨 → null
  check("unmapped", scan.cocoToSpecies("airplane", 90) === null);
  check("empty", scan.cocoToSpecies("", 90) === null);
  check("unmapped-label", scan.cocoToLabel("airplane") === null);
  // confidence 60 미만 → null (§15-1a)
  check("low-conf", scan.cocoToSpecies("cup", 59) === null);
  check("low-conf-ko", scan.cocoToLabel("cup") !== null); // 라벨 변환 자체는 점수와 무관
  // 커버 종 수 12
  const covered = new Set(cases.map(([, sp]) => sp));
  check("cover-12", covered.size === 12, String(covered.size));

  // G-2: 자동 트리거 (연속 3틱 + conf>=60, 자리당 1회, 변경·소멸 후 재인식)
  const E = scan.EMPTY_AUTO_SCAN;
  const run = (ticks) => {
    let st = E;
    const fires = [];
    for (const [label, conf] of ticks) {
      const r = scan.autoScanTick(st, label, conf);
      st = r.state;
      fires.push(r.fire);
    }
    return fires;
  };
  check("auto-streak3", JSON.stringify(run([["cup", 90], ["cup", 90], ["cup", 90]])) === "[false,false,true]");
  check("auto-streak2", run([["cup", 90], ["cup", 90]]).every((f) => !f));
  check("auto-conf59", run([["cup", 59], ["cup", 59], ["cup", 59], ["cup", 59]]).every((f) => !f));
  check("auto-norefire", JSON.stringify(run([["cup", 90], ["cup", 90], ["cup", 90], ["cup", 90], ["cup", 90]])) === "[false,false,true,false,false]");
  check("auto-rearm-change", run([["cup", 90], ["cup", 90], ["cup", 90], ["dog", 90], ["dog", 90], ["dog", 90]])[5] === true);
  check("auto-rearm-gone", run([["cup", 90], ["cup", 90], ["cup", 90], [null, 0], ["cup", 90], ["cup", 90], ["cup", 90]])[6] === true);
  check("auto-streak-reset", run([["cup", 90], ["cup", 90], ["dog", 90], ["dog", 90]]).every((f) => !f));
  check("auto-case", run([["Cup", 90], ["CUP", 90], [" cup ", 90]])[2] === true);

  rmSync(BUILD, { recursive: true, force: true });
  console.log(`\nverify-scan: ${passes} PASS, ${failures} FAIL`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
