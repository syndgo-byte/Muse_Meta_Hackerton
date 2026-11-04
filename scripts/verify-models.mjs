import { readFileSync, readdirSync } from "node:fs";
globalThis.self = globalThis;
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const loader = new GLTFLoader();
let ok = 0, fail = 0;
for (const f of readdirSync("public/models").filter((f) => f.endsWith(".glb")).sort()) {
  const buf = readFileSync("public/models/" + f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  try {
    const g = await loader.parseAsync(ab, "");
    let tris = 0;
    g.scene.traverse((o) => {
      if (o.isMesh) {
        const pos = o.geometry.attributes.position;
        tris += Math.round((o.geometry.index ? o.geometry.index.count : pos.count) / 3);
      }
    });
    console.log("OK", f, (buf.length / 1024).toFixed(0) + "KB", tris + "tris");
    ok++;
  } catch (e) {
    console.log("FAIL", f, String(e).slice(0, 100));
    fail++;
  }
}
console.log(`valid: ${ok}/24, failed: ${fail}`);
if (fail) process.exit(1);
