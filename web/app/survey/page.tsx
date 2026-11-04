"use client";
// R2 전수 표정 검증 하네스 (TODO(survey-temp): 검증 후 삭제).
// 1개 탭에서 24종을 순차 리마운트하며 표정 상태 로그만 수집한다.
// - WebGL 컨텍스트는 항상 1개 (종마다 완전 dispose 후 다음 종)
// - HDRI 미사용 (ground=null, RoomEnvironment만) → 가벼움
// - 캡처는 종당 3장(happy/chomp-1/chomp-2) 저해상도 스냅샷으로 고정
import nextDynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PovHandle } from "@/components/PovCreature";
import { ROSTER } from "@/lib/species";
import { speciesHasMouth, speciesNoFace } from "@/lib/facePaint";

const PovCreature = nextDynamic(() => import("@/components/PovCreature"), { ssr: false });

export const dynamic = "force-dynamic";

type FaceState = { id: string; ok: boolean; mouthLive: boolean };
type Verdict = "PENDING" | "RUN" | "PASS" | "FAIL" | "REVIEW" | "TIMEOUT";
type Shot = { label: string; url: string };
type Row = {
  id: string;
  name: string;
  element: string;
  expectMouth: boolean;
  expectFace: boolean;
  status: string;
  face: FaceState | null;
  logs: string[];
  shots: Shot[];
  verdict: Verdict;
  note: string;
};

function initRows(): Row[] {
  return ROSTER.map((sp) => ({
    id: sp.id,
    name: sp.name,
    element: sp.element,
    expectMouth: speciesHasMouth(sp.id),
    expectFace: !speciesNoFace(sp.id),
    status: "",
    face: null,
    logs: [],
    shots: [],
    verdict: "PENDING",
    note: "",
  }));
}

