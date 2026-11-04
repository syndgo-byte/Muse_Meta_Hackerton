// SEC-5 + PKG-2: 폰 페어링 화면. APK 런처가 코드와 함께 여기로 보낸다.
// 미들웨어에서 쿠키 없이 열리는 유일한 화면(외에 공개 JS/CSS만).
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function PairBody() {
  const router = useRouter();
  const qp = useSearchParams();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("페어링 중…");
  const [busy, setBusy] = useState(true);

  async function submit(c: string) {
    setBusy(true);
    setMsg("페어링 중…");
    try {
      const res = await fetch("/api/pairing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      if (res.ok) {
        router.replace("/");
        return;
      }
      setMsg(res.status === 429 ? "시도가 너무 많아요. 1분 후 다시 해주세요." : "코드가 맞지 않아요.");
    } catch {
      setMsg("서버에 닿지 않아요. 같은 와이파이인지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const c = (qp.get("code") ?? "").trim();
    if (c) void submit(c);
    else {
      setBusy(false);
      setMsg("PC 화면의 6자리 코드를 입력해 주세요.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 12, background: "#0c120e", color: "#fff", padding: 24,
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>OiShi-e! PC 연결</h1>
      <div style={{ fontSize: 13, opacity: 0.8 }}>{msg}</div>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
        placeholder="6자리 코드"
        inputMode="numeric"
        maxLength={6}
        style={{
          fontSize: 20, letterSpacing: 4, textAlign: "center", padding: "10px 12px",
          borderRadius: 10, border: "1px solid rgba(255,255,255,0.25)", background: "#000", color: "#fff", width: 180,
        }}
      />
      <button
        onClick={() => void submit(code)}
        disabled={busy || code.length !== 6}
        style={{
          fontSize: 15, fontWeight: 800, padding: "12px 28px", borderRadius: 12,
          border: "none", background: "#00f2fe", color: "#03252b", cursor: "pointer",
          opacity: busy || code.length !== 6 ? 0.5 : 1,
        }}
      >
        연결
      </button>
    </main>
  );
}

export default function PairPage() {
  return (
    <Suspense>
      <PairBody />
    </Suspense>
  );
}
