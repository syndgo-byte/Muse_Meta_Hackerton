# Dance screen capture: exact clip-beats on /dex center stage.
# Server must already run (never started/stopped here).
# Requires the TEMP-SCREENSHOT hooks in DexScene.tsx (?dancebeat freeze,
# __dexDbg/__dexMounts/__dexLive/__dexDance); aborts if any is absent.
# Robust to Fast Refresh remounts (another CLI saves shared modules):
# every shot is verified (mounts/sel/dance/live) and redone on change.
# Run with system python (playwright): python scripts/shoot-dance.py
import base64
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:3000"
OUTDIR = os.path.join(ROOT, "scratch", "dance")
ARGS = ["--no-sandbox", "--no-proxy-server", "--use-fake-device-for-media-stream"]
CLIPS = ["ateez", "a2o"]
PRIMARY = "fire-01"
SECOND = "rock-03"  # armless candidate (verified visually from captures)
OTHER = "grass-01"  # arrival-flip helper (never captured)


def load_bpm() -> dict:
    bpm = {}
    for cid in CLIPS:
        with open(os.path.join(OUTDIR, f"{cid}-clip.json"), encoding="utf-8") as f:
            bpm[cid] = json.load(f)["bpm"]
    return bpm


def mean_diff(a: str, b: str) -> float:
    ia = Image.open(a).convert("L")
    ib = Image.open(b).convert("L")
    d = ImageChops.difference(ia, ib)
    h = d.histogram()
    return sum(i * n for i, n in enumerate(h)) / (d.size[0] * d.size[1])


def set_beat(pg, b124) -> None:
    pg.evaluate(f"history.replaceState(null, '', '/dex?dancebeat={b124}')")


def grab(pg, path: str) -> None:
    """Capture the live WebGL canvas (page screenshots go stale here)."""
    url = pg.evaluate("document.querySelector('canvas').toDataURL('image/png')")
    with open(path, "wb") as f:
        f.write(base64.b64decode(url.split(",", 1)[1]))


def click_thumb(pg, species: str) -> None:
    pg.evaluate(f"document.getElementById('thumb-{species}')"
                ".scrollIntoView({inline:'center',block:'nearest'})")
    pg.wait_for_timeout(300)
    pg.evaluate(f"document.getElementById('thumb-{species}').click()")


def state(pg) -> dict:
    return pg.evaluate("({dbg: window.__dexDbg || null, "
                       "mounts: window.__dexMounts || 0, "
                       "live: window.__dexLive || false, "
                       "dance: window.__dexDance || null})")


def at_center(p) -> bool:
    return (p is not None and abs(math.hypot(p[0], p[2]) - 4.2) < 0.4
            and abs(p[1] - 1.35) < 0.3)


def wait_ready(pg, species: str, timeout_s: int = 150) -> dict | None:
    """Wait until species is live at center; return state or None."""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        s = state(pg)
        d = s["dbg"] or {}
        if d.get("sel") == species and at_center(d.get("pos")) and s["live"]:
            return s
        pg.wait_for_timeout(1500)
    return None


def fname(dance: str, species: str, n: int) -> str:
    if species == PRIMARY:
        return os.path.join(OUTDIR, f"screen-{dance}-b{n}.png")
    return os.path.join(OUTDIR, f"screen-{dance}-{species}-b{n}.png")


