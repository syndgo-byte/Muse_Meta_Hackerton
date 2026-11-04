"use client";
import { useState } from "react";

export default function DiaryBox() {
  const [log, setLog] = useState("카페에서 커피를 마시고 공원을 산책함");
  const [diary, setDiary] = useState("아직 없음");
  const [art, setArt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function makeDiary() {
    setBusy(true);
    try {
      const res = await fetch("/api/diary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setDiary(typeof data.diary === "string" ? data.diary : JSON.stringify(data));
    } catch (e) {
      setDiary(`실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function makeArt() {
    setBusy(true);
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Cute creature diary illustration, cozy storybook style: ${log}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setArt(
        data.url ??
          (data.b64 ? `data:image/png;base64,${data.b64}` : null) ??
          null
      );
      if (!data.url && !data.b64) setDiary((d) => `${d}\n(삽화 응답에 이미지 없음)`);
    } catch (e) {
      setDiary(`삽화 실패: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  // [EXT:share-*] 외부 호출 아님(링크 열기만, 데이터 전송 없음) — 끊기면: 해당 없음
  const shareText = encodeURIComponent(`내 크리처의 그림일기: ${log} #SnapQuest`);
  const shareUrl = `https://twitter.com/intent/tweet?text=${shareText}`;

  return (
    <div>
      <label htmlFor="daylog">오늘 한 일 한 줄</label>
      <input id="daylog" value={log} onChange={(e) => setLog(e.target.value)} />
      <div>
        <button onClick={makeDiary} disabled={busy}>
          {busy ? "쓰는 중..." : "크리처 일기 받기"}
        </button>{" "}
        <button onClick={makeArt} disabled={busy}>
          삽화 만들기 (Muse Image)
        </button>
      </div>
      <pre>{diary}</pre>
      {art && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="일기 삽화" style={{ width: "100%" }} />
      )}
      <div
        style={{
          aspectRatio: "9/16",
          border: "1px solid #d8d2c2",
          borderRadius: 10,
          padding: 16,
          marginTop: 12,
          background: "#fff",
        }}
      >
        <strong>스토리 카드 (9:16)</strong>
        <p style={{ fontSize: 13 }}>{log}</p>
        <p className="hint">인스타 스토리 비율 미리보기. 스크린샷으로 공유하세요.</p>
      </div>
      <p>
        <a href={shareUrl} target="_blank" rel="noreferrer">
          X에 공유하기
        </a>
      </p>
    </div>
  );
}
