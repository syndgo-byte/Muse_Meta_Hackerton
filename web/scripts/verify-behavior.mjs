// Part J verification: behavior state machine transitions + rules.
// Run: node scripts/verify-behavior.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-behavior");
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
    include: ["../../lib/motion/behavior.ts"],
  }));
  execFileSync(process.execPath, [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json",
  ], { cwd: BUILD, stdio: "inherit" });
  // tsc leaves path aliases in require() calls; rewrite to relative.
  const jsFiles = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js")) jsFiles.push(p);
    }
  };
  walk(join(BUILD, "out"));
  for (const f of jsFiles.map((p) => p.slice(BUILD.length + 1).replace(/\\/g, "/"))) {
    const p = join(BUILD, f);
    const depth = f.split("/").length - 3; // segments under out/lib/
    const prefix = "./" + "../".repeat(Math.max(depth, 0));
    writeFileSync(p, readFileSync(p, "utf-8").replace(/@\/lib\//g, prefix));
  }
}

compile();
const B = require(join(BUILD, "out", "lib", "motion", "behavior.js"));
const { decide, initialMemory } = B;

let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fail += 1;
};

const STATUS = (o = {}) => ({
  fullness: 50, energy: 80, affection: 20, xp: 0, level: 1, ...o,
});
const base = (o = {}) => ({
  now: 100, prev: initialMemory(100, 1), status: STATUS(), walkM: 0,
  lastScanAt: 0, creature: { x: 0, z: 0 }, vel: { x: 0, z: 0 },
  scan: null, tap: null, danger: [], freeScans: 3,
  goalVisible: false, goalReached: false, emoteDone: false,
  heading: { x: 1, z: 0 }, wildActive: false, ...o,
});
const ZONE = { x0: 1, x1: 2, z0: -1, z1: 1, cx: 1.5, approaching: false };

