// 입 리듬용 "지금 이 종이 울고/말하고 있나" 신호.
// lib/cry.ts는 다른 CLI 작업 파일이라 건드리지 않고, 재생되는 <audio>의 src
// (/cries/<id>_<mood>_<take>.mp3)를 HTMLMediaElement.play 래핑으로 한 번만 관찰한다.
// 재생 동작 자체는 그대로 원래 play로 넘긴다.
const active = new Map<string, Set<HTMLMediaElement>>();
const CRY_RE = /\/cries\/([a-z]+-\d+)_/;
let installed = false;

function install(): void {
  if (installed || typeof window === "undefined" || typeof HTMLMediaElement === "undefined") return;
  installed = true;
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
    try {
      const m = CRY_RE.exec(this.currentSrc || this.src || "");
      if (m) {
        const id = m[1];
        let set = active.get(id);
        if (!set) active.set(id, (set = new Set()));
        set.add(this);
        const done = () => set!.delete(this);
        this.addEventListener("ended", done, { once: true });
        this.addEventListener("pause", done, { once: true });
        this.addEventListener("error", done, { once: true });
      }
    } catch {
      /* 관찰 실패해도 재생은 진행 */
    }
    return orig.call(this);
  };
}

/** 이 종의 울음/음성이 재생 중인가. */
export function cryActive(speciesId: string): boolean {
  install();
  const set = active.get(speciesId);
  if (!set || !set.size) return false;
  let live = false;
  set.forEach((a) => {
    if (!a.paused && !a.ended && !a.muted) live = true;
  });
  return live;
}
