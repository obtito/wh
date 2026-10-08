"""Build data/wikidata-coords.json with a per-entry, quantified error estimate.

Why this version exists
-----------------------
The first pass simply took the first P625 claim it saw. That hides two things
that matter when you are placing a 475 m tower on a map:

  * `precision` — Wikidata stores the resolution of every coordinate. Translated
    to metres it is the honest ± of the value (0.00027778 deg is one arc second,
    i.e. ~31 m; a value like 30.51 is ~1 km).
  * `rank` and `references` — deprecated statements and unsourced imports exist
    and must not outrank a sourced preferred coordinate.

Entry fields: qid, name, lat, lon, precision_m, half_range_m, category,
sources, loo-free cross checks are handled separately in build_hydro.py.
"""
from __future__ import annotations

import glob
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "wikidata-coords.json"
CANDIDATES = ROOT / "artifacts" / "sparql" / "candidates.json"
SOURCE_LABELS = ROOT / "artifacts" / "source_labels.json"

M_PER_DEG = 111320.0

FEATURED = {
    "Q462372": "黄鹤楼", "Q8039097": "武汉长江大桥", "Q1407294": "龟山电视塔",
    "Q11090196": "晴川阁", "Q11134638": "江汉关大楼", "Q11124749": "武汉长江二桥",
    "Q11124760": "武汉鹦鹉洲长江大桥", "Q4391403": "湖北省博物馆", "Q143235": "武汉绿地中心",
    "Q1108197": "武汉大学", "Q10890788": "光谷广场", "Q15925097": "武昌起义军政府旧址",
    "Q30946741": "辛亥革命博物馆", "Q17040884": "起义门", "Q5616939": "归元寺",
    "Q11088377": "昙华林", "Q10949510": "宝通寺", "Q2594718": "长春观",
    "Q10913488": "古琴台", "Q845631": "东湖", "Q58089387": "磨山",
    "Q11140408": "沙湖", "Q28832397": "墨水湖", "Q11134644": "江汉桥",
    "Q7267796": "晴川桥", "Q11091992": "月湖桥", "Q1010546": "汉口站",
    "Q5959771": "武昌站", "Q584376": "武汉站", "Q15178654": "湖北省图书馆",
    "Q124921010": "武汉琴台音乐厅", "Q875573": "汉江", "Q8039078": "白沙洲长江大桥",
    "Q11124688": "杨泗港长江大桥", "Q11124442": "二七长江大桥", "Q8039087": "天兴洲长江大桥",
    "Q11124752": "武汉长江隧道", "Q107295339": "汉江湾桥",
    "Q60995269": "武汉汉水铁路桥", "Q24836268": "武汉长江公铁隧道",
    "Q1208250": "汉口", "Q11746": "武汉市", "Q5616939": "归元寺",
}

CATEGORY_BY_KIND = [
    ({"公路橋", "桥", "斜拉橋", "懸索橋", "拱桥", "铁路桥", "桁架桥", "箱形樑橋", "公路铁路两用桥"}, "桥梁"),
    ({"鐵路隧道", "隧道", "公路隧道", "水底隧道"}, "隧道"),
    ({"湖泊"}, "湖泊"),
    ({"河流"}, "河流"),
    ({"摩天大樓", "高层建筑物", "超高层建筑", "建築結構", "建筑物", "建筑群"}, "建筑"),
    ({"电视塔", "塔", "覆钵式塔"}, "塔"),
    ({"佛寺", "主教座堂", "教堂", "清真寺", "天主教主教座堂", "东正教建筑"}, "宗教建筑"),
    ({"博物館", "美術館", "圖書館", "图书馆", "檔案館", "劇場", "剧院", "音樂廳"}, "文化场馆"),
    ({"文物保护单位", "文化遺產", "古蹟", "纪念碑", "紀念建築物", "石墓", "墳場", "战争公墓"}, "文物古迹"),
    ({"公立大學", "大學", "私立大學", "教育机构", "高等教育机构", "學院", "醫學院", "工业学院",
      "中华人民共和国教育部直属高等学校", "副部级大学"}, "高校"),
    ({"鐵路車站", "车站"}, "车站"),
    ({"公園", "公园", "花卉園", "游乐园", "水上遊樂園"}, "公园游乐"),
    ({"体育馆", "體育場", "體育中心", "競技場", "田徑場"}, "体育"),
    ({"机場", "機場"}, "机场"),
    ({"汉口租界", "中國租界", "在华日租界", "歷史國家"}, "历史街区"),
    ({"山", "丘", "島嶼"}, "自然地形"),
    ({"地鐵", "地铁"}, "轨道交通"),
    ({"区（市辖区）", "副省级市", "大城市", "人類聚居地", "城市", "地级市"}, "行政区划"),
    # 军舰改成的博物馆。它们本来就停在水里,单独归类,免得被"水域穿模"检查误判。
    ({"博物館船", "導彈驅逐艦", "潛艇", "guided missile frigate", "preserved watercraft",
      "军舰", "驅逐艦", "巡防艦"}, "舰船"),
]

