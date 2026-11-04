// scripts/verify-sec.mjs — SEC-1b·SEC-2·SEC-3·SEC-4 검증 (docs/SECURITY_ORDER.md).
// 실행: node scripts/verify-sec.mjs (서버 불필요).
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-sec-"));
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

function tscBuild(files) {
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      ...files.map((f) => join(ROOT, f)),
      "--outDir", BUILD,
      "--module", "commonjs",
      "--target", "es2021",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
}

function walkTs(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
}

async function main() {
  // SEC-1b: 이미지 최적화 비활성 + next/image 0건 + 로컬 전용 + README.
  const cfg = readFileSync(join(ROOT, "next.config.mjs"), "utf8");
  check("sec1b-unoptimized", cfg.includes("unoptimized: true"));
  const tsFiles = [];
  walkTs(join(ROOT, "app"), tsFiles);
  walkTs(join(ROOT, "components"), tsFiles);
  const imgHits = tsFiles.filter((f) => /next\/image/.test(readFileSync(f, "utf8")));
  check("sec1b-no-next-image", imgHits.length === 0, imgHits.join(","));
  const mainJs = readFileSync(join(ROOT, "electron", "main.js"), "utf8");
  check("sec1b-localhost", mainJs.includes('HOSTNAME: "127.0.0.1"'));
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  check("sec1b-readme", readme.includes("Security notes") && readme.includes("14.2.35") && readme.includes("unoptimized"));

  // SEC-2: 세션 서명 키 (런타임).
  tscBuild(["lib/oauth.ts", "lib/account.ts"]);
  const oauth = req(join(BUILD, "oauth.js"));
  delete process.env.SESSION_SECRET;
  delete process.env.GOOGLE_CLIENT_SECRET;
  const sig1 = oauth.signSession("abc");
  const sig2 = oauth.signSession("abc");
  check("sec2-stable", sig1 === sig2 && sig1.length > 0);
  const emptySig = createHmac("sha256", "").update("abc").digest("base64url");
  check("sec2-not-empty", sig1 !== emptySig);
  check("sec2-roundtrip", oauth.verifySession(`abc.${sig1}`) === "abc");
  const envEx = readFileSync(join(ROOT, ".env.example"), "utf8");
  check("sec2-env", envEx.split("\n").some((l) => l.trim() === "SESSION_SECRET="));

  // SEC-3: 오류 응답 정제 (런타임 + 배선).
  tscBuild(["lib/muse.ts"]);
  const muse = req(join(BUILD, "muse.js"));
  const realErr = console.error;
  console.error = () => {};
  const r1 = muse.museErrorResponse(new Error("Meta API 500: <html>secret-key-xyz</html>"), "t");
  const r2 = muse.museErrorResponse(new Error("MODEL_API_KEY missing"), "t");
  const r3 = muse.museErrorResponse(new Error("Meta Image API 429: quota"), "t");
  const r4 = muse.museErrorResponse(new Error("boom"), "t");
  console.error = realErr;
  check("sec3-upstream", r1.status === 502 && r1.body.error === "upstream_error" && r1.body.status === 500 && !JSON.stringify(r1.body).includes("secret"), JSON.stringify(r1.body));
  check("sec3-nokey", r2.status === 500 && r2.body.error === "server_not_configured", JSON.stringify(r2.body));
  check("sec3-image", r3.status === 502 && r3.body.error === "upstream_error" && r3.body.status === 429, JSON.stringify(r3.body));
  check("sec3-internal", r4.status === 500 && r4.body.error === "internal_error", JSON.stringify(r4.body));
  for (const n of ["battle", "creature", "diary", "feed", "image", "look"]) {
    const src = readFileSync(join(ROOT, "app", "api", n, "route.ts"), "utf8");
    check(`sec3-route-${n}`, src.includes("museErrorResponse(e,") && !src.includes("{ error: msg }"));
  }

  // SEC-4: Electron 창 잠금 (정적 + 구문).
  check("sec4-webprefs", mainJs.includes("contextIsolation: true") && mainJs.includes("nodeIntegration: false") && mainJs.includes("sandbox: true"));
  check("sec4-open-handler", mainJs.includes("setWindowOpenHandler") && mainJs.includes("shell.openExternal") && mainJs.includes('startsWith("https:")'));
  check("sec4-navigate", mainJs.includes("will-navigate") && mainJs.includes("preventDefault") && mainJs.includes("startsWith(BASE)"));
  check("sec4-permission", mainJs.includes("requestingUrl") && mainJs.includes("setPermissionRequestHandler"));

  rmSync(BUILD, { recursive: true, force: true });
  console.log(`\nverify-sec: ${passes} PASS, ${failures} FAIL`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});
