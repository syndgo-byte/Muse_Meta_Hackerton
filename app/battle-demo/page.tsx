// app/battle-demo/page.tsx — G2 배틀 부품 시연 (?battlefx=demo, ?scene=, ?hold=1).
"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BattleEvent } from "@/lib/battle/engine";
import { BODY_SLAM, ELEMENT_SKILLS, ROLE_SKILLS } from "@/lib/battle/skills";
import { UNIQUES } from "@/lib/battle/roster";
import BattleStage, { type FighterView } from "@/components/battle/BattleStage";
import SkillModal from "@/components/battle/SkillModal";
import Waiting, { type ConnState } from "@/components/battle/Waiting";
import SnapCapture from "@/components/battle/SnapCapture";
import ReleaseFx from "@/components/battle/ReleaseFx";
import { RIVAL_SNAPSHOTS } from "@/lib/encounter/snapshots";
import type { MoveView } from "@/components/battle/SkillButtons";
import { PeerCard, postHudNotice } from "@/components/PeerEncounter";
import { applyTurn, createBattle, PASS_SLOT, type BattleState } from "@/lib/battle/engine";
import { MAX_DOUBLE_PASS, TURN_S } from "@/lib/battle/timer";
import { addFriend, isFriend, rate, ratingOf, removeFriend } from "@/lib/social/friends";
import { decideMeet } from "@/lib/social/decide";
import type { PeerBeacon } from "@/lib/social/transport";
import { speciesOf } from "@/lib/battle/roster";

type Scene = "normal" | "super" | "good" | "crit" | "weak" | "miss" | "buff" | "status";

const MOVES: MoveView[] = [BODY_SLAM, ELEMENT_SKILLS.fire, ROLE_SKILLS.attacker, UNIQUES["fire-01"]].map(
  (m, i) => ({ name: m.name, element: m.element, cdLeft: i === 3 ? 2 : 0, disabled: false })
);

const BASE_MINE: FighterView = {
  id: "fire-01", name: "모카퐁", level: 10, hp: 95, maxHp: 95, element: "fire", status: null, stages: {}, resists: {},
};
const BASE_WILD: FighterView = {
  id: "grass-04", name: "잔디멍", level: 10, hp: 120, maxHp: 120, element: "grass", status: null, stages: {}, resists: {},
};

function sceneState(scene: Scene): { events: BattleEvent[]; mine: FighterView; wild: FighterView } {
  const mine = { ...BASE_MINE, stages: { ...BASE_MINE.stages }, resists: { ...BASE_MINE.resists } };
  const wild = { ...BASE_WILD, stages: { ...BASE_WILD.stages }, resists: { ...BASE_WILD.resists } };
  if (scene === "normal") {
    wild.hp = 100;
    return {
      events: [{ type: "damage", target: "wild", value: 20, element: "none", crit: false, effect: "normal" }],
      mine, wild,
    };
  }
  if (scene === "super") {
    wild.hp = 43;
    return {
      events: [
        { type: "damage", target: "wild", value: 32, element: "fire", crit: false, effect: "good" },
        { type: "damage", target: "wild", value: 45, element: "fire", crit: true, effect: "good" },
      ],
      mine, wild,
    };
  }
  if (scene === "good") {
    wild.hp = 68;
    return {
      events: [
        { type: "damage", target: "wild", value: 32, element: "fire", crit: false, effect: "good" },
      ],
      mine, wild,
    };
  }
  if (scene === "crit") {
    wild.hp = 55;
    return {
      events: [
        { type: "damage", target: "wild", value: 45, element: "fire", crit: true, effect: "normal" },
      ],
      mine, wild,
    };
  }
  if (scene === "weak") {
    wild.hp = 88;
    return {
      events: [
        { type: "damage", target: "wild", value: 12, element: "fire", crit: false, effect: "bad" },
      ],
      mine, wild,
    };
  }
  if (scene === "miss") {
    return {
      events: [
        { type: "miss", target: "wild", reason: "dodge" },
      ],
      mine, wild,
    };
  }
  if (scene === "buff") {
    mine.stages = { ATK: 1 };
    mine.resists = { fire: 2 };
    wild.stages = { DEF: -1 };
    return {
      events: [
        { type: "stage", target: "mine", stat: "ATK", delta: 1 },
        { type: "stage", target: "wild", stat: "DEF", delta: -1 },
        { type: "resist", target: "mine", element: "fire", delta: 2 },
      ],
      mine, wild,
    };
  }
  wild.status = "burn";
  wild.hp = 114;
  return {
    events: [
      { type: "status-apply", target: "wild", status: "burn" },
      { type: "status-tick", target: "wild", status: "burn", value: 6 },
    ],
    mine, wild,
  };
}

