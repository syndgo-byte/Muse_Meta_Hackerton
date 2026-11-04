// scripts/verify-peer.mjs — PF-1b 검증 (판단표·친구·전송·신청신호·연결).
// 실행: node scripts/verify-peer.mjs (종료 코드만 본다).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-peer");
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

// lib/social/*.ts를 컴파일해서 직접 검사한다 (상대 import만이라 격리 가능).
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
writeFileSync(join(BUILD, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "es2020", module: "commonjs", moduleResolution: "node",
    outDir: "out", rootDir: "../..", skipLibCheck: true, esModuleInterop: true,
    lib: ["es2020", "dom"],
  },
  include: ["../../lib/social/friends.ts", "../../lib/social/decide.ts", "../../lib/social/transport.ts"],
}));
execFileSync(process.execPath, [
  join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json",
], { cwd: BUILD, stdio: "pipe" });
const F = require(join(BUILD, "out", "lib", "social", "friends.js"));
const D = require(join(BUILD, "out", "lib", "social", "decide.js"));
const T = require(join(BUILD, "out", "lib", "social", "transport.js"));

// 1. decideMeet 판단표.
{
  const NOW = 1_000_000_000;
  const ref = (o) => ({ peerId: "p1", isFriend: false, rating: null, lastMetAt: null, ...o });
  check("decide-friend", D.decideMeet(ref({ isFriend: true }), NOW) === "emote");
  check("decide-rating5", D.decideMeet(ref({ rating: 5 }), NOW) === "emote");
  check("decide-rating4", D.decideMeet(ref({ rating: 4 }), NOW) === "emote");
  check("decide-rating3", D.decideMeet(ref({ rating: 3 }), NOW) === "battle");
  check("decide-stranger", D.decideMeet(ref({}), NOW) === "battle");
  check("decide-rating2", D.decideMeet(ref({ rating: 2 }), NOW) === "pass");
  check("decide-rating1", D.decideMeet(ref({ rating: 1 }), NOW) === "pass");
  check("decide-cooldown", D.decideMeet(ref({ isFriend: true, lastMetAt: NOW - 60_000 }), NOW) === "pass");
  check("decide-cooldown-expired", D.decideMeet(ref({ isFriend: true, lastMetAt: NOW - 11 * 60_000 }), NOW) === "emote");
  check("decide-no-id", D.decideMeet(ref({ peerId: "" }), NOW) === "pass");
  check("decide-cooldown-const", D.MEET_COOLDOWN_MS === 10 * 60 * 1000 && F.MEET_COOLDOWN_MS === 10 * 60 * 1000);
  // 같이 표현은 greet→happy, 둘 다 기존 EMOTE_IDS에 있어야 한다.
  check("meet-emotes", JSON.stringify(D.MEET_EMOTES) === JSON.stringify(["greet", "happy"]), D.MEET_EMOTES.join(","));
  const emotes = readFileSync(join(ROOT, "lib", "motion", "emotes.ts"), "utf8");
  const idsBlock = emotes.slice(emotes.indexOf("EMOTE_IDS"), emotes.indexOf("];", emotes.indexOf("EMOTE_IDS")));
  check("meet-emotes-known", D.MEET_EMOTES.every((e) => idsBlock.includes(`"${e}"`)));
}
// 2. 친구·평점·쿨다운 저장.
{
  check("store-no-storage", F.ratingOf("x") === null && F.isFriend("x") === false && F.lastMet("x") === null);
  let threw = false;
  try { F.addFriend("x"); F.rate("x", 5); F.markMet("x"); } catch { threw = true; }
  check("store-no-throw", !threw);
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  F.addFriend("f1", "친구");
  check("friend-add", F.isFriend("f1") === true);
  F.removeFriend("f1");
  check("friend-remove", F.isFriend("f1") === false);
  F.rate("r1", 4);
  check("rate-ok", F.ratingOf("r1") === 4);
  F.rate("r1", 0); F.rate("r1", 6); F.rate("r1", 2.5); F.rate("r1", NaN);
  check("rate-guard", F.ratingOf("r1") === 4);
  check("rate-missing", F.ratingOf("nobody") === null);
  F.markMet("m1", 12345);
  check("met-mark", F.lastMet("m1") === 12345);
  check("met-missing", F.lastMet("nobody") === null);
  F.addFriend("", "x"); F.rate("", 5); F.markMet("");
  check("store-empty-id", F.isFriend("") === false && F.ratingOf("") === null && F.lastMet("") === null);
  delete globalThis.localStorage;
}
// 3. 전송층 알림 (node BroadcastChannel로 탭 2개 흉내).
{
  const A = { peerId: "peer-a", nickname: "갑", speciesId: "wind-01", level: 5 };
  const B = { peerId: "peer-b", nickname: "을", speciesId: "fire-01", level: 3 };
  const a = new T.ChannelTransport(A);
  const b = new T.ChannelTransport(B);
  const gotA = [];
  const gotB = [];
  const offA = a.onPeer((p) => gotA.push(p));
  b.onPeer((p) => gotB.push(p));
  b.announce(B);
  a.announce(A);
  await new Promise((r) => setTimeout(r, 300));
  check("bc-deliver", gotA.length === 1 && gotA[0].peerId === "peer-b" && gotB.length === 1 && gotB[0].peerId === "peer-a",
    `a:${gotA.length} b:${gotB.length}`);
  check("bc-fields", gotA[0]?.nickname === "을" && gotA[0]?.level === 3 && !("tag" in (gotA[0] ?? {})));
  // 자기 메시지는 버린다 (위에서 각자 1건씩만 받았으면 통과).
  check("bc-no-self", gotA.every((p) => p.peerId !== "peer-a") && gotB.every((p) => p.peerId !== "peer-b"));
  // 깨진 메시지 무시 + 해제.
  const raw = new BroadcastChannel(T.PEER_CHANNEL);
  raw.postMessage({ tag: "oishi-peer", peerId: "", nickname: "x".repeat(99), speciesId: "fire-01", level: 1 });
  raw.postMessage({ hello: 1 });
  raw.postMessage(null);
  await new Promise((r) => setTimeout(r, 300));
  check("bc-invalid", gotA.length === 1 && gotB.length === 1, `a:${gotA.length} b:${gotB.length}`);
  offA();
  b.announce(B);
  await new Promise((r) => setTimeout(r, 300));
  check("bc-off", gotA.length === 1, `a:${gotA.length}`);
  a.close(); b.close(); raw.close();
  const src = readFileSync(join(ROOT, "lib", "social", "transport.ts"), "utf8");
  check("bc-shortcut-note", src.includes("shortcut: 같은 브라우저"));
}
// 4. 신청 신호 (peerId 참조만, 신원은 알림 캐시에서).
{
  const A = { peerId: "peer-a", nickname: "갑", speciesId: "wind-01", level: 5 };
  const B = { peerId: "peer-b", nickname: "을", speciesId: "fire-01", level: 3 };
  const a = new T.ChannelTransport(A);
  const b = new T.ChannelTransport(B);
  const sigA = [];
  const sigB = [];
  const peerB = [];
  const offSigA = a.onSignal((s) => sigA.push(s));
  b.onSignal((s) => sigB.push(s));
  b.onPeer((p) => peerB.push(p));
  const wait = () => new Promise((r) => setTimeout(r, 300));
  a.request("peer-b");
  await wait();
  check("sig-request-deliver", sigB.length === 1 && sigB[0].kind === "request" && sigA.length === 0,
    `a:${sigA.length} b:${sigB.length}`);
  check("sig-request-shape", sigB[0]?.from === "peer-a" && sigB[0]?.to === "peer-b"
    && !("want" in sigB[0]) && !("nickname" in sigB[0]));
  check("sig-piggyback", peerB.length === 1 && peerB[0].nickname === "갑" && peerB[0].peerId === "peer-a",
    `peerB:${peerB.length}`);
  sigA.length = 0; sigB.length = 0;
  b.accept("peer-a", "emote");
  await wait();
  check("sig-accept", sigA.length === 1 && sigA[0].kind === "accept" && sigA[0].want === "emote" && sigB.length === 0,
    `a:${sigA.length} b:${sigB.length}`);
  sigA.length = 0;
  b.decline("peer-a");
  await wait();
  check("sig-decline", sigA.length === 1 && sigA[0].kind === "decline" && !("want" in sigA[0]), `a:${sigA.length}`);
  sigA.length = 0;
  b.cancel("peer-a");
  await wait();
  check("sig-cancel", sigA.length === 1 && sigA[0].kind === "cancel", `a:${sigA.length}`);
  sigA.length = 0; sigB.length = 0;
  a.request("peer-nobody");
  b.request("peer-nobody");
  await wait();
  check("sig-nottome", sigA.length === 0 && sigB.length === 0, `a:${sigA.length} b:${sigB.length}`);
  const raw = new BroadcastChannel(T.PEER_CHANNEL);
  raw.postMessage({ tag: "oishi-peer", kind: "accept", from: "peer-b", to: "peer-a" });
  raw.postMessage({ tag: "oishi-peer", kind: "accept", from: "peer-b", to: "peer-a", want: "dance" });
  raw.postMessage({ tag: "oishi-peer", kind: "request", from: "peer-b", to: "peer-a", want: "emote" });
  raw.postMessage({ tag: "oishi-peer", kind: "poke", from: "peer-b", to: "peer-a" });
  raw.postMessage({ tag: "oishi-peer", kind: "request", from: "", to: "peer-a" });
  raw.postMessage({ tag: "nope", kind: "request", from: "peer-b", to: "peer-a" });
  await wait();
  check("sig-invalid", sigA.length === 0 && sigB.length === 0, `a:${sigA.length} b:${sigB.length}`);
  offSigA();
  b.decline("peer-a");
  await wait();
  check("sig-off", sigA.length === 0, `a:${sigA.length}`);
  a.close(); b.close(); raw.close();
  check("peerid-format", /^[0-9a-f]{8}$/.test(T.randomPeerId()));
  check("peerid-unique", T.randomPeerId() !== T.randomPeerId());
}
// 5. 연결 (소스 핀).
{
  const btn = readFileSync(join(ROOT, "components", "PeerEncounter.tsx"), "utf8");
  check("peer-no-title", !/title\s*=\s*["'{]/.test(btn));
  check("peer-uses-social", btn.includes("decideMeet") && btn.includes("ChannelTransport")
    && btn.includes("onSignal") && btn.includes(".request(") && btn.includes(".accept(")
    && btn.includes(".decline(") && btn.includes(".cancel(") && btn.includes("ACCEPT_WAIT_S"));
  check("peer-no-qr", !btn.includes("social/qr") && !btn.includes("encodeQr")
    && !btn.includes("PeerCode") && !btn.includes("data-peer-code"));
  check("peer-hud-post", btn.includes('kind: "meet"') && btn.includes('kind: "battle"')
    && btn.includes('kind: "ask"') && btn.includes("/api/hud"));
  const imports = [...btn.matchAll(/^import .* from "(.*)";/gm)].map((m) => m[1]);
  const ok = ["react", "@/lib/social/friends", "@/lib/social/decide", "@/lib/social/transport",
    "@/lib/battle/timer", "@/lib/slots", "@/lib/species", "@/lib/motion/emotes"];
  check("peer-no-new-lib", imports.every((s) => ok.includes(s)), imports.join(","));
  const hud = readFileSync(join(ROOT, "app", "hud", "page.tsx"), "utf8");
  check("hud-notice", hud.includes("/api/hud") && hud.includes("data-hud-notice")
    && hud.includes("<ResultScreen") && hud.includes("<BattleScreen"));
  check("hud-ask", hud.includes('"ask"'));
  const route = readFileSync(join(ROOT, "app", "api", "hud", "route.ts"), "utf8");
  check("route-ask", route.includes('"ask"'));
  const demo = readFileSync(join(ROOT, "app", "battle-demo", "page.tsx"), "utf8");
  check("demo-section", demo.includes("근처 트레이너") && demo.includes("<PeerCard"));
  const pov = readFileSync(join(ROOT, "app", "pov", "page.tsx"), "utf8");
  check("pov-mount", pov.includes("<PeerEncounter") && pov.includes("startBattle(p.speciesId)"));
  check("peer-session-nick", btn.includes("pf1.trainer") && btn.includes("currentTrainer"));
}

rmSync(BUILD, { recursive: true, force: true });
console.log(`\nverify-peer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
