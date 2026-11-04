// components/PeerEncounter.tsx — PF-1b: 근처 감지 → 만남 신청 → 수락/거절 → 표현/배틀.
// 휴대폰 역할: 인식(BroadcastChannel 시연)·판단·친구/평점을 여기서 한다.
// 결과·신청 알림은 /api/hud로 보내 레이벤(/hud 기존 결과·배틀 화면)이 보여준다.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addFriend,
  isFriend,
  lastMet,
  markMet,
  rate,
  ratingOf,
  removeFriend,
} from "@/lib/social/friends";
import { decideMeet, MEET_COOLDOWN_MS, MEET_EMOTES, type MeetDecision, type MeetEmote } from "@/lib/social/decide";
import { ChannelTransport, randomPeerId, type MeetWant, type PeerBeacon, type PeerSignal } from "@/lib/social/transport";
import { ACCEPT_WAIT_S } from "@/lib/battle/timer";
import { currentTrainer } from "@/lib/slots";
import { ROSTER } from "@/lib/species";
import { EMOTE_DUR } from "@/lib/motion/emotes";

const ANNOUNCE_MS = 5000;
const ASK_WAIT_MS = ACCEPT_WAIT_S * 1000;

function myPeerId(): string {
  try {
    const s = globalThis.sessionStorage;
    if (s) {
      const old = s.getItem("pf1.peerId");
      if (old) return old;
      const id = randomPeerId();
      s.setItem("pf1.peerId", id);
      return id;
    }
  } catch {
    /* ignore */
  }
  return randomPeerId();
}

function speciesName(id: string): string {
  return ROSTER.find((s) => s.id === id)?.name ?? id;
}

function speciesKnown(id: string): boolean {
  return ROSTER.some((s) => s.id === id);
}

/** 만남 결과·신청 알림을 /hud로 보낸다(E1 폴링). /battle-demo 시연 행과 공용. */
export async function postHudNotice(n: { kind: "meet" | "battle" | "ask"; text: string; me: string; foe: string }): Promise<void> {
  try {
    await fetch("/api/hud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(n),
    });
  } catch {
    /* hud 없어도 만남은 계속 */
  }
}

export type PeerCardProps = {
  peer: PeerBeacon;
  decision: MeetDecision;
  friend: boolean;
  /** 0 = 아직 없음, 1~5. */
  stars: number;
  onFriendToggle: () => void;
  onRate: (n: number) => void;
  onEmote: () => void;
  onBattle: () => void;
};

/** 만남 카드 (표시 전용. /battle-demo 시연 행과 공용). */
export function PeerCard(p: PeerCardProps) {
  return (
    <div className="glass-panel peer-card" role="dialog" aria-label="근처 트레이너">
      <div className="peer-title">
        근처 트레이너 {p.peer.nickname}의 {speciesName(p.peer.speciesId)}
      </div>
      <div className="peer-sub">
        {p.peer.level}레벨 · {p.decision === "emote" ? "같이 표현" : p.decision === "battle" ? "배틀 제안" : "무시됨"}
      </div>
      <div className="peer-row">
        <button type="button" className="hud-btn" onClick={p.onFriendToggle}>
          {p.friend ? "친구 해제" : "친구 추가"}
        </button>
        <span className="peer-stars" role="group" aria-label="평점">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={n <= p.stars ? "peer-star on" : "peer-star"}
              aria-label={`평점 ${n}점`}
              onClick={() => p.onRate(n)}
            >
              ★
            </button>
          ))}
        </span>
      </div>
      {p.decision === "emote" && (
        <button type="button" className="hud-btn hud-btn-primary peer-act" onClick={p.onEmote}>
          같이 감정 표현
        </button>
      )}
      {p.decision === "battle" && (
        <button type="button" className="hud-btn hud-btn-primary peer-act" onClick={p.onBattle}>
          배틀
        </button>
      )}
    </div>
  );
}

