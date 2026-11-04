# 8-G-5: /dex dance captures (timed burst; freeze hooks are gone post-R-B).
# Usage: python scripts/shoot-8g.py <outtag>  (writes scratch/dance-v2/burst-<outtag>/)
# Server must already run. Never starts/stops anything.
import base64
import os
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:3000"
ARGS = ["--no-sandbox", "--no-proxy-server", "--use-fake-device-for-media-stream"]
TAG = sys.argv[1] if len(sys.argv) > 1 else "a"
SINGLE = len(sys.argv) > 2 and sys.argv[2] == "single"
OUT = os.path.join(ROOT, "scratch", "dance-v2", f"burst-{TAG}")
N = 80
DT = 0.5


def meandiff(a, b):
    ia = Image.open(a).convert("L")
    ib = Image.open(b).convert("L")
    h = ImageChops.difference(ia, ib).histogram()
    return sum(i * n for i, n in enumerate(h)) / (ia.size[0] * ia.size[1])


def main():
    os.makedirs(OUT, exist_ok=True)
    errs = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=ARGS)
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        # Solid (captured) rendering for the dancer; dance plays regardless.
        pg.add_init_script(
            "localStorage.setItem('snapquest-dex', "
            "JSON.stringify([{id:'fire-01',name:'모카퐁'}]));"
            "localStorage.setItem('snapquest-seen', JSON.stringify(['fire-01']));")
        ok = False
        for attempt in range(4):
            try:
                pg.goto(f"{BASE}/dex?select=fire-01", wait_until="load",
                        timeout=90000)
                for _ in range(30):
                    if pg.evaluate("document.querySelectorAll('canvas').length"):
                        ok = True
                        break
                    pg.wait_for_timeout(2000)
                if ok:
                    break
                print("  canvas missing, retry goto", flush=True)
            except Exception as e:
                print(f"  goto retry ({str(e)[:80]})", flush=True)
        if not ok:
            print("GOTO failed - aborting", flush=True)
            b.close()
            return 1
        pg.wait_for_timeout(12000)
        cv = pg.locator("canvas")
        print("thumbs:", pg.evaluate(
            "document.querySelectorAll('[id^=thumb-]').length"), flush=True)
        box = cv.bounding_box()
        print("canvas box:", box, flush=True)

        def shot(path):
            for _ in range(3):
                try:
                    pg.screenshot(path=path, clip=box, timeout=60000)
                    return True
                except Exception as e:  # noqa: BLE001 - heavy page, retry
                    print(f"  shot retry ({str(e)[:60]})", flush=True)
                    pg.wait_for_timeout(2000)
            print(f"  shot SKIPPED {os.path.basename(path)}", flush=True)
            return False

        def click_thumb(species):
            pg.evaluate(f"document.getElementById('thumb-{species}')"
                        ".scrollIntoView({inline:'center',block:'nearest'})")
            pg.wait_for_timeout(300)
            pg.evaluate(f"document.getElementById('thumb-{species}').click()")

        # Force a fresh arrival: ?select= alone does not start the dance.
        if not SINGLE:
            click_thumb("grass-01")
            pg.wait_for_timeout(2000)
        click_thumb("fire-01")
        pg.wait_for_timeout(15000)
        shot(f"{OUT}/arrived.png")
        print("arrival shot saved", flush=True)
        t0 = time.time()
        for i in range(N):
            shot(f"{OUT}/s-{i:03d}.png")
            el = time.time() - t0
            wait = (i + 1) * DT - el
            if wait > 0:
                pg.wait_for_timeout(int(wait * 1000))
        print(f"burst done: {N} shots over {time.time() - t0:.1f}s", flush=True)
        b.close()
    print(f"pageerrors: {len(errs)}", flush=True)
    for e in errs[:5]:
        print("  PAGEERROR:", e, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
