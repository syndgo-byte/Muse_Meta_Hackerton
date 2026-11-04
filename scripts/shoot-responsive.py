# D1-2 반응형 스크린샷 16장. 켜진 개발 서버를 그대로 쓴다 (시작·중지 금지).
import os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
OUTDIR = "scratch/responsive"
WIDTHS = [360, 390, 768, 1280]
HEIGHT = 844
PAGES = [
    ("dex", "/dex"),
    ("pov-cam", "/pov?mode=cam"),
    ("pov-sim", "/pov?mode=sim"),
    ("camp", "/camp"),
]
ARGS = ["--no-sandbox", "--no-proxy-server", "--use-fake-device-for-media-stream"]


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=ARGS)
        print("BROWSER: bundled chromium", flush=True)
        for name, path in PAGES:
            for w in WIDTHS:
                pg = browser.new_page(viewport={"width": w, "height": HEIGHT})
                errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
                pg.goto(f"{BASE}{path}", wait_until="load")
                pg.wait_for_timeout(4500)
                out = f"{OUTDIR}/{name}-{w}.png"
                pg.screenshot(path=out)
                print(f"SHOT {out} err={len(errs)}", flush=True)
                for e in errs[:3]:
                    print(f"  PAGEERROR: {e}", flush=True)
                pg.close()
        browser.close()
    print("SHOOT DONE", flush=True)


main()
