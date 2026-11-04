# 히트 GLB 이물질 전수 조사 (임시 프로브)
import bpy

for sid in ("wind-05", "fire-03", "rock-03", "fire-05", "water-04", "water-02", "fire-01"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f"scratch/rig-types/{sid}/{sid}-heat.glb")
    objs = sorted((o.name, o.type) for o in bpy.data.objects)
    print(f"HEAT {sid} {objs}", flush=True)
