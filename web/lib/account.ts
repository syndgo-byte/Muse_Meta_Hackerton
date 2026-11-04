// 트레이너 프로필 (로컬 세션): Google/Meta OAuth + 게스트.
// OAuth 세션은 서명 쿠키 검증 후 이 형태로 저장. 서버 없음.
export type Provider = "google" | "meta" | "guest";

export type TrainerProfile = {
  id: string; // "google:<sub>" | "meta:<sub>" | "<provider>:local:<name>"
  provider: Provider;
  name: string;
  email: string;
  avatarUrl: string;
};

/** 구 Account 소비처 호환용 별칭. 신규 코드는 TrainerProfile을 사용한다. */
export type Account = TrainerProfile;

const KEY = "oishie-account";

function cleanName(name: string): string {
  return name.trim().slice(0, 12) || "트레이너";
}

function cleanStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

// 저장·전송된 프로필의 형태 검증. 실패 시 null (구 형식 레코드는 null → 재로그인).
export function normalizeProfile(acc: unknown): TrainerProfile | null {
  const a = acc as Partial<TrainerProfile> | null;
  if (!a || typeof a !== "object") return null;
  if (a.provider !== "google" && a.provider !== "meta" && a.provider !== "guest") return null;
  if (typeof a.id !== "string" || !a.id) return null;
  if (typeof a.name !== "string" || !a.name) return null;
  return {
    id: a.id.slice(0, 128),
    provider: a.provider,
    name: a.name.slice(0, 12) || "트레이너",
    email: cleanStr(a.email, 128),
    avatarUrl: cleanStr(a.avatarUrl, 512),
  };
}

export function currentAccount(): TrainerProfile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function linkAccount(provider: Provider, name: string): TrainerProfile {
  const clean = cleanName(name);
  const acc: TrainerProfile = {
    id: `${provider}:local:${clean}`,
    provider,
    name: clean,
    email: "",
    avatarUrl: "",
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(acc));
  } catch {
    /* ignore */
  }
  return acc;
}

// 표준 로그인 핸들러: kind=local은 signIn, kind=oauth는 oauthUrl로 진입.
// 실 API 연동 시 해당 핸들러 정의만 교체한다.
export type LoginHandler = {
  id: Provider;
  label: string;
  cta: string;
  kind: "local" | "oauth";
  oauthUrl?: string;
  signIn: (name: string) => Promise<TrainerProfile>;
};
async function localSignIn(provider: Provider, name: string): Promise<TrainerProfile> {
  return linkAccount(provider, name);
}
export const LOGIN_HANDLERS: LoginHandler[] = [
  { id: "google", label: "Google", cta: "Google로 시작", kind: "oauth", oauthUrl: "/api/auth/google", signIn: (n) => localSignIn("google", n) },
  // Meta OIDC 플레이스홀더: /api/auth/meta 연동 시 실 OAuth로 전환 (서명 세션 규격은 google과 동일).
  { id: "meta", label: "Meta", cta: "Meta로 시작", kind: "oauth", oauthUrl: "/api/auth/meta", signIn: (n) => localSignIn("meta", n) },
  { id: "guest", label: "게스트", cta: "게스트로 시작", kind: "local", signIn: (n) => localSignIn("guest", n) },
];

// OAuth 세션을 로컬 프로필로 저장 (형태 검증 후 기록).
export function saveRemoteAccount(acc: unknown): TrainerProfile | null {
  try {
    const clean = normalizeProfile(acc);
    if (!clean) return null;
    localStorage.setItem(KEY, JSON.stringify(clean));
    return clean;
  } catch {
    return null;
  }
}
