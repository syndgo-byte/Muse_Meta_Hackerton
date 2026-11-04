// components/battle/ScanReveal.tsx — UI-2 조우 연출 (자체 제작).
// VF-3: 물체 중심을 찍는 작은 조준 표시 (얇은 꺾쇠 4개+중앙 점, 안쪽 완전 투명, 캡션 아래).
// AR 현실 스캔이므로 카메라 영상을 가리는 채우기·덮개 전부 없음.
// 루실라 참고 뷰파인더(원형 조임) → "Scanned: <coco>" → "이 물건에서 <종>이 나왔다" → 등장.
// 타이머 자동 진행 후 onDone (뒤에 ??? 카드+배틀/도망이 뜬다).
// VF-4 추적: 1eurofilter (https://github.com/casiez/OneEuroFilter, BSD-3-Clause).
"use client";

import { useEffect, useRef, useState } from "react";
import { OneEuroFilter } from "1eurofilter";
import { hasJong, josa } from "../../lib/josa";

// UH-1: 받침 판별은 lib/josa 하나로 통일 (기존 import 깨짐 방지용 재export).
export { hasJong };

const FINDER_MS = 1100;
const SCANNED_MS = 900;
const FOUND_MS = 1300;

// SR-1: 감지 박스 (0~1 정규화, lastDetsRef 값을 그대로). null이면 작은 틀.
export interface RevealBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// VF-3 크기 규칙 (파일 상단 한 곳): 조준 표시는 박스의 45%, 72~140px로 고정.
const VF_RATIO = 0.45; // 박스 대비 뷰파인더 비율
const VF_MIN = 72; // 뷰파인더 최소 px
const VF_MAX = 140; // 뷰파인더 최대 px
const VF_NULL = 96; // box 없을 때 크기 px
const VF_NULL_Y = 0.4; // box 없을 때 세로 위치 (시선 높이)
const VF_LINE = "2px solid rgba(111,243,255,0.85)"; // 얇은 시안 꺾쇠
const VF_SHADOW = "drop-shadow(0 1px 2px rgba(0,0,0,0.8))"; // 가독성용 얇은 그림자 1개
const VF_ARM = 22; // 꺾쇠 팔 길이 px

// VF-4 대상 고르기·가변 사각 (파일 상단 한 곳). 스캔 1회 동안 대상 1개 고정.
const VF4_MARGIN = 0.1; // 박스 여백 10%
const VF4_MAX_SHORT = 0.55; // 최대 = 짧은 변의 55%
const VF4_EDGE = 0.02; // 화면 가장자리 잘림 판정 (정규화 2%)
const VF4_DANGER = ["person", "bicycle", "car", "motorcycle", "bus", "truck"]; // 위험 라벨 제외
const VF4_FREQ = 60; // 1eurofilter 추정 주파수 Hz (rAF)
const VF4_MIN_CUT = 1.0; // 1eurofilter minCutoff (OSS_FIRST 표 값)
const VF4_BETA = 0.01; // 1eurofilter beta (OSS_FIRST 표 값)
const VF4_FINDING = "스캔할 물건을 찾는 중…"; // 대상 없음 캡션

// SCAN-2: 물체 부착 회전 뷰파인더 + 진행 원 (파일 상단 한 곳).
const SCAN2_DWELL_MS = 1500; // 진행 원을 채우는 유지 시간
const SCAN2_DECAY_MS = 3000; // 화면 밖·끊김 시 줄어드는 시간
const SCAN2_HOLD_MS = 500; // 감지 끊김 유지
const SCAN2_RING_S = 1.2; // 바깥 점선 고리 회전 주기(초)
const SCAN2_RING_PAD = 12; // 박스 밖 고리 여백 px
const SCAN2_PROG_R = 10; // 가운데 진행 원 반지름 px
const SCAN2_NO_TARGET = "주변 물건을 비춰 보세요"; // 대상 없음 아래 한 줄
const SCAN2_MAX_WAIT_MS = 5000; // 진행 없이도 넘어가는 최대 대기
const SCAN2_PROG_C = 2 * Math.PI * SCAN2_PROG_R; // 진행 원 둘레

