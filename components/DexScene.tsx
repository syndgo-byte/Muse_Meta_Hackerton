"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { rigObject, type PuppetRig } from "@/lib/puppetRig";
import { buildRiggedRig, loadBonesManifest, rigMode, riggedUrl, type RiggedRig } from "@/lib/riggedModel";
import { attachFace3D, type Face3D } from "@/lib/face3d";
import { B_ARML, B_ARMR, B_HEAD, B_LEGL, B_LEGR, B_TORSO, buildAutoRig, neutralPose, type AutoRig } from "@/lib/autoRig";
import { dancePose, danceRoot, pickDance, testTurns, type DanceClip } from "@/lib/motion/dances";
import { ROSTER } from "@/lib/species";
import { recordActivityDance, shouldRecordDanceEnd } from "@/lib/activity";

// LV-2: 마지막 춤 기록 (연타 중복 방지용).
let lastDanceId = "";
let lastDanceAt = 0;

// MOTION-3: stable per-species seed so arrivals alternate/rotate dances.
function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

export type DexHandle = { next: () => void; prev: () => void };

const ELEMENT_GLOW: Record<string, number> = {
  fire: 0xff9a3c,
  grass: 0x9fe870,
  water: 0x7cc7ff,
  rock: 0xffc46b,
  wind: 0xd6fff1,
};

// 속성 표식은 게임 심볼(다이아)로 통일. 이모티콘 사용 금지.

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 고해상도 명판 텍스처 (속성 아이콘 + 이름 + 포획 상태)
function plateTexture(text: string, element: string, isCap: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 140;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 140);

  // 반투명 다크 배경 + 속성 테두리
  g.fillStyle = "rgba(10, 16, 12, 0.88)";
  rr(g, 10, 10, 492, 120, 24);
  g.fill();

  const glowColor = isCap
    ? element === "fire" ? "#f97316" : element === "grass" ? "#22c55e" : element === "water" ? "#38bdf8" : element === "rock" ? "#eab308" : "#a7f3d0"
    : "#64748b";

  g.strokeStyle = glowColor;
  g.lineWidth = 5;
  rr(g, 10, 10, 492, 120, 24);
  g.stroke();

  // §6 이름 텍스트만 중앙 표기 (다이아 심볼 삭제).
  g.fillStyle = "#ffffff";
  g.font = "bold 50px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 72, 390);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function softDot(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// 24마리 원형 턴테이블 링 (R = 9.5)
const RING_R = 9.5;

const DexScene = forwardRef<
  DexHandle,
  {
    captured: string[];
    seen: string[];
    onSelect: (id: string) => void;
    onStatus?: (s: string) => void;
    activeId?: string | null;
    stageTier?: 0 | 1 | 2;
    onDanceTick?: (danceId: string | null, beat124: number, speciesId?: string) => void;
  }