const SCENES: Scene[] = ["normal", "super", "good", "crit", "weak", "miss", "buff", "status"];
const SCENE_LABEL: Record<Scene, string> = { normal: "보통", super: "약점+치명타 겹침", good: "약점 공략", crit: "치명타", weak: "버팀", miss: "빗나감", buff: "버프·디버프", status: "상태 이상" };

// PF-1: 시연용 상대 5명을 피어로. 별명·speciesId·level만 쓴다.
const DEMO_PEERS: PeerBeacon[] = RIVAL_SNAPSHOTS.map((r, i) => ({
  peerId: `demo-peer-${i}`,
  nickname: r.nickname,
  speciesId: r.speciesId,
  level: r.level,
}));

// BT-T: PvP 양쪽 패스 → 시간 종료 판정 시연. 실제 엔진으로 돌린다.
function PvpTimeoutSim() {
  const [sim, setSim] = useState<BattleState>(() => createBattle("fire-01", "grass-04"));
  const [msg, setMsg] = useState("양쪽 패스를 3번 누르면 시간 종료 판정");
  const step = (mine: number, wild: number) => {
    if (sim.over) return;
    const r = applyTurn(sim, mine, wild, () => 0.999);
    setSim(r.state);
    setMsg(r.logs.join(" ") || `턴 ${r.state.turn}`);
  };
  const result = !sim.over
    ? null
    : sim.winner === null
      ? "timeDraw"
      : sim.winner === "mine" && (sim.doublePass ?? 0) >= MAX_DOUBLE_PASS
        ? "timeWin"
        : sim.winner === "mine" ? "won" : "lost";
  return (
    <div data-pvp-sim="1" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13 }}>
        턴 {sim.turn} · 양쪽 패스 {sim.doublePass ?? 0}/{MAX_DOUBLE_PASS} ·
        나 {sim.mine.hp}/{sim.mine.maxHp} · 상대 {sim.wild.hp}/{sim.wild.maxHp}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => step(PASS_SLOT, PASS_SLOT)} disabled={sim.over} className="glass-btn" style={{ fontSize: 12 }}>
          양쪽 패스
        </button>
        <button onClick={() => step(0, PASS_SLOT)} disabled={sim.over} className="glass-btn" style={{ fontSize: 12 }}>
          나만 행동
        </button>
        <button
          onClick={() => {
            setSim(createBattle("fire-01", "grass-04"));
            setMsg("양쪽 패스를 3번 누르면 시간 종료 판정");
          }}
          className="glass-btn"
          style={{ fontSize: 12 }}
        >
          리셋
        </button>
      </div>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{msg}</div>
      {result && (
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }} data-pvp-verdict="1">
          {result === "timeWin" ? "시간 종료 — 판정승"
            : result === "timeDraw" ? "시간 종료 — 무승부"
            : result === "won" ? "승리" : "패배"}
        </div>
      )}
    </div>
  );
}