// SCAN-2: 차분 모드 (BP-3과 같은 판정). 회전만 멈추고 진행 원은 유지.
function scan2Calm(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// 박스 중심·크기로 뷰파인더 배치. 화면 밖으로 나가지 않게 클램프.
// VF-3: box 없음 = "물체를 찾는 중" 작은 틀 (96px, 시선 높이 40%).
export function placeViewfinder(
  box: RevealBox | null,
  vw: number,
  vh: number,
): { cx: number; cy: number; size: number } {
  if (!box) return { cx: vw / 2, cy: vh * VF_NULL_Y, size: VF_NULL };
  const w = Math.max(0, box.x1 - box.x0) * vw;
  const h = Math.max(0, box.y1 - box.y0) * vh;
  const size = Math.min(Math.max(Math.max(w, h) * VF_RATIO, VF_MIN), VF_MAX);
  const cx = Math.min(Math.max(((box.x0 + box.x1) / 2) * vw, size / 2), vw - size / 2);
  // 세로: 뷰파인더가 화면보다 클 수 없으므로(고정 상한) vh와 비교해 가드.
  const cy = size >= vh ? vh / 2 : Math.min(Math.max(((box.y0 + box.y1) / 2) * vh, size / 2), vh - size / 2);
  return { cx, cy, size };
}

// VF-4: 스캔 대상 1개 고르기 (sim·cam 공통). 매핑 라벨 최고점, 없으면 점수×면적 최대.
// 위험 라벨·가장자리 잘린 박스 제외. 스캔 1회 동안 결과 고정 (호출 쪽에서 1회만).
export interface ScanDet {
  label: string;
  score: number;
  box: RevealBox;
}

export function pickScanTarget(
  dets: ScanDet[],
  isMapped: (label: string) => boolean,
): { label: string; box: RevealBox } | null {
  const norm = (l: string) => (l || "").trim().toLowerCase();
  const mapped = dets.filter((d) => isMapped(d.label));
  if (mapped.length > 0) {
    let best = mapped[0];
    for (const d of mapped) if (d.score > best.score) best = d;
    return { label: norm(best.label), box: { ...best.box } };
  }
  const area = (b: RevealBox) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
  const cut = (b: RevealBox) =>
    b.x0 <= VF4_EDGE || b.y0 <= VF4_EDGE || b.x1 >= 1 - VF4_EDGE || b.y1 >= 1 - VF4_EDGE;
  let best: ScanDet | null = null;
  let bk = -1;
  for (const d of dets) {
    if (VF4_DANGER.includes(norm(d.label))) continue;
    if (cut(d.box)) continue;
    const k = d.score * area(d.box);
    if (k > bk) {
      bk = k;
      best = d;
    }
  }
  if (!best) return null;
  return { label: norm(best.label), box: { ...best.box } };
}

// VF-4: 박스 비율을 따르는 가변 사각 (여백 10%). 최소 72, 최대 짧은 변 55%. 없으면 null.
export function placeFinderRect(
  box: RevealBox | null,
  vw: number,
  vh: number,
): { cx: number; cy: number; w: number; h: number } | null {
  if (!box) return null;
  const maxS = Math.min(vw, vh) * VF4_MAX_SHORT;
  const w = Math.min(Math.max((box.x1 - box.x0) * vw * (1 + VF4_MARGIN), VF_MIN), maxS);
  const h = Math.min(Math.max((box.y1 - box.y0) * vh * (1 + VF4_MARGIN), VF_MIN), maxS);
  const cx = Math.min(Math.max(((box.x0 + box.x1) / 2) * vw, w / 2), vw - w / 2);
  const cy = h >= vh ? vh / 2 : Math.min(Math.max(((box.y0 + box.y1) / 2) * vh, h / 2), vh - h / 2);
  return { cx, cy, w, h };
}

// VF-2: 최근 감지 박스 (2초 이내만 유효).
export interface RecentBox {
  box: RevealBox;
  at: number;
}

export function freshBox(r: RecentBox | null, now: number): RevealBox | null {
  if (!r) return null;
  return now - r.at <= 2000 ? r.box : null;
}

const CORNERS: Array<{
  left?: number; top?: number; right?: number; bottom?: number;
  bl: boolean; bt: boolean;
}> = [
  { left: 0, top: 0, bl: true, bt: true },
  { right: 0, top: 0, bl: false, bt: true },
  { left: 0, bottom: 0, bl: true, bt: false },
  { right: 0, bottom: 0, bl: false, bt: false },
];

export default function ScanReveal({
  label,
  speciesName,
  box = null,
  element: _element = "none",
  getBox,
  hidden = false,
  simBox,
  onDone,
}: {
  label: string;
  speciesName: string;
  box?: RevealBox | null;
  element?: string;
  getBox?: () => RevealBox | null;
  hidden?: boolean;
  simBox?: () => boolean;
  onDone: () => void;
}) {
  void _element;
  const [phase, setPhase] = useState<"finder" | "scanned" | "found">("finder");
  // SCAN-2: finder→scanned는 진행 원(rAF)이 올린다. 이후 scanned→found→onDone은 기존 간격.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const doneTimersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers = doneTimersRef.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // VF-4: 실시간 박스 추적 (1eurofilter ×4: 중심 x·y·너비·높이, 감지 끊기면 마지막 자리 유지).
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const capRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<{ cx: number; cy: number; w: number; h: number } | null>(null);
  const euroRef = useRef<OneEuroFilter[] | null>(null);
  const getBoxRef = useRef(getBox);
  getBoxRef.current = getBox;
  const boxRef = useRef(box ?? null);
  boxRef.current = box ?? null;
  const [hasTarget, setHasTarget] = useState(box != null);
  const hasRef = useRef(hasTarget);
  // SCAN-2: 진행 원 상태 (rAF에서만 갱신, DOM 직접 반영).
  const mountRef = useRef(0);
  const prevTsRef = useRef(-1);
  const progRef = useRef(0);
  const lastSeenRef = useRef(-1e9);
  const ringSvgRef = useRef<SVGSVGElement | null>(null);
  const ringCircleRef = useRef<SVGCircleElement | null>(null);
  const progCircleRef = useRef<SVGCircleElement | null>(null);
  const simBoxRef = useRef(simBox);
  simBoxRef.current = simBox;
  const [simTag, setSimTag] = useState(false);
  const simRef = useRef(false);
  useEffect(() => {
    let raf = 0;
    // SCAN-2 리뷰 갈고리: ?scanhold=<0..1> 진행 원 고정·넘어감 정지 (캡처용, 없으면 동작 변화 없음).
    const holdQ = new URLSearchParams(window.location.search).get("scanhold");
    const holdVal = holdQ === null ? null : Math.min(1, Math.max(0, Number(holdQ)));
    const hold = holdVal !== null && !Number.isNaN(holdVal) ? holdVal : null;
    const advance = () => {
      if (phaseRef.current !== "finder") return;
      phaseRef.current = "scanned";
      setPhase("scanned");
      const t2 = window.setTimeout(() => {
        phaseRef.current = "found";
        setPhase("found");
      }, SCANNED_MS);
      const t3 = window.setTimeout(() => onDoneRef.current(), SCANNED_MS + FOUND_MS);
      doneTimersRef.current.push(t2, t3);
    };
    const step = (ts: number) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (mountRef.current === 0) mountRef.current = ts;
      const dt = prevTsRef.current < 0 ? 0.016 : Math.min(0.1, Math.max(0, (ts - prevTsRef.current) / 1000));
      prevTsRef.current = ts;
      const live = getBoxRef.current?.() ?? null;
      // SCAN-2: 화면 안 가시 판정 (정규화 중심이 화면 안).
      let vis = false;
      if (live) {
        const lcx = (live.x0 + live.x1) / 2;
        const lcy = (live.y0 + live.y1) / 2;
        vis = lcx >= 0 && lcx <= 1 && lcy >= 0 && lcy <= 1;
        if (vis) lastSeenRef.current = ts;
      }
      if (live) {
        const target = placeFinderRect(live, vw, vh);
        if (target) {
          if (!euroRef.current) {
            euroRef.current = [0, 1, 2, 3].map(() => new OneEuroFilter(VF4_FREQ, VF4_MIN_CUT, VF4_BETA, 1.0));
          }
          const [fx, fy, fw, fh] = euroRef.current;
          const t = ts / 1000;
          trackRef.current = {
            cx: fx.filter(target.cx, t),
            cy: fy.filter(target.cy, t),
            w: fw.filter(target.w, t),
            h: fh.filter(target.h, t),
          };
        }
      } else if (!trackRef.current) {
        trackRef.current = placeFinderRect(boxRef.current, vw, vh);
      }
      // SCAN-2: 진행 원 (유지 1.5s 충전·끊김 0.5s 유지·이후 3s 방전).
      if (phaseRef.current === "finder") {
        if (hold !== null) {
          progRef.current = hold;
        } else {
          if (vis) progRef.current = Math.min(1, progRef.current + (dt * 1000) / SCAN2_DWELL_MS);
          else if (ts - lastSeenRef.current > SCAN2_HOLD_MS) progRef.current = Math.max(0, progRef.current - (dt * 1000) / SCAN2_DECAY_MS);
          const elapsed = ts - mountRef.current;
          if (progRef.current >= 1 || elapsed > SCAN2_MAX_WAIT_MS || (trackRef.current === null && elapsed > FINDER_MS)) advance();
        }
      }
      const pc = progCircleRef.current;
      if (pc) pc.setAttribute("stroke-dashoffset", String(SCAN2_PROG_C * (1 - progRef.current)));
      const cur = trackRef.current;
      const ht = cur !== null;
      if (ht !== hasRef.current) {
        hasRef.current = ht;
        setHasTarget(ht);
      }
      if (cur) {
        const w = wrapRef.current;
        if (w) {
          w.style.left = `${cur.cx}px`;
          w.style.top = `${cur.cy}px`;
        }
        const f = frameRef.current;
        if (f) {
          f.style.width = `${cur.w}px`;
          f.style.height = `${cur.h}px`;
        }
        const c = capRef.current;
        if (c) {
          const capTop = Math.min(vh - 44, cur.cy + cur.h / 2 + 12);
          c.style.left = `${Math.min(Math.max(cur.cx, 90), vw - 90)}px`;
          c.style.top = `${capTop}px`;
        }
        // SCAN-2: 바깥 고리를 박스 크기에 맞춤.
        const rs = ringSvgRef.current;
        const rc = ringCircleRef.current;
        if (rs && rc) {
          const d = Math.max(cur.w, cur.h) + SCAN2_RING_PAD * 2;
          rs.setAttribute("width", String(d));
          rs.setAttribute("height", String(d));
          rc.setAttribute("cx", String(d / 2));
          rc.setAttribute("cy", String(d / 2));
          rc.setAttribute("r", String(d / 2 - 2));
        }
      }
      // SCAN-2: sim 가짜 박스 표시 여부.
      const sb = simBoxRef.current?.() ?? false;
      if (sb !== simRef.current) {
        simRef.current = sb;
        setSimTag(sb);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (hidden) return null;
  const speciesJosa = josa(speciesName, "이가"); // UH-1: 조사 함수 하나로 통일
  const vw = typeof window === "undefined" ? 390 : window.innerWidth;
  const vh = typeof window === "undefined" ? 844 : window.innerHeight;
  const pos = placeFinderRect(box ?? null, vw, vh);
  // SCAN-2: 대상 없을 땐 아래 한 줄만 (힌트 바는 페이지 유지).
  const noTarget = !hasTarget;
  const caption = noTarget
    ? SCAN2_NO_TARGET
    : phase === "finder" ? "스캔 중…" : phase === "scanned" ? `스캔 완료: ${label}` : `이 물건에서 ${speciesJosa} 나왔다`;
  const capTop = pos ? Math.min(vh - 44, pos.cy + pos.h / 2 + 10) : vh * VF_NULL_Y;
  const capCx = pos ? Math.min(Math.max(pos.cx, 90), vw - 90) : vw / 2;
  const calm = scan2Calm();
  const ringD = pos ? Math.max(pos.w, pos.h) + SCAN2_RING_PAD * 2 : 120;
  const ringSpin = phase === "finder" && !calm ? `scan2spin ${SCAN2_RING_S}s linear infinite` : "none";
  // AF-2/2: 3페이즈 색 구분 (브래킷은 시안 고정 — verify-scanreveal). 진행 링·원·중앙점만 페이즈색.
  const VF_ACCENT = phase === "found" ? "#ffd84a" : phase === "scanned" ? "#4ade80" : "#6ff3ff";
  return (
    <div
      data-testid="scan-reveal"
      data-phase={phase}
      style={{ position: "absolute", inset: 0, zIndex: 40, pointerEvents: "none", background: "transparent" }}
    >
      <style>{`@keyframes scan2spin { from { transform: translate(-50%,-50%) rotate(0deg); } to { transform: translate(-50%,-50%) rotate(360deg); } }`}</style>
      {hasTarget && (
      <div
        ref={wrapRef}
        style={{ position: "absolute", left: pos ? pos.cx : vw / 2, top: pos ? pos.cy : vh / 2, transform: "translate(-50%,-50%)" }}
      >
        {/* VF-3: 안쪽 완전 투명 — 채우기·덮개 없음. 얇은 꺾쇠 4개 + 중앙 점만. */}
        <div ref={frameRef} style={{ position: "relative", width: pos ? pos.w : 96, height: pos ? pos.h : 96 }} aria-hidden>
          {CORNERS.map((c, i) => (
            <div
              key={i}
              style={{
                position: "absolute", width: VF_ARM, height: VF_ARM,
                ...({ left: c.left, top: c.top, right: c.right, bottom: c.bottom } as object),
                borderLeft: c.bl ? VF_LINE : undefined,
                borderRight: !c.bl ? VF_LINE : undefined,
                borderTop: c.bt ? VF_LINE : undefined,
                borderBottom: !c.bt ? VF_LINE : undefined,
                filter: VF_SHADOW,
              }}
            />
          ))}
          {/* SCAN-2: 바깥 회전 점선 고리 (박스 크기 추종, 선만·채우기 없음). */}
          <svg
            ref={ringSvgRef}
            data-testid="scan2-ring"
            width={ringD}
            height={ringD}
            style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", animation: ringSpin, overflow: "visible" }}
          >
            <circle ref={ringCircleRef} cx={ringD / 2} cy={ringD / 2} r={ringD / 2 - 2} fill="none" stroke={VF_ACCENT} strokeOpacity={0.7} strokeWidth={2} strokeDasharray="6 5" />
          </svg>
          {/* SCAN-2: 가운데 작은 진행 원 (선만·채우기 없음). */}
          <svg
            data-testid="scan2-progress"
            width={28}
            height={28}
            style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", overflow: "visible" }}
          >
            <circle cx={14} cy={14} r={SCAN2_PROG_R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={2} />
            <circle ref={progCircleRef} cx={14} cy={14} r={SCAN2_PROG_R} fill="none" stroke={VF_ACCENT} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={SCAN2_PROG_C} strokeDashoffset={SCAN2_PROG_C} transform="rotate(-90 14 14)" />
          </svg>
          <div
            data-testid="vf-center-dot"
            style={{
              position: "absolute", left: "50%", top: "50%", width: 5, height: 5,
              borderRadius: "50%", background: VF_ACCENT,
              transform: "translate(-50%,-50%)", filter: VF_SHADOW,
            }}
          />
        </div>
        {/* SCAN-2: sim 가짜 박스 표시. */}
        {simTag && (
          <div
            data-testid="scan-sim-chip"
            style={{
              position: "absolute", left: "50%", bottom: "100%", transform: "translateX(-50%)",
              marginBottom: 6, fontSize: 10, fontWeight: 400, color: "rgba(111,243,255,0.9)",
              textShadow: "0 1px 3px rgba(0,0,0,0.9)", whiteSpace: "nowrap",
            }}
          >
            모의
          </div>
        )}
      </div>
      )}
      {/* VF-3: 캡션은 뷰파인더 아래 작은 글씨, 배경 상자 없이 텍스트 그림자만. */}
      {/* SCAN-2: 대상 없을 땐 아래 한 줄. */}
      <div
        ref={capRef}
        style={noTarget
          ? { position: "absolute", left: "50%", bottom: 118, transform: "translateX(-50%)" }
          : { position: "absolute", left: capCx, top: capTop, transform: "translateX(-50%)" }}
      >
        <div
          data-testid="scan-reveal-caption"
          aria-label={noTarget ? VF4_FINDING : undefined}
          style={{
            fontSize: 13, fontWeight: 400, color: "#fff", textAlign: "center",
            textShadow: "0 1px 3px rgba(0,0,0,0.9)", wordBreak: "keep-all",
            maxWidth: "min(72vw, 300px)",
          }}
        >
          {caption}
        </div>
      </div>
    </div>
  );
}
