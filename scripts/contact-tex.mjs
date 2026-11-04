// 텍스처 콘택트시트 준비: 24종 내장 JPEG 추출 + index.html 그리드.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const MODELS = "D:/Meta_hackerton/public/models";
const OUT = "D:/tmp/tex";
mkdirSync(OUT, { recursive: true });
const files = readdirSync(MODELS).filter((f) => f.endsWith(".glb")).sort();
for (const f of files) {
  const b = readFileSync(join(MODELS, f));
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString("utf8"));
  const bin = b.subarray(20 + jl + 8);
  j.images.forEach((im, i) => {
    const bv = j.bufferViews[im.bufferView];
    const bs = bv.byteOffset || 0;
    writeFileSync(join(OUT, f.replace(".glb", "") + "_img" + i + ".jpg"), bin.subarray(bs, bs + bv.byteLength));
  });
}
const cells = readdirSync(OUT).filter((f) => f.endsWith(".jpg")).sort();
let h = "<html><body style=\"background:#111;color:#fff;font-family:sans-serif\">";
h += "<h2>basecolor atlas contact sheet (" + cells.length + ")</h2>";
h += "<div style=\"display:grid;grid-template-columns:repeat(6,1fr);gap:8px\">";
for (const f of cells) {
  h += "<div><img src=\"" + f + "\" style=\"width:100%\"><div style=\"font-size:11px\">" + f + "</div></div>";
}
h += "</div></body></html>";
writeFileSync(join(OUT, "index.html"), h);
console.log("files:", files.length, "cells:", cells.length);
