"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { rigObject, wrapRigid, type PuppetRig } from "@/lib/puppetRig";
import { attachFace, speciesHasMouth, FACE_PAINT_ENABLED, type FaceRig } from "@/lib/facePaint";
import { EmoteIcon, EMOTE_ICON } from "@/lib/emoteIcon";
import { attachFace3D, type Face3D } from "@/lib/face3d";
import { B_ARML, B_ARMR, B_HEAD, B_LEGL, B_LEGR, B_TORSO, buildAutoRig, neutralPose, poseFor, type AutoRig } from "@/lib/autoRig";
import { PoseBlender } from "@/lib/motion/blend";
import { a2o, dancePose } from "@/lib/motion/dances";
import {
  buildRiggedRig,
  loadBonesManifest,
  rigMode,
  riggedUrl,
  type RiggedRig,
} from "@/lib/riggedModel";
import { applyMissingBoneFallback, RIG_TAIL_EXTRA } from "@/lib/motion/rigRetarget";
import {
  EMOTE_DUR,
  emoteLocomotion,
  faceFor,
  type EmoteId,
} from "@/lib/motion/emotes";
// 5a: PARAM 종(fire-01)의 감정→파라미터 표. 그 외 종은 기존 경로.
import { faceParamsFor, PARAM_FACE_SPECIES } from "@/lib/motion/faces";
import { battleAttackMove, battleBounceY, battleLegCrouch, battleShootMove, battleYaw } from "@/lib/motion/battleMotion";
import { sfxChomp, sfxStep } from "@/lib/sfx";
import { CALM_ROAM_RANGE_SCALE } from "@/lib/calm";

export type PovElement = "fire" | "grass" | "water" | "rock" | "wind";
export type SimGround = "cafe" | "street" | "room";

// CC0 HDRI (Poly Haven): 시뮬레이터 포토리얼 배경 + IBL. 귀속: public/hdri/ATTRIBUTION.md
const HDRI: Record<SimGround, string> = {
  cafe: "/hdri/lebombo_1k.hdr",
  street: "/hdri/potsdamer_platz_1k.hdr",
  room: "/hdri/st_fagans_interior_1k.hdr",
};
export type Emote = EmoteId;

// 9-B 배틀 prop (CLI 3 9-A가 위치·크기 뒤 모션 연결에 사용).
export type BattleRole = "mine" | "wild";
export type BattleAction = "idle" | "attack" | "shoot" | "hurt" | "buff" | "faint";
export type BattleProp = { role: BattleRole; action: BattleAction };
// 액션→R-C 리그 emote 재사용 (faint만 9-B 신규).
const BATTLE_EMOTE: Record<BattleAction, Emote> = {
  idle: "idle", attack: "attack", shoot: "attack", hurt: "hurt", buff: "happy", faint: "faint",
};

// Palm-sized MR companion (§3): model height in world units (0.55~0.65 range).
// Camera reframed to match (z≈2.6); depth travel on ±Z shrinks naturally
// through the PerspectiveCamera — actor.scale never compensates distance.
const MODEL_H = 0.6;

// 7-3 20번: 깊이 이동 범위 (카메라 z=2.6 기준 화면 크기 약 0.35~1.2배).
export const DEPTH_NEAR = 0.4;
export const DEPTH_FAR = -4.8;

// 깊이 왕복: near → far (out초, 코사인 보간) → far에 dwell초 머무름 → near (back초).
// 순간이동 없음. emoteT 기준이라 감정이 바뀌면 처음부터 다시 간다.
export function depthExcursion(e: number, out: number, dwell: number, back: number, span = 1): number {
  const far = DEPTH_NEAR + (DEPTH_FAR - DEPTH_NEAR) * span;
  const cl = Math.max(0, e);
  if (cl < out) {
    const k = (1 - Math.cos((Math.PI * cl) / out)) / 2;
    return DEPTH_NEAR + (far - DEPTH_NEAR) * k;
  }
  if (cl < out + dwell) return far;
  const b = Math.min(cl - out - dwell, back);
  const k = (1 - Math.cos((Math.PI * b) / back)) / 2;
  return far + (DEPTH_NEAR - far) * k;
}

export type PovHandle = {
  capture: () => void;
  emote: (e: Emote) => void;
  // 무음 댄스: ATEEZ 케이던스 프로시저럴 루프. emote()/capture() 호출 시 자동 해제.
  // at: 촬영용 시작 위상(초). 생략 시 0.
  dance: (at?: number) => void;
  stopDance: () => void;
  // SNS 공유용 스냅샷 (WebGL 캔버스 PNG dataURL, 실패 시 null).
  snapshot: () => string | null;
  // 크리처 머리 위 화면 좌표 (말풍선 앵커용, 마운트 기준 px. 실패 시 null).
  headScreen: () => { x: number; y: number } | null;
};

const PALETTE: Record<PovElement, { glow: number }> = {
  fire: { glow: 0xff9a3c },
  grass: { glow: 0x9fe870 },
  water: { glow: 0x7cc7ff },
  rock: { glow: 0xffc46b },
  wind: { glow: 0xd6fff1 },
};

// 아트워크 폴백: Muse Image 초상화도, 스캔 카드도 없을 때 쓰는 스타터 도감 이미지.
const FALLBACK_ART: Record<PovElement, string> = {
  fire: "/dex/fire-01.jpg",
  grass: "/dex/grass-01.jpg",
  water: "/dex/water-01.jpg",
  rock: "/dex/rock-01.jpg",
  wind: "/dex/wind-01.jpg",
};

// 실측 .glb 폴백: 모델이 지정되지 않으면 원소 대표 파일을 쓴다.
const FALLBACK_MODEL: Record<PovElement, string> = {
  fire: "/models/fire-01.glb",
  grass: "/models/grass-01.glb",
  water: "/models/water-01.glb",
  rock: "/models/rock-01.glb",
  wind: "/models/wind-01.glb",
};

function radialSprite(inner: string, outer: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// AR 소환진: 동심원 + 눈금 + 십자 그리드를 캔버스에 직접 그린다.
function summonTexture(): THREE.Texture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const cx = S / 2, cy = S / 2;
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, 118, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, 104, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(cx, cy, 64, 0, Math.PI * 2); g.stroke();
  // 눈금
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r0 = i % 4 === 0 ? 104 : 110;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * 118, cy + Math.sin(a) * 118);
    g.stroke();
  }
  // 십자 그리드
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx - 118, cy); g.lineTo(cx + 118, cy);
  g.moveTo(cx, cy - 118); g.lineTo(cx, cy + 118);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 크리처 홀로그램 셰이더: 초록 배경 크로마키 컷아웃 + 실루엣 림라이트.
const HOLO_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HOLO_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uGlow;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uGlowStrength;
  varying vec2 vUv;

  float bgness(vec3 c) {
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float gDom = c.g - max(c.r, c.b);
    return smoothstep(0.03, 0.14, gDom) * (1.0 - smoothstep(0.25, 0.55, lum));
  }

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float bg = bgness(tex.rgb);
    float alpha = tex.a * (1.0 - bg) * uOpacity;
    if (alpha < 0.02) discard;

    // 이웃 4탭으로 실루엣 경계를 찾아 림라이트를 태운다.
    vec2 e = vec2(0.0045, 0.0045);
    float n = bgness(texture2D(uMap, vUv + vec2(e.x, 0.0)).rgb)
            + bgness(texture2D(uMap, vUv - vec2(e.x, 0.0)).rgb)
            + bgness(texture2D(uMap, vUv + vec2(0.0, e.y)).rgb)
            + bgness(texture2D(uMap, vUv - vec2(0.0, e.y)).rgb);
    float rim = clamp((n * 0.25 - bg) * 2.2, 0.0, 1.0);
    float pulse = 0.75 + 0.25 * sin(uTime * 3.2);

    vec3 col = tex.rgb;
    col += uGlow * rim * (1.4 * pulse * uGlowStrength);
    // 홀로그램 스캔라인: 은은한 수평 결 + 전체 광택 펄스
    col += uGlow * 0.05 * uGlowStrength * (0.5 + 0.5 * sin(vUv.y * 60.0 + uTime * 2.0));
    col += uGlow * 0.05 * uGlowStrength * pulse;

    gl_FragColor = vec4(col, alpha);
  }
