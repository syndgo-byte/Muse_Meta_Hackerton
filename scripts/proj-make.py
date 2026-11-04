# scripts/proj-make.py — BP-2: 속성별 투사체 5종 (blender headless).
# 실행: blender --background --factory-startup --python-exit-code 1 --python scripts/proj-make.py -- \
#         --out public/models/projectiles --scratch scratch/proj --shots scratch/cli2/bp2
# 출력: proj_{fire,grass,rock,wind,water}.glb (500면 이하·50KB 이하·발광) + 동명 .png 스프라이트(128px 투명) +
#       projectiles.blend (원본 5종 동봉).
import argparse
import os
import sys

import bpy


def log(msg):
    print(f"[proj] {msg}", flush=True)


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for x in list(coll):
            try:
                coll.remove(x)
            except Exception:
                pass


def emissive_mat(name, base, emission, strength, roughness=0.4):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base
    bsdf.inputs["Roughness"].default_value = roughness
    for key in ("Emission Color", "Emission"):
        if key in bsdf.inputs:
            try:
                bsdf.inputs[key].default_value = emission
                break
            except Exception:
                pass
    for key in ("Emission Strength",):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = strength
    try:
        log(f"mat {name}: emission={tuple(round(v, 2) for v in bsdf.inputs['Emission Color'].default_value)} x{bsdf.inputs['Emission Strength'].default_value}")
    except Exception as e:
        log(f"mat {name}: emission socket missing ({e})")
    try:
        mat_output = mat.node_tree.nodes.get("Material Output")
        if mat_output is not None:
            mat_output.target = "ALL"
    except Exception:
        pass
    return mat


def tri_count(obj):
    me = obj.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


def build_fire():
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.25, location=(0, 0, 0))
    o = bpy.context.view_layer.objects.active
    o.name = "proj_fire"
    o.scale = (1.0, 1.0, 1.25)
    bpy.ops.object.transform_apply(scale=True)
    mat = emissive_mat("M_Fire", (1.0, 0.32, 0.05, 1.0), (1.0, 0.3, 0.04, 1.0), 5.0, 0.5)
    o.data.materials.append(mat)
    return o


def build_grass():
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.25, location=(0, 0, 0))
    leaf = bpy.context.view_layer.objects.active
    leaf.name = "proj_grass_leaf"
    leaf.scale = (1.15, 0.16, 0.75)  # 납작면이 -Y(카메라)를 향하게
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=0.34, location=(0.0, 0.0, -0.3))
    stem = bpy.context.view_layer.objects.active
    stem.name = "proj_grass_stem"
    stem.rotation_euler[1] = 0.35
    bpy.ops.object.transform_apply(rotation=True)
    stem.select_set(True)
    leaf.select_set(True)
    bpy.context.view_layer.objects.active = leaf
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = "proj_grass"
    mat = emissive_mat("M_Grass", (0.15, 0.85, 0.25, 1.0), (0.12, 1.0, 0.3, 1.0), 2.5, 0.5)
    o.data.materials.append(mat)
    return o


def build_rock():
    import random

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.26, location=(0, 0, 0))
    o = bpy.context.view_layer.objects.active
    o.name = "proj_rock"
    rnd = random.Random(7)
    me = o.data
    for v in me.vertices:
        v.co.x *= 1.0 + (rnd.random() - 0.5) * 0.35
        v.co.y *= 1.0 + (rnd.random() - 0.5) * 0.35
        v.co.z *= 1.0 + (rnd.random() - 0.5) * 0.3
    me.update()
    mat = emissive_mat("M_Rock", (0.42, 0.36, 0.3, 1.0), (0.25, 0.12, 0.06, 1.0), 0.4, 0.9)
    o.data.materials.append(mat)
    return o


def build_wind():
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.22, minor_radius=0.075,
        major_segments=24, minor_segments=8, location=(0, 0, 0),
    )
    o = bpy.context.view_layer.objects.active
    o.name = "proj_wind"
    o.rotation_euler[0] = 1.5708  # 고리가 -Y(카메라)를 향하게
    bpy.ops.object.transform_apply(rotation=True)
    mat = emissive_mat("M_Wind", (0.55, 0.85, 0.95, 1.0), (0.5, 0.9, 1.0, 1.0), 3.0, 0.35)
    o.data.materials.append(mat)
    return o


