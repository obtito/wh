"""Third-party verification of the Wikidata coordinates against OpenStreetMap.

Why
---
Wikidata and the hand-typed renderer coordinates disagree by a median of ~800 m.
Deciding who is wrong needs a source that is independent of *both*. Photon
(komoot's OSM geocoder) is that source: OpenStreetMap, WGS84, no shared
provenance with Wikidata's P625 or with the numbers in js/data.js.

For each landmark we query Photon inside a Wuhan bbox and compare:

    agreement_m = |Wikidata - OSM|

  <= 100 m  confirmed — two independent sources agree, use it with confidence
  <= 500 m  approx    — same object, coarse on one side
   > 500 m  conflict  — different object or a genuinely wrong coordinate,
                        flagged for manual review; OSM wins only if the name
                        and OSM tag both match well.

Results are cached in artifacts/osm_cache.json so re-runs are free.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COORDS = ROOT / "data" / "wikidata-coords.json"
CACHE = ROOT / "artifacts" / "osm_cache.json"
OUT = ROOT / "data" / "osm-verification.json"

M_PER_DEG = 111320.0
ENDPOINT = "https://photon.komoot.io/api/"
BBOX = "114.05,30.35,114.65,31.00"   # min_lon,min_lat,max_lon,max_lat


def dist_m(lon1, lat1, lon2, lat2):
    mlat = (lat1 + lat2) / 2
    return math.hypot((lat1 - lat2) * M_PER_DEG,
                      (lon1 - lon2) * M_PER_DEG * math.cos(math.radians(mlat)))


def norm(s):
    if not s:
        return ""
    s = s.lower()
    s = re.sub(r"[\s·・\-—()（）【】\[\],，.。'\"`]", "", s)
    return s


def fetch(query, retries=3):
    url = f'{ENDPOINT}?q={query}&limit=5&bbox={BBOX}'
    for attempt in range(retries):
        try:
            r = subprocess.run(
                ["curl", "-s", "-m", "25", url],
                capture_output=True, timeout=40)
            if r.returncode == 0 and r.stdout:
                return json.loads(r.stdout.decode("utf-8", "replace"))
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def load_cache():
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def pick(features, wanted):
    """在返回的结果里挑真正同名的那条;挑不到就返回 None(宁缺勿滥)。"""
    wn = norm(wanted)
    if not wn:
        return None
    best = None
    for f in features or []:
        props = f.get("properties") or {}
        for key in ("name", "alt_name", "official_name"):
            cand = norm(props.get(key))
            if not cand:
                continue
            if cand == wn:
                return f
            if wn in cand or cand in wn:
                if best is None or abs(len(cand) - len(wn)) < 2:
                    best = f
    return best


# 面状 / 线状对象本来就没有唯一的"那个点":湖心、区中心、隧道中点,
# 双方取点定义不同就会出现几百米到几公里的差,这不算谁错了。
AREA_CATEGORIES = {"湖泊", "行政区划", "自然地形", "公园游乐", "河流", "历史街区", "高校", "其它"}
LINE_CATEGORIES = {"隧道", "桥梁"}


def classify(row, wd_category):
    if row["status"] != "conflict":
        return ""
    oname = norm(row.get("osm_name"))
    wname = norm(row["name"])
    if oname and wname and oname != wname and oname not in wname and wname not in oname:
        return "OSM 匹配到同名异对象（忽略）"
    if wd_category in AREA_CATEGORIES:
        return "面状对象，取点定义不同"
    if wd_category in LINE_CATEGORIES:
        return "线状工程，中点 / 桥头取点不同"
    return "**真冲突，需人工定夺**"


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10 ** 9
    coords = json.loads(COORDS.read_text(encoding="utf-8"))
    cache = load_cache()

    targets = [r for r in coords["landmarks"] if r["usability"] != "out_of_region"]
    # 先做 featured 和精度好的,时间不够时先覆盖最重要的
    targets.sort(key=lambda r: (not r["featured"], r["half_range_m"]))
    targets = targets[:limit]

    rows = []
    for i, r in enumerate(targets, 1):
        name = r["name"]
        hit = None
        for q in dict.fromkeys([name, r.get("name_en") or ""]):
            if not q or norm(q) == norm(str(r["qid"])):
                continue
            key = f"q={q}|bbox={BBOX}"
            if key not in cache:
                cache[key] = fetch(_urlquote(q))
                CACHE.parent.mkdir(parents=True, exist_ok=True)
                CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
                time.sleep(0.25)
            data = cache[key]
            if not data:
                continue
            hit = pick(data.get("features"), q)
            if hit:
                used = q
                break
        if not hit:
            rows.append({"qid": r["qid"], "name": name, "status": "no_osm_match",
                         "wd_lon": r["lon"], "wd_lat": r["lat"]})
            if i % 25 == 0:
                print(f"  ...{i}/{len(targets)}")
            continue
        props = hit["properties"]
        lon, lat = hit["geometry"]["coordinates"]
        d = dist_m(r["lon"], r["lat"], lon, lat)
        status = "confirmed" if d <= 100 else ("approx" if d <= 500 else "conflict")
        row = {
            "qid": r["qid"], "name": name, "featured": r["featured"],
            "query": used, "status": status,
            "wd_lon": r["lon"], "wd_lat": r["lat"], "wd_half_range_m": r["half_range_m"],
            "wd_category": r["category"],
            "osm_lon": round(lon, 6), "osm_lat": round(lat, 6),
            "osm_name": props.get("name"), "osm_key": props.get("osm_key"),
            "osm_value": props.get("osm_value"), "osm_city": props.get("city"),
            "agreement_m": round(d, 1),
        }
        row["conflict_reason"] = classify(row, r["category"])
        rows.append(row)
        if i % 25 == 0:
            print(f"  ...{i}/{len(targets)}")
        elif status == "conflict":
            print(f"  冲突 {name} Δ={d:.0f} m  OSM={props.get('name')} ({props.get('osm_key')})")

    counted = [r for r in rows if r["status"] != "no_osm_match"]
    tally = {k: sum(1 for r in rows if r["status"] == k)
             for k in ("confirmed", "approx", "conflict", "no_osm_match")}
    agree = sorted(r["agreement_m"] for r in counted)
    out = {
        "source": "OpenStreetMap via Photon (komoot), WGS84",
        "window_bbox": BBOX,
        "independent_of": ["Wikidata P625", "js/data.js hand-entered coordinates"],
        "counts": tally,
        "agreement_m_distribution": {
            "min": agree[0] if agree else None,
            "median": agree[len(agree) // 2] if agree else None,
            "p90": agree[int(len(agree) * 0.9)] if agree else None,
            "max": agree[-1] if agree else None,
        },
        "results": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print()
    print(json.dumps(tally, ensure_ascii=False))
    print("agreement(m):", out["agreement_m_distribution"])
    print("\n真冲突清单(已排除面状对象取点差异与同名异对象):")
    for r in rows:
        if r["status"] == "conflict" and r.get("conflict_reason", "").startswith("**"):
            print(f"  {r['name']:<16} Δ={r['agreement_m']:7.0f} m  "
                  f"WD={r['wd_lon']},{r['wd_lat']}  OSM={r['osm_lon']},{r['osm_lat']} "
                  f"[{r.get('osm_key')}={r.get('osm_value')}] {r['qid']}")
    print(f"\nwrote {OUT.relative_to(ROOT)}")


def _urlquote(s):
    from urllib.parse import quote
    return quote(s)


if __name__ == "__main__":
    main()
