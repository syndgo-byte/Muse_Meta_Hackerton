// scripts/lan-serve.mjs — PKG-2: 폰 데모용 LAN https 서버.
// 6자리 페어링 코드를 만들고 콘솔에 크게 찍은 뒤, next dev를 0.0.0.0:3443 https로 띄운다.
// 아침 재실행: npm run serve:lan (와이파이 바뀌면 먼저 python scripts/lan-cert.py)
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const KEY = join(ROOT, "certs", "lan", "key.pem");
const CERT = join(ROOT, "certs", "lan", "cert.pem");
if (!existsSync(KEY) || !existsSync(CERT)) {
  console.error("lan-serve: certs/lan/* 없음. 먼저 python scripts/lan-cert.py 실행.");
  process.exit(1);
}
const code = String(randomInt(0, 1000000)).padStart(6, "0");
const ips = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n.address);
console.log("========================================");
console.log(`  폰 페어링 코드: ${code}`);
for (const ip of ips) console.log(`  https://${ip}:3443`);
console.log("  (같은 와이파이에서 APK 주소칸에 입력)");
console.log("========================================");
const child = spawn(
  process.execPath,
  [
    join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev",
    "-H", "0.0.0.0",
    "-p", "3443",
    "--experimental-https",
    "--experimental-https-key", KEY,
    "--experimental-https-cert", CERT,
  ],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PAIRING_CODE: code, NEXT_DIST_DIR: ".next-lan" },
  }
);
child.on("exit", (c) => process.exit(c ?? 0));
