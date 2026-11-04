"use client";
import nextDynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DexHandle } from "@/components/DexScene";
import DanceCompare, { type DanceTick } from "@/components/DanceCompare";
import { ROSTER } from "@/lib/species";
import { ELEMENT_LABEL } from "@/lib/battle/skills";
import { loadSeen, loadStatus, type Status } from "@/lib/state";
import { ensureStarter } from "@/lib/starter";
import { fetchStatus } from "@/lib/status/client";
import { danceTier } from "@/lib/exp";
import { playCry, preloadCries } from "@/lib/cry";
import { startBgm } from "@/lib/bgm";
import { BOTTOM_BTN_H, BOTTOM_SIDE } from "@/lib/layout";
import { hintFor } from "@/lib/encounter/hints";
import { startStatusHeartbeat } from "@/lib/status/heartbeat";
import { battleStats, loadBoosts } from "@/lib/stats";
import { sanitizeBoosts } from "@/lib/status/statpoints";


const DexScene = nextDynamic(() => import("@/components/DexScene"), { ssr: false });

// localStorage 기반 도감: 절대 정적 캐시하지 않는다.
export const dynamic = "force-dynamic";

const PARTNER_KEY = "snapquest_active_partner";
const LEGACY_PARTNER_KEY = "oishie-partner";