# 不是"地方"的实体:战役、事件、未建成方案、以及一些几何概念。
# 它们带着坐标混进来,一旦进渲染就是幽灵地标,单独隔离。
NON_PLACE_KINDS = {
    "戰役", "战役", "武装冲突", "战争", "公交车爆炸", "爆炸", "事件",
    "计划中建筑物或结构", "拟建建筑物", "角", "地角",
}


def load_kinds():
    kinds = {}
    if CANDIDATES.exists():
        for item in json.loads(CANDIDATES.read_text(encoding="utf-8"))["items"]:
            kinds[item["qid"]] = item["kinds"]
    return kinds


def categorise(qid, kinds):
    for kind in kinds.get(qid, []):
        for group, label in CATEGORY_BY_KIND:
            if kind in group:
                return label
    return "其它"


# --- 地理窗口:分层,而不是一刀切 -------------------------------------------
# 一层窗口不够用。天河机场(30.775)在主城区窗口外但确实是武汉的;磨山镇
# (34.80/118.15,江苏徐州)在任何武汉窗口外,是同名误收。所以改成:
#   主城区 INNER > 市域 OUTER > 其它,再按 rank、precision 排序;
#   最后用"到城市原点的距离"硬判定是否越区,越区的一律不进渲染。
CENTER = (30.5931, 114.3054)      # 武汉城市原点(两江交汇 / 江汉路一带)
REGION_RADIUS_KM = 60.0           # 超出此半径视为同名误收或非武汉实体

BBOX_INNER = (114.10, 30.40, 114.55, 30.72)   # 主城区
BBOX_OUTER = (113.95, 30.25, 114.75, 31.05)   # 市域(含天河机场、阳逻等)

# P518 "applies to part" values seen on river coordinates.
PART_LABELS = {"Q1233637": "河口", "Q7376362": "河源"}


def _zone(lat, lon):
    if BBOX_INNER[0] < lon < BBOX_INNER[2] and BBOX_INNER[1] < lat < BBOX_INNER[3]:
        return 0
    if BBOX_OUTER[0] < lon < BBOX_OUTER[2] and BBOX_OUTER[1] < lat < BBOX_OUTER[3]:
        return 1
    return 2


def _km_from_center(lat, lon):
    mlat = (lat + CENTER[0]) / 2
    dlat = (lat - CENTER[0]) * M_PER_DEG
    dlon = (lon - CENTER[1]) * M_PER_DEG * math.cos(math.radians(mlat))
    return math.hypot(dlat, dlon) / 1000.0


