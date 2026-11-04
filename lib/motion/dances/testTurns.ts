// R-B-6 시연용 테스트 클립 (손으로 씀, 8박/16키). ?dance=test일 때만 선택.
// - 0~1.5박: 돌려차기 1회 (yaw 0→360°, 240°/박이라 머리 보정 꺼짐)
// - 1.5~4박: 정면 춤
// - 4~6박: 옆으로 서서(+90°) 정면 응시 2박 (머리 ry가 -yaw로 보정)
// - 6~8박: 되돌아오기 (역회전, 다시 정면)
// 한 바퀴 끝 yaw = 시작 yaw = 0 (루프 이음매 역회전 없음).
// root.x·z는 ±0.3 안, sy는 ±3% 안으로 씀.
import type { DanceClip } from "./types";

const TAU = Math.PI * 2;

export const testTurns: DanceClip = {
  id: "test",
  bpm: 124,
  counts: 8,
  keys: [
    // k0 b0.0: 차기 시작, 양팔 위
    { torso: { rx: 0.1, ry: 0, rz: 0.1, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -1.5, rz: 0.3 }, armR: { rx: -1.5, rz: -0.3 }, legL: { rx: 0, rz: 0 }, legR: { rx: -0.5, rz: 0 }, root: { yaw: 0, x: 0, y: 0, z: 0 } },
    // k1 b0.5: 회전 중, 오른발 차올림
    { torso: { rx: 0.15, ry: 0, rz: 0.15, sy: 1.02 }, head: { rx: 0, rz: 0 }, armL: { rx: -1.5, rz: 0.5 }, armR: { rx: -1.2, rz: -0.5 }, legL: { rx: 0, rz: 0 }, legR: { rx: -0.6, rz: 0.1 }, root: { yaw: TAU / 3, x: 0, y: 0.05, z: 0 } },
    // k2 b1.0: 회전 중
    { torso: { rx: 0.15, ry: 0, rz: -0.15, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -1.2, rz: 0.5 }, armR: { rx: -1.5, rz: -0.5 }, legL: { rx: -0.3, rz: 0 }, legR: { rx: -0.4, rz: 0 }, root: { yaw: (TAU * 2) / 3, x: 0, y: 0.05, z: 0 } },
    // k3 b1.5: 360° 도착, 착지
    { torso: { rx: 0.2, ry: 0, rz: 0, sy: 0.97 }, head: { rx: 0.1, rz: 0 }, armL: { rx: -0.8, rz: 0.6 }, armR: { rx: -0.8, rz: -0.6 }, legL: { rx: -0.2, rz: -0.1 }, legR: { rx: -0.2, rz: 0.1 }, root: { yaw: TAU, x: 0, y: 0, z: 0 } },
    // k4 b2.0: 정면 그루브
    { torso: { rx: 0.1, ry: 0.1, rz: 0.1, sy: 1.0 }, head: { rx: 0, rz: 0.1 }, armL: { rx: -0.6, rz: 0.8 }, armR: { rx: -0.6, rz: -0.8 }, legL: { rx: -0.3, rz: 0 }, legR: { rx: 0.1, rz: 0 }, root: { yaw: TAU, x: 0, y: 0, z: 0 } },
    // k5 b2.5
    { torso: { rx: 0.1, ry: -0.1, rz: -0.1, sy: 1.03 }, head: { rx: 0, rz: -0.1 }, armL: { rx: -0.9, rz: 0.6 }, armR: { rx: -0.4, rz: -0.6 }, legL: { rx: 0.1, rz: 0 }, legR: { rx: -0.3, rz: 0 }, root: { yaw: TAU, x: 0, y: 0.02, z: 0 } },
    // k6 b3.0
    { torso: { rx: 0.15, ry: 0.1, rz: 0.1, sy: 1.0 }, head: { rx: 0.1, rz: 0 }, armL: { rx: -0.6, rz: 0.8 }, armR: { rx: -0.6, rz: -0.8 }, legL: { rx: -0.3, rz: 0 }, legR: { rx: 0.1, rz: 0 }, root: { yaw: TAU, x: 0, y: 0, z: 0 } },
    // k7 b3.5: 옆서기 준비
    { torso: { rx: 0.05, ry: 0, rz: 0, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -0.3, rz: 0.4 }, armR: { rx: -0.3, rz: -0.4 }, legL: { rx: 0, rz: 0 }, legR: { rx: 0, rz: 0 }, root: { yaw: TAU, x: 0, y: 0, z: 0 } },
    // k8 b4.0: 옆으로 (+90°), 정면 응시 시작
    { torso: { rx: 0, ry: 0, rz: 0, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -0.2, rz: 0.3 }, armR: { rx: -0.2, rz: -0.3 }, legL: { rx: 0, rz: 0 }, legR: { rx: 0, rz: 0 }, root: { yaw: TAU + Math.PI / 2, x: 0.15, y: 0, z: 0 } },
    // k9 b4.5: 응시 유지, 가벼운 인사 손
    { torso: { rx: 0.05, ry: 0, rz: 0, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -0.5, rz: 0.3 }, armR: { rx: -0.2, rz: -0.3 }, legL: { rx: 0, rz: 0 }, legR: { rx: 0, rz: 0 }, root: { yaw: TAU + Math.PI / 2, x: 0.15, y: 0, z: 0 } },
    // k10 b5.0
    { torso: { rx: 0, ry: 0, rz: 0, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -0.2, rz: 0.3 }, armR: { rx: -0.2, rz: -0.3 }, legL: { rx: 0, rz: 0 }, legR: { rx: 0, rz: 0 }, root: { yaw: TAU + Math.PI / 2, x: 0.15, y: 0, z: 0 } },
    // k11 b5.5
    { torso: { rx: 0.05, ry: 0, rz: 0, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -0.2, rz: 0.3 }, armR: { rx: -0.5, rz: -0.3 }, legL: { rx: 0, rz: 0 }, legR: { rx: 0, rz: 0 }, root: { yaw: TAU + Math.PI / 2, x: 0.15, y: 0, z: 0 } },
    // k12 b6.0: 되돌아오기 시작 (역회전)
    { torso: { rx: 0.1, ry: 0, rz: 0, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -0.6, rz: 1.0 }, armR: { rx: -0.6, rz: -1.0 }, legL: { rx: -0.2, rz: 0 }, legR: { rx: -0.2, rz: 0 }, root: { yaw: TAU + Math.PI / 2, x: 0.1, y: 0, z: 0 } },
    // k13 b6.5
    { torso: { rx: 0.1, ry: 0, rz: -0.1, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -0.6, rz: 1.0 }, armR: { rx: -0.6, rz: -1.0 }, legL: { rx: 0.1, rz: 0 }, legR: { rx: -0.2, rz: 0 }, root: { yaw: 5.89, x: 0.05, y: 0, z: 0 } },
    // k14 b7.0
    { torso: { rx: 0.1, ry: 0, rz: 0.1, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -0.6, rz: 1.0 }, armR: { rx: -0.6, rz: -1.0 }, legL: { rx: -0.2, rz: 0 }, legR: { rx: 0.1, rz: 0 }, root: { yaw: 3.927, x: 0, y: 0, z: 0 } },
    // k15 b7.5: 정면 복귀 (다음 루프 k0 yaw=0과 이음매 일치)
    { torso: { rx: 0.05, ry: 0, rz: 0, sy: 1.0 }, head: { rx: 0, rz: 0 }, armL: { rx: -1.0, rz: 0.5 }, armR: { rx: -1.0, rz: -0.5 }, legL: { rx: 0, rz: 0 }, legR: { rx: 0, rz: 0 }, root: { yaw: 1.963, x: 0, y: 0, z: 0 } },
  ],
};