// 한글 종성 판별: 받침 있으면 true (와/과·을/를 분기용).
function hasJong(s: string): boolean {
  if (!s) return false;
  const c = s.charCodeAt(s.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}

export default function DexPage() {
  const dexRef = useRef<DexHandle>(null);
  // 7-3 10번: 썸네일 띠 드래그 스크롤 (마우스 전용. 터치는 네이티브 스와이프).
  const stripRef = useRef<HTMLDivElement | null>(null);
  const stripDrag = useRef({ down: false, dragging: false, startX: 0, startScroll: 0, lastX: 0, vel: 0, moved: 0, raf: 0, pointerId: 0 });
  const stripClickBlock = useRef(false);
  // pointerdown에서는 좌표만 기록한다 (캡처·preventDefault 금지: 탭 클릭이 버튼에 전달되어야 함).
  function onStripPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    stripClickBlock.current = false;
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    cancelAnimationFrame(stripDrag.current.raf);
    stripDrag.current = { down: true, dragging: false, startX: e.clientX, startScroll: stripRef.current?.scrollLeft ?? 0, lastX: e.clientX, vel: 0, moved: 0, raf: 0, pointerId: e.pointerId };
  }
  function onStripPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = stripDrag.current;
    if (!d.down) return;
    const el = stripRef.current;
    if (!el) return;
    d.vel = e.clientX - d.lastX;
    d.lastX = e.clientX;
    d.moved = Math.max(d.moved, Math.abs(e.clientX - d.startX));
    // 가로 6px 초과 시점에 드래그 모드로 전환하고 그때 캡처한다.
    if (!d.dragging && d.moved > 6) {
      d.dragging = true;
      stripClickBlock.current = true;
      try {
        el.setPointerCapture(d.pointerId);
      } catch {
        /* ignore */
      }
    }
    if (d.dragging) el.scrollLeft = d.startScroll - (e.clientX - d.startX);
  }
  function endStripDrag() {
    const d = stripDrag.current;
    if (!d.down) return;
    d.down = false;
    if (!d.dragging) return;
    const el = stripRef.current;
    if (!el) return;
    let v = -d.vel;
    const step = () => {
      v *= 0.94;
      if (Math.abs(v) < 0.5) return;
      el.scrollLeft += v;
      d.raf = requestAnimationFrame(step);
    };
    if (Math.abs(v) > 0.5) d.raf = requestAnimationFrame(step);
  }
  const [loaded, setLoaded] = useState(false);
  const [captured, setCaptured] = useState<string[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 8-H-0: compare window follows DexScene dance ticks (ref: no re-render).
  const danceTick = useRef<DanceTick>({ id: null, beat: 0 });
  const [danceId, setDanceId] = useState<string | null>(null);
  // 8-H-0b: video basis is the SELECTED creature; ignore other dancers' ticks.
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const onDanceTick = useCallback((id: string | null, beat: number, speciesId?: string) => {
    if (speciesId !== undefined && speciesId !== selectedIdRef.current) return;
    danceTick.current = { id, beat };
    setDanceId((prev) => (prev === id ? prev : id));
  }, []);
  useEffect(() => {
    danceTick.current = { id: null, beat: 0 };
    setDanceId(null);
  }, [selectedId]);
  // R-B: ?select=<id> 딥링크 (headless 스냅샷용. 하이드레이션 뒤에 적용).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("select");
      if (q && ROSTER.some((r) => r.id === q)) setSelectedId(q);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    loadSt(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  const [, setScene] = useState("dex-loading");
  const [st, setSt] = useState<Status | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const [activePartnerId, setActivePartnerId] = useState<string>("fire-01");
  const stReq = useRef(0);
  // PC-1: 선택 크리처 값으로 읽는다. 마지막 요청만 반영(경합 방지).
  function loadSt(id?: string) {
    const my = ++stReq.current;
    fetchStatus(id)
      .then((st) => {
        if (stReq.current === my) setSt(st);
      })
      .catch(() => {
        if (stReq.current === my) setSt(loadStatus());
      });
  }


  useEffect(() => {
    ensureStarter(); // ST-1: 첫 실행 스타터 지급 (도감 읽기 전)
    try {
      const raw = localStorage.getItem("snapquest-dex");
      const arr = (raw ? JSON.parse(raw) : []) as Array<{ id?: string; name?: string; image?: string; element?: string }>;
      const names = arr.map((d) => d.name).filter(Boolean);
      setCaptured(ROSTER.filter((sp) => names.includes(sp.name)).map((sp) => sp.id));
      // §5 대표 파트너: 저장값 > 도감 선두 > 스타터 순 (camp와 동일 규격).
      const saved = localStorage.getItem(PARTNER_KEY) ?? localStorage.getItem(LEGACY_PARTNER_KEY);
      if (saved && ROSTER.some((r) => r.id === saved)) {
        setActivePartnerId(saved);
      } else {
        const firstId =
          arr.map((d) => d.id).find((x) => x && ROSTER.some((r) => r.id === x)) ??
          ROSTER.find((sp) => sp.name === arr[0]?.name)?.id ??
          "fire-01";
        setActivePartnerId(firstId);
      }
    } catch {
      /* ignore */
    }
    setSeen(loadSeen());
    loadSt();
    setLoaded(true);
    startBgm();
    preloadCries(ROSTER.map((s) => s.id));
    // D4-3: 접속 하트비트 (1분마다 tick).
    return startStatusHeartbeat();
  }, []);

  // BFCache 복원 시 강제 리로드: 뒤로가기로 옛 화면이 나오지 않게.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // 선택 즉시 울음소리 자동 재생 (발견/포획된 경우).
  useEffect(() => {
    if (!selectedId) return;
    const target = ROSTER.find((s) => s.id === selectedId);
    if (!target) return;
    if (captured.includes(target.id) || seen.includes(target.id)) {
      playCry(target.id, "meet");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 선택 썸네일이 띠 안에 보이게 스크롤.
  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`thumb-${selectedId}`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selectedId]);

  const sp = ROSTER.find((s) => s.id === selectedId) ?? null;
  const spCaptured = sp != null && captured.includes(sp.id);
  const spSeen = sp != null && (spCaptured || seen.includes(sp.id));
  const activePartner = ROSTER.find((s) => s.id === activePartnerId) ?? ROSTER[0];
  const isPartner = sp != null && spCaptured && sp.id === activePartner.id;

  // 항목 7 규격: 토스트는 ✕ 버튼과 5초 자동 숨김을 갖는다 (단일 타이머).
  function showFeedback(msg: string) {
    setFeedback(msg);
    if (feedbackTimer.current != null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 5000);
  }

  // §5 대표 파트너 즉시 교체: AR 강제 이동 없이 교체+카드 갱신+토스트.
  function replacePartner() {
    if (!sp || !spCaptured) return;
    try {
      localStorage.setItem(PARTNER_KEY, sp.id);
      // 대표 크리처를 맨 앞으로: 기존 선두가 확실히 교체된다.
      const raw = localStorage.getItem("snapquest-dex");
      const arr = (raw ? JSON.parse(raw) : []) as Array<{ id?: string; name?: string; image?: string; element?: string }>;
      const i = arr.findIndex((d) => d.id === sp.id || (d.name && d.name === sp.name));
      if (i > 0) {
        const [head] = arr.splice(i, 1);
        arr.unshift(head);
      } else if (i === -1) {
        arr.unshift({ id: sp.id, name: sp.name, image: sp.image, element: sp.element });
      }
      localStorage.setItem("snapquest-dex", JSON.stringify(arr));
    } catch {
      /* ignore */
    }
    setActivePartnerId(sp.id);
    showFeedback(`대표 파트너가 ${sp.name}으로 변경되었습니다`);
    // PC-1: 서버 대표도 바꾼다.
    try {
      void fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: sp.id }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="screen-root" style={{ position: "fixed", top: 0, left: 0, right: 0, overflow: "hidden", background: "#10140f", color: "#fff", display: "flex", flexDirection: "column" }}>
      <style>{`
        .dex-strip { scrollbar-width: none; -ms-overflow-style: none; }
        .dex-strip::-webkit-scrollbar { display: none; }
        .dex-info { scrollbar-width: thin; scrollbar-color: rgba(0,242,254,0.45) transparent; }
        .dex-info::-webkit-scrollbar { width: 4px; }
        .dex-info::-webkit-scrollbar-track { background: transparent; }
        .dex-info::-webkit-scrollbar-thumb { background: rgba(0,242,254,0.45); border-radius: 999px; }
        .dex-info::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
      `}</style>
      {/* 3D 무대: 화면 높이의 60% (7-3 19번) */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }} /* DX-1: 남는 높이는 무대가 */>
        {loaded && (
          <DexScene
            ref={dexRef}
            captured={captured}
            seen={seen}
            onSelect={setSelectedId}
            onStatus={setScene}
            activeId={selectedId}
            stageTier={danceTier(st?.level ?? 1)}
            onDanceTick={onDanceTick}
          />
        )}
        <DanceCompare tickRef={danceTick} danceId={danceId} caption={sp ? (spSeen ? sp.name : "???") : null} />
      </div>

      {/* 상단에는 아무것도 두지 않는다 (7-3 9번) */}
      {feedback && (
        <div className="glass-toast" style={{ position: "absolute", top: 56, left: 12, right: 12, textAlign: "center", zIndex: 40 }}>
          {feedback}
        </div>
      )}

      {/* 크리처 썸네일 띠: 무대 아래 상시 표시, 가로 스크롤 (스크롤바 숨김) */}
      <div style={{ flexShrink: 0, padding: "8px 12px 0" }}>
        <div style={{ position: "relative" }}>
          <div
            className="dex-strip"
            tabIndex={0}
            ref={stripRef}
            onPointerDown={onStripPointerDown}
            onPointerMove={onStripPointerMove}
            onPointerUp={endStripDrag}
            onPointerCancel={endStripDrag}
            onClickCapture={(e) => {
              if (stripClickBlock.current) {
                stripClickBlock.current = false;
                e.stopPropagation();
                e.preventDefault();
              }
            }}
            style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, touchAction: "pan-x pan-y", cursor: "grab" }}
          >
            {ROSTER.map((s) => {
            const cap = captured.includes(s.id);
            const sn = cap || seen.includes(s.id);
            const sel = s.id === selectedId;
            return (
              <button
                key={s.id}
                id={`thumb-${s.id}`}
                onClick={() => setSelectedId(s.id)}
                aria-label={sn ? s.name : "미발견"}
                style={{
                  flexShrink: 0, width: 60, height: 68, borderRadius: 10, overflow: "hidden",
                  border: sel ? "2px solid #9fe870" : "1px solid rgba(255,255,255,0.2)",
                  background: "#0c120e", cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {sn && s.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image} alt={s.name} draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", filter: cap ? "none" : "grayscale(1) brightness(0.6)", pointerEvents: "none" }} />
                ) : (
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#64748b" }}>?</span>
                )}
              </button>
            );
            })}
          </div>
          <div style={{ position: "absolute", top: 0, bottom: 4, left: 0, width: 24, background: "linear-gradient(to right, rgba(16,20,15,0.9), transparent)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: 0, bottom: 4, right: 0, width: 24, background: "linear-gradient(to left, rgba(16,20,15,0.9), transparent)", pointerEvents: "none" }} />
        </div>
      </div>

      {/* 기본 정보: 이름·종·감정 목록 + 포획분 Lv·스탯 읽기 전용 (§11-4) */}
      {/* DX-1: 패널+버튼 한 컨테이너 (같은 폭·좌우 끝 일치). 패널은 내용 높이, 넘치면 내부 스크롤. */}
      <div style={{ flexShrink: 0, padding: "12px 12px 0" }}>
        {sp ? (
          <div className="dex-info" style={{ background: "rgba(0,0,0,0.65)", borderRadius: 10, padding: "12px 14px", maxHeight: "34vh", overflowY: "auto", scrollbarGutter: "stable" }}>
            <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ flex: "1 1 auto", minWidth: 0 }} /* DX-1: 말줄임 없이 줄바꿈 */>
                {spSeen ? sp.name : "???"} ({ELEMENT_LABEL[sp.element]})
              </span>
              {isPartner && (
                <span className="glass-chip" style={{ flexShrink: 0, height: 20, fontSize: 11, lineHeight: 1, whiteSpace: "nowrap", padding: "0 8px", boxSizing: "border-box", display: "inline-flex", alignItems: "center", borderColor: "rgba(0, 242, 254, 0.55)", color: "#d9fbff" }}>
                  현재 동행 중인 파트너
                </span>
              )}
            </div>
            <div style={{ fontSize: 13 }}>
              {spCaptured ? sp.flavor : spSeen ? "발견됨 — AR 필드 탐험에서 포획하세요." : "미발견 — AR 필드 탐험에서 마주치면 등록됩니다."}
            </div>
            {spSeen && (
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                감정 표현: 기쁨 · 먹이 · 산책 · 낮잠 · 인사 · 공격 · 아픔
              </div>
            )}
            {spCaptured && st && (() => {
              const lv = Math.max(1, st.level ?? 1);
              const remote = st as typeof st & { statBoosts?: { atk: number; hp: number; def: number; spd: number } };
              const b = remote.statBoosts ? sanitizeBoosts(remote.statBoosts) : loadBoosts(sp.id);
              const bs = battleStats(sp.id, lv, b, { fullness: st.fullness ?? 0, affection: st.affection ?? 0 });
              return (
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                  {lv}레벨 · HP {bs.hp} · ATK {bs.atk} · DEF {bs.def} · SPD {bs.spd}
                </div>
              );
            })()}
            {!spSeen && (
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                힌트: {hintFor(sp.id)}
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.7, textAlign: "center", padding: "24px 0" }}>
            위의 띠에서 크리처를 고르세요
          </div>
        )}
      {/* 하단 고정 버튼 2개 (DX-1: 패널 바로 아래 12px, 같은 폭) */}
      <div id="bottom-bar" className="bottom-bar-pad" style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={replacePartner}
          disabled={!sp || !spCaptured || isPartner}
          className="hud-btn"
          style={{ flex: 1, minWidth: 0, height: BOTTOM_BTN_H, fontSize: 14, whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.25 }}
        >
          파트너로 지정
        </button>
        <button
          onClick={() => {
            window.location.href = "/pov?mode=cam";
          }}
          className="hud-btn hud-btn-primary"
          style={{ flex: 1, minWidth: 0, height: BOTTOM_BTN_H, fontSize: 14, whiteSpace: "normal", wordBreak: "keep-all", lineHeight: 1.25 }}
        >
          {activePartner.name}{hasJong(activePartner.name) ? "과" : "와"} AR 탐험 출발
        </button>
      </div>
      </div>
    </div>
  );
}
