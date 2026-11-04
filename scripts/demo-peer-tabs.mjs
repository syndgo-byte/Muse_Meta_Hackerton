// scripts/demo-peer-tabs.mjs — PF-1 탭 2개 만남 + hud 연결 + 캡처 3장.
// 필요: dev 서버(격리 NEXT_DIST_DIR 권장, :3000·.next 금지) + 디버그 포트 크롬(별도 프로필).
// 실행 예: $env:NEXT_DIST_DIR=".next-pf1"; npx next dev -p 3341
//   chrome --headless=new --user-data-dir=D:\tmp\pf1-demo --remote-debugging-port=9343 about:blank
//   PF1_PORT=3341 PF1_CDP=9343 node scripts/demo-peer-tabs.mjs
// 실패해도 멈추지 않고 어디서 막혔는지 출력한다. 종료 코드만 본다.
const CDP = `http://127.0.0.1:${process.env.PF1_CDP ?? "9343"}`;
const BASE = `http://127.0.0.1:${process.env.PF1_PORT ?? "3341"}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const OUTDIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scratch", "peer");
mkdirSync(OUTDIR, { recursive: true });
const shot = (name) => join(OUTDIR, name);

class Tab {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error).slice(0, 200)));
        else p.resolve(m.result);
      }
    };
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const cur = ++this.id;
      this.pending.set(cur, { resolve, reject });
      this.ws.send(JSON.stringify({ id: cur, method, params }));
    });
  }
  async js(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

async function targets() {
  return await (await fetch(`${CDP}/json/list`)).json();
}
async function openTab(url) {
  const t = await (await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const tab = new Tab(t.webSocketDebuggerUrl);
  await tab.open();
  return { tab, id: t.id };
}
async function waitFor(tab, expr, secs, label) {
  for (let i = 0; i < secs; i++) {
    const v = await tab.js(expr);
    if (v) return v;
    await sleep(1000);
  }
  throw new Error(`timeout: ${label}`);
}

const results = [];
function rep(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK " : "FAIL "}${name}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

// 탭 A·B: /pov (각자 휴대폰). 같은 브라우저라 BC가 통한다.
// localStorage가 공유되므로 A가 별명을 확정한 뒤에 B를 연다.
const A = await openTab("about:blank");
await A.tab.send("Page.navigate", { url: `${BASE}/` });
await sleep(2500);
await A.tab.js(`localStorage.setItem("snapquest-trainer", "갑")`);
await A.tab.send("Page.navigate", { url: `${BASE}/pov` });
try {
  await waitFor(A.tab, `document.querySelector('[data-peer-state="live"]') ? 1 : 0`, 150, "A live");
  await waitFor(A.tab, `document.querySelector('[data-peer-code]') ? 1 : 0`, 30, "A beacon");
  rep("a-live", true);
} catch (e) { rep("a-live", false, e.message); }
const B = await openTab("about:blank");
await B.tab.send("Page.navigate", { url: `${BASE}/` });
await sleep(2500);
await B.tab.js(`localStorage.setItem("snapquest-trainer", "을")`);
await B.tab.send("Page.navigate", { url: `${BASE}/pov` });
try {
  await waitFor(B.tab, `document.querySelector('[data-peer-state="live"]') ? 1 : 0`, 150, "B live");
  rep("b-live", true);
} catch (e) { rep("b-live", false, e.message); }
try {
  await waitFor(A.tab, `document.querySelector('.peer-card') ? 1 : 0`, 30, "A card");
  await waitFor(B.tab, `document.querySelector('.peer-card') ? 1 : 0`, 30, "B card");
  const aTitle = await A.tab.js(`document.querySelector('.peer-title')?.textContent ?? ''`);
  const bTitle = await B.tab.js(`document.querySelector('.peer-title')?.textContent ?? ''`);
  const aBtn = await A.tab.js(`document.querySelector('.peer-act')?.textContent ?? ''`);
  const bBtn = await B.tab.js(`document.querySelector('.peer-act')?.textContent ?? ''`);
  rep("a-sees-b", aTitle.includes("을") && aBtn === "배틀", `${aTitle} / ${aBtn}`);
  rep("b-sees-a", bTitle.includes("갑") && bBtn === "배틀", `${bTitle} / ${bBtn}`);
} catch (e) { rep("mutual-cards", false, e.message); }

// A: 친구 추가 → 같이 표현 → hud result.
try {
  await A.tab.js(`[...document.querySelectorAll('.peer-row .hud-btn')].find(b => b.textContent.includes('친구 추가'))?.click()`);
  await sleep(700);
  const btn = await A.tab.js(`document.querySelector('.peer-act')?.textContent ?? ''`);
  rep("friend-flips-emote", btn === "같이 감정 표현", btn);
  await A.tab.js(`document.querySelector('.peer-act')?.click()`);
  await sleep(2500);
  const n = await (await fetch(`${BASE}/api/hud`)).json();
  rep("hud-notice-meet", n.notice?.kind === "meet" && (n.notice?.text ?? "").includes("을"), JSON.stringify(n.notice));
} catch (e) { rep("emote-flow", false, e.message); }

// 탭 C: /hud 결과 화면 → 캡처 1.
const C = await openTab(`${BASE}/hud`);
try {
  await waitFor(C.tab, `document.querySelector('[data-hud-notice]:not([data-hud-notice="0"])') ? 1 : 0`, 20, "hud notice");
  await sleep(1200);
  const pic = await C.tab.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(shot("pf1-hud-meet.png"), Buffer.from(pic.data, "base64"));
  rep("cap-hud-meet", true);
} catch (e) { rep("cap-hud-meet", false, e.message); }

// B: 배틀 → hud battle 화면 → 캡처 2.
try {
  const bBtn = await B.tab.js(`document.querySelector('.peer-act')?.textContent ?? ''`);
  rep("b-still-battle", bBtn === "배틀", bBtn);
  await B.tab.js(`document.querySelector('.peer-act')?.click()`);
  await sleep(2500);
  const n = await (await fetch(`${BASE}/api/hud`)).json();
  rep("hud-notice-battle", n.notice?.kind === "battle", JSON.stringify(n.notice));
  await C.tab.send("Page.navigate", { url: `${BASE}/hud` });
  await waitFor(C.tab, `document.querySelector('[data-hud-notice]:not([data-hud-notice="0"])') ? 1 : 0`, 20, "hud battle");
  await sleep(1200);
  const pic = await C.tab.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(shot("pf1-hud-battle.png"), Buffer.from(pic.data, "base64"));
  rep("cap-hud-battle", true);
} catch (e) { rep("battle-flow", false, e.message); }

// 탭 D: /battle-demo 근처 트레이너 → 캡처 3.
const Dd = await openTab(`${BASE}/battle-demo?battlefx=demo`);
try {
  await waitFor(Dd.tab, `document.querySelectorAll('.peer-card').length >= 5 ? 1 : 0`, 120, "demo rows");
  await waitFor(Dd.tab, `[...document.querySelectorAll('.peer-card .peer-sub')].some(e => e.textContent.includes('같이 표현')) ? 1 : 0`, 60, "demo seeded");
  await sleep(800);
  const kinds = await Dd.tab.js(`[...document.querySelectorAll('.peer-card .peer-sub')].map(e => e.textContent).join(' / ')`);
  rep("demo-branches", kinds.includes("같이 표현") && kinds.includes("배틀 제안") && kinds.includes("무시됨"), kinds);
  await Dd.tab.js(`[...document.querySelectorAll('h2')].find(h => h.textContent.includes('근처 트레이너'))?.scrollIntoView()`);
  await sleep(1200);
  const pic = await Dd.tab.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(shot("pf1-peer-card.png"), Buffer.from(pic.data, "base64"));
  rep("cap-peer-card", true);
} catch (e) { rep("demo-section", false, e.message); }

A.tab.close(); B.tab.close(); C.tab.close(); Dd.tab.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\npf1-demo: ${results.length - fails}/${results.length} ok`);
if (fails > 0) process.exitCode = 1;
