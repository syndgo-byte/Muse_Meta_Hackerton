// scripts/gen-external-table.mjs — EX-5: 레지스트리 → docs/EXTERNAL_APIS.md 표 생성.
// 실행: node scripts/gen-external-table.mjs
// 단일 원천: lib/external/registry.ts (tsc로 임시 컴파일 후 import).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUILD = mkdtempSync(join(tmpdir(), "gen-external-"));

function cell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

async function main() {
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      join(ROOT, "lib", "external", "registry.ts"),
      "--outDir", BUILD,
      "--module", "nodenext",
      "--target", "es2021",
      "--moduleResolution", "nodenext",
      "--skipLibCheck",
    ],
    { stdio: "pipe" }
  );
  const { EXTERNAL_REGISTRY } = await import(pathToFileURL(join(BUILD, "registry.js")).href);

  const head = [
    "# 외부 API·외부 연결 표 (EX-5 자동 생성)",
    "",
    "> 이 파일은 `node scripts/gen-external-table.mjs`로 생성한다. 직접 고치지 말고",
    "> `lib/external/registry.ts`를 고친 뒤 다시 생성한다. 키 값은 절대 쓰지 않는다(이름만).",
    "",
    "화면 패널: 캠프 탭 4 '외부 연결' (/camp). 상태 API: `GET /api/health/external`.",
    "",
    "| id | 상태 | 목적 | 나가는 데이터 | 필요 env | 키 발급처 | 끊기면 |",
    "|---|---|---|---|---|---|---|",
  ];
  const rows = EXTERNAL_REGISTRY.map((e) =>
    `| ${cell(e.id)} | ${cell(e.status)} | ${cell(e.purpose)} | ${cell(e.sends)} | ${cell(e.envKeys.join(", ") || "없음")} | ${cell(e.keyIssuer)} | ${cell(e.fallback)} |`
  );
  const tail = [
    "",
    `원천: lib/external/registry.ts (${EXTERNAL_REGISTRY.length}개 항목).`,
    "",
  ];
  const out = [...head, ...rows, ...tail].join("\n");
  const prev = (() => {
    try {
      return readFileSync(join(ROOT, "docs", "EXTERNAL_APIS.md"), "utf8");
    } catch {
      return null;
    }
  })();
  writeFileSync(join(ROOT, "docs", "EXTERNAL_APIS.md"), out);
  console.log(prev === out ? "EXTERNAL_APIS.md unchanged" : `EXTERNAL_APIS.md written (${EXTERNAL_REGISTRY.length} rows)`);
  rmSync(BUILD, { recursive: true, force: true });
}

await main();