>(function DexScene({ captured, seen, onSelect, onStatus, activeId, stageTier, onDanceTick }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  // 8-H-0b: selected dancer's clip + beat + species for the compare window (no re-render).
  const tickRef = useRef(onDanceTick);
  tickRef.current = onDanceTick;
  const navRef = useRef<{ theta: number; target: number }>({ theta: 0, target: 0 });
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = activeId ?? null;
  const tierRef = useRef(0);
  tierRef.current = stageTier ?? 0;

  useImperativeHandle(ref, () => ({
    next: () => {
      const n = navRef.current;
      n.target -= (Math.PI * 2) / ROSTER.length;
    },
    prev: () => {
      const n = navRef.current;
      n.target += (Math.PI * 2) / ROSTER.length;
    },
  }));

  // activeId 변경 시 해당 위치로 카메라 회전
  useEffect(() => {
    if (!activeId) return;
    const idx = ROSTER.findIndex((s) => s.id === activeId);
    if (idx < 0) return;
    const targetAngle = (idx / ROSTER.length) * Math.PI * 2;
    const nav = navRef.current;
    const diff = ((targetAngle - nav.theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    nav.target = nav.theta + diff;
  }, [activeId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer | null = null;
    let raf = 0;
    let disposed = false;
    const clock = new THREE.Clock();
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nav = navRef.current;
    let lastTouch = -10;
    let readySent = false;

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed("이 브라우저에서 WebGL을 쓸 수 없어요.");
      onStatus?.("dex-error");
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1310);
    scene.fog = new THREE.Fog(0x0e1310, 22, 48);

    // 하단 UI 패널에 가리지 않도록 카메라를 살짝 높이고 위쪽을 바라봄
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
    // §4 슬롯별 독립 레이어 격리: 24 슬롯이 1..31 레이어를 나눠 쓰고 카메라는 전부 관측.
    camera.layers.enableAll();

    renderer.setClearColor(0x0e1310, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    // 조명 세팅: 화사하고 선명한 전면광 + 상단 환경광
    scene.add(new THREE.HemisphereLight(0xffffff, 0x1f2e24, 1.1));
    const sun = new THREE.DirectionalLight(0xfff6ea, 1.8);
    sun.position.set(5, 12, 6);
    scene.add(sun);

    const camLight = new THREE.DirectionalLight(0xffffff, 2.0);
    scene.add(camLight);
    scene.add(camLight.target);

    // 턴테이블 바닥
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(18, 48),
      new THREE.MeshStandardMaterial({ color: 0x16221a, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const grid = new THREE.GridHelper(36, 36, 0x367a57, 0x1e3025);
    grid.position.y = 0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    scene.add(grid);

    // 센터 스포트라이트 무대 (선택된 크리처를 위한 공중 런웨이 발판 & 원형 네온 오라)
    const spotGroup = new THREE.Group();
    scene.add(spotGroup);

    const spotPed = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.6, 0.35, 32),
      new THREE.MeshStandardMaterial({ color: 0x223328, roughness: 0.6, metalness: 0.2 })
    );
    spotPed.position.y = 0.18;
    spotGroup.add(spotPed);

    const spotRing = new THREE.Mesh(
      new THREE.RingGeometry(1.45, 1.75, 48),
      new THREE.MeshBasicMaterial({
        color: 0x9fe870,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    spotRing.rotation.x = -Math.PI / 2;
    spotRing.position.y = 0.36;
    spotGroup.add(spotRing);

    const spotLight = new THREE.PointLight(0x9fe870, 70, 16);
    spotLight.position.y = 2.8;
    spotGroup.add(spotLight);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2b332d, roughness: 0.85 });
    const pedGeo = new THREE.CylinderGeometry(0.95, 1.15, 0.5, 20);
    const hitMeshes: THREE.Mesh[] = [];
    const dancers: Array<{
      id: string;
      angle: number;
      g: THREE.Group;
      spin: THREE.Group;
      plate: THREE.Mesh;
      ped: THREE.Mesh;
      glow: number;
      update: (t: number, beat: number, bar: number, amp: number, center: boolean) => void;
    }> = [];
    const auras: Array<{ pts: THREE.Points; seeds: Float32Array }> = [];
    const dotTex = softDot();
    const gltfLoader = new GLTFLoader();
    // R-B-1·6: 리그 모드 + 테스트 춤 모드 (URL 1회 판독).
    const useRigged = rigMode() !== "auto";
    const forceTestDance = new URLSearchParams(window.location.search).get("dance") === "test";
    // R-B 리뷰용: ?beat=<124박>이면 춤 시계를 그 박에 고정 (정확한 포즈 확인용).
    const beatFrozen = (() => {
      const v = new URLSearchParams(window.location.search).get("beat");
      const n = v === null ? NaN : parseFloat(v);
      return Number.isFinite(n) ? n : null;
    })();
    // 8-H-2 리뷰용: ?pose=sit|kick|armsup|back면 중앙 크리처에 고정 포즈.
    // 쿼리 없으면 동작 변화 없음.
    const poseName = (() => {
      const v = new URLSearchParams(window.location.search).get("pose");
      return v === "sit" || v === "kick" || v === "armsup" || v === "back" ? v : null;
    })();
    let bonesManifest: Record<string, string[]> | null = null;
    const pendingLoads: Array<() => void> = [];

    ROSTER.forEach((sp, i) => {
      const a = (i / ROSTER.length) * Math.PI * 2;
      const x = Math.cos(a) * RING_R;
      const z = Math.sin(a) * RING_R;
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      // §4: 이 슬롯 전용 레이어 (layer 0은 무대/조명 공용).
      const slotLayer = 1 + (i % 31);
      g.layers.set(slotLayer);

      // ★ 크리처 정면이 바깥쪽(카메라 쪽)을 똑바로 바라보도록 세팅!
      // 원점에서 바깥 (x, z) 방향을 바라보게 함
      g.lookAt(x * 2, 0, z * 2);

      const ped = new THREE.Mesh(pedGeo, stoneMat);
      ped.position.y = 0.25;
      g.add(ped);

      // 클릭용 투명 히트박스
      const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      proxyMat.colorWrite = false;
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.2, 12), proxyMat);
      proxy.position.y = 1.3;
      proxy.userData.speciesId = sp.id;
      g.add(proxy);
      hitMeshes.push(proxy);

      const isCap = captured.includes(sp.id);
      const isKnown = isCap || seen.includes(sp.id);
      const glowHex = ELEMENT_GLOW[sp.element] ?? 0x9fe870;

      const spin = new THREE.Group();
      spin.position.y = 0;
      spin.userData.speciesId = sp.id;
      g.add(spin);

      let rig: PuppetRig | null = null;
      let rigged: RiggedRig | null = null;
      let auto: AutoRig | null = null;
      let face3d: Face3D | null = null; // EL-1: GLB 셰이프 키 눈꺼풀·입
      let face3dT = 0;
      let ateezLive = false;
      let live = false;
      let clip: DanceClip | null = null;
      let arrivals = 0;
      let playedDanceId: string | null = null;

      const origUrl = `/models/${sp.id}.glb`;
      // R-B-1: 리그 GLB 우선, 실패하면 원본+autoRig으로 1회 되돌림.
      const loadSpecies = (url: string, fallback: boolean): void => {
        gltfLoader.load(url,
          // (URL은 loadSpecies 인자)
        (gltf) => {
          if (disposed) return;
          live = true;
          const obj = gltf.scene;
          const isRiggedLoad = url !== origUrl;
          const bbox = new THREE.Box3().setFromObject(obj);
          const size = bbox.getSize(new THREE.Vector3());
          const center = bbox.getCenter(new THREE.Vector3());
          const s = 1.7 / Math.max(size.x, size.y, size.z, 0.001);
          obj.scale.setScalar(s);
          obj.position.set(-center.x * s, 0.5 - bbox.min.y * s, -center.z * s);

          obj.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mm) => {
              const mat = mm as unknown as THREE.MeshStandardMaterial;
              if (mat && "emissive" in mat) {
                mat.metalness = 0;
                mat.roughness = 0.65;
                mat.normalMap = null;
                if (isCap) {
                  if (mat.map) {
                    mat.emissive = new THREE.Color(0xffffff);
                    mat.emissiveMap = mat.map;
                    mat.emissiveIntensity = 0.35;
                  }
                } else {
                  mat.emissive = new THREE.Color(glowHex);
                  mat.emissiveIntensity = 0.65;
                  mat.transparent = true;
                  mat.opacity = 0.55;
                }
              }
            });
          });

          try {
            // 리그 경로는 rigObject를 쓰지 않는다 (월드 베이크가 스키닝을 깬다).
            rig = isRiggedLoad ? null : rigObject(obj);
          } catch {
            rig = null;
          }

          const placed = rig ? rig.group : obj;
          spin.add(placed);
          placed.traverse((o) => {
            // §4: 슬롯 레이어 격리 + frustumCulled=true (리지드 리그라 바운드 유효).
            o.layers.set(slotLayer);
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.userData.speciesId = sp.id;
              m.frustumCulled = true;
              try {
                m.geometry.computeBoundingSphere();
              } catch {
                /* keep renderer-computed bounds */
              }
              hitMeshes.push(m);
            }
          });
          // §6 ATEEZ 캡슐 본 리그: 휴지 bbox 기준 (PovCreature와 동일 절차).
          // 스킨 슬롯은 정점 변형 후 바운드가 무효라 frustumCulled=false (POV 선례).
          try {
            scene.updateMatrixWorld(true);
            const gb = new THREE.Box3().setFromObject(placed);
            if (Number.isFinite(gb.min.y) && Number.isFinite(gb.max.y)) {
              if (isRiggedLoad) {
                rigged = buildRiggedRig(obj, sp.id, bonesManifest?.[sp.id]);
                face3d = rigged ? attachFace3D(obj, sp.id) : null;
                if (!rigged) {
                  loadSpecies(origUrl, false);
                  return;
                }
              } else auto = buildAutoRig(placed, gb);
              if (auto) {
                placed.traverse((o) => {
                  const m = o as THREE.Mesh;
                  if (m.isMesh) m.frustumCulled = false;
                });
              }
            }
          } catch {
            auto = null;
          }
        },
        undefined,
        () => { if (fallback) loadSpecies(origUrl, false); }
      );

      };
      pendingLoads.push(() => loadSpecies(
        useRigged && bonesManifest?.[sp.id] ? riggedUrl(sp.id) : origUrl, useRigged));

      // 속성 파티클 오라
      if (isCap) {
        const N = 12;
        const p = new Float32Array(N * 3);
        const seeds = new Float32Array(N * 2);
        for (let k = 0; k < N; k++) {
          p[k * 3] = (Math.random() - 0.5) * 1.8;
          p[k * 3 + 1] = Math.random() * 2.2;
          p[k * 3 + 2] = (Math.random() - 0.5) * 1.8;
          seeds[k * 2] = Math.random() * Math.PI * 2;
          seeds[k * 2 + 1] = 0.2 + Math.random() * 0.4;
        }
        const ageo = new THREE.BufferGeometry();
        ageo.setAttribute("position", new THREE.BufferAttribute(p, 3));
        const am = new THREE.PointsMaterial({
          size: 0.12,
          map: dotTex,
          transparent: true,
          color: glowHex,
          depthWrite: false,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
        });
        const pts = new THREE.Points(ageo, am);
        pts.position.y = 0.5;
        g.add(pts);
        auras.push({ pts, seeds });
      }

      // 플로팅 네임택: 머리 위쪽에 띄우고 매 프레임 카메라를 정면 응시.
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 0.52),
        new THREE.MeshBasicMaterial({
          map: plateTexture(isKnown ? sp.name : "???", sp.element, isCap),
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      plate.position.set(0, 2.55, 0.3);
      plate.userData.speciesId = sp.id;
      g.add(plate);
      hitMeshes.push(plate);

      // §4: 동기 자식(발판/히트박스/명판/오라)도 슬롯 레이어로 격리 + 컬링 명시.
      // 비동기 로드 모델은 loader 콜백에서 동일 처리 (위 placed.traverse).
      g.traverse((o) => {
        o.layers.set(slotLayer);
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.frustumCulled = true;
          try {
            m.geometry.computeBoundingSphere();
          } catch {
            /* keep renderer-computed bounds */
          }
        }
      });

      dancers.push({
        id: sp.id,
        angle: a,
        g,
        spin,
        plate,
        ped,
        glow: glowHex,
        update: (t, beat, bar, amp, center) => {
          if (!live) return;
          if (face3d) {
            face3d.update(Math.min(0.1, Math.max(0, t - face3dT)), t, { emote: "idle", emoteT: 0, dancing: center });
            face3dT = t;
          }
          if (rig) {
            rig.update({
              emote: "idle",
              k: 0,
              t,
              dancing: false, // R-B-7: 뼈 춤과 puppet 그루브 이중 모션 금지
              beat,
              amp,
            });
          }
          // MOTION-3: 중앙 도착 시 춤 1회 선택 후 데이터 클립 재생.
          // poseFor의 ateez 분기는 그대로 두어 기존 ateez:true 호출과 호환 유지.
          const updater = rigged ?? auto;
          if (updater) {
            if (center) {
              if (poseName) {
                // 8-H-2 리뷰 고정 포즈 (클립 대신 정적 자세).
                ateezLive = true;
                try { (window as unknown as { __dexPose?: string }).__dexPose = poseName; } catch { /* flag only */ }
                const pose = neutralPose();
                if (poseName === "kick") {
                  pose.rx[B_LEGR] = -1.0; pose.rx[B_LEGL] = 0.15;
                  pose.rx[B_TORSO] = 0.12; pose.rz[B_TORSO] = 0.15;
                  pose.rx[B_ARML] = -1.2; pose.rz[B_ARML] = 0.3;
                  pose.rx[B_ARMR] = 0.3; pose.rz[B_ARMR] = -0.2;
                  pose.rx[B_HEAD] = -0.1;
                } else if (poseName === "sit") {
                  pose.rx[B_LEGL] = 0.5; pose.rz[B_LEGL] = -0.5;
                  pose.rx[B_LEGR] = 0.5; pose.rz[B_LEGR] = 0.5;
                  pose.rx[B_TORSO] = 0.25; pose.rx[B_HEAD] = -0.15;
                  pose.rx[B_ARML] = -0.5; pose.rx[B_ARMR] = -0.5;
                } else if (poseName === "armsup") {
                  pose.rx[B_ARML] = -1.9; pose.rz[B_ARML] = 0.2;
                  pose.rx[B_ARMR] = -1.9; pose.rz[B_ARMR] = -0.2;
                  pose.rx[B_HEAD] = -0.25; pose.rx[B_TORSO] = -0.12;
                }
                spin.rotation.y = poseName === "back" ? Math.PI : 0;
                spin.position.set(0, poseName === "sit" ? -0.3 : 0, 0);
                updater.update(pose);
              } else if (!ateezLive) {
                arrivals += 1;
                clip = forceTestDance ? testTurns : pickDance(hashSeed(sp.id) + arrivals);
                playedDanceId = clip ? clip.id : null;
                ateezLive = true;
                if (clip) {
                  const pose = dancePose(clip, beat, neutralPose());
                  const rd = danceRoot(clip, beat);
                  // R-B-6: 춤 몸 회전·이동은 spin에만 (d.g 정면 lookAt과 분리).
                  // 조상(spin) 먼저, 본은 마지막 (같은 프레임에 신선한 부모 체인).
                  spin.rotation.y = rd.yaw;
                  spin.position.set(rd.x, rd.y, rd.z);
                  pose.ry[B_HEAD] = rd.headRy;
                  pose.ry[B_TORSO] += rd.torsoRyAdd;
                  updater.update(pose);
                  tickRef.current?.(clip.id, beat, sp.id); // 8-H-0b
                }
              } else if (clip) {
                const pose = dancePose(clip, beat, neutralPose());
                const rd = danceRoot(clip, beat);
                spin.rotation.y = rd.yaw;
                spin.position.set(rd.x, rd.y, rd.z);
                pose.ry[B_HEAD] = rd.headRy;
                pose.ry[B_TORSO] += rd.torsoRyAdd;
                updater.update(pose);
                tickRef.current?.(clip.id, beat, sp.id); // 8-H-0b
              }
            } else if (ateezLive) {
              // 중앙에서 내려오면 스킨을 1회 리셋하고 이후 손대지 않음.
              ateezLive = false;
              // LV-2: 춤 1회 재생 기록 (테스트 춤·포즈 제외, 연타 중복 방지).
              try {
                const now = Date.now();
                if (shouldRecordDanceEnd(playedDanceId, lastDanceId, lastDanceAt, now)) {
                  lastDanceId = playedDanceId as string;
                  lastDanceAt = now;
                  recordActivityDance();
                }
              } catch {
                /* ignore */
              }
              playedDanceId = null;
              spin.rotation.set(0, 0, 0);
              spin.position.set(0, 0, 0);
              updater.update(neutralPose());
            }
          }
        },
      });

      scene.add(g);
    });

    // R-B-1: 매니페스트 확인 후 모델 로드 시작 (2.5초 타임아웃 → 원본 경로).
    const manifestWait = useRigged
      ? Promise.race([loadBonesManifest(), new Promise<null>((res) => setTimeout(() => res(null), 2500))])
      : Promise.resolve(null);
    manifestWait.then((m) => {
      if (disposed) return;
      bonesManifest = m;
      pendingLoads.forEach((f) => f());
    }).catch(() => { if (!disposed) pendingLoads.forEach((f) => f()); });

    // 배경 반딧불이
    const N = 100;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 32;
      pos[i * 3 + 1] = Math.random() * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 32;
    }
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(
      mgeo,
      new THREE.PointsMaterial({ size: 0.09, color: 0xe2e8f0, transparent: true, opacity: 0.45, depthWrite: false })
    );
    scene.add(motes);

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

    // 드래그 회전 인터랙션
    let dragging = false;
    let lastX = 0;
    let downX = 0;
    let downY = 0;
    const el = renderer.domElement;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      downX = e.clientX;
      downY = e.clientY;
      lastTouch = clock.getElapsedTime();
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      nav.target += dx * 0.005;
      nav.theta = nav.target;
      lastTouch = clock.getElapsedTime();
    };

    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) return;
      const rect = el.getBoundingClientRect();
      const ptr = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ptr, camera);
      ray.layers.enableAll(); // §4: 슬롯 레이어(1..31) 피킹 허용
      const hits = ray.intersectObjects(hitMeshes, false);
      if (hits.length > 0) {
        const id = (hits[0].object as THREE.Mesh).userData.speciesId as string;
        if (id) {
          selectRef.current(id);
          const d = dancers.find((dd) => dd.id === id);
          if (d) {
            const diff = ((d.angle - nav.theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            nav.target = nav.theta + diff;
          }
        }
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = beatFrozen !== null ? (beatFrozen * 60) / 124 : clock.getElapsedTime();

      if (!calm) {
        if (t - lastTouch > 6) nav.target += 0.0007; // 은은한 자동 회전
        // §6 ATEEZ 케이던스 시간함수: beat=(time*124)/60.
        const beat = t * (124 / 60);
        const bar = beat % 4;

        const selId = selectedRef.current;

        for (const d of dancers) {
          const isSelected = selId != null && d.id === selId;
          d.update(t, beat, bar, (isSelected ? 1.4 : 0.9) * (1 + tierRef.current * 0.15), isSelected);

          if (isSelected) {
            // ★ 선택된 크리처: 화면 정중앙 앞 전면 무대(카메라 바로 앞 중앙)로 이동!
            // 카메라 각도(nav.theta) 선상에서 카메라 쪽(R=4.2), 하단 UI 위로 솟은 높이(Y=1.35)
            const targetX = Math.cos(nav.theta) * 4.2;
            const targetZ = Math.sin(nav.theta) * 4.2;
            const targetY = 1.35;
            const targetScale = 1.45;

            d.g.position.x += (targetX - d.g.position.x) * 0.12;
            d.g.position.y += (targetY - d.g.position.y) * 0.12;
            d.g.position.z += (targetZ - d.g.position.z) * 0.12;
            d.g.scale.setScalar(d.g.scale.x + (targetScale - d.g.scale.x) * 0.12);

            // ★ 360도 회전 중에도 스포트라이트 된 크리처는 카메라를 똑바로 정면 응시!
            d.g.lookAt(camera.position.x, d.g.position.y, camera.position.z);

            // 네임택은 머리 위 플로팅 (가림 완전 해결)
            d.plate.position.set(0, 2.5, 0.3);
            d.ped.visible = false; // 중앙 무대에서는 별도 전용 스포트라이트 발판 사용
          } else {
            // 비선택 크리처: 원래 링 궤도에 정렬
            const origX = Math.cos(d.angle) * RING_R;
            const origZ = Math.sin(d.angle) * RING_R;
            d.g.position.x += (origX - d.g.position.x) * 0.1;
            d.g.position.y += (0 - d.g.position.y) * 0.1;
            d.g.position.z += (origZ - d.g.position.z) * 0.1;
            d.g.scale.setScalar(d.g.scale.x + (1.0 - d.g.scale.x) * 0.1);

            // 링 위에서는 원점 바깥쪽을 바라봄
            d.g.lookAt(origX * 2, 0, origZ * 2);

            d.plate.position.set(0, 2.55, 0.3);
            d.ped.visible = true;
          }
          // 네임택은 항상 카메라를 정면 응시 (진짜 빌보드). 근거리는 축소.
          d.plate.lookAt(camera.position);
          const pdist = d.plate.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position);
          const pbase = isSelected ? 1.2 : 1.0;
          const pk = pbase * THREE.MathUtils.clamp(pdist / 9, 0.45, 1.15);
          d.plate.scale.set(pk, pk, pk);
        }

        // 스포트라이트 무대 위치 추적
        const sd = selId ? dancers.find((dd) => dd.id === selId) : undefined;
        if (sd) {
          spotGroup.visible = true;
          const targetX = Math.cos(nav.theta) * 4.2;
          const targetZ = Math.sin(nav.theta) * 4.2;
          spotGroup.position.set(targetX, 0, targetZ);
          (spotRing.material as THREE.MeshBasicMaterial).color.setHex(sd.glow);
          spotLight.color.setHex(sd.glow);
        } else {
          spotGroup.visible = false;
        }

        for (const a2 of auras) {
          const pa = a2.pts.geometry.getAttribute("position") as THREE.BufferAttribute;
          for (let k = 0; k < pa.count; k++) {
            let yy = pa.getY(k) + dt * a2.seeds[k * 2 + 1];
            if (yy > 2.4) yy = 0;
            pa.setY(k, yy);
            pa.setX(k, pa.getX(k) + Math.sin(t * 1.5 + a2.seeds[k * 2]) * dt * 0.15);
          }
          pa.needsUpdate = true;
        }
      }

      nav.theta += (nav.target - nav.theta) * 0.08;

      // ★ 카메라 위치 & 시선 타겟 최적화:
      // 하단 UI 패널 공간을 배려하여, 카메라를 위(Y=3.6)에 두고 시선을 중앙 상단으로 향함.
      // 7-3 19번: 시야를 조금 위로 (2.1 → 2.35) 올려 뒤쪽 크리처가 더 보이게 한다.
      camera.position.set(Math.cos(nav.theta) * 13.8, 3.6, Math.sin(nav.theta) * 13.8);
      camera.lookAt(0, 2.35, 0);

      camLight.position.copy(camera.position);
      camLight.target.position.set(0, 2.35, 0);

      if (!readySent) {
        readySent = true;
        onStatus?.("dex-ready");
      }
      renderer!.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      scene.traverse((o) => {
        if ((o as unknown as THREE.Points).isPoints) {
          const p = o as unknown as THREE.Points;
          p.geometry.dispose();
          (p.material as THREE.Material).dispose();
          return;
        }
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach((mm) => {
            const am = mm as unknown as THREE.MeshBasicMaterial;
            if (am.map) am.map.dispose();
            (mm as THREE.Material).dispose();
          });
        }
      });
      dotTex.dispose();
      renderer!.dispose();
      if (renderer!.domElement.parentNode === mount) mount.removeChild(renderer!.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return <p className="hint">{failed}</p>;
  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
});

export default DexScene;
