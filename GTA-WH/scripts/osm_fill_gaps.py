"""Fill the gaps: POIs the renderer has but Wikidata could not supply.

js/data.js contains hills, streets and venues (蛇山、喻家山、汉口江滩、汉秀剧场…)
that have no usable Wikidata item in our set. Rather than leave them on
unverified hand-typed numbers, ask OSM for them too and record how far the
hand-typed value was off.

Output: data/osm-gap-fill.json
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path
from urllib.parse import quote

import importlib.util

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
COORDS = ROOT / "data" / "wikidata-coords.json"
XCHECK = ROOT / "data" / "cross-check.json"
CACHE = ROOT / "artifacts" / "osm_cache.json"
OUT = ROOT / "data" / "osm-gap-fill.json"

BBOX = "114.05,30.35,114.65,31.00"

# 复用已有脚本里的解析与几何函数,不重复实现。
def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cc = _load("cross_check")    # parse_js_pois / parse_devplan / dist_m
ov = _load("osm_verify")     # norm / pick


def fetch(query, retries=3):
    url = f"https://photon.komoot.io/api/?q={quote(query)}&limit=5&bbox={BBOX}"
    for attempt in range(retries):
        try:
            import subprocess
            r = subprocess.run(["curl", "-s", "-m", "25", url], capture_output=True, timeout=40)
            if r.returncode == 0 and r.stdout:
                return json.loads(r.stdout.decode("utf-8", "replace"))
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def main():
    coords = json.loads(COORDS.read_text(encoding="utf-8"))
    have = {r["name"] for r in coords["landmarks"] if r["usability"] != "out_of_region"}
    xcheck = json.loads(XCHECK.read_text(encoding="utf-8")) if XCHECK.exists() else {}

    wanted = []
    for u in xcheck.get("unmatched", []):
        if u["source"] == "js/data.js" and u["name"] not in have:
            wanted.append((u["name"], u["lon"], u["lat"]))
    # 去重
    seen = set()
    wanted = [w for w in wanted if not (w[0] in seen or seen.add(w[0]))]

    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    rows = []
    for name, lon, lat in wanted:
        key = f"q={name}|bbox={BBOX}"
        if key not in cache:
            cache[key] = fetch(name)
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            time.sleep(0.3)
        hit = ov.pick((cache[key] or {}).get("features"), name)
        if not hit:
            rows.append({"name": name, "status": "no_osm_match",
                         "renderer_lon": lon, "renderer_lat": lat})
            print(f"  {name}: OSM 无匹配")
            continue
        props = hit["properties"]
        olon, olat = hit["geometry"]["coordinates"]
        d = cc.dist_m(lon, lat, olon, olat)
        rows.append({
            "name": name, "status": "found",
            "renderer_lon": lon, "renderer_lat": lat,
            "osm_lon": round(olon, 6), "osm_lat": round(olat, 6),
            "osm_name": props.get("name"), "osm_key": props.get("osm_key"),
            "osm_value": props.get("osm_value"),
            "delta_m": round(d, 1),
        })
        print(f"  {name}: OSM {olon:.5f},{olat:.5f}  渲染器偏 {d:.0f} m  "
              f"[{props.get('osm_key')}={props.get('osm_value')}]")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "OpenStreetMap via Photon (komoot), WGS84",
        "note": "Wikidata 缺项的补充坐标;delta_m 是渲染器原坐标与 OSM 的偏差",
        "count": len(rows),
        "results": rows,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT.relative_to(ROOT)} ({len(rows)} 条)")


if __name__ == "__main__":
    main()
