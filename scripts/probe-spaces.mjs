import { readFileSync, readdirSync, statSync } from "node:fs";
globalThis.self = globalThis;
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const loader = new GLTFLoader();
for (const f of readdirSync("aiconfirm/hero").filter((f) => f.endsWith(".glb")).sort()) {
  const p = "aiconfirm/hero/" + f;
  const buf = readFileSync(p);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  try {
    const g = await loader.parseAsync(ab, "");
    let tris = 0, verts = 0, meshes = 0;
    const mats = new Set();
    g.scene.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        const pos = o.geometry.attributes.position;
        verts += pos.count;
        tris += Math.round((o.geometry.index ? o.geometry.index.count : pos.count) / 3);
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach((x) => mats.add(x.name || x.type));
      }
    });
    console.log(f, (statSync(p).size / 1048576).toFixed(2) + "MB", `meshes=${meshes} tris=${tris} verts=${verts} mats=[${[...mats].join(",")}]`);
  } catch (e) {
    console.log(f, "PARSE FAIL:", String(e).slice(0, 150));
  }
}
