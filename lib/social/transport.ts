// lib/social/transport.ts — PF-1b: 피어 전송층 (import 없음).
// shortcut: 같은 브라우저 탭 = 근처. 실기기는 BLE·위치 서버로 이 인터페이스만 교체.

/** 전송 페이로드. 위치·개인정보 없음. 별명·speciesId·level·peerId만. */
export type PeerBeacon = {
  peerId: string;
  nickname: string;
  speciesId: string;
  level: number;
};

export type SignalKind = "request" | "accept" | "decline" | "cancel";
export type MeetWant = "emote" | "battle";

/** 신청/수락/거절/취소. peerId 참조만 싣는다(신원은 announce 캐시에서 찾는다). */
export type PeerSignal = {
  kind: SignalKind;
  from: string;
  to: string;
  /** 수락에만: 받는 쪽 decide 결과. 양쪽이 같은 결과로 진행한다. */
  want?: MeetWant;
};

export interface PeerTransport {
  announce(me: PeerBeacon): void;
  onPeer(cb: (peer: PeerBeacon) => void): () => void;
  request(to: string): void;
  accept(to: string, want: MeetWant): void;
  decline(to: string): void;
  cancel(to: string): void;
  onSignal(cb: (sig: PeerSignal) => void): () => void;
  close(): void;
}

export const PEER_CHANNEL = "oishi-peer-1";
const PEER_TAG = "oishi-peer";

/** 8자리 16진 피어 ID. */
export function randomPeerId(): string {
  try {
    const g = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
    if (g) {
      const b = new Uint8Array(4);
      g(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* ignore */
  }
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
}

function validBeacon(m: unknown): boolean {
  if (!m || typeof m !== "object") return false;
  const w = m as Record<string, unknown>;
  return (
    w.tag === PEER_TAG &&
    (w.kind === undefined || w.kind === "announce") &&
    typeof w.peerId === "string" && w.peerId.length > 0 && w.peerId.length <= 64 &&
    typeof w.nickname === "string" && w.nickname.length > 0 && w.nickname.length <= 24 &&
    typeof w.speciesId === "string" && w.speciesId.length > 0 && w.speciesId.length <= 32 &&
    typeof w.level === "number" && Number.isInteger(w.level) && w.level >= 1 && w.level <= 999
  );
}

function validSignal(m: unknown): m is { kind: SignalKind; from: string; to: string; want?: unknown } {
  if (!m || typeof m !== "object") return false;
  const w = m as Record<string, unknown>;
  if (w.tag !== PEER_TAG) return false;
  if (w.kind !== "request" && w.kind !== "accept" && w.kind !== "decline" && w.kind !== "cancel") return false;
  if (typeof w.from !== "string" || w.from.length === 0 || w.from.length > 64) return false;
  if (typeof w.to !== "string" || w.to.length === 0 || w.to.length > 64) return false;
  if (w.kind === "accept") return w.want === "emote" || w.want === "battle";
  return w.want === undefined;
}

/** BroadcastChannel 구현 1개. 미지원 환경이면 조용히 비활성(인터페이스는 유지). */
export class ChannelTransport implements PeerTransport {
  private ch: BroadcastChannel | null = null;
  private me: PeerBeacon;

  constructor(me: PeerBeacon) {
    this.me = { ...me };
    try {
      if (typeof globalThis.BroadcastChannel !== "undefined") {
        this.ch = new globalThis.BroadcastChannel(PEER_CHANNEL);
      }
    } catch {
      this.ch = null;
    }
  }

  announce(me: PeerBeacon): void {
    if (!this.ch) return;
    try {
      this.ch.postMessage({ tag: PEER_TAG, kind: "announce", ...me });
    } catch {
      /* ignore */
    }
  }

  private signal(kind: SignalKind, to: string, want?: MeetWant): void {
    if (!this.ch) return;
    try {
      // 신호 앞에 알림을 같이 싣는다: 받는 쪽이 신원을 모르더라도 카드에 쓸 수 있다.
      this.ch.postMessage({ tag: PEER_TAG, kind: "announce", ...this.me });
      const m: Record<string, unknown> = { tag: PEER_TAG, kind, from: this.me.peerId, to };
      if (want !== undefined) m.want = want;
      this.ch.postMessage(m);
    } catch {
      /* ignore */
    }
  }

  request(to: string): void {
    this.signal("request", to);
  }

  accept(to: string, want: MeetWant): void {
    this.signal("accept", to, want);
  }

  decline(to: string): void {
    this.signal("decline", to);
  }

  cancel(to: string): void {
    this.signal("cancel", to);
  }

  onPeer(cb: (peer: PeerBeacon) => void): () => void {
    if (!this.ch) return () => {};
    const onMsg = (ev: MessageEvent) => {
      if (!validBeacon(ev.data)) return;
      const b = ev.data as PeerBeacon;
      if (b.peerId === this.me.peerId) return;
      cb({ peerId: b.peerId, nickname: b.nickname, speciesId: b.speciesId, level: b.level });
    };
    try {
      this.ch.addEventListener("message", onMsg);
    } catch {
      return () => {};
    }
    return () => {
      try {
        this.ch?.removeEventListener("message", onMsg);
      } catch {
        /* ignore */
      }
    };
  }

  onSignal(cb: (sig: PeerSignal) => void): () => void {
    if (!this.ch) return () => {};
    const onMsg = (ev: MessageEvent) => {
      if (!validSignal(ev.data)) return;
      const s = ev.data as { kind: SignalKind; from: string; to: string; want?: MeetWant };
      if (s.to !== this.me.peerId || s.from === this.me.peerId) return;
      cb(s.kind === "accept" ? { kind: s.kind, from: s.from, to: s.to, want: s.want } : { kind: s.kind, from: s.from, to: s.to });
    };
    try {
      this.ch.addEventListener("message", onMsg);
    } catch {
      return () => {};
    }
    return () => {
      try {
        this.ch?.removeEventListener("message", onMsg);
      } catch {
        /* ignore */
      }
    };
  }

  close(): void {
    try {
      this.ch?.close();
    } catch {
      /* ignore */
    }
    this.ch = null;
  }
}
