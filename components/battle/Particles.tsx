// components/battle/Particles.tsx — 캔버스 입자 (§10-1: 60개 상한, rAF, resize 대응).
"use client";

import { useEffect, useRef } from "react";
import type { FxBurst, FxSide } from "./fx";

const MAX_PARTICLES = 60;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

// BP-2: 블렌더 투사체 스프라이트 (2D 캔버스에 회전+펄스로 그림. 외부 3D 없이 static-no3d 유지).
const PROJ_ELEMENTS = ["fire", "grass", "rock", "wind", "water"] as const;
const PROJ_SET: ReadonlySet<string> = new Set(PROJ_ELEMENTS);
const PROJ_FLIGHT_MS = 350;
const PROJ_SIZE = 44;
const projImgCache = new Map<string, HTMLImageElement>();
const projImgFailed = new Set<string>();
function projImage(element: string | undefined): HTMLImageElement | null {
  if (!element || !PROJ_SET.has(element) || projImgFailed.has(element)) return null;
  if (typeof Image === "undefined") return null;
  let img = projImgCache.get(element);
  if (!img) {
    img = new Image();
    img.onerror = () => { projImgFailed.add(element); };
    img.src = `/models/projectiles/proj_${element}.png`;
    projImgCache.set(element, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

interface Proj {
  img: HTMLImageElement;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  start: number;
  dur: number;
  color: string;
}

// J-2 발사체 분리 렌더. 아래 3 함수는 모양별 스폰 전담 (기존 랜덤 스폰과 분리).
//
// J-1 SWAP POINT: Blender 모델(J-1)이 들어오면 spawnProjectile의 몸통만 교체한다.
// 시그니처(sx/sy 출발·tx/ty 도착·color·calm)와 타이밍(약 200ms 비행)은 유지하고,
// 입자 push 대신 모델 투사체를 그린다. fx.ts의 kind=ranged → shape=fireball 배선은 그대로 둔다.
// BP-2: 몸통 교체 완료 — 스프라이트 모델 + 350ms 비행. 파일이 없으면 기존 입자로 폴백.
function spawnProjectile(ps: P[], sx: number, sy: number, tx: number, ty: number, color: string, calm: boolean, element?: string): void {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;
  const legacy = (sp: number) => {
    // 중심 밝은 코어 3개.
    for (let i = 0; i < 3; i++) {
      const life = 14 + Math.floor(Math.random() * 6);
      ps.push({
        x: sx + (Math.random() - 0.5) * 8,
        y: sy + (Math.random() - 0.5) * 8,
        vx: ux * sp * (1 + (Math.random() - 0.5) * 0.1),
        vy: uy * sp * (1 + (Math.random() - 0.5) * 0.1),
        life,
        maxLife: life,
        color: "#fff8e1",
        size: 5 + Math.random() * 2,
      });
    }
  };
  const tail = (sp: number, lifeBase: number) => {
    // 꼬리 11개: 진행 반대 방향으로 길게, 뒤로 갈수록 작게.
    for (let i = 0; i < 11; i++) {
      const back = (i + 1) * (dist / 16);
      const life = lifeBase + Math.floor(Math.random() * 10);
      ps.push({
        x: sx - ux * back + (Math.random() - 0.5) * 12,
        y: sy - uy * back + (Math.random() - 0.5) * 12,
        vx: ux * sp * (0.95 + Math.random() * 0.1),
        vy: uy * sp * (0.95 + Math.random() * 0.1),
        life,
        maxLife: life,
        color,
        size: Math.max(1.5, 4 - i * 0.25),
      });
    }
  };
  const img = projImage(element);
  const slow = calm ? 0.12 : 1;
  if (img) {
    try {
      const w = window as unknown as { __bp2sprite?: number };
      w.__bp2sprite = (w.__bp2sprite ?? 0) + 1;
    } catch {
      /* ignore */
    }
    projFlight.push({
      img, sx, sy, tx, ty,
      start: (typeof performance !== "undefined" ? performance.now() : Date.now()),
      dur: PROJ_FLIGHT_MS / slow,
      color,
    });
    tail((dist / 21) * slow, 24); // 350ms 비행에 맞춘 꼬리
    return;
  }
  // 폴백: 기존 입자 (약 200ms).
  legacy((dist / 12) * slow);
  tail((dist / 12) * slow, 20);
}

// BP-2: 비행 중 투사체 (모듈 공용 — Particles 마운트 전 스폰 대비).
const projFlight: Proj[] = [];

// J-2 콩콩 들이받기 돌진: 빠르고 촘촘한 줄기 (왕복은 2버스트로).
function spawnLunge(ps: P[], sx: number, sy: number, tx: number, ty: number, color: string, calm: boolean): void {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const sp = (dist / 6) * (calm ? 0.12 : 1); // 약 100ms 돌진
  for (let i = 0; i < 8; i++) {
    const life = 12 + Math.floor(Math.random() * 6);
    ps.push({
      x: sx + (Math.random() - 0.5) * 16,
      y: sy + (Math.random() - 0.5) * 12,
      vx: (dx / dist) * sp * (1 + (Math.random() - 0.5) * 0.15),
      vy: (dy / dist) * sp * (1 + (Math.random() - 0.5) * 0.15),
      life,
      maxLife: life,
      color,
      size: 3 + Math.random() * 2,
    });
  }
}

// J-2 버프/디버프 링: 원형 대형으로 솟거나(위) 가라앉는다(아래).
function spawnRing(ps: P[], cx: number, cy: number, color: string, up: boolean, calm: boolean): void {
  const vy = (up ? -1.4 : 1.4) * (calm ? 0.12 : 1);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 52 + (Math.random() - 0.5) * 8;
    const life = 30 + Math.floor(Math.random() * 12);
    ps.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r * 0.55,
      vx: Math.cos(a) * 0.4,
      vy: vy + Math.sin(a) * 0.2,
      life,
      maxLife: life,
      color,
      size: 2 + Math.random() * 1.5,
    });
  }
}