function DemoInner() {
  const q = useSearchParams();
  const demo = q.get("battlefx") === "demo";
  const hold = q.get("hold") === "1";
  const initial = (q.get("scene") as Scene) || "normal";
  const [scene, setScene] = useState<Scene>(SCENES.includes(initial) ? initial : "normal");
  const [fxKey, setFxKey] = useState(1);
  const [mine, setMine] = useState<FighterView>(BASE_MINE);
  const [wild, setWild] = useState<FighterView>(BASE_WILD);
  const [events, setEvents] = useState<BattleEvent[]>([]);
  const [locked, setLocked] = useState(false);
  const [distance] = useState(0); // 9-F: m 단위 (스테퍼 없음, 표시만)
  const [fled, setFled] = useState(false);
  const [modal, setModal] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [round, setRound] = useState(1);
  const [conn, setConn] = useState<ConnState>("online");
  const [stickers, setStickers] = useState<string[]>([]);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const captureFirst = q.get("scene") === "capture";
  // PF-1: 근처 트레이너 시연. 아무도 안 건드렸을 때만 1회 심는다(2친구·1저평가·2모름).
  const [peerTick, setPeerTick] = useState(0);
  const [peerMsg, setPeerMsg] = useState<string | null>(null);
  useEffect(() => {
    const ids = DEMO_PEERS.map((p) => p.peerId);
    const touched = ids.some((id) => isFriend(id) || ratingOf(id) !== null);
    if (!touched) {
      const d0 = DEMO_PEERS[0];
      const d1 = DEMO_PEERS[1];
      const d2 = DEMO_PEERS[2];
      if (d0 && d1 && d2) {
        addFriend(d0.peerId, d0.nickname);
        addFriend(d1.peerId, d1.nickname);
        rate(d2.peerId, 1);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function peerRefOf(peer: PeerBeacon) {
    return {
      peerId: peer.peerId,
      isFriend: isFriend(peer.peerId),
      rating: ratingOf(peer.peerId),
      lastMetAt: null,
    };
  }

  function peerBattle(peer: PeerBeacon) {
    let element = BASE_WILD.element;
    let name = peer.speciesId;
    try {
      const meta = speciesOf(peer.speciesId);
      element = meta.element;
      name = meta.name;
    } catch {
      /* 알 수 없으면 기본값 유지 */
    }
    setWild({ id: peer.speciesId, name, level: peer.level, hp: 100, maxHp: 100, element, status: null, stages: {}, resists: {} });
    setPeerMsg(`${peer.nickname}와 배틀! (시연 진입)`);
    void postHudNotice({ kind: "battle", text: `${peer.nickname}와 배틀`, me: mine.id, foe: peer.speciesId });
    fire("normal");
  }

  function fire(s: Scene) {
    const st = sceneState(s);
    setScene(s);
    setMine(st.mine);
    setWild(st.wild);
    setEvents(st.events);
    setFxKey((k) => k + 1);
    setLocked(true);
    window.setTimeout(() => setLocked(false), 600);
  }

  useEffect(() => {
    if (demo) fire(SCENES.includes(initial) ? initial : "normal");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [waiting]);

  if (!demo) {
    return (
      <main style={{ color: "#fff", padding: 32, fontSize: 15 }}>
        배틀 연출 시연 페이지입니다.{" "}
        <a href="/battle-demo?battlefx=demo" style={{ color: "#7cc7ff" }}>
          ?battlefx=demo로 열기
        </a>
      </main>
    );
  }

  return (
    <main style={{ color: "#fff", padding: "24px 16px 48px", maxWidth: 680, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>G2 배틀 부품 시연</h1>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
        장면: {SCENE_LABEL[scene]} · 다음 턴 {locked ? "잠김(0.6초)" : "가능"}
      </div>
      <BattleStage
        mine={mine}
        wild={wild}
        events={events}
        fxKey={fxKey}
        moves={MOVES}
        onPickMove={(i) => setPicked(`기술 ${i + 1} 선택: ${MOVES[i].name}`)}
        movesDisabled={locked}
        distance={distance}
        fled={fled}
        onFlee={() => setFled(true)}
        hold={hold}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        {SCENES.map((s) => (
          <button key={s} onClick={() => fire(s)} disabled={locked} className="glass-btn" style={{ fontSize: 13 }}>
            {SCENE_LABEL[s]}
          </button>
        ))}
      </div>
      <button
        onClick={() => fire(SCENES[(SCENES.indexOf(scene) + 1) % SCENES.length])}
        disabled={locked}
        className="glass-btn"
        style={{ width: "100%", fontSize: 14, marginTop: 8 }}
      >
        다음 턴
      </button>
      {picked && <div style={{ fontSize: 13, marginTop: 8 }}>{picked}</div>}

      <h2 style={{ fontSize: 17, margin: "24px 0 8px" }}>스킬 창 (§13-1)</h2>
      <button onClick={() => setModal(true)} className="glass-btn" style={{ fontSize: 13 }}>
        스킬 창 열기
      </button>
      <SkillModal
        open={modal}
        moves={MOVES}
        onPick={(i) => {
          setPicked(`스킬 창 선택: ${MOVES[i].name}`);
          setModal(false);
        }}
        onClose={() => setModal(false)}
      />

      <h2 style={{ fontSize: 17, margin: "24px 0 8px" }}>네트워크 대기 (§14)</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {(["online", "weak", "offline"] as ConnState[]).map((c) => (
          <button
            key={c}
            onClick={() => setConn(c)}
            className="glass-btn"
            style={{ fontSize: 12, ...(conn === c ? { borderColor: "#9fe870" } : {}) }}
          >
            {c}
          </button>
        ))}
        <button
          onClick={() => {
            setWaiting(true);
            setElapsed(0);
            setRound(1);
          }}
          className="glass-btn"
          style={{ fontSize: 12 }}
        >
          대기 시작
        </button>
      </div>
      <Waiting
        active={waiting}
        elapsed={elapsed}
        round={round}
        conn={conn}
        onRetry={() => {
          setRound((r) => r + 1);
          setElapsed(0);
        }}
        onSolo={() => {
          setWaiting(false);
          setPicked("혼자 대결 (AI 상대) 시작");
        }}
        onCancel={() => setWaiting(false)}
        onAcceptTimeout={() => {
          setWaiting(false);
          setPicked("수락 시간 초과 — 자동 취소");
        }}
      />

      <h2 style={{ fontSize: 17, margin: "24px 0 8px" }}>G4 포획·놓아주기 (§16)</h2>
      <SnapCapture
        speciesId="grass-04"
        objectName="공원"
        hpRatio={Math.max(0, wild.hp / wild.maxHp)}
        fullness={80}
        auto={captureFirst}
        onDone={(caught) => {
          if (caught) {
            setStickers((s) => [...s, "grass-04"]);
            setCaptureMsg("포획 성공! 도감 등록 + EXP 20");
          } else {
            setCaptureMsg("3회 실패 — 야생 크리처가 떠났다. EXP 0");
          }
        }}
      />
      <div style={{ marginTop: 12 }}>
        <ReleaseFx onDone={() => setCaptureMsg("놓아주기 완료! EXP 40 (도감 등록 없음)")} />
      </div>
      {captureMsg && <div style={{ fontSize: 13, marginTop: 8 }}>{captureMsg}</div>}

      <h2 style={{ fontSize: 17, margin: "24px 0 8px" }}>시연용 상대 스냅샷 5 (§15-3)</h2>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>서버 없음 · 개인정보 없음 · 별명+크리처 정보만</div>
      {RIVAL_SNAPSHOTS.map((r) => (
        <div key={r.nickname} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <span>{r.nickname} · {r.speciesId} · {r.level}레벨</span>
          <span style={{ opacity: 0.6, fontSize: 11 }}>{r.note}</span>
        </div>
      ))}

      <h2 style={{ fontSize: 17, margin: "24px 0 8px" }}>근처 트레이너 (PF-1 시연)</h2>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
        시연용 상대 5명 · 친구·평점에 따라 같이 표현 / 배틀 / 무시 세 갈래
      </div>
      <div data-peer-tick={peerTick} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {DEMO_PEERS.map((peer) => (
          <PeerCard
            key={peer.peerId}
            peer={peer}
            decision={decideMeet(peerRefOf(peer), Date.now())}
            friend={isFriend(peer.peerId)}
            stars={ratingOf(peer.peerId) ?? 0}
            onFriendToggle={() => {
              if (isFriend(peer.peerId)) removeFriend(peer.peerId);
              else addFriend(peer.peerId, peer.nickname);
              setPeerTick((t) => t + 1);
            }}
            onRate={(n) => {
              rate(peer.peerId, n);
              setPeerTick((t) => t + 1);
            }}
            onEmote={() => {
              setPeerMsg(`${peer.nickname}와 같이 인사! (greet→happy)`);
              void postHudNotice({ kind: "meet", text: `친구 "${peer.nickname}" 만남`, me: mine.id, foe: peer.speciesId });
            }}
            onBattle={() => peerBattle(peer)}
          />
        ))}
      </div>
      {peerMsg && <div style={{ fontSize: 13, marginTop: 8 }}>{peerMsg}</div>}

      <h2 style={{ fontSize: 17, margin: "24px 0 8px" }}>PvP 시간 종료 시연 (BT-T)</h2>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
        턴 {TURN_S}초 초과=패스, 양쪽 패스 {MAX_DOUBLE_PASS}연속=판정. 엔진 직접 구동
        (양쪽 화면 시간은 호스트 기준, 시연은 같은 시계).
      </div>
      <PvpTimeoutSim />

      <h2 style={{ fontSize: 17, margin: "24px 0 8px" }}>스티커북 (시연) {stickers.length}장</h2>
      {stickers.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>포획에 성공하면 카드가 1장 붙는다.</div>
      ) : (
        stickers.map((id, i) => (
          <div key={i} style={{ fontSize: 13, padding: "4px 0" }}>▣ {id} 포획 카드</div>
        ))
      )}
    </main>
  );
}

export default function BattleDemoPage() {
  return (
    <Suspense>
      <DemoInner />
    </Suspense>
  );
}