`;

type HoloUniforms = {
  uMap: { value: THREE.Texture | null };
  uGlow: { value: THREE.Color };
  uTime: { value: number };
  uOpacity: { value: number };
  uGlowStrength: { value: number };
};

const PovCreature = forwardRef<PovHandle, {
  element: PovElement;
  // 실측 .glb (public/models/<roster-id>.glb). 없으면 원소 대표 파일로 폴백.
  modelUrl?: string | null;
  portraitUrl?: string | null;
  // 스캔 카드(초상화/도감 이미지): .glb 로드 실패 시 홀로그램 폴백의 소스.
  tintUrl?: string | null;
  // 표정 캘리브레이션용 종 id (예: fire-01). 생략 시 파일명에서 추정.
  speciesId?: string | null;
  // 시뮬레이터 바닥 (null이면 현실 카메라용 투명).
  ground?: SimGround | null;
  // 3-2: 1인칭 보행 영상이 뒤에 깔리면 HDRI 배경을 비워 영상이 비치게 한다 (IBL 조명은 유지).
  videoBg?: boolean;
  // next/dynamic은 ref를 전달하지 않으므로 핸들은 이 prop으로 받는다.
  handleRef?: React.RefObject<PovHandle> | null;
  // 7-3 20번 검증용: ?pose=near|far. 감정 호출을 무시하고 z를 고정한다. 없으면 기존 동작.
  poseLock?: "near" | "far" | null;
  onStatus?: (s: string) => void;
  // §2 컨디션: 탈진 이동속도 배율(0.5) + 주저앉음/반쯤 감은 눈+하품.
  speedMult?: number;
  drowsy?: boolean;
  // 7-C 같이 걷기: 화면 x(0~1) → 월드 x 부드럽게 이동. null이면 중앙 복귀.
  laneX?: number | null;
  // 7-C 같이 걷기: 걷기 루프(다리 스텝 + 등 돌림). dance와 동시 사용 금지.
  walking?: boolean;
  // 7-C 뒤돌아보기: 카메라 쪽으로 180도 뒤집고 1.5초 뒤 자동 복귀. 걷는 중에만 쓴다.
  faceBack?: boolean;
  // 9-B 배틀: 있는 동안 걷기·뒤돌아보기·졸음을 끄고 action 자세를 취한다.
  // mine은 야생 쪽으로 돌아 뒷모습, wild는 카메라 정면.
  battle?: BattleProp | null;
  // TODO(survey-temp): R2 전수 검증용 표정 상태 보고. 검증 후 삭제.
  onFaceStatus?: (s: { id: string; ok: boolean; mouthLive: boolean }) => void;
}>(function PovCreature({ element, modelUrl, portraitUrl, tintUrl, speciesId, ground, videoBg, handleRef, poseLock, onStatus, onFaceStatus, speedMult, drowsy, laneX, walking, faceBack, battle }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  // §2 컨디션 ref: status 변화에 3D 씬을 리마운트하지 않고 tick에서만 반영.
  const speedRef = useRef(1);
  const drowsyRef = useRef(false);
  // 7-3 20번: 검증용 z 고정. 리마운트 없이 tick에서만 반영.
  const poseLockRef = useRef<"near" | "far" | null>(null);
  useEffect(() => {
    poseLockRef.current = poseLock === "near" || poseLock === "far" ? poseLock : null;
  }, [poseLock]);
  useEffect(() => {
    const v = typeof speedMult === "number" && Number.isFinite(speedMult) ? speedMult : 1;
    speedRef.current = Math.max(0.2, Math.min(2, v));
  }, [speedMult]);
  useEffect(() => {
    drowsyRef.current = !!drowsy;
  }, [drowsy]);
  // 7-C: 리마운트 없이 tick에서만 반영 (poseLockRef 패턴).
  const laneXRef = useRef<number | null>(null);
  const walkingRef = useRef(false);
  const faceBackRef = useRef(false);
  // 9-B 배틀 ref (같은 패턴).
  const battleRef = useRef<BattleProp | null>(null);
  useEffect(() => {
    laneXRef.current = typeof laneX === "number" && Number.isFinite(laneX) ? laneX : null;
  }, [laneX]);
  useEffect(() => {
    walkingRef.current = !!walking;
  }, [walking]);
  useEffect(() => {
    faceBackRef.current = !!faceBack;
  }, [faceBack]);
  useEffect(() => {
    const okRole = battle?.role === "mine" || battle?.role === "wild";
    const okAction = battle && (["idle", "attack", "shoot", "hurt", "buff", "faint"] as const).includes(battle.action);
    battleRef.current = battle && okRole && okAction ? battle : null;
  }, [battle]);
  // 9-B 후속: 콜백은 리마운트 없이 tick에서만 반영. 페이지 리렌더에 씬이 통째로
  // 재시작되며 모델이 바뀌어 보이는 원인이었음 (야생 onStatus 인라인이 매 렌더 새 함수).
  const onStatusRef = useRef(onStatus);
  const onFaceStatusRef = useRef(onFaceStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
    onFaceStatusRef.current = onFaceStatus;
  });
  const [failed, setFailed] = useState<string | null>(null);
  const captureRef = useRef<() => void>(() => {});
  const emoteRef = useRef<(e: Emote) => void>(() => {});
  const danceRef = useRef<(at?: number) => void>(() => {});
  const stopDanceRef = useRef<() => void>(() => {});
  const snapshotRef = useRef<() => string | null>(() => null);
  const headScreenRef = useRef<() => { x: number; y: number } | null>(() => null);

  useImperativeHandle(ref, () => ({
    capture: () => captureRef.current(),
    emote: (e) => emoteRef.current(e),
    dance: (at) => danceRef.current(at),
    stopDance: () => stopDanceRef.current(),
    snapshot: () => snapshotRef.current(),
    headScreen: () => headScreenRef.current(),
  }));

  // dynamic() 우회 핸들 주입 (ref 전달 불가 대응).
  useEffect(() => {
    if (!handleRef) return;
    (handleRef as React.MutableRefObject<PovHandle | null>).current = {
      capture: () => captureRef.current(),
      emote: (e) => emoteRef.current(e),
      dance: (at) => danceRef.current(at),
      stopDance: () => stopDanceRef.current(),
      snapshot: () => snapshotRef.current(),
      headScreen: () => headScreenRef.current(),
    };
  }, [handleRef]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer | null = null;
    let raf = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let capT = -1;
    let emote: Emote = "idle";
    let emoteT = 0;
    let dancing = false;
    let danceT = 0;
    captureRef.current = () => { if (capT < 0) capT = 0; dancing = false; };
    // ?pose 고정 중에는 감정 호출을 무시한다 (감정 타이머 정지 효과).
    emoteRef.current = (e) => { if (poseLockRef.current || battleRef.current) return; emote = e; emoteT = 0; dancing = false; };
    danceRef.current = (at?: number) => { dancing = true; danceT = at ?? 0; spawnT = 1; };
    stopDanceRef.current = () => { dancing = false; };
    // R-C 리뷰 갈고리: ?povmodel=<id> ?povemote=<emote> ?povt=<초> ?povblink=closed
    // ?povwalk=1 ?povdance=<초>. ?beat=·?pose= 선례의 검증용. 쿼리 없으면 동작 변화 없음.
    const qs = new URLSearchParams(window.location.search);
    const useRigged = rigMode() !== "auto";
    const reviewIdRaw = qs.get("povmodel");
    const reviewId = reviewIdRaw && /^[a-z]+-\d+$/.test(reviewIdRaw) ? reviewIdRaw : null;
    const povemoteRaw = qs.get("povemote");
    const reviewEmote: Emote | null =
      povemoteRaw && povemoteRaw in EMOTE_DUR ? (povemoteRaw as Emote) : null;
    const povtRaw = qs.get("povt");
    const reviewT = povtRaw === null ? NaN : Number(povtRaw);
    const reviewBlink = qs.get("povblink") === "closed";
    // FN-1 리뷰: ?poviconhold=1이면 감정 아이콘 30초 유지 (캡처용).
    const iconHold = qs.get("poviconhold") === "1";
    const reviewWalk = qs.get("povwalk") === "1";
    const povdanceRaw = qs.get("povdance");
    const reviewDance = povdanceRaw !== null && Number.isFinite(Number(povdanceRaw))
      ? Math.max(0, Number(povdanceRaw))
      : null;
    const reviewBack = qs.get("povback") === "1";
    // 8-H-2 리뷰: ?povpose=sit|kick|armsup 고정 포즈 (뒷모습은 기존 ?povwalk=1).
    const povposeRaw = qs.get("povpose");
    const reviewPose: "sit" | "kick" | "armsup" | null =
      povposeRaw === "sit" || povposeRaw === "kick" || povposeRaw === "armsup" ? povposeRaw : null;
    // 8-H-2 리뷰: ?povpose=a2o<비트> A2O 클립 뼈포즈 고정 (dex 라이브와 동일 평가, graft 없음).
    const reviewA2o: number | null = povposeRaw !== null && povposeRaw.startsWith("a2o") &&
      Number.isFinite(Number(povposeRaw.slice(3))) ? Math.max(0, Number(povposeRaw.slice(3))) : null;
    // 9-B 리뷰: ?povbattle=<action> ?povrole=<mine|wild, 기본 wild>.
    const battleRaw = qs.get("povbattle");
    const reviewBattle: BattleAction | null =
      battleRaw === "idle" || battleRaw === "attack" || battleRaw === "shoot" || battleRaw === "hurt" ||
      battleRaw === "buff" || battleRaw === "faint" ? battleRaw : null;
    const roleRaw = qs.get("povrole");
    const reviewRole: BattleRole = roleRaw === "mine" ? "mine" : "wild";
    // 9-B 리뷰: ?lanej=<0~1> lane 강제 (매핑 검증용).
    const laneRaw = qs.get("lanej");
    const laneNum = laneRaw === null ? NaN : Number(laneRaw);
    const reviewLane: number | null = Number.isFinite(laneNum)
      ? Math.max(0, Math.min(1, laneNum)) : null;
    // 리뷰 촬영 중에는 페이지의 프레이밍 입력(walking·laneX)을 중립화한다.
    // 쿼리 없으면 기존 동작과 동일.
    const reviewFrame = reviewEmote !== null || reviewDance !== null || reviewWalk || reviewBack || reviewPose !== null || reviewA2o !== null || reviewBattle !== null || reviewLane !== null;
    // R-C 리뷰: 파싱된 리뷰 입력 + 실시간 emoteT (원격 검증용, 동작에 영향 없음).
    try {
      (window as unknown as { __povRev?: string }).__povRev = JSON.stringify({
        em: reviewEmote, t: reviewT, blink: reviewBlink, walk: reviewWalk,
        dance: reviewDance, back: reviewBack, id: reviewId, pose: reviewPose, a2o: reviewA2o,
        battle: reviewBattle, role: reviewRole, lane: reviewLane,
      });
    } catch {
      /* review flag only */
    }
    let reviewFired = false;
    let reviewSnapped = false;
    let readySent = false;
    const ready = () => {
      if (!readySent && !disposed) {
        readySent = true;
        onStatusRef.current?.("3d-ready");
        // R-C 리뷰: headless 촬영 대기용 플래그 (동작에 영향 없음).
        try {
          (window as unknown as { __pov3d?: string }).__pov3d = "ready";
        } catch {
          /* noop */
        }
      }
    };

    try {
      // preserveDrawingBuffer: SNS 스냅샷 캡처용.
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      setFailed("이 브라우저에서 WebGL을 쓸 수 없어요.");
      onStatusRef.current?.("3d-error: WebGL 생성 실패");
      return;
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    // §3 거리 연동 원근 스케일링: PerspectiveCamera + ±Z 이동. 멀어질수록 자연 축소.
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);
    // 파트너 전신 + 발밑 접지면: 눈높이 살짝 위에서 내려다본다. 발바닥 Y=0 원점.
    camera.position.set(0, 0.55, 2.6);
    camera.lookAt(0, 0.28, -0.15);

    // 투명 캔버스: 현실 카메라 배경 위에 얹히므로 클리어 잔상 없이 완전 투명.
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    snapshotRef.current = () => {
      try {
        if (!renderer || disposed) return null;
        return renderer.domElement.toDataURL("image/png");
      } catch {
        return null;
      }
    };
    // 머리 위 앵커: 액터 위치 + 모델 높이 여유를 카메라에 투영 (마운트 기준 px).
    headScreenRef.current = () => {
      try {
        if (!renderer || disposed || !mount) return null;
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        if (!w || !h) return null;
        const v = new THREE.Vector3(actor.position.x, actor.position.y + MODEL_H + 0.12, actor.position.z);
        v.project(camera);
        return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
      } catch {
        return null;
      }
    };

    // 시네마틱 조명: 부드러운 키 + 원소색 강한 림 백라이트(깊이 분리용).
    const glowHex = PALETTE[element].glow;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3a30, 0.9));
    const key = new THREE.DirectionalLight(0xfff2df, 1.6);
    key.position.set(1.3, 1.8, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -1.5;
    key.shadow.camera.right = 1.5;
    key.shadow.camera.top = 1.5;
    key.shadow.camera.bottom = -1.5;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 10;
    scene.add(key);
    const rim = new THREE.DirectionalLight(glowHex, 2.4);
    rim.position.set(-1.8, 0.9, -1.8);
    scene.add(rim);

    // 이미지 기반 라이팅: sim=실측 HDRI(배경+IBL), cam=RoomEnvironment(모델 셰이딩용).
    const pmrem = new THREE.PMREMGenerator(renderer);
    if (ground) {
      new RGBELoader().load(
        HDRI[ground],
        (tex) => {
          if (disposed) return;
          tex.mapping = THREE.EquirectangularReflectionMapping;
          // 3-2: 보행 영상이 있으면 배경을 비운다 (환경 조명은 아래에서 그대로 설정).
          if (!videoBg) scene.background = tex;
          if ("backgroundIntensity" in scene) (scene as unknown as { backgroundIntensity: number }).backgroundIntensity = 0.85;
          const env = pmrem.fromEquirectangular(tex).texture;
          scene.environment = env;
          if ("environmentIntensity" in scene) (scene as unknown as { environmentIntensity: number }).environmentIntensity = 0.5;
        },
        undefined,
        () => {
          if (disposed) return;
          scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        }
      );
    } else {
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      if ("environmentIntensity" in scene) (scene as unknown as { environmentIntensity: number }).environmentIntensity = 0.45;
    }

    // 무대 위 배우는 하나: 카메라를 향하는 아트워크 홀로그램 평면.
    const float = new THREE.Group();
    scene.add(float);
    const actor = new THREE.Group();
    // 스폰 낙하 시작점: 위에서 미끄러지듯 착지 (스무딩과 결합).
    if (!calm) actor.position.y = 1.6;
    float.add(actor);

    const uniforms: HoloUniforms = {
      uMap: { value: null },
      uGlow: { value: new THREE.Color(glowHex) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uGlowStrength: { value: 1 },
    };
    const holoMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const holo = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), holoMat);
    holo.position.set(0, 0.29, 0);
    actor.add(holo);

    // 후광: 실루엣 뒤에서 원소색으로 호흡하는 글로우.
    const haloMat = new THREE.MeshBasicMaterial({
      map: radialSprite("rgba(255,255,255,0.85)", "rgba(255,255,255,0)"),
      color: glowHex, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), haloMat);
    halo.position.set(0, 0.29, -0.18);
    actor.add(halo);

    // 1차: 실측 .glb (GLTFLoader) → 실패 시 2차: 홀로그램 평면 폴백.
    // 원시 도형(cone/sphere) 리그는 사용하지 않는다.
    const modelRoot = new THREE.Group();
    actor.add(modelRoot);
    let modelLive = false;
    let puppet: PuppetRig | null = null;
    let rig: AutoRig | null = null;
    let rigged: RiggedRig | null = null;
    let face: FaceRig | null = null;
    let face3d: Face3D | null = null; // EL-1: GLB 셰이프 키 눈꺼풀·입 (키 없으면 null)
    let blinkT = 0;
    // FN-1: 머리 위 감정 아이콘 (덧대기 대체). 모델 로드 뒤에만 트리거.
    const emoteIcon = new EmoteIcon(scene);
    let lastIconEmote = "idle";
    let iconWasLive = false;
    const iconAnchor = () => {
      // 머리 본이 있으면 그 위(웅크림·점프 추적), 없으면 고정 오프셋.
      const hb = rigged?.bones?.get("head");
      if (hb) {
        const p = new THREE.Vector3();
        hb.getWorldPosition(p);
        p.y += 0.26;
        return p;
      }
      return new THREE.Vector3(
        actor.position.x,
        actor.position.y + groundY + MODEL_H * 1.02,
        actor.position.z
      );
    };
    let hugMode = false;
    let mixer: THREE.AnimationMixer | null = null;
    let walkYaw = 0;
    // 9-B: lane 추적 중 두리번 진폭 (급변 방지 스무딩).
    let lookSwayAmp = 1;
    let walkPhase = 0;
    let walkAmp = 0;
    // 7-C 뒤돌아보기 상태: eased yaw + 상승 엣지 이후 경과.
    let faceBackYaw = 0;
    let faceBackT = 0;
    let faceBackPrev = false;
    const blender = new PoseBlender();
    let lastStride = 0;
    let lastChompSide = 0;
    // 앞발 프롭 구체(살색 구슬): 지침에 따라 완전 삭제. 팔 본 끝 추적 코드 없음.
    let dracoLoader: DRACOLoader | null = null;
    const modelSrc = modelUrl ?? FALLBACK_MODEL[element];
    // R-C-1: 리그 GLB 선택. 형상 기준은 URL의 로스터 id (표정 기준 speciesId와 분리).
    const fromUrl = modelSrc.match(/\/models\/([a-z]+-\d+)\.glb/)?.[1] ?? null;
    const rigId = reviewId ?? fromUrl ?? speciesId;
    const origSrc = reviewId ? `/models/${reviewId}.glb` : modelSrc;
    // 리뷰 종이 있으면 표정 캘리브레이션도 그 종으로 (page prop보다 우선).
    const resolvedSpecies = reviewId ?? speciesId ?? fromUrl ?? "fire-01";

    const texLoader = new THREE.TextureLoader();
    const fitPlane = (tex: THREE.Texture) => {
      const iw = (tex.image?.width || 4) as number;
      const ih = (tex.image?.height || 3) as number;
      const H = 1.4;
      const W = Math.min(H * (iw / ih), 1.6);
      holo.geometry.dispose();
      holo.geometry = new THREE.PlaneGeometry(W, H);
    };
    const artSrc = portraitUrl ?? tintUrl ?? FALLBACK_ART[element];
    const showHoloFallback = (src: string, retried: boolean) => {
      texLoader.load(
        src,
        (tex) => {
          if (disposed) return;
          tex.colorSpace = THREE.SRGBColorSpace;
          uniforms.uMap.value = tex;
          fitPlane(tex);
          holo.visible = true;
          halo.visible = true;
          try {
            (window as unknown as { __povHolo?: string }).__povHolo = "fallback";
          } catch {
            /* review flag only */
          }
          ready();
        },
        undefined,
        () => {
          if (disposed) return;
          if (!retried && src !== FALLBACK_ART[element]) {
            showHoloFallback(FALLBACK_ART[element], true);
          } else {
            setFailed("크리처 3D 모델을 불러오지 못했어요.");
            onStatusRef.current?.("3d-error: 모델/아트워크 로드 실패");
          }
        }
      );
    };
    // .glb가 붙기 전까지 홀로그램은 숨긴다.
    holo.visible = false;
    halo.visible = false;

    const gltfLoader = new GLTFLoader();
    try {
      dracoLoader = new DRACOLoader();
      // [EXT:cdn-draco] 로컬 번들(외부 호출 없음) — 출처: public/vendor/LICENSES.md
      dracoLoader.setDecoderPath("/vendor/draco/");
      gltfLoader.setDRACOLoader(dracoLoader);
    } catch {
      dracoLoader = null;
    }
    // 9-B 후속: 역할별 리뷰 플래그 키 (리마운트·리그 회귀 판별용, 동작에 영향 없음).
    const roleTag = battle?.role ?? (roleRaw === "mine" || roleRaw === "wild" ? roleRaw : null);
    const mountTag = roleTag === "mine" ? "__povMountMine" : roleTag === "wild" ? "__povMountWild" : null;
    const rigTag = roleTag === "mine" ? "__povRigMine" : roleTag === "wild" ? "__povRigWild" : null;
    const modelTag = roleTag === "mine" ? "__povModelMine" : roleTag === "wild" ? "__povModelWild" : null;
    let roleMountLogged = false; // 9-B 후속: 역할별 마운트 tick 1회 기록용.
    // R-C-1: 리그 GLB 우선, 실패하면 원본+autoRig으로 1회 되돌림 (DexScene R-B-1과 동일).
    const onModel = (gltf: GLTF, isRiggedLoad: boolean, wantBones: string[] | undefined) => {
        if (disposed) return;
        const obj = gltf.scene;
        // 정규화: 손바닥 크기(MODEL_H), 발바닥이 groundY 근처에 닿도록 접지.
        const bbox = new THREE.Box3().setFromObject(obj);
        const size = bbox.getSize(new THREE.Vector3());
        const center = bbox.getCenter(new THREE.Vector3());
        const s = MODEL_H / Math.max(size.x, size.y, size.z, 0.001);
        obj.scale.setScalar(s);
        // 정규화는 발바닥을 0에 두기만 하고, 접지는 아래 re-ground가 단일 기준으로 수행.
        obj.position.set(-center.x * s, -bbox.min.y * s, -center.z * s);
        // 자동 퍼펫 리깅: 실패하면 원본 그대로 얹는다.
        // 리그 경로는 월드 베이크 없이 감싼다 (bake는 스키닝을 깬다, R-B 실증).
        try {
          puppet = isRiggedLoad ? wrapRigid(obj) : rigObject(obj);
        } catch {
          puppet = null;
        }
        if (puppet) modelRoot.add(puppet.group);
        else modelRoot.add(obj);
        // 종 판별: 무입 종은 허그 동작 분기. UV 표정 리그 부착 (3D 일체형).
        // R-C-4: 부착은 휴지 자세 스냅샷에서만 한다. 틱이 액터(점프·회전)·진행
        // 방향(걷기·응시)을 움직인 채로 부착하면 눈·입 UV 패치가 어긋나고,
        // 로드 타이밍·행동 상태에 따라 눈이 안 감긴 채로 굳는다 (실측:
        // fire-01 눈 중심이 로드마다 x −0.12/−0.04 ↔ −0.04/+0.06으로 이동).
        // 접지 측정 블록과 같은 stash 패턴 (동기 구간이라 깜빡임 없음).
        hugMode = !speciesHasMouth(resolvedSpecies);
        const stashAP0 = actor.position.clone();
        const stashAR0 = actor.rotation.clone();
        const stashAS0 = actor.scale.clone();
        const stashFP0 = float.position.clone();
        const stashFR0 = float.rotation.clone();
        const stashMR0 = modelRoot.rotation.clone();
        actor.position.set(0, 0, 0);
        actor.rotation.set(0, 0, 0);
        actor.scale.set(1, 1, 1);
        float.position.set(0, 0, 0);
        float.rotation.set(0, 0, 0);
        modelRoot.rotation.set(0, 0, 0);
        scene.updateMatrixWorld(true);
        try {
          const host0 = puppet ? puppet.group : obj;
          const faceT0 = performance.now();
          const rig0 = attachFace(host0, resolvedSpecies);
          try {
            const w = window as unknown as { __povFaceMs?: number; __povFaceOk?: string };
            w.__povFaceMs = Math.round(performance.now() - faceT0);
            w.__povFaceOk = `${rig0.ok}/${rig0.mouthLive}/${rig0.bakedFace}`;
          } catch {
            /* review flag only */
          }
          face = rig0.ok ? rig0 : null;
          if (!rig0.mouthLive) hugMode = true;
          try {
            onFaceStatusRef.current?.({ id: resolvedSpecies, ok: rig0.ok, mouthLive: rig0.mouthLive });
          } catch {
            /* survey hook only */
          }
        } catch {
          face = null;
          try {
            onFaceStatusRef.current?.({ id: resolvedSpecies, ok: false, mouthLive: false });
          } catch {
            /* survey hook only */
          }
        }
        face3d = attachFace3D(puppet ? puppet.group : obj, resolvedSpecies);
        actor.position.copy(stashAP0);
        actor.rotation.copy(stashAR0);
        actor.scale.copy(stashAS0);
        float.position.copy(stashFP0);
        float.rotation.copy(stashFR0);
        modelRoot.rotation.copy(stashMR0);
        // 실측 그림자 + 착지 + 앞발: 스폰 리프트/스웨이 오염 방지용 휴지 실측.
        // 액터/플로트를 휴지 자세로 잠시 되돌려 bbox를 재고 곧바로 복원한다.
        // JS 단일 스레드라 콜백 중간에 렌더가 끼지 않아 깜빡임이 없다.
        const host = puppet ? puppet.group : obj;
        const skip = new Set<THREE.Object3D>();
        const stashAP = actor.position.clone();
        const stashAR = actor.rotation.clone();
        const stashAS = actor.scale.clone();
        const stashFP = float.position.clone();
        const stashFR = float.rotation.clone();
        actor.position.set(0, 0, 0);
        actor.rotation.set(0, 0, 0);
        actor.scale.set(1, 1, 1);
        float.position.set(0, 0, 0);
        float.rotation.set(0, 0, 0);
        scene.updateMatrixWorld(true);
        const gb = new THREE.Box3();
        let boxed = false;
        host.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || skip.has(o)) return;
          m.castShadow = true;
          gb.expandByObject(m);
          boxed = true;
        });
        let needFallback = false;
        if (boxed && Number.isFinite(gb.min.y)) {
          // 착지 고정: 휴지 실측 발바닥을 groundY에 정확히 맞춤 (결정적 1회).
          modelRoot.position.y += groundY - gb.min.y;
          // 본 리깅: 리그 GLB면 SkinnedMesh 직접 구동, 아니면 자동 본 리깅.
          try {
            if (isRiggedLoad) {
              rigged = buildRiggedRig(obj, resolvedSpecies, wantBones, [RIG_TAIL_EXTRA]);
              if (!rigged) throw new Error("rigged build failed");
            } else {
              rig = buildAutoRig(host, gb);
            }
          } catch {
            if (isRiggedLoad) {
              modelRoot.remove(puppet ? puppet.group : obj);
              puppet = null;
              needFallback = true;
            } else {
              rig = null;
            }
          }
        }
        actor.position.copy(stashAP);
        actor.rotation.copy(stashAR);
        actor.scale.copy(stashAS);
        float.position.copy(stashFP);
        float.rotation.copy(stashFR);
        if (needFallback) {
          // 접지 오프셋 되돌림: 원본 로드가 새로 1회 적용한다 (이중 누적 방지).
          modelRoot.position.y = 0;
          gltfLoader.load(origSrc, (g) => onModel(g, false, undefined), undefined, () => {
            if (!disposed) showHoloFallback(artSrc, false);
          });
          return;
        }
        modelLive = true;
        // R-C 리뷰: 리그 경로 식별 플래그 (동작에 영향 없음).
        try {
          const w = window as unknown as { __povRig?: string; __povModel?: string; __povHolo?: string };
          w.__povRig = rigged ? "rigged" : rig ? "auto" : "none";
          w.__povModel = isRiggedLoad ? "rigged" : "orig";
          w.__povHolo = "3d";
          if (rigTag) (window as unknown as Record<string, string>)[rigTag] = w.__povRig;
          if (modelTag) (window as unknown as Record<string, string>)[modelTag] = w.__povModel;
        } catch {
          /* noop */
        }
        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(obj);
          for (const clip of gltf.animations) mixer.clipAction(clip).play();
        }
        ready();
    };
    // 매니페스트 확인 후 리그 GLB, 실패하면 원본 1회 (2.5초 타임아웃 → 원본).
    const startLoad = (manifest: Record<string, string[]> | null) => {
      if (disposed) return;
      const wantBones = rigId ? manifest?.[rigId] : undefined;
      if (useRigged && rigId && wantBones) {
        gltfLoader.load(riggedUrl(rigId), (g) => onModel(g, true, wantBones), undefined, () => {
          if (disposed) return;
          gltfLoader.load(origSrc, (g) => onModel(g, false, undefined), undefined, () => {
            if (!disposed) showHoloFallback(artSrc, false);
          });
        });
      } else {
        gltfLoader.load(origSrc, (g) => onModel(g, false, undefined), undefined, () => {
          if (!disposed) showHoloFallback(artSrc, false);
        });
      }
    };
    // R-C 리뷰: 마운트 경합 판별용 pending 마커 (동작에 영향 없음).
    try {
      const w = window as unknown as Record<string, string | number>;
      w.__povRig = "pending";
      w.__povModel = "pending";
      w.__povFaceOk = "pending";
      w.__povHolo = "pending";
      w.__povMount = ((window as unknown as { __povMountN?: number }).__povMountN ?? 0) + 1;
      (window as unknown as { __povMountN?: number }).__povMountN = w.__povMount as number;
      // 9-B 후속: 마운트 이벤트 로그 (리마운트 시점 판별용).
      const mlog = (window as unknown as { __b9mountLog?: string[] });
      (mlog.__b9mountLog ??= []).push(`${battle?.role ?? "pre"}#${w.__povMount}@${Math.round(performance.now())}`);
      if (mountTag) {
        const wk = window as unknown as Record<string, number>;
        wk[mountTag] = (wk[mountTag] ?? 0) + 1;
      }
    } catch {
      /* review flag only */
    }
    if (useRigged) {
      // R-C-1: 매니페스트 8초 대기 (dev 서버 스톨 시 원본 폴백. Dex 2.5초보다 여유).
      void Promise.race([
        loadBonesManifest(),
        new Promise<null>((res) => setTimeout(() => res(null), 8000)),
      ]).then(startLoad);
    } else {
      startLoad(null);
    }

    // 3-1: 떠오르는 파티클(motes) 제거. 홀씨·배틀 파티클은 별도라 유지.
    // AR 접지: 발바닥 Y=0 원점. cam=블롭 그림자, sim=실측 섀도 캐처.
    const groundY = 0;
    const shadowMat = new THREE.MeshBasicMaterial({
      map: radialSprite("rgba(0,0,0,0.85)", "rgba(0,0,0,0)"),
      transparent: true, opacity: 0.42, depthWrite: false,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = groundY;
    shadow.visible = !ground;
    scene.add(shadow);

    const summonMat = new THREE.MeshBasicMaterial({
      map: summonTexture(), color: glowHex, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const summon = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), summonMat);
    summon.rotation.x = -Math.PI / 2;
    summon.position.y = groundY + 0.01;
    scene.add(summon);

    // 시뮬레이터 바닥: HDRI가 깔리므로 투명 섀도 캐처로 실측 그림자만 받는다.
    if (ground) {
      const catcher = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 12),
        new THREE.ShadowMaterial({ opacity: 0.35 })
      );
      catcher.rotation.x = -Math.PI / 2;
      catcher.position.set(0, groundY - 0.01, -1.5);
      catcher.receiveShadow = true;
      scene.add(catcher);
    }

    // 디저트 3D 프롭: 접시 + 쇼트케이크 조각 (집어올리기 연출용).
    const cake = new THREE.Group();
    {
      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.077, 0.077, 0.011, 24),
        new THREE.MeshStandardMaterial({ color: 0xf2ede0, roughness: 0.5, metalness: 0 })
      );
      plate.position.y = 0.005;
      const slice = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.05, 10, 1, false, 0, 1.9),
        new THREE.MeshStandardMaterial({ color: 0xf6e3c8, roughness: 0.65, metalness: 0 })
      );
      slice.position.y = 0.036;
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.009, 10, 1, false, 0, 1.9),
        new THREE.MeshStandardMaterial({ color: 0xe88a9a, roughness: 0.6, metalness: 0 })
      );
      top.position.y = 0.063;
      const berry = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xd63d52, roughness: 0.4, metalness: 0 })
      );
      berry.position.set(0.014, 0.081, 0.009);
      cake.add(plate, slice, top, berry);
      cake.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      cake.visible = false;
      actor.add(cake);
    }
    const cakeHome = new THREE.Vector3(0, groundY + 0.01, -0.25);
    const cakeMouth = new THREE.Vector3(0, groundY + MODEL_H * 0.43, 0.16);
    const cakeHug = new THREE.Vector3(0, groundY + MODEL_H * 0.30, 0.14);

    const ringMat = new THREE.MeshBasicMaterial({
      color: glowHex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.47, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = groundY + 0.02;
    scene.add(ring);
    // 조우 스폰 연출: 위에서 통통 떨어지며 커진다 (야생 바뀔 때마다 리마운트라 매번 재생)
    let spawnT = calm ? 1 : 0;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer!.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer!.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();
      emoteT += dt;
      if (spawnT < 1) spawnT = Math.min(1, spawnT + dt / 0.7);
      if (emote !== "idle" && emoteT > EMOTE_DUR[emote]) {
        emote = "idle";
        emoteT = 0;
      }
      // R-C 리뷰 갈고리: 감정·춤·걷기 강제 + 위상 고정. 페이지 행동 루프가
      // 끼어들어도 매 프레임 되돌린다 (쿼리 없으면 없음).
      // 걷기 단독(?povwalk)도 블록에 포함해야 춤이 끼어들지 않는다.
      // 9-B 배틀: prop 또는 리뷰 쿼리. 걷기·뒤돌아보기·졸음을 끈다.
      const battleNow: BattleProp | null = reviewBattle
        ? { role: reviewRole, action: reviewBattle }
        : battleRef.current;
      // 9-B 후속: 배틀 대기는 감정 없이 제자리 바운스만 (3초 그리드 결정적).
      const battleIdle = !!battleNow && battleNow.action === "idle";
      // 9-B lane 입력: 리뷰 강제(?lanej=) > prop (리뷰 중 prop은 중립).
      const laneIn: number | null = reviewLane ?? (reviewFrame ? null : laneXRef.current);
      if (modelLive && (reviewEmote || reviewDance !== null || reviewWalk || reviewPose || reviewA2o !== null || battleNow)) {
        if (battleNow) {
          emote = BATTLE_EMOTE[battleNow.action];
          dancing = false;
          // 리뷰 고정: 액션 정점 (attack 돌진·hurt 밀림·buff 점프).
          // 실전 prop은 만료+재지정으로 반복한다.
          if (reviewBattle && emote !== "idle" && emote !== "faint") {
            emoteT = EMOTE_DUR[emote] / 2;
          }
          // 9-B 후속: 기절은 끝 자세 유지 (만료 후 일어남 반복 금지).
          if (!reviewBattle && battleNow.action === "faint" && emoteT > EMOTE_DUR.faint - 0.05) {
            emoteT = EMOTE_DUR.faint - 0.05;
          }
        } else if (reviewDance !== null) {
          dancing = true;
          emote = "idle";
          emoteT = 0;
          danceT = reviewDance;
        } else {
          if (reviewEmote) emote = reviewEmote;
          else if (reviewPose || reviewWalk || reviewA2o !== null) emote = "idle";
          dancing = false;
          if (reviewEmote && reviewEmote !== "idle") {
            const dur = EMOTE_DUR[reviewEmote];
            emoteT = Number.isFinite(reviewT)
              ? Math.min(Math.max(reviewT, 0), dur - 0.05)
              : dur / 2;
          }
        }
        if (!reviewSnapped) {
          // 결정적 촬영: 스폰 리프트 제거 + 액터를 접지에 스냅 (이후 스무딩 수렴).
          spawnT = 1;
          actor.position.set(0, 0, 0);
          reviewSnapped = true;
        }
        reviewFired = true;
        try {
          const w = window as unknown as { __povE?: number; __povEm?: string; __povBattle?: string; __povEmMine?: string; __povEmWild?: string; __povBattleMine?: string; __povBattleWild?: string };
          w.__povE = emoteT;
          w.__povEm = emote;
          if (battleNow) {
            const mineSide = battleNow.role === "mine";
            w.__povBattle = `${battleNow.role}:${battleNow.action}`;
            (w as unknown as Record<string, string>)[mineSide ? "__povBattleMine" : "__povBattleWild"] = battleNow.action;
            w[mineSide ? "__povEmMine" : "__povEmWild"] = emote;
            // 9-B 후속: 역할별 리그·마운트 (마운트 시점엔 role 미정이므로 tick에서 기록).
            const ww = window as unknown as Record<string, string | number>;
            ww[mineSide ? "__povRigMine" : "__povRigWild"] = rigged ? "rigged" : rig ? "auto" : "none";
            ww[mineSide ? "__povModelMine" : "__povModelWild"] = rigged ? "rigged" : "orig";
            ww[mineSide ? "__povTMine" : "__povTWild"] = t;
            ww[mineSide ? "__povYMine" : "__povYWild"] = actor.position.y;
            if (!roleMountLogged) {
              roleMountLogged = true;
              const wk = window as unknown as Record<string, number>;
              const mk = mineSide ? "__povMountMine" : "__povMountWild";
              wk[mk] = (wk[mk] ?? 0) + 1;
            }
          }
        } catch {
          /* review flag only */
        }
      }
      // FN-1: 감정 변경(또는 로드 직후 감정 보유) 시 머리 위 아이콘 1회.
      const iconKind = modelLive ? (EMOTE_ICON[emote] ?? null) : null;
      if (iconKind && (emote !== lastIconEmote || !iconWasLive)) {
        emoteIcon.show(iconKind, iconAnchor, t, iconHold ? 30 : 1.0);
      }
      lastIconEmote = emote;
      iconWasLive = modelLive;
      const k = emote === "idle" ? 0 : Math.min(emoteT / EMOTE_DUR[emote], 1);

      if (!calm) {
        // 기본 호흡은 항상 아래에 깔린다.
        const bobY = Math.sin(t * 1.6) * 0.09;
        const swayY = Math.sin(t * 0.5) * 0.35;
        let y = bobY, ry = swayY, rz = 0, z = 0, sx = 1, sy = 1, xt = 0;
        let op = 1, glowS = 1, haloO = 0.35;
        // 화면비별 산책 진폭: 세로 화면에서 화면 밖으로 나가지 않게.
        const roamAmp = Math.min(1.6, Math.max(0.55, camera.aspect * 1.1));

        if (emote === "beg" || emote === "want") {
          // AR 펫 조르기: 카메라(플레이어) 앞으로 쑥 다가와 통통 뛰며 보채기
          const approach = Math.sin(Math.min(k * 2, 1) * (Math.PI / 2));
          z += approach * 0.7;
          y += Math.abs(Math.sin(emoteT * 7.5)) * 0.3;
          glowS = 1.9;
          haloO = 0.6;
        } else if (emote === "hungry") {
          // 배고파서 갸우뚱거리며 다가오기
          const rub = Math.sin(emoteT * 3);
          rz = rub * 0.12;
          y -= 0.05;
          glowS = 1.2;
        } else if (emote === "cry") {
          // 훌쩍거리며 뒷걸음질
          z -= 0.3;
          y -= 0.08;
          glowS = 0.8;
          haloO = 0.2;
        } else if (emote === "happy") {
          y += Math.abs(Math.sin(emoteT * 7)) * 0.35;
          const pop = 1 + Math.abs(Math.sin(emoteT * 7)) * 0.1;
          sx = pop; sy = pop;
          glowS = 1.8; haloO = 0.55;
        } else if (emote === "attack") {
          const lunge = Math.sin(Math.min(k, 1) * Math.PI);
          // J-5: 배틀 중 공격은 옆·위 짧은 홉(z 최소). 평상은 카메라 돌진 유지.
          if (battleNow) {
            // BP-2: shoot는 제자리 발사, attack은 홉 돌진.
            const mv = battleNow.action === "shoot"
              ? battleShootMove(Math.min(k, 1))
              : battleAttackMove(Math.min(k, 1), battleNow.role);
            z += mv.z;
            xt += mv.x;
            y += mv.y;
          } else {
            z += lunge * 0.9;
          }
          if (battleNow) { sx = 1 + lunge * 0.08; sy = 1 - lunge * 0.025; } else { sx = 1 + lunge * 0.15; sy = 1 - lunge * 0.06; }
          glowS = 2.4; haloO = 0.7;
        } else if (emote === "hurt") {
          // J-5: 배틀 피격은 좌우 흔들림만 (z 이동 제거). 평상은 기존 뒤로 밀림 유지.
          if (battleNow) {
            xt = actor.position.x = Math.sin(emoteT * 30) * 0.1 * (1 - k);
          } else {
            z -= Math.sin(Math.min(k, 1) * Math.PI) * 0.5;
            xt = actor.position.x = Math.sin(emoteT * 30) * 0.06 * (1 - k);
          }
          op = 0.5 + 0.4 * Math.abs(Math.sin(emoteT * 20));
          glowS = 0.7; haloO = 0.2;
        } else if (emote === "sleep") {
          op = 0.55;
          glowS = 0.5; haloO = 0.15;
          // 1c-8: 낮추기는 A만 담당. 호흡만 남긴다.
          y = Math.sin(t * 1.1) * 0.035;
        } else if (emote === "eat") {
          const chomp = Math.abs(Math.sin(emoteT * 10));
          sy = 1 - chomp * 0.12; sx = 1 + chomp * 0.1;
          z += Math.sin(Math.min(k, 1) * Math.PI) * 0.2;
          glowS = 1.3;
        } else if (emote === "chomp") {
          // 덥석: 디저트로 깡총 다가가 입 크게 벌려 냠냠
          const dash = Math.sin(Math.min(k, 1) * Math.PI);
          z += dash * 0.55;
          y += Math.abs(Math.sin(emoteT * 9)) * 0.18;
          const ch = 1 + Math.abs(Math.sin(emoteT * 9)) * 0.08;
          sx = ch; sy = 2 - ch;
          glowS = 1.5; haloO = 0.5;
        } else if (emote === "fetch") {
          // 앞장서기: 바닥(XZ, Y 고정) 위 −Z 깊이로 걸어 원근감에 작아진다.
          // Y 엘리베이터 금지: 점프 대신 발을 딛는 스텝(다리 본이 담당) + 미세 호흡만.
          z -= Math.min(k * 1.2, 1) * 2.1;
          // 1c-6: Y 상승 제거. 이동은 바닥 XZ로만.
          rz = Math.sin(emoteT * 8) * 0.05;
          glowS = 1.4; haloO = 0.45;
        } else if (emote === "greet") {
          // 달려나가기: 돌진 + 점프 + 팡팡 스케일
          const dash = Math.sin(Math.min(k, 1) * Math.PI);
          z += dash * 0.8 * CALM_ROAM_RANGE_SCALE;
          y += Math.abs(Math.sin(emoteT * 8)) * 0.3;
          const pop = 0.7 + dash * 0.5;
          sx = pop; sy = pop;
          op = 1; glowS = 2.0; haloO = 0.6;
        } else if (emote === "roam") {
          // 동행 산책: 바닥(XZ, Y 고정) 위 −Z 깊이로 어슬렁 (등 돌림은 walkYaw).
          // 멀어질수록 원근감에 작아지고, 발치로 돌아오면 커진다. Y 점프 금지.
          // 7-3 20번: 6초 주기 — 2초 나가기, 2초 머무름, 2초 돌아오기 (보간).
          xt = Math.sin(t * 0.9) * roamAmp * CALM_ROAM_RANGE_SCALE;
          z = depthExcursion(emoteT, 2, 2, 2, CALM_ROAM_RANGE_SCALE);
          rz = Math.sin(emoteT * 5) * 0.05;
          glowS = 1.4; haloO = 0.45;
        } else if (emote === "drowsy") {
          // §2 탈진: 축 늘어진 비틀거림 (낮추기는 A 담당, 1c-8).
          y -= Math.sin(t * 1.1) * 0.02;
          rz = Math.sin(t * 1.4) * 0.08;
          sy *= 0.88; sx *= 1.06;
          op = 0.75;
          glowS = 0.6; haloO = 0.2;
        } else if (emote === "zoomies") {
          // §2 활기: 발 구르기 통통 + 트레이너 주변 고속 회전.
          // 7-3 20번: 3.2초 주기 — 0.6초 나가기, 2초 머무름, 0.6초 돌아오기 (보간).
          y += Math.abs(Math.sin(emoteT * 14)) * 0.28;
          xt = Math.sin(emoteT * 6) * roamAmp * CALM_ROAM_RANGE_SCALE;
          z = depthExcursion(emoteT, 0.6, 2.0, 0.6, CALM_ROAM_RANGE_SCALE);
          ry = emoteT * 10;
          rz = Math.sin(emoteT * 14) * 0.1;
          glowS = 2.0; haloO = 0.6;
        } else if (emote === "pat") {
          // §2 포만: 배 두드림 통통 + 앞으로 살짝.
          const pat = Math.abs(Math.sin(emoteT * 6));
          y += pat * 0.1;
          sy = 1 - pat * 0.08; sx = 1 + pat * 0.08;
          z += Math.sin(Math.min(k, 1) * Math.PI) * 0.25;
          glowS = 1.5; haloO = 0.5;
        } else if (emote === "cuddle") {
          // §2 단짝: 정면 접근 + 갸웃 + 애교 폴짝.
          const approach = Math.sin(Math.min(k * 2, 1) * (Math.PI / 2));
          z += approach * 0.7 * CALM_ROAM_RANGE_SCALE;
          y += Math.abs(Math.sin(emoteT * 4)) * 0.22;
          rz = 0.2 + Math.sin(emoteT * 4) * 0.08;
          glowS = 1.9; haloO = 0.55;
        } else if (emote === "faint") {
          // 9-B: 기절. 옆으로 쓰러져 낮아짐 + 기울기. 호흡만.
          y -= 0.12;
          rz = 0.45;
          z -= 0.05;
          sy *= 0.92; sx *= 1.04;
          glowS = 0.5; haloO = 0.15;
        } else if (emote === "idle") {
          // 가만히 서 있지 않고 주변을 기웃 기웃.
          // 9-B: lane 추적·배틀 중에는 기웃을 멈춘다 (렌더 x ±0.03·전투 대형 유지).
          xt = laneIn !== null || battleNow ? actor.position.x : Math.sin(t * 0.35) * Math.min(0.6, roamAmp * 0.45);
          // 9-B 후속: 배틀 대기는 제자리 바운스만 (기본 호흡 대신, 1.5s 주기).
          if (battleIdle) y = battleBounceY(t);
        }
        // 9-B 후속: 배틀 중 기본 좌우 흔들림(ry) 제거 — 대각선 마주보기 유지.
        if (battleNow) ry = 0;
        // 8-H-2 리뷰: 앉기 낮추기 (다리 벌림과 함께, 무릎 없음).
        if (reviewPose === "sit") y -= 0.12;
        // §2 탈진 상시: 주저앉음 스쿼트 (어떤 감정 중에도 축 처짐).
        // 9-B: 배틀 중에는 끈다.
        if (drowsyRef.current && emote !== "zoomies" && !battleNow) {
          y -= 0.12;
          sy *= 0.94;
          sx *= 1.03;
        }

        if (dancing) {
          // 무음 댄스: 24s ATEEZ 케이던스 → 8비트 프로시저럴 프레이즈 @128BPM
          danceT = reviewDance !== null ? reviewDance : danceT + dt;
          const b = danceT * (128 / 60);
          const cyc = b % 8;
          const dir = Math.floor(cyc / 4) % 2 === 0 ? 1 : -1;
          const kk = (cyc % 4) / 4;
          xt = dir * (kk * 2 - 1) * Math.min(1.1, roamAmp * 0.75);
          y = Math.abs(Math.sin(b * Math.PI)) * 0.35 + Math.sin(t * 1.6) * 0.05;
          ry = Math.sin(t * 0.5) * 0.2;
          const sp = b % 16;
          if (sp > 14) ry += ((sp - 14) / 2) * Math.PI * 2;
          rz = Math.sin(b * Math.PI / 2) * 0.3;
          const pu = 1 + Math.sin(b * Math.PI * 2) * 0.06;
          sx = pu; sy = pu;
          glowS = 1.6 + Math.sin(b * Math.PI * 2) * 0.7;
          haloO = 0.45 + 0.2 * Math.sin(b * Math.PI * 2);
          op = 1;
        }

        // ?pose 고정: z 고정 + x 중앙 정렬 (마스크 측정용). 쿼리 없으면 동작 없음.
        if (poseLockRef.current === "near") { z = DEPTH_NEAR; xt = 0; }
        else if (poseLockRef.current === "far") { z = DEPTH_FAR; xt = 0; }

        // 이동 스무딩: 감정 전환 시 순간이동 대신 미끄러지듯 이동.
        // §2 탈진: 이동속도 50% (스무딩+보폭 모두 감속).
        const spd = drowsyRef.current ? Math.min(speedRef.current, 0.5) : speedRef.current;
        const sm = Math.min(1, dt * 7 * spd);
        actor.position.y += (y + (1 - spawnT) * 1.6 - actor.position.y) * sm;
        actor.position.z += (z - actor.position.z) * sm;
        if (emote === "hurt") actor.position.x = xt;
        else actor.position.x += (xt - actor.position.x) * sm;
        // 7-C laneX: 화면 x(0~1) → 월드 x(±0.4). 바깥(float) 이동이라 emote x와 충돌 없음.
        // cam 블롭 그림자도 따라간다 (sim 섀도 캐처는 실측이라 자동).
        const lx = laneIn;
        const laneTarget = typeof lx === "number" ? (Math.max(0, Math.min(1, lx)) - 0.5) * 0.8 : 0;
        float.position.x += (laneTarget - float.position.x) * Math.min(1, dt * 4);
        shadow.position.x = float.position.x;
        // 9-B lane 검증 플래그: 목표 월드x와 실제 렌더 월드x (차이 ±0.03 목표).
        try {
          (window as unknown as { __povLane?: string }).__povLane =
            `${laneTarget.toFixed(4)},${(float.position.x + actor.position.x).toFixed(4)}`;
        } catch { /* flag only */ }
        // 7-C faceBack: 카메라 응시(절대 방향)로 뒤집고 1.5초 뒤 자동 복귀.
        // actor.rotation.y 단일 대입에 합산하므로 emote 회전과 덮어쓰기 충돌 없음 (R-B 6번 원칙).
        // R-C-5: 춤추는 동안 faceBack을 끈다 (modelRoot 스핀과 간섭, 7-C 보고).
        // 9-B: 배틀 중 faceBack 끔 + 뒤집기 강체 연결 (과도 x 어긋남 제거).
        const fbOn = (faceBackRef.current || reviewBack) && !dancing && !battleNow;
        if (fbOn && !faceBackPrev) faceBackT = 0;
        faceBackPrev = fbOn;
        if (fbOn) faceBackT += dt;
        // 리뷰 고정: 뒤집힌 자세 유지 ("Coming?" 손짓 촬영용).
        if (reviewBack && modelLive) faceBackT = 0.7;
        const fbTarget = fbOn && faceBackT < 1.5 ? -walkYaw : 0;
        if (fbOn && faceBackT < 1.5) faceBackYaw = fbTarget;
        else faceBackYaw += (fbTarget - faceBackYaw) * Math.min(1, dt * 6);
        actor.rotation.y = ry + faceBackYaw;
        actor.rotation.z = rz;
        const se = spawnT >= 1 ? 1 : 1 + 2.2 * Math.pow(spawnT - 1, 3) + 1.2 * Math.pow(spawnT - 1, 2);
        actor.scale.set(sx * se, sy * se, se);
        ring.scale.setScalar(1 + spawnT * 1.8);
        ringMat.opacity = (1 - spawnT) * 0.9;
        shadow.scale.setScalar(THREE.MathUtils.clamp(1 - actor.position.y * 0.3, 0.55, 1.15));

        // 동행 시선: 산책/fetch 중엔 앞장(등 돌림), 그 외엔 카메라 응시. 부드럽게 전환.
        if (modelLive && !dancing) {
          // 7-C walking: roam과 같은 등 돌림(앞장서기). 진행 방향은 바깥(modelRoot) 담당.
          // 리뷰 촬영은 정면 고정 (걷기 촬영만 등 돌림).
          // 9-B: 배틀 중 걷기 끔. 9-B 후속: 대각선 마주보기 (mine π−0.42 / wild −0.42).
          const walkOn = battleNow ? false : reviewFrame ? reviewWalk : walkingRef.current;
          const targetYaw = battleNow
            ? battleYaw(battleNow.role)
            : emoteLocomotion(emote) || walkOn ? Math.PI : 0;
          walkYaw += (targetYaw - walkYaw) * Math.min(1, dt * 5);
          // 9-B: lane 추적·배틀 중 두리번 진폭 0 (렌더 x ±0.03). 급변 방지 스무딩.
          lookSwayAmp += ((laneIn !== null || battleNow ? 0 : 1) - lookSwayAmp) * Math.min(1, dt * 3);
          const lookSway = Math.sin(t * 1.2) * 0.15 * lookSwayAmp;
          modelRoot.rotation.y = walkYaw + lookSway * (1 - Math.abs(walkYaw) / Math.PI);
        } else if (modelLive && dancing) {
          // 리뷰 고정: 춤 스핀도 결정적 위상.
          if (reviewDance !== null) modelRoot.rotation.y = reviewDance * 0.4;
          else modelRoot.rotation.y += dt * 0.4;
        }
        if (mixer) mixer.update(dt);
        // 퍼펫 본 드라이브: 눈(머리)·팔·다리·허리·꼬리가 감정/춤에 맞춰 움직인다.
        if (puppet) {
          // 9-B 후속: 배틀 대기는 기본 호흡(t)도 멈춰 바운스만 남긴다.
          puppet.update({
            emote, k, t: battleIdle ? 0 : t, e: emoteT, dancing,
            beat: dancing ? danceT * (128 / 60) : 0,
          });
        }
        // 본 스킨 구동: 걷기 위상 + 감정 포즈 (다리/발 스텝 100% 보존).
        // R-C: 걷기 사이클(다리 스텝 + 등 돌림)을 새 리그 본에 그대로 적용한다.
        const walkTarget = battleNow ? 0 : emoteLocomotion(emote) || (reviewFrame ? reviewWalk : walkingRef.current) ? 1 : 0;
        if (reviewWalk && modelLive) {
          // 리뷰 고정: 풀 스텝 진폭 + 고정 위상 (결정적 촬영).
          walkAmp = 1;
          walkPhase = 1.2;
        } else {
          walkAmp += (walkTarget - walkAmp) * Math.min(1, dt * 4);
          if (walkAmp > 0.02) walkPhase += dt * (3 + 5 * walkAmp) * spd;
        }
        // 아장아장 발소리: 스트라이드 위상 반전마다 한 걸음.
        {
          const side = Math.sin(walkPhase) > 0 ? 1 : -1;
          if (side !== lastStride) {
            if (walkAmp > 0.4) sfxStep();
            lastStride = side;
          }
        }
        // 덥석 깨무기 SFX: chomp/eat 씹기 사이클마다.
        if ((emote === "chomp" || emote === "eat") && !hugMode) {
          const side = Math.sin(emoteT * (emote === "chomp" ? 9 : 10)) > 0 ? 1 : -1;
          if (side !== lastChompSide) {
            sfxChomp();
            lastChompSide = side;
          }
        }
        // R-C-1·3: 리그 우선, 없으면 auto. 리그 경로는 squash를 무시하고
        // (retarget, R-B-7), 팔·머리뼈가 없는 종은 몸통 대체로 메운다.
        const updater = rigged ?? rig;
        if (updater) {
          // 8-H-2 리뷰 고정 포즈 (/dex ?pose=와 같은 값).
          let pose;
          if (reviewPose || reviewA2o !== null) {
            pose = neutralPose();
            if (reviewA2o !== null) {
              pose = dancePose(a2o, reviewA2o, neutralPose());
            } else if (reviewPose === "kick") {
              pose.rx[B_LEGR] = -1.0; pose.rx[B_LEGL] = 0.15;
              pose.rx[B_TORSO] = 0.12; pose.rz[B_TORSO] = 0.15;
              pose.rx[B_ARML] = -1.2; pose.rz[B_ARML] = 0.3;
              pose.rx[B_ARMR] = 0.3; pose.rz[B_ARMR] = -0.2;
              pose.rx[B_HEAD] = -0.1;
            } else if (reviewPose === "sit") {
              pose.rx[B_LEGL] = 0.5; pose.rz[B_LEGL] = -0.5;
              pose.rx[B_LEGR] = 0.5; pose.rz[B_LEGR] = 0.5;
              pose.rx[B_TORSO] = 0.25; pose.rx[B_HEAD] = -0.15;
              pose.rx[B_ARML] = -0.5; pose.rx[B_ARMR] = -0.5;
            } else if (reviewPose === "armsup") {
              pose.rx[B_ARML] = -1.9; pose.rz[B_ARML] = 0.2;
              pose.rx[B_ARMR] = -1.9; pose.rz[B_ARMR] = -0.2;
              pose.rx[B_HEAD] = -0.25; pose.rx[B_TORSO] = -0.12;
            }
          } else {
            pose = blender.update(emote, poseFor({
              emote, k, t: battleIdle ? 0 : t, e: emoteT, walkAmp, walkPhase,
              hug: hugMode && (emote === "chomp" || emote === "eat"),
              dancing, beat: dancing ? danceT * (128 / 60) : 0,
            }), dt);
            // 9-B 후속: 바운스 위상에 맞춘 다리 굽힘 (착지에서 굽고 피크에서 핀다).
            if (battleIdle) {
              const crouch = battleLegCrouch(battleBounceY(t));
              pose.rx[B_LEGL] += crouch;
              pose.rx[B_LEGR] += crouch;
            }
          }
          if (rigged) applyMissingBoneFallback(pose, rigged.bones);
          updater.update(pose);
        }
        // UV 표정 전환: 감정 매핑은 lib/motion/emotes.ts 표에서 읽는다.
        // 무입 종은 눈만(허그는 눈웃음), 평소엔 baked + 깜빡임.
        if (face) {
          const f = faceFor(emote, { emoteT, hug: hugMode, dancing });
          // 5a: PARAM 종은 감정→파라미터 표로 직행. null 조건은 faceFor와 동일.
          const paramFace = PARAM_FACE_SPECIES.includes(resolvedSpecies);
          const pf = paramFace ? faceParamsFor(emote, { emoteT, hug: hugMode, dancing }) : null;
          try {
            (window as unknown as { __povFaceBranch?: string }).__povFaceBranch =
              f ? `emote:${f.eyes}` : drowsyRef.current ? "drowsy" : reviewBlink ? "pin" : "timer";
          } catch {
            /* review flag only */
          }
          // 9-B 후속: 배틀 대기는 눈 뜬 채 고정 (깜빡임·졸음 표정 없음 — 3초 그리드 결정적).
          if (battleIdle) {
            face.setFace("baked", "baked");
            blinkT = 0;
          } else if (paramFace && pf) face.setFaceParams(pf.p, pf.mouth, pf.eyes);
          else if (f) face.setFace(f.eyes, f.mouth);
          else if (drowsyRef.current) {
            // §2 탈진: 반쯤 감은 눈 + 6초 주기 하품 (1.2초 벌림).
            const yaw = t % 6;
            face.setFace("closed", yaw < 1.2 ? "open" : "baked");
            blinkT = 0;
          } else if (reviewBlink) {
            // R-C 리뷰: 감은 눈 고정 (깜빡임 프레임 촬영용).
            face.setFace("closed", "baked");
            blinkT = 0;
          } else {
            // 2.4초 주기 눈 깜빡임 (120ms).
            // FN-1: 깜빡임은 덧대기라 상수로 완전히 끈다 (face=null라 이중 차단).
            if (FACE_PAINT_ENABLED) blinkT += dt;
            if (blinkT > 2.4) face.setFace("closed", "baked");
            if (blinkT > 2.52) {
              face.setFace("baked", "baked");
              blinkT = 0;
            }
          }
          if (emote !== "idle" || dancing) blinkT = 0;
        }
        face3d?.update(dt, t, {
          emote, emoteT, dancing, drowsy: drowsyRef.current, frozen: battleIdle, closed: reviewBlink,
        });
        // FN-1: 감정 아이콘 상승·페이드 (face 유무와 무관).
        emoteIcon.update(t, dt);
        // 디저트 프롭: fetch/beg엔 앞에, chomp엔 입(무입은 품)으로 이동하며 축소.
        if (emote === "fetch" || emote === "beg" || emote === "want") {
          cake.visible = true;
          cake.position.copy(cakeHome);
          cake.scale.setScalar(1);
        } else if (emote === "chomp" || emote === "eat") {
          cake.visible = true;
          const ck = Math.sin(Math.min(k * 1.3, 1) * Math.PI);
          cake.position.lerpVectors(cakeHome, hugMode ? cakeHug : cakeMouth, ck);
          cake.scale.setScalar(Math.max(0.12, 1 - ck * 0.88));
        } else {
          cake.visible = false;
        }
        // 접지 추적: 링/그림자가 액터 x/z를 따라다녀 붕 뜬 느낌 제거.
        summon.position.x = actor.position.x;
        summon.position.z = actor.position.z;
        ring.position.x = actor.position.x;
        ring.position.z = actor.position.z;
        shadow.position.x = actor.position.x;
        shadow.position.z = actor.position.z;
        holo.quaternion.copy(camera.quaternion);
        halo.quaternion.copy(camera.quaternion);
        uniforms.uTime.value = t;
        uniforms.uOpacity.value = op;
        uniforms.uGlowStrength.value = glowS;
        haloMat.opacity = haloO;

        // 소환진은 천천히 회전. 9-B 후속: 배틀 대기 중에는 고정 (검증샷 결정적).
        if (!battleIdle) {
          summon.rotation.z += dt * 0.35;
          summonMat.opacity = 0.32 + 0.1 * Math.sin(t * 1.6);
        }
      }
      if (capT >= 0) {
        capT += dt;
        const ck = capT / 1.1;
        if (ck >= 1) {
          capT = -1;
        } else {
          float.position.y = Math.sin(ck * Math.PI) * 0.5;
          float.rotation.y = ck * Math.PI * 2;
        }
      } else if (calm) {
        float.position.y = 0;
        float.rotation.y = 0;
      }
      renderer!.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      try { emoteIcon.dispose(); } catch { /* noop */ }
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (dracoLoader) dracoLoader.dispose();
      scene.traverse((o) => {
        // 3-1: 이 씬에 THREE.Points가 없음(motes 제거). Mesh만 정리.
        const m = o as unknown as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mm) => {
            const anyMat = mm as unknown as { map?: THREE.Texture | null; uniforms?: { uMap?: { value?: THREE.Texture | null } } };
            if (anyMat.map) anyMat.map.dispose();
            if (anyMat.uniforms?.uMap?.value) (anyMat.uniforms.uMap.value as THREE.Texture).dispose();
            (mm as THREE.Material).dispose();
          });
        }
      });
      renderer!.dispose();
      if (renderer!.domElement.parentNode === mount) mount.removeChild(renderer!.domElement);
    };
  }, [element, modelUrl, portraitUrl, tintUrl, speciesId, ground, videoBg]);

  if (failed) return <p className="hint">{failed}</p>;
  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
});

export default PovCreature;