// 1. priority: danger + goal + walking -> avoid
{
  const m = { ...initialMemory(100, 1), state: "follow", since: 90 };
  const r = decide(base({ prev: m, danger: [{ ...ZONE, x0: -1, x1: 1, cx: 0 }],
    tap: { x: 5, z: 0, at: 99 }, walkM: 5 }));
  ok(r.state === "avoid", `priority -> avoid (got ${r.state})`);
  ok(r.balloon === "위험해!", `avoid entry balloon (got ${r.balloon})`);
  ok(r.move !== null && r.move.dx !== 0, "avoid moves");
}
// 2. avoid holds until 2s clear, then exits
{
  const m = { ...initialMemory(100, 1), state: "avoid", since: 90, avoidClearSince: 99 };
  const stay = decide(base({ now: 100.9, prev: m }));
  const leave = decide(base({ now: 101.5, prev: m }));
  ok(stay.state === "avoid", `avoid holds at 1.9s clear (got ${stay.state})`);
  ok(leave.state === "idle", `avoid exits at 2.5s clear (got ${leave.state})`);
  ok(stay.balloon === null, "balloon only on entry");
}
// 3. avoid direction: zone center right of creature -> move left (-x)
{
  const r = decide(base({ danger: [ZONE], creature: { x: 1.2, z: 0 } }));
  ok(r.state === "avoid" && r.move !== null && r.move.dx < 0,
    `avoid -x away from zone (dx=${r.move?.dx})`);
  const r2 = decide(base({ danger: [ZONE], creature: { x: 1.2, z: 1 } }));
  ok(r2.move !== null && r2.move.dz < 0, `avoid pulls z toward 0..0.4 (dz=${r2.move?.dz})`);
}
// 4. goal inside danger -> dropped, no approach
{
  const r = decide(base({ danger: [ZONE], tap: { x: 1.5, z: 0, at: 99 } }));
  ok(r.memory.goal === null && r.goalDropped === "goal-in-danger",
    `danger goal dropped (goal=${JSON.stringify(r.memory.goal)} ${r.goalDropped})`);
  ok(r.state === "idle", `no approach without goal (got ${r.state})`);
}
// 5. heading into zone (velocity) -> avoid
{
  const r = decide(base({ danger: [ZONE], vel: { x: 3, z: 0 } }));
  ok(r.state === "avoid", `heading into zone -> avoid (got ${r.state})`);
}
// 6. tap -> approach; reach -> interact immediately (greet)
{
  const a = decide(base({ tap: { x: 5, z: 0, at: 99 } }));
  ok(a.state === "approach", `tap -> approach (got ${a.state})`);
  const m = { ...a.memory, since: 99.5 };
  const i = decide(base({ now: 100, prev: m, goalReached: true }));
  ok(i.state === "interact" && i.emote === "greet",
    `reach -> interact+greet immediately (got ${i.state} ${i.emote})`);
  const d = decide(base({ now: 101, prev: { ...i.memory, since: 100 }, emoteDone: true }));
  ok(d.memory.goal === null, "goal consumed after emoteDone");
}
// 7. hungry + scan -> food goal + approach + eat; event flag passes through
{
  const r = decide(base({
    status: STATUS({ fullness: 20 }),
    scan: { x: 3, z: 1, visible: true, event: true, at: 99 },
  }));
  ok(r.state === "approach" && r.memory.goal?.kind === "food",
    `hungry scan -> food approach (got ${r.state})`);
  const i = decide(base({ prev: r.memory, goalReached: true,
    status: STATUS({ fullness: 20 }) }));
  ok(i.emote === "eat" && i.eventFood === true, "eat + eventFood on reach");
}
// 8. full + visible food -> no goal, focus only
{
  const r = decide(base({
    status: STATUS({ fullness: 80 }),
    scan: { x: 3, z: 1, visible: true, event: false, at: 99 },
  }));
  ok(r.memory.goal === null && r.state === "focus",
    `full scan -> focus, no goal (got ${r.state})`);
  ok(r.move === null && r.face !== null, "focus faces, no move");
}
// 9. min 3s: follow holds after trainer stops; higher preempts at once
{
  const m = { ...initialMemory(100, 1), state: "follow", since: 99, lastWalkM: 5 };
  const hold = decide(base({ now: 100, prev: m, walkM: 5 }));
  ok(hold.state === "follow", `follow holds at 1s (got ${hold.state})`);
  const late = decide(base({ now: 103, prev: m, walkM: 5 }));
  ok(late.state === "idle", `follow -> idle at 4s (got ${late.state})`);
  const pre = decide(base({ now: 100, prev: m, walkM: 5,
    danger: [{ ...ZONE, x0: -1, x1: 1, cx: 0 }] }));
  ok(pre.state === "avoid", "avoid preempts 1s-old follow immediately");
}
// 10. exhausted: no approach/follow, idle; avoid still works at half speed
{
  const ex = STATUS({ energy: 10 });
  const a = decide(base({ status: ex, tap: { x: 5, z: 0, at: 99 } }));
  ok(a.state === "idle", `exhausted + goal -> idle (got ${a.state})`);
  const f = decide(base({ status: ex, walkM: 5 }));
  ok(f.state === "idle", `exhausted + walking -> idle (got ${f.state})`);
  const v = decide(base({ status: ex, danger: [{ ...ZONE, x0: -1, x1: 1, cx: 0 }] }));
  ok(v.state === "avoid" && v.move?.speed === 0.5, "exhausted avoid at 0.5x");
  const i = decide(base({ status: ex, tap: { x: 5, z: 0, at: 99 }, goalReached: true }));
  ok(i.state === "interact", "exhausted can still interact (eat/greet)");
}
// 11. trainer walking -> follow along heading
{
  const r = decide(base({ walkM: 2, heading: { x: 0, z: 1 } }));
  ok(r.state === "follow", `walking -> follow (got ${r.state})`);
  ok(r.move !== null && r.move.dz === 1 && r.move.dx === 0, "follow heading");
}
// 12. scan cadence: due at 12s when hungry+goalless; blocked at quota 0 / full
{
  const due = decide(base({ status: STATUS({ fullness: 10 }), lastScanAt: 80 }));
  ok(due.scanDue === true, "scan due after 20s hungry");
  const wait = decide(base({ status: STATUS({ fullness: 10 }), lastScanAt: 95 }));
  ok(wait.scanDue === false, "no scan 5s after last");
  const quota = decide(base({ status: STATUS({ fullness: 10 }), lastScanAt: 80, freeScans: 0 }));
  ok(quota.scanDue === false, "no scan at quota 0");
  const full = decide(base({ lastScanAt: 80 }));
  ok(full.scanDue === false, "no scan when full");
}
// 13. food goal expires after 60s
{
  const m = { ...initialMemory(100, 1),
    goal: { kind: "food", x: 3, z: 1, at: 30 } };
  const r = decide(base({ now: 100, prev: m, status: STATUS({ fullness: 10 }) }));
  ok(r.memory.goal === null && r.goalDropped === "food-expired-or-full",
    "food goal expires at 60s+");
}
// 14. wild freezes everything
{
  const m = { ...initialMemory(100, 1), state: "approach", since: 90,
    goal: { kind: "food", x: 1, z: 1, at: 99 } };
  const r = decide(base({ prev: m, wildActive: true, tap: { x: 9, z: 9, at: 99 } }));
  ok(r.yielded && r.state === "approach" && r.memory.goal?.x === 1 && r.move === null,
    "wild yields frozen state");
}
// 15. levelup fires once per band with a real dance id
{
  const m = initialMemory(100, 1);
  const l = decide(base({ prev: m, status: STATUS({ level: 2 }) }));
  ok(l.levelup !== null && ["ateez", "a2o"].includes(l.levelup.danceId),
    `levelup fires with dance (got ${JSON.stringify(l.levelup)})`);
  const again = decide(base({ now: 101, prev: l.memory, status: STATUS({ level: 2 }) }));
  ok(again.levelup === null, "no refire on same level");
  const next = decide(base({ now: 102, prev: again.memory, status: STATUS({ level: 3 }) }));
  ok(next.levelup !== null && next.levelup.level === 3, "fires again on level 3");
}

console.log(fail === 0 ? "ALL BEHAVIOR CHECKS PASSED" : `${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
