"""Cross-check the Wikidata coordinates against the renderer's own data.

Why this exists
---------------
Two coordinate sets live in this repo and they disagree. Before you can say
"replace the hand-typed numbers with the Wikidata ones" you have to answer one
question first: **is the disagreement a datum problem or a sloppy-picking
problem?**

  * A datum problem (WGS84 vs GCJ-02, the Chinese "offset" used by AMap/Baidu/
    Tencent) shifts *every* point by roughly the same vector, ~300-600 m in
    mainland China. Fix it once with a transform and all points improve.
  * A sloppy-picking problem has no consistent direction. A transform makes
    things *worse*, and the only fix is to replace the points.

This script implements the standard GCJ-02 <-> WGS84 transform and tests both
hypotheses numerically against two hand-authored sources:

  * js/data.js          - what the running game actually uses
  * docs/DEV_PLAN.md    - the original landmark table

Output: data/cross-check.json + a printed verdict.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COORDS = ROOT / "data" / "wikidata-coords.json"
DATAJS = ROOT / "js" / "data.js"
DEVPLAN = ROOT / "docs" / "DEV_PLAN.md"
OUT = ROOT / "data" / "cross-check.json"

M_PER_DEG = 111320.0
A = 6378245.0            # Krasovsky 1940 (GCJ-02 使用的参考椭球长半轴)
EE = 0.00669342162296594323


# --------------------------------------------------------------------------
# GCJ-02 ("火星坐标") 变换。公开算法,误差量级 ~1 m,用于判定 datum 足够。
# --------------------------------------------------------------------------
def _t_lat(x, y):
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def _t_lon(x, y):
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return ret


def wgs_to_gcj(lon, lat):
    dlat = _t_lat(lon - 105.0, lat - 35.0)
    dlon = _t_lon(lon - 105.0, lat - 35.0)
    rad = math.radians(lat)
    magic = 1 - EE * math.sin(rad) ** 2
    sq = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sq) * math.pi)
    dlon = (dlon * 180.0) / (A / sq * math.cos(rad) * math.pi)
    return lon + dlon, lat + dlat


def gcj_to_wgs(lon, lat):
    """数值反解:正向变换的偏移量在百公里内是平滑的,迭代三次即收敛到 <1 mm。"""
    wlng, wlat = lon, lat
    for _ in range(6):
        glng, glat = wgs_to_gcj(wlng, wlat)
        wlng += lon - glng
        wlat += lat - glat
        if abs(glng - lon) < 1e-9 and abs(glat - lat) < 1e-9:
            break
    return wlng, wlat


def dist_m(lon1, lat1, lon2, lat2):
    mlat = (lat1 + lat2) / 2
    return math.hypot((lat1 - lat2) * M_PER_DEG,
                      (lon1 - lon2) * M_PER_DEG * math.cos(math.radians(mlat)))


def bearing_deg(lon1, lat1, lon2, lat2):
    mlat = math.radians((lat1 + lat2) / 2)
    dx = (lon2 - lon1) * math.cos(mlat)
    dy = lat2 - lat1
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


# --------------------------------------------------------------------------
# 读取渲染器自己的坐标
# --------------------------------------------------------------------------
def _enclosing_block(text, pos):
    """返回包围 pos 的 {...} 区间;找不到就返回整篇。回溯找最近的未闭合 '{'。"""
    depth = 0
    start = None
    for i in range(pos, -1, -1):
        if text[i] == "}":
            depth += 1
        elif text[i] == "{":
            if depth == 0:
                start = i
                break
            depth -= 1
    if start is None:
        return 0, len(text)
    depth = 0
    for j in range(start, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return start, j + 1
    return start, len(text)


def _polygon_centroid(pts):
    """面积加权质心;退化(共线/零面积)时退回顶点平均。"""
    a = 0.0
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a) < 1e-12:
        return sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    return cx / (3 * a), cy / (3 * a)


def parse_js_pois(path):
    """Pull (name, lon, lat) out of js/data.js without executing it.

    三种写法都要支持,否则会取到别的条目的坐标:
      * `lon: x, lat: y`       —— 点状(山体、POI)
      * `pts: [[x,y], ...]`    —— 面状/线状(湖泊、道路)→ 取质心
      * `axis: [[x,y], ...]`   —— 桥梁轴线 → 取中点
    """
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    found = {}
    for m in re.finditer(r"name:\s*'([^']+)'", text):
        s, e = _enclosing_block(text, m.start())
        block = text[s:e]
        lon = re.search(r"\blon:\s*(-?\d+\.?\d*)", block)
        lat = re.search(r"\blat:\s*(-?\d+\.?\d*)", block)
        if lon and lat:
            found.setdefault(m.group(1), (float(lon.group(1)), float(lat.group(1))))
            continue
        pts = re.search(r"\bpts:\s*\[(.*?)\]", block, re.S)
        axis = re.search(r"\baxis:\s*\[(.*?)\]", block, re.S)
        blob = (pts or axis)
        if not blob:
            continue
        pairs = re.findall(r"\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]", blob.group(1))
        if not pairs:
            continue
        xy = [(float(a), float(b)) for a, b in pairs]
        if pts:
            cx, cy = _polygon_centroid(xy)
        else:
            cx = sum(p[0] for p in xy) / len(xy)
            cy = sum(p[1] for p in xy) / len(xy)
        found.setdefault(m.group(1), (round(cx, 6), round(cy, 6)))
    return found


def parse_devplan(path):
    """The landmark table in DEV_PLAN.md: | n | name | lon,lat | ... |"""
    if not path.exists():
        return {}
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip().strip("*") for c in line.strip().strip("|").split("|")]
        if len(cells) < 4:
            continue
        name = cells[1]
        m = re.match(r"^(-?\d+\.\d+)\s*[–-]\s*(-?\d+\.\d+)$", cells[2])  # 桥的经度区间
        if m:
            continue
        m = re.match(r"^\s*(\d+\.\d+)\s*,\s*(\d+\.\d+)\s*$", cells[2])
        if m:
            rows[name] = (float(m.group(1)), float(m.group(2)))
    return rows


# 手工别名:渲染器里的名字和 Wikidata 的正式名不完全一致。
ALIAS = {
    "武汉大学·樱顶": "武汉大学",            # 樱顶是校内一栋楼,只能对齐到校区中心
    "武大樱顶(老斋舍)": "武汉大学",
    "磨山楚天台": "磨山",
    "光谷广场·星河": "光谷广场",
    "红楼": "武昌起义军政府旧址",
    "辛亥革命红楼": "武昌起义军政府旧址",
    "长江二桥": "武汉长江二桥",
    "鹦鹉洲长江大桥": "武汉鹦鹉洲长江大桥",
    "江汉路步行街": "江汉路",
    "汉口江滩": "汉口江滩",
    "楚河汉街": "楚河汉街",
    "汉秀剧场": "汉秀剧场",
    "辛亥革命博物馆": "辛亥革命博物馆",
}
# 明确不要参与比较的:接线道路、桥梁轴线端点这些本来就是线,不该和点对。
SKIP_PATTERNS = ("接线",)
# 语义上本来就不该重合:一个是面/区,一个是点。
EXPECT_LOOSE = {
    "武汉大学": "校区中心 vs 校内单栋建筑,差 1 km 内属正常",
    "磨山": "景区中心 vs 楚天台单体",
    "汉口江滩": "带状公园,只有中心点",
    "江汉路": "街道中心点 vs 步行街入口",
    "武汉": "行政区",
    "武汉市": "行政区",
    "汉口": "三镇之一,面状区域",
    "东湖": "湖面中心 vs 岸线景点",
}


def main():
    payload = json.loads(COORDS.read_text(encoding="utf-8"))
    index = {}
    for r in payload["landmarks"]:
        if r["usability"] in ("out_of_region", "not_a_place"):
            continue
        index[r["name"]] = r
        if r.get("name_en"):
            index.setdefault(r["name_en"], r)

    sources = {
        "js/data.js": parse_js_pois(DATAJS),
        "docs/DEV_PLAN.md": parse_devplan(DEVPLAN),
    }

    results = []
    unmatched = []
    for src_name, pois in sources.items():
        for name, (lon, lat) in pois.items():
            if any(p in name for p in SKIP_PATTERNS):
                continue
            wd = index.get(ALIAS.get(name, name)) or index.get(name)
            if wd is None:
                # 只接受"整名互为前缀"的强包含匹配,且短名至少 3 个字。
                # 弱包含会把"月湖"配到"月湖桥"上,宁可漏也不要错配。
                for key, val in index.items():
                    if len(key) >= 3 and (key.startswith(name) or name.startswith(key)):
                        wd = val
                        break
            if wd is None:
                unmatched.append({"source": src_name, "name": name,
                                  "lon": lon, "lat": lat})
                continue
            d_raw = dist_m(lon, lat, wd["lon"], wd["lat"])
            x, y = gcj_to_wgs(lon, lat)
            d_dev_gcj = dist_m(x, y, wd["lon"], wd["lat"])
            x, y = gcj_to_wgs(wd["lon"], wd["lat"])
            d_wd_gcj = dist_m(lon, lat, x, y)
            results.append({
                "source": src_name,
                "name": name,
                "qid": wd["qid"],
                "wd_name": wd["name"],
                "ref_lon": lon, "ref_lat": lat,
                "wd_lon": wd["lon"], "wd_lat": wd["lat"],
                "wd_half_range_m": wd["half_range_m"],
                "delta_m": round(d_raw, 1),
                "delta_if_ref_is_gcj_m": round(d_dev_gcj, 1),
                "delta_if_wd_is_gcj_m": round(d_wd_gcj, 1),
                "bearing_deg": round(bearing_deg(lon, lat, wd["lon"], wd["lat"]), 1),
                "loose": wd["name"] in EXPECT_LOOSE,
                "note": EXPECT_LOOSE.get(wd["name"], ""),
            })
    results.sort(key=lambda r: -r["delta_m"])

    def stats(vals):
        vals = sorted(vals)
        if not vals:
            return {}
        return {
            "n": len(vals),
            "median": round(vals[len(vals) // 2], 1),
            "mean": round(sum(vals) / len(vals), 1),
            "p90": round(vals[int(len(vals) * 0.9)], 1),
            "max": round(vals[-1], 1),
        }

    tight = [r for r in results if not r["loose"]]
    hypotheses = {
        "H0_both_wgs84": stats([r["delta_m"] for r in tight]),
        "H1_ref_is_gcj02": stats([r["delta_if_ref_is_gcj_m"] for r in tight]),
        "H2_wd_is_gcj02": stats([r["delta_if_wd_is_gcj_m"] for r in tight]),
    }
    best = min((k for k in hypotheses if hypotheses[k]),
               key=lambda k: hypotheses[k]["median"])

    # 一致性检验:datum 问题会让方向高度一致,取点误差则方向散乱。
    # 用平均合成向量长度 R(0=散乱,1=完全一致)衡量。
    vec = [math.cos(math.radians(r["bearing_deg"])) for r in tight]
    vec += [math.sin(math.radians(r["bearing_deg"])) for r in tight]
    n = len(tight) or 1
    rx = sum(math.cos(math.radians(r["bearing_deg"])) for r in tight) / n
    ry = sum(math.sin(math.radians(r["bearing_deg"])) for r in tight) / n
    coherence = round(math.hypot(rx, ry), 3)

    verdict = {
        "best_hypothesis": best,
        "bearing_coherence_R": coherence,
        "verdict": (
            "取点误差为主，不是坐标系偏移" if coherence < 0.7 and best == "H0_both_wgs84"
            else f"{best} 更优，需进一步确认基准面"
        ),
        "advice": (
            "不要做整体 GCJ-02 反解——方向不一致、反解后残差更大。"
            "正确做法是逐点替换成 Wikidata 坐标，并保留 half_range_m 作为置信度。"
            if coherence < 0.7 else
            "存在系统性偏移，先统一基准面再逐点校核。"
        ),
    }
    out = {
        "crs_of_wikidata_set": payload["crs"],
        "method": (
            "GCJ-02 正反变换(公开算法);对每处地标分别计算 "
            "① 直接比较 ② 假设渲染器坐标为 GCJ-02 ③ 假设 Wikidata 坐标为 GCJ-02;"
            "并用平均合成向量长度 R 判断偏差方向是否一致(R≈1 为系统性偏移)。"
        ),
        "hypotheses": hypotheses,
        "verdict": verdict,
        "worst": [r for r in results if r["delta_m"] > 1000][:20],
        "unmatched": unmatched,
        "pairs": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"配对 {len(results)} 处(其中 {len(tight)} 处为严格同名可比)")
    for k, v in hypotheses.items():
        print(f"  {k:20s} median={v.get('median')} mean={v.get('mean')} "
              f"p90={v.get('p90')} max={v.get('max')}")
    print(f"  偏差方向一致性 R={coherence} (1=完全一致,0=完全散乱)")
    print(f"  结论: {verdict['verdict']}")
    print()
    print(f"未能在 Wikidata 侧找到同名条目的: {len(unmatched)} 处")
    for u in unmatched:
        print(f"    {u['source']:18s} {u['name']}")
    print()
    print("偏差 > 500 m 的条目:")
    for r in results:
        if r["delta_m"] > 500:
            print(f"  {r['source']:18s} {r['name']:12s} Δ={r['delta_m']:7.0f} m "
                  f"方位={r['bearing_deg']:5.0f}° {r['note']}")
    print(f"\nwrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
