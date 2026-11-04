"use client";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { a2o, ateez } from "@/lib/motion/dances";
import { josa } from "@/lib/josa";

// 8-H-0: /dex top-right source-video compare window (muted, beat-synced).
// Dance clock comes from DexScene onDanceTick (no re-render per frame).
// 8-H-0b: video follows the SELECTED creature's dance; English caption below.

export type DanceTick = { id: string | null; beat: number };

const CLIPS = { ateez, a2o } as const;
// v3 grid starts (provenance): key i samples source at t0 + i*0.25*beat.
const T0: Record<string, number> = { ateez: 0, a2o: 0.374 };
// Loops: ateez 41ct@102.86bpm=23.9s (san 30s), a2o 23ct@86.13bpm=16.0s (a2o-16s 16.1s).
// video = (danceSec + T0 + OFFSET) mod duration: wrap keeps the window moving
// across dance-loop wraps instead of pinning at a clamp edge.
// 2번 정정: NEON(J Black) 제외·CAT 토글 제거. 춤→영상 자동 대응.
const VIDEOS: Record<string, { src: string; offset: number }> = {
  // 8-H-3: san offset 7.25 = t_s(23.25) - 16. The collapse (fold onset, first
  // deviating frame, unique level-change in the 30s facecam) at san 23.25
  // aligns with dance 16. Cut lands at dance 22.75 (tail 1.15s wraps).
  ateez: { src: "/dance/ref/san-facecam.mp4", offset: 7.25 },
  a2o: { src: "/dance/ref/a2o-16s.mp4", offset: 0 },
};

function danceSecOf(danceId: string, beat124: number): number {
  const clip = CLIPS[danceId as keyof typeof CLIPS];
  let b = ((beat124 * clip.bpm) / 124) % clip.counts;
  if (b < 0) b += clip.counts;
  return (b * 60) / clip.bpm;
}