function judge(
  id: string,
  status: string,
  face: FaceState | null,
  logs: string[]
): { verdict: Verdict; note: string } {
  if (status.startsWith("3d-error")) return { verdict: "FAIL", note: status };
  if (!face) return { verdict: "TIMEOUT", note: "face 상태 미수신(20s)" };
  if (logs.some((l) => l.includes("patches=NULL")))
    return { verdict: "FAIL", note: "eye patches=NULL" };
  if (logs.some((l) => /textured=0\b/.test(l)))
    return { verdict: "FAIL", note: "textured=0" };
  if (!speciesNoFace(id)) {
    if (!face.ok) return { verdict: "FAIL", note: "attachFace ok=false" };
    if (speciesHasMouth(id) && !face.mouthLive)
      return { verdict: "FAIL", note: "mouthLive=false (입 paint 실패)" };
    if (!speciesHasMouth(id) && face.mouthLive)
      return { verdict: "REVIEW", note: "무입종인데 mouthLive=true" };
  } else if (face.ok) {
    return { verdict: "REVIEW", note: "noFace인데 ok=true" };
  }
  return { verdict: "PASS", note: "" };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const VCOLOR: Record<Verdict, string> = {
  PENDING: "#64748b",
  RUN: "#38bdf8",
  PASS: "#22c55e",
  FAIL: "#ef4444",
  REVIEW: "#eab308",
  TIMEOUT: "#f97316",
};

export default function SurveyPage() {
  const handleRef = useRef<PovHandle>(null);
  const [rows, setRows] = useState<Row[]>(initRows);
  const [cur, setCur] = useState(-1);
  const [running, setRunning] = useState(false);
  const [sceneStatus, setSceneStatus] = useState("");
  const gateRef = useRef<{ id: string; resolve: (v: FaceState | null) => void } | null>(null);
  const statusRef = useRef("");
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const curIdRef = useRef("");

  // PovCreature effect 의존성에 들어가므로 반드시 stable 콜백 + ref 경유.
  const handleStatus = useCallback((s: string) => {
    statusRef.current = s;
    setSceneStatus(s);
  }, []);
  const handleFaceStatus = useCallback((s: FaceState) => {
    const g = gateRef.current;
    if (!g || g.id !== s.id) return; // 이전 종의 늦은 콜백은 무시
    gateRef.current = null;
    g.resolve(s);
  }, []);

  // [dbgface]/[dbgpaint]/[dbgrig] 콘솔 수집 (원본 출력은 유지).
  useEffect(() => {
    const orig = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      try {
        const line = args.map((a) => String(a)).join(" ");
        if (/\[dbg(face|paint|rig)\]/.test(line) && curIdRef.current) {
          const id = curIdRef.current;
          setRows((prev) => prev.map((r) => (r.id === id ? { ...r, logs: [...r.logs, line].slice(-12) } : r)));
        }
      } catch {
        /* ignore */
      }
      orig(...args);
    };
    return () => {
      console.log = orig;
    };
  }, []);

  function patchRow(idx: number, p: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  }

  async function runOne(idx: number) {
    const sp = ROSTER[idx];
    curIdRef.current = sp.id;
    statusRef.current = "";
    patchRow(idx, { verdict: "RUN", logs: [], shots: [], note: "", status: "", face: null });
    setCur(idx);
    const face = await new Promise<FaceState | null>((resolve) => {
      gateRef.current = { id: sp.id, resolve };
      window.setTimeout(() => {
        if (gateRef.current?.id === sp.id) {
          gateRef.current = null;
          resolve(null);
        }
      }, 20000);
    });
    const status = statusRef.current;
    const h = handleRef.current;
    if (stopRef.current) {
      patchRow(idx, { status, face, verdict: "REVIEW", note: "사용자 중단" });
      return;
    }
    if (!face || !h) {
      const j = judge(sp.id, status, face, []);
      patchRow(idx, { status, face, verdict: j.verdict, note: !h ? "핸들 없음" : j.note });
      return;
    }
    await sleep(1200);
    if (stopRef.current) {
      patchRow(idx, { status, face, verdict: "REVIEW", note: "사용자 중단" });
      return;
    }
    const shots: Shot[] = [];
    const snap = (label: string) => {
      try {
        const url = handleRef.current?.snapshot();
        if (url) shots.push({ label, url });
      } catch {
        /* ignore */
      }
    };
    h.emote("happy");
    await sleep(1400);
    snap("happy");
    h.emote("chomp");
    await sleep(900);
    snap("chomp-1");
    await sleep(400);
    snap("chomp-2");
    h.emote("idle");
    // 로그 state 최신값은 다음 틱에 읽는다.
    await sleep(50);
    patchRow(idx, { status, face, shots });
    setRows((prev) => {
      const target = prev[idx];
      const j = judge(sp.id, status, face, target.logs);
      return prev.map((r, i) => (i === idx ? { ...r, verdict: j.verdict, note: j.note } : r));
    });
  }

  async function runAll() {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    try {
      for (let i = 0; i < ROSTER.length; i++) {
        if (stopRef.current) break;
        await runOne(i);
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  function downloadJson() {
    const payload = {
      at: new Date().toISOString(),
      rows: rows.map(({ shots, ...r }) => ({ ...r, shots: shots.map((s) => s.label) })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `survey-r2-${Date.now()}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const cur_sp = cur >= 0 ? ROSTER[cur] : null;
  const counts = rows.reduce<Record<Verdict, number>>(
    (acc, r) => ({ ...acc, [r.verdict]: acc[r.verdict] + 1 }),
    { PENDING: 0, RUN: 0, PASS: 0, FAIL: 0, REVIEW: 0, TIMEOUT: 0 }
  );

  return (
    <div style={{ background: "#060a12", color: "#fff", minHeight: "100vh", padding: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 900, margin: "0 0 4px" }}>R2 전수 표정 검증 (24종 · 1탭 순회)</h1>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
        WebGL 컨텍스트 1개 · HDRI 없음 · 종당 스냅샷 3장 고정 · 상태: {sceneStatus || "-"}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => void runAll()}
          disabled={running}
          className="hud-btn hud-btn-primary"
          style={{ padding: "10px 18px", fontWeight: 900 }}
        >
          {running ? `실행 중… (${counts.PASS + counts.FAIL + counts.REVIEW + counts.TIMEOUT}/24)` : "전체 실행"}
        </button>
        <button
          onClick={() => { stopRef.current = true; }}
          disabled={!running}
          className="hud-btn"
          style={{ padding: "10px 18px", fontWeight: 800 }}
        >
          중단
        </button>
        <button
          onClick={downloadJson}
          className="hud-btn"
          style={{ padding: "10px 18px", fontWeight: 800 }}
        >
          JSON 저장
        </button>
        <div style={{ marginLeft: "auto", fontSize: 12, alignSelf: "center" }}>
          PASS {counts.PASS} · FAIL {counts.FAIL} · REVIEW {counts.REVIEW} · TIMEOUT {counts.TIMEOUT} · 대기 {counts.PENDING}
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ position: "sticky", top: 16 }}>
          <div style={{ position: "relative", width: 440, height: 330, background: "#0e1310", borderRadius: 12, border: "1px solid #2f6b4f", overflow: "hidden" }}>
            {cur_sp ? (
              <PovCreature
                key={cur_sp.id}
                handleRef={handleRef}
                element={cur_sp.element}
                modelUrl={`/models/${cur_sp.id}.glb`}
                tintUrl={null}
                speciesId={cur_sp.id}
                ground={null}
                onStatus={handleStatus}
                onFaceStatus={handleFaceStatus}
              />
            ) : (
              <div style={{ padding: 24, fontSize: 13, opacity: 0.7 }}>전체 실행을 누르면 24종이 순서대로 로드됩니다.</div>
            )}
          </div>
          <div style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>
            현재: {cur_sp ? `${cur_sp.id} ${cur_sp.name}` : "-"}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ background: "#101812", borderRadius: 10, padding: 10, border: `1px solid ${VCOLOR[r.verdict]}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <span style={{ fontWeight: 900, color: VCOLOR[r.verdict] }}>{r.verdict}</span>
                <span style={{ fontWeight: 800 }}>{r.id} {r.name}</span>
                <span style={{ opacity: 0.6, fontSize: 11 }}>
                  {r.expectFace ? (r.expectMouth ? "A·입있음" : "B·무입") : "X·얼굴없음"}
                </span>
                {r.face && (
                  <span style={{ fontSize: 11, opacity: 0.8 }}>
                    ok={String(r.face.ok)} mouth={String(r.face.mouthLive)}
                  </span>
                )}
                {r.note && <span style={{ fontSize: 11, color: "#fca5a5" }}>{r.note}</span>}
                <button
                  onClick={() => void runOne(i)}
                  disabled={running}
                  className="hud-btn"
                  style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11 }}
                >
                  재실행
                </button>
              </div>
              {r.shots.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {r.shots.map((s) => (
                    <div key={s.label} style={{ textAlign: "center" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt={`${r.id} ${s.label}`} style={{ width: 150, borderRadius: 6, border: "1px solid #333", background: "#000" }} />
                      <div style={{ fontSize: 10, opacity: 0.7 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}
              {r.logs.length > 0 && (
                <pre style={{ fontSize: 10, opacity: 0.65, whiteSpace: "pre-wrap", margin: "8px 0 0", maxHeight: 90, overflow: "hidden" }}>
                  {r.logs.join("\n")}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