function FriendRow(p: { peerId: string; nickname: string; friend: boolean; stars: number; onToggle: () => void; onRate: (n: number) => void }) {
  return (
    <div className="peer-row">
      <button type="button" className="hud-btn" onClick={p.onToggle}>
        {p.friend ? "친구 해제" : "친구 추가"}
      </button>
      <span className="peer-stars" role="group" aria-label="평점">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={n <= p.stars ? "peer-star on" : "peer-star"}
            aria-label={`평점 ${n}점`}
            onClick={() => p.onRate(n)}
          >
            ★
          </button>
        ))}
      </span>
    </div>
  );
}

/** 근처 알림 + [만남 신청] (표시 전용). */
export function NoticeCard(p: {
  peer: PeerBeacon;
  friend: boolean;
  stars: number;
  canAsk: boolean;
  onFriendToggle: () => void;
  onRate: (n: number) => void;
  onRequest: () => void;
}) {
  return (
    <div className="glass-panel peer-card" role="dialog" aria-label="근처 트레이너">
      <div className="peer-title">
        근처 트레이너 {p.peer.nickname}의 {speciesName(p.peer.speciesId)}
      </div>
      <div className="peer-sub">{p.peer.level}레벨 · 근처에 있음</div>
      <FriendRow peerId={p.peer.peerId} nickname={p.peer.nickname} friend={p.friend} stars={p.stars} onToggle={p.onFriendToggle} onRate={p.onRate} />
      <button
        type="button"
        className="hud-btn hud-btn-primary peer-act"
        data-peer-request="1"
        disabled={!p.canAsk}
        onClick={p.onRequest}
      >
        {p.canAsk ? "만남 신청" : "잠시 후 신청 가능"}
      </button>
    </div>
  );
}

/** 신청 보냄 + 대기 + [취소] (표시 전용). */
export function OutWaitCard(p: { peer: PeerBeacon; onCancel: () => void }) {
  return (
    <div className="glass-panel peer-card" role="dialog" aria-label="만남 신청 중">
      <div className="peer-title">{p.peer.nickname}님에게 만남 신청</div>
      <div className="peer-sub">응답 대기 중… ({ACCEPT_WAIT_S}초 안에 답이 없으면 취소됨)</div>
      <button type="button" className="hud-btn peer-cancel" data-peer-cancel="1" onClick={p.onCancel}>
        취소
      </button>
    </div>
  );
}

/** 받은 신청 + [수락][거절] (표시 전용). */
export function AskedCard(p: { peer: PeerBeacon; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="glass-panel peer-card" role="dialog" aria-label="만남 신청 받음">
      <div className="peer-title">{p.peer.nickname}님이 만남 신청</div>
      <div className="peer-sub">
        {speciesName(p.peer.speciesId)} · {p.peer.level}레벨 · 받겠습니까?
      </div>
      <div className="peer-row">
        <button type="button" className="hud-btn hud-btn-primary peer-accept" data-peer-accept="1" onClick={p.onAccept}>
          수락
        </button>
        <button type="button" className="hud-btn peer-decline" data-peer-decline="1" onClick={p.onDecline}>
          거절
        </button>
      </div>
    </div>
  );
}

export type PeerEncounterProps = {
  /** 내 크리처. 없으면 /api/status에서 읽는다. */
  speciesId?: string;
  level?: number;
  /** 감정 표현 1동작. PeerEncounter가 greet→happy 순서로 두 번 부른다. */
  onEmote: (peer: PeerBeacon, emote: MeetEmote) => void;
  onBattle: (peer: PeerBeacon) => void;
  notice: (msg: string) => void;
};

type NoticeState = { peer: PeerBeacon } | null;
type OutState = { to: PeerBeacon } | null;
type AskedState = { from: PeerBeacon; want: MeetWant } | null;

