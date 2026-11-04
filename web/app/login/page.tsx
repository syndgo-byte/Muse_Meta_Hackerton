"use client";
// 표준 로그인: LOGIN_HANDLERS 경유 → /slots. 그 다음 슬롯에서 /dex로 간다 (작업 7-6).
// Google은 실 OIDC(/api/auth/google), Meta는 OIDC 플레이스홀더, 게스트는 로컬 핸들러.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { currentTrainer, setTrainer } from "@/lib/slots";
import { LOGIN_HANDLERS, currentAccount, saveRemoteAccount, type TrainerProfile } from "@/lib/account";
import { startBgm } from "@/lib/bgm";

const ERROR_KO: Record<string, string> = {
  oauth_unconfigured: "Google 로그인 설정이 아직 없어요. 게스트로 시작하세요.",
  state_mismatch: "로그인 검증에 실패했어요. 다시 시도해주세요.",
  token_failed: "Google 인증 처리에 실패했어요. 다시 시도해주세요.",
  userinfo_failed: "Google 프로필 조회에 실패했어요. 다시 시도해주세요.",
  access_denied: "Google 로그인이 취소됐어요.",
  meta_unconfigured: "Meta 로그인은 준비 중이에요. Google 또는 게스트로 시작하세요.",
};

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState<TrainerProfile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    setName(currentTrainer());
    setLinked(currentAccount());
    startBgm();
    try {
      const q = new URLSearchParams(window.location.search);
      const err = q.get("error");
      if (err) setNotice(ERROR_KO[err] ?? "로그인 중 문제가 생겼어요.");
      const linkedProvider = q.get("linked");
      if (linkedProvider === "google" || linkedProvider === "meta") {
        const label = linkedProvider === "google" ? "Google" : "Meta";
        setLinking(true);
        fetch("/api/auth/session")
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { account?: unknown } | null) => {
            const acc = d ? saveRemoteAccount(d.account) : null;
            if (acc) {
              setTrainer(acc.name);
              setLinked(acc);
              router.push("/slots");
            } else {
              setNotice(`${label} 세션을 확인하지 못했어요. 다시 시도해주세요.`);
            }
          })
          .catch(() => setNotice(`${label} 세션을 확인하지 못했어요.`))
          .finally(() => setLinking(false));
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function go(handlerId: string) {
    if (busy) return;
    const h = LOGIN_HANDLERS.find((x) => x.id === handlerId);
    if (!h) return;
    if (h.kind === "oauth" && h.oauthUrl) {
      window.location.href = h.oauthUrl;
      return;
    }
    setBusy(true);
    try {
      const n = name.trim().slice(0, 12) || "트레이너";
      setTrainer(n);
      const acc = await h.signIn(n);
      setLinked(acc);
      router.push("/slots");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="page-narrow"
      style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 16,
        background: "radial-gradient(circle at 50% 30%, #1d3a2a, #0c120e 70%)",
        color: "#fff", padding: 24,
      }}
    >
      <h1 style={{ margin: 0 }}>트레이너 로그인</h1>
      <p style={{ opacity: 0.7, fontSize: 13, margin: 0, textAlign: "center" }}>
        로그인하면 뮤즈 AI 할당량가 함께 준비됩니다.
        <br />
        Google 연동 시 이름·이메일은 이 기기에만 저장됩니다.
      </p>
      {linked && (
        <div className="glass-chip" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {linked.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={linked.avatarUrl} alt="" width={20} height={20} style={{ borderRadius: "50%" }} />
          ) : null}
          연결됨: {linked.provider} · {linked.name}{linked.email ? ` · ${linked.email}` : ""}
        </div>
      )}
      {notice && (
        <div className="glass-chip" style={{ borderColor: "rgba(248,113,113,0.5)", color: "#fecaca" }}>
          {notice}
        </div>
      )}
      {linking && (
        <div className="glass-chip">계정 연결 중…</div>
      )}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void go("guest"); }}
        placeholder="이름 입력"
        maxLength={12}
        style={{
          fontSize: 18, padding: "12px 16px", borderRadius: 10,
          border: "1px solid #9fe870", background: "#000", color: "#fff",
          width: "min(320px, 80vw)", textAlign: "center",
        }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {LOGIN_HANDLERS.map((h) => (
          <button key={h.id} onClick={() => void go(h.id)} disabled={busy || linking} className="glass-btn">
            {h.cta}
          </button>
        ))}
      </div>
    </main>
  );
}