def best_coordinate(claims):
    """Pick the most trustworthy P625 statement, preferring the Wuhan area."""
    candidates = []
    for claim in claims.get("P625", []):
        mainsnak = claim.get("mainsnak", {})
        value = mainsnak.get("datavalue", {})
        if value.get("type") != "globecoordinate":
            continue
        if claim.get("rank") == "deprecated":
            continue
        payload = value["value"]
        sources = []
        for ref in claim.get("references", []) or []:
            for prop, snaks in (ref.get("snaks") or {}).items():
                for snak in snaks:
                    dv = snak.get("datavalue", {})
                    if isinstance(dv.get("value"), dict) and dv["value"].get("id"):
                        sources.append(f'{prop}:{dv["value"]["id"]}')
        parts = []
        for snaks in (claim.get("qualifiers") or {}).get("P518", []):
            dv = snaks.get("datavalue", {})
            if isinstance(dv.get("value"), dict) and dv["value"].get("id"):
                parts.append(PART_LABELS.get(dv["value"]["id"], dv["value"]["id"]))
        lat, lon = payload["latitude"], payload["longitude"]
        candidates.append({
            "lat": lat,
            "lon": lon,
            "precision": payload.get("precision"),
            "rank": claim.get("rank", "normal"),
            "sources": sources,
            "applies_to": parts,
            "_zone": _zone(lat, lon),
            "_km": _km_from_center(lat, lon),
        })
    total = len(candidates)
    if not candidates:
        return None, 0
    order = {"preferred": 0, "normal": 1, "deprecated": 2}
    # 窗口层级优先,其次 rank,其次 precision;同等条件下离城市原点更近的取胜。
    pool = sorted(candidates, key=lambda c: (c["_zone"], order.get(c["rank"], 1),
                                             c["precision"] or 9, c["_km"]))
    best = pool[0]
    best["outside_window"] = best["_zone"] > 0
    best["out_of_region"] = best["_km"] > REGION_RADIUS_KM
    best["km_from_center"] = round(best["_km"], 1)
    return best, total


def numeric_claims(item, prop):
    """Best (ranked, non-deprecated) numeric value for a property, e.g. P2043 length."""
    order = {"preferred": 0, "normal": 1, "deprecated": 2}
    found = []
    for claim in (item.get("claims") or {}).get(prop, []):
        if claim.get("rank") == "deprecated":
            continue
        dv = claim.get("mainsnak", {}).get("datavalue", {})
        value = dv.get("value")
        if isinstance(value, dict) and value.get("amount") is not None:
            found.append((order.get(claim.get("rank", "normal"), 1), value["amount"]))
    if not found:
        return None
    found.sort()
    return found[0][1]