export default function PeerEncounter({ speciesId, level, onEmote, onBattle, notice }: PeerEncounterProps) {
  const [me, setMe] = useState<PeerBeacon | null>(null);
  const [noticeState, setNoticeState] = useState<NoticeState>(null);
  const [out, setOut] = useState<OutState>(null);
  const [asked, setAsked] = useState<AskedState>(null);
  const noticeStateRef = useRef<NoticeState>(null);
  const outRef = useRef<OutState>(null);
  const askedRef = useRef<AskedState>(null);
  const meRef = useRef<PeerBeacon | null>(null);
  noticeStateRef.current = noticeState;
  outRef.current = out;
  askedRef.current = asked;
  meRef.current = me;
  const liveRef = useRef(true);
  const timers = useRef<number[]>([]);
  const heardRef = useRef(new Map<string, PeerBeacon>());
  const lastReqRef = useRef<Record<string, number>>({});
  const transportRef = useRef<ChannelTransport | null>(null);
  const outTimer = useRef(0);
  const askedTimer = useRef(0);
  const onEmoteRef = useRef(onEmote);
  const onBattleRef = useRef(onBattle);
  const noticeRef = useRef(notice);
  onEmoteRef.current = onEmote;
  onBattleRef.current = onBattle;
  noticeRef.current = notice;

  const peerId = useMemo(() => myPeerId(), []);
  const nickname = useMemo(() => {
    try {
      // 탭별 별명 우선(시연·멀티프로필, 리마운트에도 유지). 없으면 서버 트레이너명.
      const s = globalThis.sessionStorage?.getItem("pf1.trainer")?.trim().slice(0, 12);
      if (s) return s;
      const t = currentTrainer().trim().slice(0, 12);
      return t || "트레이너";
    } catch {
      return "트레이너";
    }
  }, []);

  // 내 비콘: props 우선, 없으면 서버 상태.
  useEffect(() => {
    liveRef.current = true;
    let dead = false;
    const done = (species: string, lv: number) => {
      if (!dead) setMe({ peerId, nickname, speciesId: species, level: lv });
    };
    if (speciesId && level !== undefined) {
      done(speciesId, level);
      return () => { dead = true; };
    }
    fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { speciesId?: unknown; level?: unknown } | null) => {
        const s = typeof j?.speciesId === "string" && speciesKnown(j.speciesId) ? j.speciesId : "fire-01";
        const lv = typeof j?.level === "number" && Number.isInteger(j.level) && j.level >= 1 ? j.level : 1;
        done(s, lv);
      })
      .catch(() => done("fire-01", 1));
    return () => { dead = true; };
  }, [peerId, nickname, speciesId, level]);

  const clearOut = useCallback(() => {
    if (outTimer.current) window.clearTimeout(outTimer.current);
    outTimer.current = 0;
    setOut(null);
  }, []);

  const clearAsked = useCallback(() => {
    if (askedTimer.current) window.clearTimeout(askedTimer.current);
    askedTimer.current = 0;
    setAsked(null);
  }, []);

  // setState 업데이터 안에서는 부수 효과 금지(렌더 경고·이중 실행). ref로 읽고 밖에서 실행한다.
  /** 성사된 만남 1건: 표현이면 greet→happy, 배틀이면 onBattle. 양쪽이 같은 want로 진행한다. */
  const meetWith = useCallback((peer: PeerBeacon, want: MeetWant) => {
    const m = meRef.current;
    if (!m) return;
    markMet(peer.peerId);
    if (want === "emote") {
      const gap = Math.round((EMOTE_DUR[MEET_EMOTES[0]] ?? 1.6) * 1000) + 100;
      onEmoteRef.current(peer, MEET_EMOTES[0]);
      timers.current.push(window.setTimeout(() => {
        if (liveRef.current) onEmoteRef.current(peer, MEET_EMOTES[1]);
      }, gap));
      void postHudNotice({ kind: "meet", text: `친구 "${peer.nickname}" 만남`, me: m.speciesId, foe: peer.speciesId });
      noticeRef.current(`${peer.nickname}와 같이 인사!`);
    } else {
      void postHudNotice({ kind: "battle", text: `${peer.nickname}와 배틀`, me: m.speciesId, foe: peer.speciesId });
      onBattleRef.current(peer);
    }
  }, []);

  /** 받은 신청 1건에 답한다. 쿨다운이면 조용히 거절, 아니면 카드를 띄운다. */
  const answerRequest = useCallback((fromId: string, beacon: PeerBeacon) => {
    const t = transportRef.current;
    const m = meRef.current;
    if (!t || !m) return;
    const d = decideMeet({
      peerId: fromId,
      isFriend: isFriend(fromId),
      rating: ratingOf(fromId),
      lastMetAt: lastMet(fromId),
    }, Date.now());
    if (d === "pass") {
      t.decline(fromId);
      return;
    }
    const want: MeetWant = d === "emote" ? "emote" : "battle";
    setAsked({ from: beacon, want });
    void postHudNotice({ kind: "ask", text: `${beacon.nickname}님이 신청`, me: m.speciesId, foe: beacon.speciesId });
    if (askedTimer.current) window.clearTimeout(askedTimer.current);
    askedTimer.current = window.setTimeout(() => {
      askedTimer.current = 0;
      if (askedRef.current?.from.peerId === fromId) {
        setAsked(null);
        noticeRef.current("신청 응답 시간 초과");
      }
    }, ASK_WAIT_MS);
    timers.current.push(askedTimer.current);
  }, []);

  const handleSignal = useCallback((sig: PeerSignal) => {
    const t = transportRef.current;
    const m = meRef.current;
    if (!t || !m) return;
    if (sig.kind === "request") {
      const beacon = heardRef.current.get(sig.from);
      if (!beacon) return;
      const mine = outRef.current;
      if (mine && mine.to.peerId === sig.from) {
        // 동시 신청: 작은 쪽이 신청자로 남고, 큰 쪽은 받는 쪽으로 전환한다.
        if (m.peerId < sig.from) return;
        if (outTimer.current) window.clearTimeout(outTimer.current);
        outTimer.current = 0;
        setOut(null);
        answerRequest(sig.from, beacon);
        return;
      }
      if (mine || askedRef.current) {
        t.decline(sig.from); // 이미 진행 중이면 거절
        return;
      }
      answerRequest(sig.from, beacon);
      return;
    }
    if (sig.kind === "accept") {
      const mine = outRef.current;
      if (!mine || mine.to.peerId !== sig.from) return;
      const peer = mine.to;
      clearOut();
      meetWith(peer, sig.want ?? "battle");
      return;
    }
    if (sig.kind === "decline") {
      const mine = outRef.current;
      if (!mine || mine.to.peerId !== sig.from) return;
      const peer = mine.to;
      clearOut();
      noticeRef.current(`${peer.nickname}님이 거절했어요`);
      return;
    }
    // cancel
    const inc = askedRef.current;
    if (!inc || inc.from.peerId !== sig.from) return;
    const peer = inc.from;
    clearAsked();
    noticeRef.current(`${peer.nickname}님이 신청을 취소했어요`);
  }, [answerRequest, clearAsked, clearOut, meetWith]);

  // 전송: 알림 + 신호. 같은 탭 메시지는 transport가 거른다.
  useEffect(() => {
    if (!me) return;
    const t = new ChannelTransport(me);
    transportRef.current = t;
    const hello = () => t.announce(me);
    hello();
    const iv = window.setInterval(hello, ANNOUNCE_MS);
    const offPeer = t.onPeer((peer) => {
      if (!liveRef.current) return;
      if (!speciesKnown(peer.speciesId)) return;
      // 받으면 알림으로 답하지 않는다(핑퐁 무한 루프 방지). 5초 주기 알림으로 발견된다.
      heardRef.current.set(peer.peerId, peer);
      setNoticeState({ peer });
    });
    const offSig = t.onSignal((sig) => {
      if (!liveRef.current) return;
      handleSignal(sig);
    });
    return () => {
      window.clearInterval(iv);
      offPeer();
      offSig();
      t.close();
      transportRef.current = null;
    };
  }, [me, handleSignal]);

  // 배틀 종료 복귀: pov가 배틀 중 HUD를 통째로 내리므로(9-A2) 리마운트 + 5초 알림으로
  // 자연 복원된다. 이벤트 리스너는 배틀 중에 언마운트라 받을 수 없어 두지 않는다.
  useEffect(() => () => {
    liveRef.current = false;
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const doRequest = useCallback(() => {
    const n = noticeStateRef.current;
    const m = meRef.current;
    const t = transportRef.current;
    if (!n || !m || !t || outRef.current || askedRef.current) return;
    const to = n.peer;
    const now = Date.now();
    const d = decideMeet({
      peerId: to.peerId,
      isFriend: isFriend(to.peerId),
      rating: ratingOf(to.peerId),
      lastMetAt: lastMet(to.peerId),
    }, now);
    const lastReq = lastReqRef.current[to.peerId] ?? 0;
    if (d === "pass" || now - lastReq < MEET_COOLDOWN_MS) {
      noticeRef.current("잠시 후 다시 신청할 수 있어요");
      return;
    }
    lastReqRef.current[to.peerId] = now;
    setOut({ to });
    t.request(to.peerId);
    if (outTimer.current) window.clearTimeout(outTimer.current);
    outTimer.current = window.setTimeout(() => {
      outTimer.current = 0;
      if (outRef.current?.to.peerId === to.peerId) {
        setOut(null);
        noticeRef.current("상대 응답 없음");
      }
    }, ASK_WAIT_MS);
    timers.current.push(outTimer.current);
  }, []);

  const doCancel = useCallback(() => {
    const mine = outRef.current;
    const t = transportRef.current;
    if (!mine || !t) return;
    t.cancel(mine.to.peerId);
    clearOut();
    noticeRef.current("신청을 취소했어요");
  }, [clearOut]);

  const doAccept = useCallback(() => {
    const inc = askedRef.current;
    const t = transportRef.current;
    if (!inc || !t) return;
    t.accept(inc.from.peerId, inc.want);
    const peer = inc.from;
    const want = inc.want;
    clearAsked();
    meetWith(peer, want);
  }, [clearAsked, meetWith]);

  const doDecline = useCallback(() => {
    const inc = askedRef.current;
    const t = transportRef.current;
    if (!inc || !t) return;
    t.decline(inc.from.peerId);
    clearAsked();
    noticeRef.current("만남 신청을 거절했어요");
  }, [clearAsked]);

  const toggleFriend = useCallback((peer: PeerBeacon) => {
    if (isFriend(peer.peerId)) removeFriend(peer.peerId);
    else addFriend(peer.peerId, peer.nickname);
    setNoticeState({ peer }); // 별점·버튼 다시 그리기
  }, []);

  const ratePeer = useCallback((peer: PeerBeacon, n: number) => {
    rate(peer.peerId, n);
    setNoticeState({ peer });
  }, []);

  const stateName = !me ? "idle" : asked ? "asked" : out ? "wait" : noticeState ? "notice" : "live";
  const shown = asked ? asked.from : out ? out.to : noticeState ? noticeState.peer : null;
  const friend = shown ? isFriend(shown.peerId) : false;
  const stars = shown ? (ratingOf(shown.peerId) ?? 0) : 0;
  const canAsk = noticeState ? decideMeet({
    peerId: noticeState.peer.peerId,
    isFriend: isFriend(noticeState.peer.peerId),
    rating: ratingOf(noticeState.peer.peerId),
    lastMetAt: lastMet(noticeState.peer.peerId),
  }, Date.now()) !== "pass" && Date.now() - (lastReqRef.current[noticeState.peer.peerId] ?? 0) >= MEET_COOLDOWN_MS : false;

  return (
    <div className="peer-wrap" data-peer-state={stateName}>
      {(asked || out || noticeState) && (
        <div className="peer-live-card">
          {asked && (
            <AskedCard peer={asked.from} onAccept={doAccept} onDecline={doDecline} />
          )}
          {!asked && out && (
            <OutWaitCard peer={out.to} onCancel={doCancel} />
          )}
          {!asked && !out && noticeState && shown && (
            <NoticeCard
              peer={noticeState.peer}
              friend={friend}
              stars={stars}
              canAsk={canAsk}
              onFriendToggle={() => toggleFriend(noticeState.peer)}
              onRate={(n) => ratePeer(noticeState.peer, n)}
              onRequest={doRequest}
            />
          )}
        </div>
      )}
    </div>
  );
}