def build_water():
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.2, segments=16, ring_count=8, location=(0, 0, -0.04))
    drop = bpy.context.view_layer.objects.active
    drop.name = "proj_water_drop"
    drop.scale = (1.0, 1.0, 1.15)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.mesh.primitive_cone_add(radius1=0.11, depth=0.26, vertices=16, location=(0, 0, 0.26))
    tip = bpy.context.view_layer.objects.active
    tip.name = "proj_water_tip"
    tip.select_set(True)
    drop.select_set(True)
    bpy.context.view_layer.objects.active = drop
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = "proj_water"
    mat = emissive_mat("M_Water", (0.15, 0.55, 1.0, 1.0), (0.1, 0.6, 1.0, 1.0), 2.5, 0.15)
    o.data.materials.append(mat)
    return o


BUILDERS = {
    "fire": build_fire,
    "grass": build_grass,
    "rock": build_rock,
    "wind": build_wind,
    "water": build_water,
}


def setup_camera_light():
    try:
        bpy.context.scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        bpy.context.scene.render.engine = "BLENDER_EEVEE"
    sc = bpy.context.scene
    sc.render.resolution_x = 128
    sc.render.resolution_y = 128
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    try:
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.exposure = 0.0
        log(f"view={sc.view_settings.view_transform}")
    except Exception as e:
        log(f"view settings N/A ({e})")
    try:
        sc.eevee.taa_render_samples = 16
    except Exception:
        pass
    try:
        sc.eevee.use_bloom = True
        sc.eevee.bloom_intensity = 0.4
        log("bloom on")
    except Exception as e:
        log(f"bloom N/A ({e})")
    log(f"engine={sc.render.engine}")
    bpy.ops.object.camera_add(location=(0.42, -0.95, 0.36))
    cam = bpy.context.view_layer.objects.active
    cam.name = "ProjCam"
    cam.data.lens = 50
    con = cam.constraints.new("TRACK_TO")
    con.target = None
    # 빈 타깃에 트랙 (원점).
    bpy.ops.object.empty_add(location=(0, 0, 0))
    tgt = bpy.context.view_layer.objects.active
    tgt.name = "ProjTarget"
    con.target = tgt
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    sc.camera = cam
    bpy.ops.object.light_add(type="SUN", location=(2, -2, 4))
    sun = bpy.context.view_layer.objects.active
    sun.name = "ProjSun"
    sun.data.energy = 0.5
    try:
        world = bpy.context.scene.world
        world.use_nodes = True
        bg = world.node_tree.nodes.get("Background")
        if bg is not None:
            bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
            bg.inputs["Strength"].default_value = 0.0
    except Exception as e:
        log(f"world black failed ({e})")
    return cam


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--scratch", required=True)
    ap.add_argument("--shots", required=True)
    args, _ = ap.parse_known_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    # 렌더 경로는 절대경로로 (blender CWD 기준이 어긋나는 경우 방지).
    args.out = os.path.abspath(args.out)
    args.scratch = os.path.abspath(args.scratch)
    args.shots = os.path.abspath(args.shots)
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.scratch, exist_ok=True)
    os.makedirs(args.shots, exist_ok=True)

    clean_scene()
    cam = setup_camera_light()
    built = {}
    for el, fn in BUILDERS.items():
        o = fn()
        o.hide_render = False
        built[el] = o
    log(f"blender {bpy.app.version_string}")

    for el, o in built.items():
        # 이것만 보이게 (렌더·익스포트).
        for other in built.values():
            other.hide_viewport = other is not o
            other.hide_render = other is not o
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        tris = tri_count(o)
        log(f"{el}: tris={tris}")
        if tris > 500:
            raise SystemExit(f"FAIL {el}: {tris} tris > 500")
        glb = os.path.join(args.out, f"proj_{el}.glb")
        bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True)
        size = os.path.getsize(glb)
        log(f"{el}: {size} bytes -> {glb}")
        if size > 50 * 1024:
            raise SystemExit(f"FAIL {el}: {size} bytes > 50KB")
        bpy.context.scene.render.filepath = os.path.join(args.out, f"proj_{el}.png")
        bpy.ops.render.render(write_still=True)
        log(f"{el}: sprite done")

    for other in built.values():
        other.hide_viewport = False
        other.hide_render = False
    blend = os.path.join(args.scratch, "projectiles.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    log(f"blend -> {blend}")
    log("DONE 5/5")


main()