def load_entities():
    merged = {}
    patterns = (
        "artifacts/claims/b*.json",
        "artifacts/entities/b*.json",
        "artifacts/wikidata/p*.json",
        "artifacts/wikidata/e*.json",
        "artifacts/wikidata/en/e*.json",
        "artifacts/wikidata/search/s*.json",
    )
    for pattern in patterns:
        for page in sorted(glob.glob(str(ROOT / pattern))):
            try:
                body = json.loads(Path(page).read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            for qid, item in (body.get("entities") or {}).items():
                if isinstance(item, dict) and item.get("claims") and str(qid).startswith("Q"):
                    merged[qid] = item
    return merged


def main():
    kinds = load_kinds()
    labels = {}
    if SOURCE_LABELS.exists():
        labels = json.loads(SOURCE_LABELS.read_text(encoding="utf-8"))

    entities = load_entities()
    print(f"loaded {len(entities)} entities with claims")

    rows = []
    for qid, item in entities.items():
        coord, n_claims = best_coordinate(item.get("claims") or {})
        if not coord:
            continue
        label_zh = (item.get("labels") or {}).get("zh", {}).get("value") \
            or (item.get("labels") or {}).get("zh-hans", {}).get("value")
        label_en = (item.get("labels") or {}).get("en", {}).get("value")
        desc = (item.get("descriptions") or {}).get("zh", {}).get("value") \
            or (item.get("descriptions") or {}).get("en", {}).get("value")
        precision_m = round((coord["precision"] or 0.0001) * M_PER_DEG, 1)
        length = numeric_claims(item, "P2043")
        height = numeric_claims(item, "P2048")  # height above sea level / structure height
        rows.append({
            "qid": qid,
            "name": FEATURED.get(qid) or label_zh or label_en or qid,
            "name_en": label_en,
            "desc": desc,
            "lat": round(coord["lat"], 6),
            "lon": round(coord["lon"], 6),
            "precision_m": precision_m,
            "half_range_m": round(precision_m / 2, 1),
            "category": categorise(qid, kinds),
            "featured": qid in FEATURED,
            "coordinate_claims": n_claims,
            "rank": coord["rank"],
            "length_m": length,
            "height_m": height,
            "applies_to": coord["applies_to"],
            "outside_window": coord["outside_window"],
            "out_of_region": coord["out_of_region"],
            "km_from_center": coord["km_from_center"],
            # sources arrive as "P143:Q30239"; the label cache is keyed by bare QID.
            "sources": [labels.get(s.rsplit(":", 1)[-1], s) for s in dict.fromkeys(coord["sources"])],
        })
        half = rows[-1]["half_range_m"]
        unlabelled = rows[-1]["name"] == qid
        if coord["out_of_region"]:
            # 同名误收或非武汉实体(例:江苏的磨山镇、长江源头的青海坐标)。
            # 留档但不渲染,也不参与精度统计,否则会把统计口径拉爆。
            rows[-1]["usability"] = "out_of_region"
        elif NON_PLACE_KINDS & set(kinds.get(qid, [])):
            # 战役 / 事件 / 未建成方案 / 几何概念:不是可以站上去的地方。
            rows[-1]["usability"] = "not_a_place"
        elif half > 1000 or (unlabelled and half > 150):
            rows[-1]["usability"] = "unusable"      # degree-level coordinate, do not render
        elif half > 150:
            rows[-1]["usability"] = "coarse"        # good for a district, not for a footprint
        else:
            rows[-1]["usability"] = "ok"

    order_us = {"ok": 0, "coarse": 1, "unusable": 2, "out_of_region": 3, "not_a_place": 4}
    rows.sort(key=lambda r: (not r["featured"], order_us[r["usability"]],
                             r["half_range_m"], r["name"]))
    stats = [r["half_range_m"] for r in rows if r["usability"] in ("ok", "coarse")]
    payload = {
        "crs": "WGS84 (EPSG:4326)",
        "source": "Wikidata coordinate location (P625); rank-filtered, precision preserved",
        "license": "Wikidata facts are CC0",
        "count": len(rows),
        "accuracy_note": (
            "half_range_m 是 Wikidata 记录的坐标分辨率的一半，即该点的 ± 误差。"
            "数值在十几米到一公里之间，取点精度差异很大，请勿把不同精度的点当同等可靠。"
        ),
        "accuracy_distribution_m": {
            "min": min(stats) if stats else None,
            "median": sorted(stats)[len(stats) // 2] if stats else None,
            "p90": sorted(stats)[int(len(stats) * 0.9)] if stats else None,
            "max": max(stats) if stats else None,
        },
        "featured_count": sum(1 for r in rows if r["featured"]),
        "usability_counts": {
            key: sum(1 for r in rows if r["usability"] == key)
            for key in ("ok", "coarse", "unusable", "out_of_region", "not_a_place")
        },
        "region": {
            "center": {"lat": CENTER[0], "lon": CENTER[1]},
            "radius_km": REGION_RADIUS_KM,
            "note": "out_of_region 条目为同名误收或非武汉实体,已隔离,不参与精度统计",
        },
        "landmarks": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(rows)} landmarks, "
          f"{payload['featured_count']} featured")
    print(f"  精度分布(±m): min={payload['accuracy_distribution_m']['min']} "
          f"median={payload['accuracy_distribution_m']['median']} "
          f"p90={payload['accuracy_distribution_m']['p90']} "
          f"max={payload['accuracy_distribution_m']['max']}")


if __name__ == "__main__":
    main()
