// One-click SNS share pipeline: AR snapshot + caption + hashtags.
// Web Share API (mobile) with download + clipboard fallback (desktop).
export const SHARE_TAGS = "#OiShi_e #TheArMuse #MetaRayBan #AI_Pet";

export function shopTag(mode: "cam" | "sim", env: string): string {
  if (mode === "cam") return "#MuseLive_AR";
  if (env === "cafe") return "#MusePartner_Cafe";
  if (env === "street") return "#MusePartner_Street";
  return "#MusePartner_Home";
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("snapshot decode failed"));
    img.src = src;
  });
}

export type ShareTarget = {
  id: "system" | "x" | "threads" | "facebook" | "instagram" | "tiktok" | "save" | "copy";
  label: string;
  // 딥링크/인텐트 URL (system/save/copy는 null → 전용 핸들러).
  url: string | null;
  note: string;
};

// Meta 패밀리 + X/TikTok 다이렉트 공유 타깃. 공식/제휴 태그 포함 캡션 동봉.
// [EXT:share-*] 외부 호출 아님(링크 열기만, 데이터 전송 없음) — 끊기면: 해당 없음
export function buildShareTargets(title: string, tags: string, pageUrl: string): ShareTarget[] {
  const caption = `${title} ${tags}`.slice(0, 280);
  const enc = encodeURIComponent(caption);
  const encUrl = encodeURIComponent(pageUrl);
  return [
    { id: "system", label: "시스템 공유", url: null, note: "이미지+캡션 함께 공유" },
    { id: "x", label: "X", url: `https://twitter.com/intent/tweet?text=${enc}`, note: "캡션이 미리 들어가요" },
    { id: "threads", label: "Threads", url: `https://www.threads.net/intent/post?text=${enc}`, note: "캡션이 미리 들어가요" },
    // MF-3: FB는 quote를 무시 → 복사 후 열기로 (u=만 전달).
    { id: "facebook", label: "Facebook", url: `https://www.facebook.com/sharer/sharer.php?u=${encUrl}`, note: "캡션 복사 후 열기" },
    { id: "instagram", label: "Instagram", url: "https://www.instagram.com/", note: "캡션 복사 → 앱에서 붙여넣기" },
    { id: "tiktok", label: "TikTok", url: "https://www.tiktok.com/upload?lang=ko", note: "캡션 복사 후 업로드" },
    { id: "save", label: "이미지 저장", url: null, note: "PNG 다운로드" },
    { id: "copy", label: "캡션 복사", url: null, note: "제목+태그 클립보드" },
  ];
}

export function shareCaption(title: string, tags: string): string {
  return `${title} ${tags}`;
}

// 스냅샷 합성 (공유 시트 공용): AR 레이어 + 캡션 스트립 → PNG 파일.
export async function composeShareFile(
  glDataUrl: string,
  opts: { title: string; tags: string; backdrop?: string | null }
): Promise<File | null> {
  try {
    const img = await loadImage(glDataUrl);
    const stripH = 132;
    const c = document.createElement("canvas");
    c.width = img.width || 720;
    c.height = (img.height || 720) + stripH;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0c120e";
    g.fillRect(0, 0, c.width, c.height);
    // Simulator sample-media backdrop under the transparent WebGL layer.
    if (opts.backdrop) {
      try {
        const bg = await loadImage(opts.backdrop);
        const s = Math.max(c.width / bg.width, img.height / bg.height);
        const dw = bg.width * s;
        const dh = bg.height * s;
        g.drawImage(bg, (c.width - dw) / 2, (img.height - dh) / 2, dw, dh);
      } catch {
        /* backdrop optional */
      }
    }
    g.drawImage(img, 0, 0);
    g.fillStyle = "#0c120e";
    g.fillRect(0, c.height - stripH, c.width, stripH);
    g.fillStyle = "#9fe870";
    g.fillRect(0, c.height - stripH, c.width, 3);
    g.fillStyle = "#ffffff";
    g.font = "800 34px sans-serif";
    g.fillText(opts.title.slice(0, 40), 28, c.height - stripH + 52, c.width - 56);
    g.fillStyle = "#7cc7ff";
    g.font = "400 26px sans-serif";
    g.fillText(opts.tags.slice(0, 90), 28, c.height - stripH + 96, c.width - 56);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) return null;
    return new File([blob], "oishie-ar.png", { type: "image/png" });
  } catch {
    return null;
  }
}

type NavShare = Navigator & {
  share?: (d: { files?: File[]; title?: string; text?: string; url?: string }) => Promise<void>;
  canShare?: (d: { files?: File[] }) => boolean;
};

// 네이티브 공유 시트 (모바일: IG/스레드/FB/X/TikTok 타깃 포함).
export async function systemShare(
  file: File,
  opts: { title: string; tags: string }
): Promise<"shared" | "failed"> {
  try {
    const nav = navigator as NavShare;
    if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      await nav.share({ files: [file], title: opts.title, text: opts.tags });
      return "shared";
    }
    return "failed";
  } catch {
    return "failed"; // user cancel counts as failed; keep quiet
  }
}

export function downloadFile(file: File): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyCaption(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareSnapshot(
  glDataUrl: string,
  opts: { title: string; tags: string; backdrop?: string | null }
): Promise<"shared" | "downloaded" | "failed"> {
  const file = await composeShareFile(glDataUrl, opts);
  if (!file) return "failed";
  if ((await systemShare(file, opts)) === "shared") return "shared";
  // Desktop fallback: download + copy tags.
  downloadFile(file);
  await copyCaption(`${opts.title} ${opts.tags}`);
  return "downloaded";
}
