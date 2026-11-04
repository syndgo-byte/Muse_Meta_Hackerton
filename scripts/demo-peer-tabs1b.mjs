// scripts/demo-peer-tabs1b.mjs — PF-1b 탭 시연: 신청→수락/거절→표현/배틀 + 캡처 2장.
// 필요: dev 서버(격리 NEXT_DIST_DIR 권장, :3000·.next 금지) + 디버그 포트 크롬(별도 프로필).
// 실행 예: $env:NEXT_DIST_DIR=".next-pf1b"; npx next dev -p 3351
//   chrome --headless=new --user-data-dir=D:\tmp\pf1b-demo --remote-debugging-port=9345 about:blank
//   PF1B_PORT=3351 PF1B_CDP=9345 node scripts/demo-peer-tabs1b.mjs
// 실패해도 멈추지 않고 어디서 막혔는지 출력한다. 종료 코드만 본다.
// 주의: pov는 배틀 중 HUD(피어 UI 포함)를 통째로 내린다(9-A2). 배틀 중 피어 UI
// 없음은 정상이며, 복귀는 리마운트 + 5초 알림으로 자연 복원된다.
const CDP = `http://127.0.0.1:${process.env.PF1B_CDP ?? "9345"}`;
const BASE = `http://127.0.0.1:${process.env.PF1B_PORT ?? "3351"}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { mkdirSync, writeFileSync } from "node:fs";
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
async function waitHudKind(kind, secs) {
  for (let i = 0; i < secs; i++) {
    const n = await (await fetch(`${BASE}/api/hud`)).json();
    if (n.notice?.kind === kind) return n.notice;
    await sleep(1000);
  }
  return null;
}

const results = [];
function rep(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK " : "FAIL "}${name}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

// 고스트 탭 정리 (이전 실행 탭이 같은 채널로 알리면 엉뚱한 상대를 잡는다).
{
  const list = await (await fetch(`${CDP}/json/list`)).json();
  for (const t of list) {
    if (t.type === "page") {
      try { await fetch(`${CDP}/json/close/${t.id}`, { method: "PUT" }); } catch { /* ignore */ }
    }
  }
  await sleep(1000);
}

// 탭 A·B: /pov (각자 휴대폰). 같은 브라우저라 BC가 통한다.
// 별명은 탭별 sessionStorage(리마운트에도 유지). localStorage도 같이 둔다.
const A = await openTab("about:blank");
await A.tab.send("Page.navigate", { url: `${BASE}/` });
await sleep(2500);
await A.tab.js(`sessionStorage.setItem("pf1.trainer", "갑"); localStorage.setItem("snapquest-trainer", "갑")`);
await A.tab.send("Page.navigate", { url: `${BASE}/pov` });
try {
  await waitFor(A.tab, `document.querySelector('[data-peer-state="live"]') ? 1 : 0`, 150, "A live");
  rep("a-live", true);
} catch (e) { rep("a-live", false, e.message); }
const B = await openTab("about:blank");
await B.tab.send("Page.navigate", { url: `${BASE}/` });
await sleep(2500);
await B.tab.js(`sessionStorage.setItem("pf1.trainer", "을"); localStorage.setItem("snapquest-trainer", "을")`);
await B.tab.send("Page.navigate", { url: `${BASE}/pov` });
try {
  // A가 이미 알리므로 live를 건너뛰고 바로 notice일 수 있다.
  await waitFor(B.tab, `document.querySelector('[data-peer-state="live"], [data-peer-state="notice"]') ? 1 : 0`, 150, "B live");
  rep("b-live", true);
} catch (e) { rep("b-live", false, e.message); }
// 탭 C: 일단 /hud (조용히 구경). 나중에 /pov로 올려 3번째 휴대폰이 된다.
const C = await openTab(`${BASE}/hud`);
await sleep(2500);

// 서로 근처 알림만 뜬다 (자동 카드 없음, QR 없음).
try {
  await waitFor(A.tab, `document.querySelector('[data-peer-state="notice"]') ? 1 : 0`, 30, "A notice");
  await waitFor(B.tab, `document.querySelector('[data-peer-state="notice"]') ? 1 : 0`, 30, "B notice");
  const aTitle = await A.tab.js(`document.querySelector('.peer-title')?.textContent ?? ''`);
  const bTitle = await B.tab.js(`document.querySelector('.peer-title')?.textContent ?? ''`);
  const aBtn = await A.tab.js(`document.querySelector('[data-peer-request]')?.textContent ?? ''`);
  rep("a-sees-b", aTitle.includes("을") && aBtn === "만남 신청", `${aTitle} / ${aBtn}`);
  rep("b-sees-a", bTitle.includes("갑"), bTitle);
  const qr = await A.tab.js(`document.querySelector('[data-peer-code], canvas.peer-code') ? 1 : 0`);
  const qrB = await B.tab.js(`document.querySelector('[data-peer-code], canvas.peer-code') ? 1 : 0`);
  rep("no-qr", qr === 0 && qrB === 0);
} catch (e) { rep("mutual-notice", false, e.message); }

// 1막: A 신청 → B 수락 → 배틀 (낯선 사이).
try {
  await A.tab.js(`document.querySelector('[data-peer-request]')?.click()`);
  await waitFor(A.tab, `document.querySelector('[data-peer-state="wait"]') ? 1 : 0`, 15, "A wait");
  await waitFor(B.tab, `document.querySelector('[data-peer-state="asked"]') ? 1 : 0`, 15, "B asked");
  const bTitle = await B.tab.js(`document.querySelector('.peer-title')?.textContent ?? ''`);
  rep("request-asked", bTitle.includes("갑") && bTitle.includes("신청"), bTitle);
  await sleep(600);
  const pic = await B.tab.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(shot("pf1b-asked.png"), Buffer.from(pic.data, "base64"));
  rep("cap-asked", true);
} catch (e) { rep("request-asked", false, e.message); }
try {
  await waitFor(C.tab, `document.querySelector('[data-hud-notice]:not([data-hud-notice="0"])') ? 1 : 0`, 20, "hud ask");
  await sleep(1200);
  const hudText = await C.tab.js(`document.body.textContent.includes('갑') ? 1 : 0`);
  rep("hud-ask", hudText === 1);
  const pic = await C.tab.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(shot("pf1b-hud-ask.png"), Buffer.from(pic.data, "base64"));
  rep("cap-hud-ask", true);
} catch (e) { rep("hud-ask", false, e.message); }
try {
  await B.tab.js(`document.querySelector('[data-peer-accept]')?.click()`);
  const n = await waitHudKind("battle", 15);
  rep("accept-battle", !!n, JSON.stringify(n));
  await sleep(1500);
  // 배틀 중 피어 UI는 언마운트(9-A2: 크리처 2마리만). 없음이 정상.
  const aPeer = await A.tab.js(`document.querySelector('[data-peer-state]') ? 1 : 0`);
  const aFlee = await A.tab.js(`document.querySelector('.bfx-flee-btn') ? 1 : 0`);
  rep("a-battle-hides-peer", aPeer === 0 && aFlee === 1, `peer=${aPeer} flee=${aFlee}`);
} catch (e) { rep("accept-battle", false, e.message); }

// 1.5막: B는 /hud로 퇴장(배틀 종료), A는 도망 → 자동 복귀 → 피어 UI 리마운트.
try {
  await B.tab.send("Page.navigate", { url: `${BASE}/hud` });
  await sleep(1000);
  await waitFor(A.tab, `document.querySelector('.bfx-flee-btn') ? 1 : 0`, 30, "A flee btn");
  await A.tab.js(`document.querySelector('.bfx-flee-btn')?.click()`);
  await waitFor(A.tab, `document.querySelector('[data-peer-state="live"]') ? 1 : 0`, 60, "A back");
  rep("a-flee-back", true);
} catch (e) { rep("a-flee-back", false, e.message); }

// 2막: C가 /pov로 입장. A 신청 → C 거절.
try {
  await C.tab.js(`sessionStorage.setItem("pf1.trainer", "병"); localStorage.setItem("snapquest-trainer", "병")`);
  await C.tab.send("Page.navigate", { url: `${BASE}/pov` });
  await waitFor(C.tab, `document.querySelector('[data-peer-state="notice"]') ? 1 : 0`, 150, "C notice");
  rep("c-live", true);
  await waitFor(A.tab, `document.querySelector('.peer-title')?.textContent.includes('병') ? 1 : 0`, 30, "A sees C");
  await A.tab.js(`document.querySelector('[data-peer-request]')?.click()`);
  await waitFor(A.tab, `document.querySelector('[data-peer-state="wait"]') ? 1 : 0`, 15, "A wait2");
  await waitFor(C.tab, `document.querySelector('[data-peer-state="asked"]') ? 1 : 0`, 15, "C asked");
  const cTitle = await C.tab.js(`document.querySelector('.peer-title')?.textContent ?? ''`);
  rep("a-requests-c", cTitle.includes("갑"), cTitle);
  await C.tab.js(`document.querySelector('[data-peer-decline]')?.click()`);
  await waitFor(A.tab, `document.querySelector('[data-peer-state="notice"]') ? 1 : 0`, 15, "A back");
  await waitFor(C.tab, `document.querySelector('[data-peer-state="notice"]') ? 1 : 0`, 15, "C back");
  rep("decline-flow", true);
} catch (e) { rep("decline-flow", false, e.message); }

// 3막: A가 C를 친구 추가 → C 신청 → A 수락 → 같이 표현.
try {
  await waitFor(A.tab, `document.querySelector('.peer-title')?.textContent.includes('병') ? 1 : 0`, 30, "A sees C2");
  await A.tab.js(`[...document.querySelectorAll('.peer-row .hud-btn')].find(b => b.textContent.includes('친구 추가'))?.click()`);
  await sleep(700);
  const fBtn = await A.tab.js(`[...document.querySelectorAll('.peer-row .hud-btn')].find(b => b.textContent.includes('친구'))?.textContent ?? ''`);
  rep("a-friends-c", fBtn === "친구 해제", fBtn);
  await waitFor(C.tab, `document.querySelector('.peer-title')?.textContent.includes('갑') ? 1 : 0`, 30, "C sees A");
  await C.tab.js(`document.querySelector('[data-peer-request]')?.click()`);
  await waitFor(A.tab, `document.querySelector('[data-peer-state="asked"]') ? 1 : 0`, 15, "A asked");
  rep("c-requests-a", true);
  await A.tab.js(`document.querySelector('[data-peer-accept]')?.click()`);
  const n = await waitHudKind("meet", 20);
  rep("accept-emote", !!n, JSON.stringify(n));
} catch (e) { rep("emote-flow", false, e.message); }

A.tab.close(); B.tab.close(); C.tab.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\npf1b-demo: ${results.length - fails}/${results.length} ok`);
if (fails > 0) process.exitCode = 1;
