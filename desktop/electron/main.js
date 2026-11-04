// electron/main.js — F2: Windows 데스크톱 래퍼. 로컬 Next 서버를 띄우고 창에 연다.
// 웹 코드는 손대지 않는다. 시작 주소는 루트(/), 카메라는 /pov에서 쓴다.
const { app, BrowserWindow, session, shell } = require("electron");
const { spawn } = require("child_process");
const { randomInt } = require("crypto");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = process.env.SNAP_PORT || "3000";
const BASE = `http://127.0.0.1:${PORT}`;
// PKG-3: `--lan-https` 또는 OISHIE_LAN_HTTPS=1 이면 0.0.0.0:3443 https 프록시를 연다.
const LAN_HTTPS = process.argv.includes("--lan-https") || process.env.OISHIE_LAN_HTTPS === "1";
const LAN_PORT = 3443;
const PAIR_CODE = LAN_HTTPS ? String(randomInt(0, 1000000)).padStart(6, "0") : (process.env.PAIRING_CODE || "");
let serverProc = null;

function waitReady(timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(BASE, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - t0 > timeoutMs) reject(new Error("server not ready"));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function startServer() {
  if (!app.isPackaged) return; // 개발 중에는 `npm run dev`를 따로 띄운다
  const serverJs = path.join(__dirname, "..", "standalone-dist", "server.js");
  serverProc = spawn(process.execPath, [serverJs], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT, HOSTNAME: "127.0.0.1", PAIRING_CODE: PAIR_CODE },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitReady(60000);
  if (LAN_HTTPS) {
    try {
      const { startLanProxy } = require("./lan-proxy");
      await startLanProxy({
        certDir: path.join(__dirname, "..", "certs", "lan"),
        targetPort: Number(PORT),
        lanPort: LAN_PORT,
      });
      console.log(`[lan] https://<PC-IP>:${LAN_PORT} (pairing ${PAIR_CODE})`);
    } catch (e) {
      console.error("[lan] https proxy failed:", e instanceof Error ? e.message : e);
    }
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, "..", "build", "icon.ico");
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    backgroundColor: "#0c120e",
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    // SEC-4: 렌더러 격리 (node 통합 차단).
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // SEC-4: 새 창은 앱 안에서 열지 않는다. https만 외부 브라우저로.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });
  // SEC-4: BASE 밖 이동은 막고, https면 외부 브라우저로.
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(BASE)) return;
    e.preventDefault();
    if (url.startsWith("https:")) shell.openExternal(url);
  });
  win.loadURL(`${BASE}/`);
}

app.whenReady().then(async () => {
  // SEC-4: 카메라·마이크는 BASE 출처 요청에만 허용.
  session.defaultSession.setPermissionRequestHandler((wc, permission, requestingUrl, details, cb) => {
    const done = typeof cb === "function" ? cb : (typeof details === "function" ? details : null);
    const url = typeof requestingUrl === "string" ? requestingUrl : "";
    const allow =
      url.startsWith(BASE) && (permission === "camera" || permission === "microphone" || permission === "media");
    if (done) done(allow);
  });
  try {
    await startServer();
  } catch (e) {
    console.error("server failed:", e);
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {
      /* ignore */
    }
    serverProc = null;
  }
  app.quit();
});