export default function Particles({ bursts, burstKey, hold }: { bursts: FxBurst[]; burstKey: number; hold?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ps = useRef<P[]>([]);
  const timers = useRef<number[]>([]);
  const holdRef = useRef(hold ?? false);
  holdRef.current = hold ?? false;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.floor(r.width));
      cv.height = Math.max(1, Math.floor(r.height));
    };
    resize();
    window.addEventListener("resize", resize);
    // BP-2: 투사체 스프라이트 예열 (첫 발사부터 모델로).
    for (const el of PROJ_ELEMENTS) projImage(el);
    let raf = 0;
    let lastNow = typeof performance !== "undefined" ? performance.now() : Date.now();
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      // BP-3 히트스톱: hold면 위치·수명 고정 (그리기는 계속).
      if (!holdRef.current) {
        ps.current = ps.current.filter((p) => p.life > 0);
        for (const p of ps.current) {
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 1;
        }
      }
      for (const p of ps.current) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      // BP-2: 비행 중 투사체 스프라이트 (회전 + 크기 펄스 + 발광). hold면 동결.
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (holdRef.current) {
        for (const f of projFlight) f.start += now - lastNow;
      }
      lastNow = now;
      for (let i = projFlight.length - 1; i >= 0; i--) {
        const f = projFlight[i];
        const k = (now - f.start) / Math.max(1, f.dur);
        if (k >= 1) {
          projFlight.splice(i, 1);
          continue;
        }
        const x = f.sx + (f.tx - f.sx) * k;
        const y = f.sy + (f.ty - f.sy) * k;
        const pulse = 1 + 0.12 * Math.sin(k * Math.PI * 3);
        const size = PROJ_SIZE * pulse;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(k * Math.PI * 4);
        ctx.shadowColor = f.color;
        ctx.shadowBlur = 18;
        ctx.drawImage(f.img, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const anchor = (side: FxSide, w: number, h: number): [number, number] =>
      side === "wild" ? [w * 0.68, h * 0.22] : [w * 0.32, h * 0.72];
    const calm = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const b of bursts) {
      const id = window.setTimeout(() => {
        const w = cv.width || 300;
        const h = cv.height || 300;
        const [tx, ty] = anchor(b.side, w, h);
        const [sx, sy] = anchor(b.from ?? b.side, w, h);
        // J-2: 모양 버스트는 분리 렌더 (기존 경로 무변경).
        if (b.shape === "fireball") {
          spawnProjectile(ps.current, sx, sy, tx, ty, b.color, calm, b.element);
          while (ps.current.length > MAX_PARTICLES) ps.current.shift();
          return;
        }
        if (b.shape === "lunge") {
          spawnLunge(ps.current, sx, sy, tx, ty, b.color, calm);
          while (ps.current.length > MAX_PARTICLES) ps.current.shift();
          return;
        }
        if (b.shape === "ring-up" || b.shape === "ring-down") {
          spawnRing(ps.current, tx, ty, b.color, b.shape === "ring-up", calm);
          while (ps.current.length > MAX_PARTICLES) ps.current.shift();
          return;
        }
        const aimed = b.from !== undefined && b.from !== b.side;
        for (let i = 0; i < b.count; i++) {
          let vx: number;
          let vy: number;
          let px = sx + (Math.random() - 0.5) * 60;
          let py = sy + (Math.random() - 0.5) * 40;
          if (aimed) {
            // 9-E: 때린 쪽에서 맞아주는 쪽으로 날아간다.
            const dx = tx - sx;
            const dy = ty - sy;
            const dist = Math.max(1, Math.hypot(dx, dy));
            const sp = dist / 26;
            vx = (dx / dist) * sp * (1 + (Math.random() - 0.5) * 0.25);
            vy = (dy / dist) * sp * (1 + (Math.random() - 0.5) * 0.25);
            px = sx + (Math.random() - 0.5) * 20;
            py = sy + (Math.random() - 0.5) * 16;
          } else {
            const ang =
              b.dir === "up"
                ? -Math.PI / 2 + (Math.random() - 0.5) * 1.2
                : b.dir === "down"
                  ? Math.PI / 2 + (Math.random() - 0.5) * 1.2
                  : Math.random() * Math.PI * 2;
            const sp = 0.8 + Math.random() * 2.2;
            vx = Math.cos(ang) * sp;
            vy = Math.sin(ang) * sp;
          }
          ps.current.push({
            x: px,
            y: py,
            vx,
            vy,
            life: 24 + Math.floor(Math.random() * 18),
            maxLife: 42,
            color: b.color,
            size: 2 + Math.random() * 3,
          });
        }
        while (ps.current.length > MAX_PARTICLES) ps.current.shift();
      }, b.delayMs);
      timers.current.push(id);
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
