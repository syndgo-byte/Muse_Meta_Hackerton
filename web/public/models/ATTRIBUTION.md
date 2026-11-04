# 3D creature assets — attribution

Files: `public/models/<roster-id>.glb` (24 total, matching `ROSTER` in `lib/species.ts`).

## Pipeline (oishie-fix2, current)

1. Portrait: original species portrait brief per species (`lib/species.ts` prompt).
2. image-to-3D: external Stable-Fast-3D conversion of the portrait (front view).
3. Merge: trimesh single-mesh merge with baked baseColor texture.
4. Repair (`scripts/fix-creature-glbs.mjs`, idempotent, originals in `.glb-orig/`):
   - Front pivot: +180 deg Y baked into POSITION+NORMAL, face fronts +Z.
   - Matte mascot PBR: metallicFactor 0, roughnessFactor 0.65, texture kept.

Result: single closed mascot mesh per species, soft matte vinyl look,
no black-metal artifacts, front-facing at origin. Rigging is rigid
(`lib/puppetRig.ts`) + expression sub-meshes (`lib/expressions.ts`):
no vertex deformation, so joints can never tear.

## License

Original art commissioned for this project. All rights otherwise reserved
by the asset authors. Do not redistribute outside the hackathon demo.
