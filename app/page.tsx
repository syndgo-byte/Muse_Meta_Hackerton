"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { clearBgmLock, startBgm } from "@/lib/bgm";
import { ensureStarter } from "@/lib/starter";

let memeAudio: HTMLAudioElement | null = null;

export default function StartPage() {
  const router = useRouter();
  const timer = useRef<number | null>(null);

  // 입장 즉시 프라이밍 + 첫 터치/클릭/스크롤 시 오디오 잠금 해제 및 즉각 재생
  useEffect(() => {
    ensureStarter(); // ST-1: 첫 실행 스타터 지급
    clearBgmLock();
    startBgm();
    const unlock = () => {
      startBgm();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  function onStart(e: React.MouseEvent) {
    e.preventDefault();
    startBgm();
    // 연타 리미트: 이동 예약됐거나 재생 중이면 무시 (진입할 땐 매번 재생)
    if (timer.current) return;
    if (memeAudio && !memeAudio.paused && !memeAudio.ended) return;
    try {
      memeAudio?.pause();
      memeAudio = new Audio("/oishie.mp3?v=6");
      memeAudio.volume = 0.35;
      void memeAudio.play().catch(() => {});
    } catch {
      /* ignore */
    }
    // 소리가 끊기지 않게 1.2초 뒤 이동 (내비게이션이 오디오를 죽였음이 원인)
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => router.push("/login"), 1200);
  }

  return (
    <main
      className="start-root"
      style={{
        width: "100vw", maxWidth: "100%", margin: 0,
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 16,
        background: "radial-gradient(circle at 50% 30%, #3a1d2a, #0c120e 70%)",
        color: "#fff", padding: 24, textAlign: "center",
      }}
    >
      <style>{`
        @keyframes mallet {
          0%,55% { transform: rotate(-25deg); opacity: 0; }
          62% { transform: rotate(-25deg); opacity: 1; }
          70% { transform: rotate(150deg); opacity: 1; }
          80%,100% { transform: rotate(-25deg); opacity: 0; }
        }
        @keyframes squash {
          0%,68% { transform: scale(1,1); }
          73% { transform: scale(1.25,0.62); }
          81% { transform: scale(0.94,1.06); }
          89%,100% { transform: scale(1,1); }
        }
        @keyframes pop {
          0%,68% { opacity: 0; transform: scale(0.5) rotate(-6deg); }
          75% { opacity: 1; transform: scale(1.25) rotate(2deg); }
          89%,100% { opacity: 0; transform: scale(1) rotate(0deg); }
        }
        @keyframes laugh {
          0%,70% { opacity: 0; transform: translateY(6px); }
          78% { opacity: 1; transform: translateY(0); }
          92%,100% { opacity: 0; transform: translateY(-8px); }
        }
      `}</style>
      <div style={{ fontSize: 13, letterSpacing: 4, opacity: 0.7 }}>AR 뮤즈</div>
      <h1 style={{ fontSize: 56, margin: 0, fontWeight: 900 }}>OiShi-e!</h1>
      <p style={{ opacity: 0.85, margin: 0 }}>
        현실 사물을 비추면 크리처가 깨어난다.
        <br />
        먹이고, 교감하고, 야생 배틀에서 승리하라!
      </p>
      {/* 밈 개그: 웃고 → 꿀밤! */}
      <div style={{ position: "relative", height: 170, width: 200 }}>
        <div
          style={{
            position: "absolute", left: -20, top: -150, width: 56, height: 130,
            transformOrigin: "50% 100%",
            animation: "mallet 3.2s ease-in infinite",
          }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, width: 56, height: 26, background: "#c9a06a", borderRadius: 8, border: "2px solid #7a5a30" }} />
          <div style={{ position: "absolute", left: 21, top: 26, width: 14, height: 78, background: "#8a5a2b", borderRadius: 7 }} />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/dex/fire-01.jpg" alt="얻어맞은 크리처"
          style={{
            width: 120, height: 120, objectFit: "cover", borderRadius: "50%",
            border: "2px solid #9fe870", marginTop: 34,
            animation: "squash 3.2s ease-in infinite",
          }}
        />
        <div
          style={{
            position: "absolute", left: "50%", top: 44, transform: "translateX(-50%)",
            fontWeight: 900, fontSize: 22, color: "#ffd94d", whiteSpace: "nowrap",
            animation: "pop 3.2s ease-in infinite", textShadow: "2px 2px 0 #000",
          }}
        >
          오이쉬에!!
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/woni.jpg" alt="웃는 원이"
          style={{
            position: "absolute", right: -30, top: -20, width: 92, height: 92,
            objectFit: "cover", objectPosition: "32% 20%", borderRadius: "50%",
            border: "2px solid #ffd94d",
            animation: "laugh 3.2s ease-in infinite",
          }}
        />
      </div>

      <a
        href="/login"
        onClick={onStart}
        className="hud-btn hud-btn-primary"
        style={{
          fontSize: 22, fontWeight: 800, padding: "16px 64px",
        }}
      >
        게임 시작
      </a>
      <div style={{ fontSize: 12, opacity: 0.6 }}>버튼을 누르면 로그인으로 이동</div>
    </main>
  );
}