export default function DanceCompare({
  tickRef,
  danceId,
  caption,
}: {
  tickRef: MutableRefObject<DanceTick>;
  danceId: string | null;
  caption: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prevBeat = useRef<number | null>(null);
  const lastResync = useRef<number>(0);
  // Seek-latency tracking: under /dex load a seek lands ~0.5-1.5s after it is
  // issued (measured), so hard seeks aim ahead by the EMA latency and are
  // spaced 2.5s apart; smaller errors are closed by playbackRate cruise.
  const lastSeekAt = useRef<number>(0);
  const seekEma = useRef<number>(1.0);
  const shown = danceId === "ateez" || danceId === "a2o";

  useEffect(() => {
    // new dance -> auto-switch video (src derives from danceId below)
    lastSeekAt.current = 0;
    seekEma.current = 1.0;
    prevBeat.current = null;
  }, [danceId]);

  const vid = shown ? VIDEOS[danceId] : null;
  const src = vid?.src ?? "";
  // Fully buffer via Blob (3MB local): immune to range/stall quirks in the
  // /dex load storm, seeks stay instant. Retried; revoked on switch/unmount.
  const [objUrl, setObjUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) {
      setObjUrl(null);
      return;
    }
    let alive = true;
    let url: string | null = null;
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 10000);
        try {
          const res = await fetch(src, { signal: ctl.signal });
          if (!res.ok) throw new Error(`http ${res.status}`);
          const blob = await res.blob();
          clearTimeout(timer);
          if (!alive) return;
          url = URL.createObjectURL(blob);
          setObjUrl(url);
          return;
        } catch {
          clearTimeout(timer);
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      // Blob path failed (hung server?): fall back to direct URL so the
      // element's native buffering takes over instead of staying sourceless.
      if (alive) setObjUrl(src);
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setObjUrl(null);
    };
  }, [src]);

  // Beat-sync loop. Frozen beat: exact seek + pause. Live: playbackRate
  // cruise closes errors under 1s (this is the <=0.15s resync path: any drift
  // past 0.15 gets active rate correction); hard seeks only for jumps/wraps
  // past 1s, aimed ahead by measured seek latency, spaced 2.5s apart.
  // (Rationale: a seek lands ~1s stale here, so seeking at every 0.15
  // crossing chases forever; rate cruise holds steady state in spec.)
  const wrapTarget = (raw: number, dur: number) => {
    if (!Number.isFinite(dur) || dur <= 0) return Math.max(raw, 0);
    let t = raw % dur;
    if (t < 0) t += dur;
    return t;
  };
  // onSeeked prop (not addEventListener): the <video> remounts when the blob
  // URL arrives, which would orphan a listener bound in this effect.
  const handleSeeked = () => {
    if (lastSeekAt.current > 0) {
      const sample = (performance.now() - lastSeekAt.current) / 1000;
      if (Number.isFinite(sample) && sample >= 0)
        seekEma.current = Math.min(2, Math.max(0.2, seekEma.current * 0.5 + sample * 0.5));
    }
  };
  useEffect(() => {
    if (!shown || !danceId) return;
    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      const v = videoRef.current;
      if (!v || v.readyState < 1) return;
      const { beat } = tickRef.current;
      const frozen = prevBeat.current !== null && beat === prevBeat.current;
      prevBeat.current = beat;
      const dur = v.duration;
      const target = wrapTarget(danceSecOf(danceId, beat) + T0[danceId] + (vid?.offset ?? 0), dur);
      const drift = target - v.currentTime;
      try {
        (window as unknown as { __dexSync?: object }).__dexSync = {
          danceId, beat124: beat, danceSec: danceSecOf(danceId, beat),
          target, videoTime: v.currentTime, drift, src, lead: seekEma.current,
        };
      } catch { /* flag only */ }
      if (v.seeking) return;
      if (frozen) {
        if (Math.abs(drift) > 0.04) v.currentTime = target;
        if (!v.paused) v.pause();
        return;
      }
      if (v.paused) void v.play().catch(() => {});
      const now = performance.now();
      const adrift = Math.abs(drift);
      if (adrift > 1.0 && (adrift > 4.0 || now - lastResync.current > 2500)) {
        v.currentTime = wrapTarget(target + seekEma.current, dur);
        v.playbackRate = 1;
        lastSeekAt.current = now;
        lastResync.current = now;
      } else if (adrift < 0.02) {
        v.playbackRate = 1;
      } else {
        v.playbackRate = 1 + Math.max(-0.35, Math.min(0.35, drift * 1.0));
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [shown, danceId, src, tickRef, vid?.offset]);

  if (!shown || !vid || !danceId) return null;
  return (
    <div style={{ position: "absolute", top: 8, right: 8, zIndex: 30, width: 140 }}>
      {/* CI-1 덤: 로드 전후 칸 크기 고정(16:9, 두 클립 모두 854x480). 로드 전엔 같은 크기의 어두운 자리표시만. */}
      <div style={{
        width: 140, aspectRatio: "16 / 9", borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.28)", background: "#05080c", overflow: "hidden",
      }}>
        {objUrl ? (
          <video
            key={objUrl}
            ref={videoRef}
            src={objUrl}
            muted
            playsInline
            disablePictureInPicture
            preload="auto"
            onSeeked={handleSeeked}
            style={{ width: "100%", height: "100%", display: "block", objectFit: "cover", background: "#000" }}
          />
        ) : (
          <div aria-hidden style={{ width: "100%", height: "100%", background: "#05080c" }} />
        )}
      </div>
      {caption !== null && (
        <div style={{
          marginTop: 4, width: "100%", fontSize: 10, lineHeight: 1.3, padding: "5px 4px",
          borderRadius: 7, border: "1px solid rgba(255,255,255,0.22)",
          background: "rgba(10,16,12,0.72)", color: "#d9fbff", textAlign: "center",
          wordBreak: "keep-all", overflowWrap: "break-word",
        }}>
          {josa(caption, "이가")} 춤을 따라 추는 중
        </div>
      )}
    </div>
  );
}
