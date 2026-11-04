// scripts/pack-standalone.mjs — F2: standalone 서버를 설치본용 폴더로 모은다.
// $NEXT_DIST_DIR/standalone + static + public → standalone-dist/ (기본 .next)
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "standalone-dist");
// 릴리스 격리: next.config distDir와 같은 폴더를 본다 (기본 .next).
const NEXT = join(ROOT, process.env.NEXT_DIST_DIR || ".next");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(NEXT, "standalone"), OUT, { recursive: true });
mkdirSync(join(OUT, ".next", "static"), { recursive: true });
cpSync(join(NEXT, "static"), join(OUT, ".next", "static"), { recursive: true });
cpSync(join(ROOT, "public"), join(OUT, "public"), { recursive: true });
// 제출본 제외: .env(실키) · data/(로컬 원장). 둘 다 tracing에 딸려오므로 지운다.
rmSync(join(OUT, ".env"), { force: true });
rmSync(join(OUT, ".env.local"), { force: true });
rmSync(join(OUT, "data"), { recursive: true, force: true });

for (const f of ["server.js", join(".next", "static"), join("public", "bgm", "battle")]) {
  if (!existsSync(join(OUT, f))) {
    console.error(`pack-standalone: missing ${f}`);
    process.exitCode = 1;
  }
}
console.log("pack-standalone: ok");
