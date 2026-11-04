"use client";
// 세이브 슬롯 선택 (PLATFORM_WORKORDER 작업 7-6).
// 로그인 다음 화면. 카드 3개: [불러오기] / [새로 시작](빈 슬롯) / [삭제](확인 한 번 더).
// AF-1a: /camp 토큰 HUD의 슬롯 저장을 여기로 옮김 — 사용 중 슬롯에 [현재 상태 저장] 추가.
// 불러오기·새로 시작 후 /dex로 간다. 토큰·조우 상태는 슬롯에 넣지 않는다.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { BOTTOM_BTN_H, BOTTOM_SIDE } from "@/lib/layout";
import { ROSTER } from "@/lib/species";
import {
  applySlot,
  currentTrainer,
  deleteSlot,
  freshStart,
  loadSlots,
  saveSlot,
  setCurrentSlot,
  type ServerStatusSnapshot,
  type Slot,
} from "@/lib/slots";

function fmtTime(ts: number): string {
  try {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return "-";
  }
}

async function readServer(): Promise<ServerStatusSnapshot | null> {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ServerStatusSnapshot;
  } catch {
    return null;
  }
}

async function writeServer(body: unknown): Promise<boolean> {
  try {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const FRESH_SERVER = { fullness: 50, energy: 80, affection: 20, xp: 0, level: 1 };

export default function SlotsPage() {
  const router = useRouter();
  const [slots, setSlots] = useState<[Slot, Slot, Slot]>([null, null, null]);
  const [names, setNames] = useState<string[]>(["", "", ""]);
  const [armed, setArmed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setSlots(loadSlots());
    const t = currentTrainer();
    setNames([t, t, t]);
  }, []);

  async function handleLoad(i: number) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = applySlot(i);
      if (!r.ok) {
        setMsg("슬롯을 불러오지 못했어요.");
        return;
      }
      if (r.server) {
        // PC-1: 옛 평탄 스냅샷이면 슬롯 파트너 몫으로 지정해 복원한다.
        const snap = r.server as Record<string, unknown>;
        let body: unknown = snap;
        if (snap && typeof snap === "object" && !("growth" in snap) && !snap.speciesId) {
          const sp = loadSlots()[i]?.data?.partnerId;
          body = { ...snap, speciesId: sp && ROSTER.some((x) => x.id === sp) ? sp : "fire-01" };
        }
        const ok = await writeServer(body);
        if (!ok) setMsg("서버 상태 복원에 실패했어요. 로컬만 복원됩니다.");
      }
      setCurrentSlot(i);
      router.push("/dex");
    } finally {
      setBusy(false);
    }
  }

  async function handleNew(i: number) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const trainer = (names[i] ?? "").trim().slice(0, 12) || "트레이너";
      freshStart(trainer);
      await writeServer(FRESH_SERVER);
      const snap = await readServer();
      saveSlot(i, trainer, snap);
      setCurrentSlot(i);
      router.push("/dex");
    } finally {
      setBusy(false);
    }
  }

  // AF-1a: /camp에서 옮겨온 현재-플레이 저장. 같은 슬롯에 덮어쓴다. 토큰·조우는 건드리지 않는다.
  async function handleSave(i: number) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const snap = await readServer();
      const trainer = loadSlots()[i]?.trainer || currentTrainer() || "트레이너";
      saveSlot(i, trainer, snap);
      setSlots(loadSlots());
      setMsg(`슬롯 ${i + 1}에 저장했어요`);
    } finally {
      setBusy(false);
    }
  }

  function handleDelete(i: number) {
    if (armed !== i) {
      setArmed(i);
      return;
    }
    deleteSlot(i);
    setArmed(null);
    setSlots(loadSlots());
  }

  return (
    <main
      className="page-narrow"
      style={{
        minHeight: "100vh", background: "#0c120e", color: "#fff",
        display: "flex", flexDirection: "column",
      }}
    >
      <TopBar center={<span style={{ fontWeight: 900, fontSize: 16 }}>저장 슬롯 선택</span>} />
      <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 560, width: "100%", margin: "0 auto" }}>
        {msg && (
          <div className="glass-chip" style={{ borderColor: "rgba(248,113,113,0.5)", color: "#fecaca", textAlign: "center" }}>
            {msg}
          </div>
        )}
        {slots.map((slot, i) => {
          const partner = slot ? (ROSTER.find((s) => s.id === slot.data.partnerId) ?? ROSTER[0]) : null;
          const lv = slot ? (slot.data.server?.level ?? slot.data.status.level ?? 1) : 1;
          const caught = slot ? Math.min(24, slot.data.dex.length) : 0;
          return (
            <div key={i} className="glass-panel" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.7, marginBottom: 6 }}>
                슬롯 {i + 1}
              </div>
              {slot && partner ? (
                <>
                  <div style={{ fontSize: 15, fontWeight: 900 }}>
                    {slot.trainer} · {partner.name} Lv{lv}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                    포획 {caught}/24 · {fmtTime(slot.updatedAt)}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => void handleLoad(i)} disabled={busy} className="glass-btn" style={{ fontSize: 13, flex: 1 }}>
                      불러오기
                    </button>
                    <button onClick={() => void handleSave(i)} disabled={busy} className="glass-btn" style={{ fontSize: 13, flex: 1 }}>
                      현재 상태 저장
                    </button>
                    <button
                      onClick={() => handleDelete(i)}
                      disabled={busy}
                      className="glass-btn"
                      style={{
                        fontSize: 13, flex: 1,
                        ...(armed === i ? { borderColor: "rgba(248,113,113,0.7)", color: "#fecaca" } : {}),
                      }}
                    >
                      {armed === i ? "정말 삭제?" : "삭제"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, opacity: 0.6 }}>빈 슬롯</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input
                      value={names[i] ?? ""}
                      onChange={(e) => setNames((prev) => prev.map((v, k) => (k === i ? e.target.value : v)))}
                      placeholder="트레이너 이름"
                      maxLength={12}
                      style={{
                        flex: 1, fontSize: 14, padding: "10px 12px", borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.25)", background: "#000", color: "#fff",
                      }}
                    />
                    <button onClick={() => void handleNew(i)} disabled={busy} className="glass-btn" style={{ fontSize: 13 }}>
                      새로 시작
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ paddingLeft: BOTTOM_SIDE, paddingRight: BOTTOM_SIDE, paddingBottom: 12, maxWidth: 560, width: "100%", margin: "0 auto" }}>
        <button
          onClick={() => router.push("/login")}
          className="glass-btn"
          style={{ width: "100%", height: BOTTOM_BTN_H, fontSize: 13, opacity: 0.8 }}
        >
          ← 로그인으로
        </button>
      </div>
    </main>
  );
}
