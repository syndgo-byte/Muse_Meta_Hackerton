// 24종 AR 정면 시트 촬영 (병렬 Edge headless).
import { execFile } from "node:child_process";
const IDS = ["fire-01","fire-02","fire-03","fire-04","fire-05","grass-01","grass-02","grass-03","grass-04","grass-05","water-01","water-02","water-03","water-04","water-05","rock-01","rock-02","rock-03","rock-04","wind-01","wind-02","wind-03","wind-04","wind-05"];
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const batch = process.argv[2] === "b" ? IDS.slice(12) : IDS.slice(0, 12);
await Promise.all(batch.map((id) => new Promise((res) => {
  execFile(EDGE, ["--headless","--disable-gpu","--enable-unsafe-swiftshader","--no-first-run",
    `--screenshot=D:/tmp/face/${id}.png`, "--window-size=480,480",
    "--virtual-time-budget=45000", "--hide-scrollbars",
    `http://localhost:3000/pov?mode=cam&partner=${id}`],
    { timeout: 120000 }, () => res(null));
})));
console.log("batch done:", batch.length);