def main() -> int:
    bpm = load_bpm()
    print(f"BPM: {bpm}", flush=True)
    os.makedirs(OUTDIR, exist_ok=True)
    only_playing = len(sys.argv) > 1 and sys.argv[1] == "playing"
    errs: list = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=ARGS)
        pg = browser.new_page(viewport={"width": 1280, "height": 800})
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        models = set()
        pg.on("response",
              lambda r: models.add(r.url.split("/")[-1])
              if "/models/" in r.url and r.status == 200 else None)
        def robust_goto(url: str) -> bool:
            for _ in range(4):
                try:
                    pg.goto(url, wait_until="load", timeout=90000)
                    pg.wait_for_selector("canvas", timeout=30000)
                    return True
                except Exception as e:  # noqa: BLE001 - server may recompile
                    print(f"  goto retry ({str(e)[:80]})", flush=True)
            return False

        if not robust_goto(f"{BASE}/dex"):
            print("GOTO failed - aborting", flush=True)
            browser.close()
            return 1
        pg.wait_for_timeout(20000)
        print(f"models served: {len(models)}", flush=True)
        if not state(pg)["dbg"]:
            print("HOOK check FAILED (no __dexDbg) - aborting", flush=True)
            browser.close()
            return 1

        def new_arrival(species: str):
            click_thumb(pg, OTHER)
            pg.wait_for_timeout(500)
            click_thumb(pg, species)
            return wait_ready(pg, species)

        # Opportunistic sets: redrive arrivals until both dances have 8 beats.
        done: dict = {}
        for species in (() if only_playing else (PRIMARY, SECOND)):
            done[species] = set()
            s = None
            click_thumb(pg, species)
            s = wait_ready(pg, species)
            if s is None:
                print(f"READY timeout ({species}) - aborting", flush=True)
                browser.close()
                return 1
            tries = 0
            while len(done[species]) < 2 and tries < 14:
                tries += 1
                dance = s["dance"]
                if dance in done[species]:
                    s = new_arrival(species)
                    if s is None:
                        break
                    continue
                print(f"shooting {dance}/{species} "
                      f"(mounts={s['mounts']})", flush=True)
                ok = True
                for n in range(8):
                    m0 = state(pg)["mounts"]
                    set_beat(pg, n * 124 / bpm[dance])
                    pg.wait_for_timeout(900)
                    out = fname(dance, species, n)
                    grab(pg, out)
                    s2 = state(pg)
                    p2 = (s2["dbg"] or {}).get("pos")
                    if (s2["mounts"] != m0 or (s2["dbg"] or {}).get("sel") != species
                            or s2["dance"] != dance or not s2["live"]
                            or not at_center(p2)):
                        print(f"  b{n}: disturbed "
                              f"(mounts {m0}->{s2['mounts']}, "
                              f"sel={(s2['dbg'] or {}).get('sel')}, "
                              f"dance={s2['dance']}, pos={p2}) - redo set",
                              flush=True)
                        ok = False
                        break
                    print(f"  SHOT {os.path.basename(out)}", flush=True)
                if ok:
                    done[species].add(dance)
                    print(f"set complete: {dance}/{species}", flush=True)
                s = new_arrival(species)
                if s is None:
                    break
            if len(done[species]) < 2:
                print(f"FAILED to complete both dances for {species} "
                      f"(got {done[species]}) - aborting", flush=True)
                browser.close()
                return 1

        # Motion proof: playing (no freeze) on PRIMARY, mounts-guarded.
        # Fresh page: a live heavyweight page starves the next navigation.
        pg.close()
        pg = browser.new_page(viewport={"width": 1280, "height": 800})
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        if not robust_goto(f"{BASE}/dex"):
            print("GOTO failed (playing) - aborting", flush=True)
            browser.close()
            return 1
        pg.wait_for_timeout(15000)
        click_thumb(pg, PRIMARY)
        s = wait_ready(pg, PRIMARY)
        if s is None:
            print("READY timeout (playing) - aborting", flush=True)
            browser.close()
            return 1
        for k in range(2):
            m0 = state(pg)["mounts"]
            d = s["dance"]
            out = os.path.join(OUTDIR, f"screen-{d}-play{k + 1}.png")
            grab(pg, out)
            print(f"SHOT {os.path.basename(out)} (playing)", flush=True)
            pg.wait_for_timeout(1200)
            s = state(pg)
            if s["mounts"] != m0:
                print("  playing disturbed by remount - kept anyway", flush=True)
        browser.close()
    for e in errs[:10]:
        print(f"  PAGEERROR: {e}", flush=True)
    print(f"SHOOT DONE err={len(errs)}", flush=True)

    rows = [("ateez", PRIMARY), ("ateez", SECOND),
            ("a2o", PRIMARY), ("a2o", SECOND)]
    thumbs = []
    for dance, species in rows:
        row = []
        for n in range(8):
            im = Image.open(fname(dance, species, n)).convert("RGB")
            im.thumbnail((320, 200))
            row.append(im)
        thumbs.append(row)
    W = sum(im.size[0] for im in thumbs[0])
    H = sum(im.size[1] for im in [r[0] for r in thumbs]) + 30 * len(rows)
    sheet = Image.new("RGB", (W, H + 30), "white")
    dr = ImageDraw.Draw(sheet)
    y = 0
    dr.text((8, 6), "dance screen sheet: rows ateez/fire-01, ateez/rock-03, "
                    "a2o/fire-01, a2o/rock-03; cols b0..b7 (exact frozen beats)",
            fill="black")
    y = 30
    for (dance, species), row in zip(rows, thumbs):
        x = 0
        label = f"{dance}/{species}"
        for n, im in enumerate(row):
            sheet.paste(im, (x, y + 30))
            if n == 0:
                dr.text((x + 6, y + 6), label, fill="black")
            x += im.size[0]
        y += row[0].size[1] + 30
    sheet.save(os.path.join(OUTDIR, "screen-sheet.png"))
    print("wrote screen-sheet.png", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
