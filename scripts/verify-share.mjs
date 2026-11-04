// scripts/verify-share.mjs — MF-3 검증 (공유 타깃 문구·URL + 합성 배선).
// 실행: node scripts/verify-share.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "verify-share-"));
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
      "lib/share.ts",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
  const s = req(join(BUILD, "share.js"));
  const ts = s.buildShareTargets("T", "#g", "http://x/y");
  const byId = Object.fromEntries(ts.map((t) => [t.id, t]));

  check("targets-8", ts.length === 8, String(ts.length));
  check("x-intent", byId.x.url.includes("twitter.com/intent/tweet?text=") && byId.x.note.includes("미리 들어가요"));
  check("threads-intent", byId.threads.url.includes("threads.net/intent/post?text=") && byId.threads.note.includes("미리 들어가요"));
  check("facebook-copy-first", !byId.facebook.url.includes("quote=") && byId.facebook.note.includes("복사 후 열기"));
  check("instagram-copy", byId.instagram.url === "https://www.instagram.com/" && byId.instagram.note.includes("복사"));
  check("tiktok-copy", byId.tiktok.url.includes("tiktok.com/upload") && byId.tiktok.note.includes("복사"));
  check("caption-280", byId.x.url.length - "https://twitter.com/intent/tweet?text=".length <= 900, "enc-capped");

  // 정적: pov 배선 (배경 합성 + 3D 게이트 + 미리보기 + FB 복사)
  const pov = readFileSync(join(ROOT, "app", "pov", "page.tsx"), "utf8");
  check("pov-backdrop", pov.includes("captureVideoFrame") && pov.includes("backdrop }") && !pov.includes("backdrop: null"));
  check("pov-3d-gate", pov.includes('scene3d !== "3d-ready"'));
  check("pov-preview", pov.includes("sheet.preview") && pov.includes("URL.createObjectURL(file)") && pov.includes("revokeObjectURL"));
  check("pov-fb-copy", /t\.id === "facebook"\) await copyCaption/.test(pov) || pov.includes('"facebook") await copyCaption'));
  check("pov-two-line", pov.includes("t.note"));
  check("pov-system-gated", pov.includes('t.id !== "system" ||'));

  rmSync(BUILD, { recursive: true, force: true });
  console.log(`verify-share: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

await main();
