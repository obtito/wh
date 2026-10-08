"""Fit Wuhan's two river centrelines purely from verified crossing coordinates.

Approach
--------
A bridge or river-crossing tunnel item in Wikidata always sits *on* the water it
crosses, so a set of independent crossings is a measured sampling of the river
axis. Two deliberate choices keep this honest:

1. **Shape: monotone cubic Hermite interpolation (PCHIP), not a polynomial.**
   The Yangtze bends into an S between the 鹦鹉洲 and 长江大桥 crossings. A low
   order polynomial cannot follow that bend, and fitting one will happily
   declare the bridges themselves to be outliers. PCHIP passes through every
   anchor exactly and never overshoots, so any remaining disagreement is
   attributed to the coordinate, not to the curve model.

2. **Accuracy estimate: leave-one-out (LOO).** For every anchor we rebuild the
   curve from all the *other* anchors and measure the gap to the held-out one.
   That number is per-coordinate and assumption free.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPARQL = ROOT / "artifacts" / "sparql" / "wuhan_box.json"
OUT = ROOT / "data" / "hydro-centerlines.json"

M_PER_DEG_LAT = 111320.0

YANGTZE = [
    ("Q8039078", "武汉白沙洲长江大桥"),
    ("Q11124688", "武汉杨泗港长江大桥"),
    ("Q11124760", "武汉鹦鹉洲长江大桥"),
    ("Q140981257", "武汉地铁4号线过江隧道"),
    ("Q8039097", "武汉长江大桥"),
    ("Q11124515", "武汉地铁2号线过江隧道"),
    ("Q11124752", "武汉长江隧道"),
    ("Q24836268", "武汉长江公铁隧道"),
    ("Q11124749", "武汉长江二桥"),
    ("Q11124442", "武汉二七长江大桥"),
    ("Q8039087", "天兴洲长江大桥"),
]

HAN = [
    ("Q130263571", "长丰桥"),
    ("Q10913499", "古田桥"),
    ("Q15935286", "知音桥"),
    ("Q107295339", "汉江湾桥"),
    ("Q140986327", "地铁3号线过汉江隧道(西)"),
    ("Q60995269", "武汉汉水铁路桥"),
    ("Q11091992", "月湖桥"),
    ("Q140986232", "过汉江隧道(东)"),
    ("Q11134644", "江汉桥"),
    ("Q7267796", "晴川桥"),
    ("Q125923274", "保寿桥"),
]

HAN_MOUTH = ("Q875573", "汉江(汇入口)")

PLAN_YANGTZE = [
    ("白沙洲南", 114.215, 30.497),
    ("无名控制点", 114.255, 30.512),
    ("鹦鹉洲桥", 114.2786, 30.5222),
    ("龙王庙两江交汇", 114.2762, 30.5732),
    ("二桥", 114.3088, 30.6017),
    ("二七桥", 114.3420, 30.6290),
    ("天兴洲北汊", 114.380, 30.650),
]
PLAN_HAN = [
    ("入城西端", 114.180, 30.523),
    ("控制点2", 114.225, 30.543),
    ("控制点3", 114.252, 30.553),
    ("控制点4", 114.270, 30.564),
]


def metres_per_deg_lon(lat):
    return M_PER_DEG_LAT * math.cos(math.radians(lat))


def load_points(pairs):
    index = {}
    for b in json.loads(SPARQL.read_text(encoding="utf-8"))["results"]["bindings"]:
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        if "coord" in b and qid not in index:
            lon, lat = b["coord"]["value"].replace("Point(", "").replace(")", "").split()
            index[qid] = (float(lon), float(lat))
    out = []
    for qid, name in pairs:
        if qid in index:
            lon, lat = index[qid]
            out.append({"qid": qid, "name": name, "lon": lon, "lat": lat})
        else:
            print(f"  ! missing anchor {qid} {name}")
    return out


def pchip_tangents(xs, ys):
    """Fritsch–Carlson monotone tangents; zero slope at sign changes."""
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    delta = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    for i in range(1, n - 1):
        if delta[i - 1] * delta[i] <= 0:
            m[i] = 0.0
        else:
            w1 = 2 * h[i] + h[i - 1]
            w2 = h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i])
    m[0] = ((2 * h[0] + h[1]) * delta[0] - h[0] * delta[1]) / (h[0] + h[1]) if n > 2 else delta[0]
    m[-1] = ((2 * h[-1] + h[-2]) * delta[-1] - h[-1] * delta[-2]) / (h[-1] + h[-2]) if n > 2 else delta[-1]
    return m


def hermite_eval(xs, ys, ms, x):
    n = len(xs)
    if x <= xs[0]:
        seg = 0
    elif x >= xs[-1]:
        seg = n - 2
    else:
        seg = max(i for i in range(n - 1) if xs[i] <= x)
    h = xs[seg + 1] - xs[seg]
    t = (x - xs[seg]) / h
    t2, t3 = t * t, t * t * t
    h00 = 2 * t3 - 3 * t2 + 1
    h10 = t3 - 2 * t2 + t
    h01 = -2 * t3 + 3 * t2
    h11 = t3 - t2
    return h00 * ys[seg] + h10 * h * ms[seg] + h01 * ys[seg + 1] + h11 * h * ms[seg + 1]


def make_curve(points, vertical, pad=0.05, step_target=100.0, x_range=None):
    """Build a dense lon/lat polyline through the anchors.

    `x_range` lets callers force the sampled span — needed by leave-one-out,
    where taking out an end anchor would otherwise shrink the curve and make
    the held-out point look wrong simply because it lies past the last sample.
    """
    key = (lambda p: p["lat"]) if vertical else (lambda p: p["lon"])
    ordered = sorted(points, key=key)
    xs = [p["lat"] if vertical else p["lon"] for p in ordered]
    ys = [p["lon"] if vertical else p["lat"] for p in ordered]
    ms = pchip_tangents(xs, ys)
    span = xs[-1] - xs[0]
    if x_range is None:
        lo = xs[0] - span * pad
        hi = xs[-1] + span * pad
    else:
        lo, hi = x_range
    steps = max(200, int((span * (1 + 2 * pad)) * (M_PER_DEG_LAT if vertical else metres_per_deg_lon(30.55)) / step_target))
    curve = []
    for k in range(steps + 1):
        t = lo + (hi - lo) * k / steps
        v = hermite_eval(xs, ys, ms, t)
        curve.append((v, t) if vertical else (t, v))
    return ordered, curve, (lo, hi)


def point_to_curve(lon, lat, curve):
    lon_m = metres_per_deg_lon(lat)
    best = float("inf")
    for clon, clat in curve:
        best = min(best, math.hypot((lon - clon) * lon_m, (lat - clat) * M_PER_DEG_LAT))
    return best


def leave_one_out(ordered, vertical):
    """Rebuild the curve without each anchor and measure the gap to it."""
    all_x = [p["lat"] if vertical else p["lon"] for p in ordered]
    full_range = (min(all_x), max(all_x))
    errors = []
    for i in range(len(ordered)):
        rest = ordered[:i] + ordered[i + 1:]
        _, curve, _ = make_curve(rest, vertical, x_range=full_range)
        errors.append(point_to_curve(ordered[i]["lon"], ordered[i]["lat"], curve))
    return errors


def thin(curve, spacing_m=200.0):
    out = []
    carry = 0.0
    for i, (lon, lat) in enumerate(curve):
        if i == 0:
            out.append([round(lon, 6), round(lat, 6)])
            continue
        plon, plat = curve[i - 1]
        carry += math.hypot((lon - plon) * metres_per_deg_lon(lat), (lat - plat) * M_PER_DEG_LAT)
        if carry >= spacing_m:
            carry = 0.0
            out.append([round(lon, 6), round(lat, 6)])
    if out[-1] != [round(curve[-1][0], 6), round(curve[-1][1], 6)]:
        out.append([round(curve[-1][0], 6), round(curve[-1][1], 6)])
    return out


def build_river(name, anchors):
    lats = [a["lat"] for a in anchors]
    lons = [a["lon"] for a in anchors]
    lat_span = (max(lats) - min(lats)) * M_PER_DEG_LAT
    lon_span = (max(lons) - min(lons)) * metres_per_deg_lon(sum(lats) / len(lats))
    vertical = lat_span >= lon_span

    ordered, curve, (lo, hi) = make_curve(anchors, vertical)
    errors = leave_one_out(ordered, vertical)
    values = sorted(errors)
    median = values[len(values) // 2]
    for i, (item, err) in enumerate(zip(ordered, errors)):
        item["loo_error_m"] = round(err, 1)
        endpoint = i == 0 or i == len(ordered) - 1
        item["position"] = "endpoint" if endpoint else "interior"
        # Removing an end anchor forces the LOO fit to extrapolate, so a large
        # number out there says more about extrapolation than about the datum.
        if not endpoint and err > max(300.0, 3.0 * median):
            item["flag"] = "suspect_coordinate"
        elif err > max(300.0, 3.0 * median):
            item["flag"] = "endpoint_extrapolation"
        else:
            item["flag"] = "ok"

    reliable = [a for a in ordered if a["flag"] != "suspect_coordinate"]
    _, reliable_curve, _ = make_curve(reliable, vertical)
    polyline = thin(curve)
    polyline_reliable = thin(reliable_curve)

    confirmed = [a["loo_error_m"] for a in ordered if a["flag"] == "ok"]
    print(f"  {name}: 锚点 {len(ordered)}（可靠 {len(reliable)}）"
          f"  可靠点留一 median={sorted(confirmed)[len(confirmed)//2]:.0f} m  "
          f"max={max(confirmed):.0f} m")
    suspects = [a["name"] for a in ordered if a["flag"] == "suspect_coordinate"]
    if suspects:
        print(f"      存疑坐标（已单独出可靠版）：{suspects}")

    return {
        "name": name,
        "method": "PCHIP monotone cubic through bridge / tunnel coordinates; accuracy via leave-one-out",
        "independent_axis": "lat" if vertical else "lon",
        "extent": [round(lo, 6), round(hi, 6)],
        "anchors": ordered,
        "loo_cross_validation_m": {
            "median": round(median, 1),
            "p90": round(values[int(len(values) * 0.9)], 1),
            "max": round(values[-1], 1),
        },
        "polyline": polyline,
        "polyline_reliable": polyline_reliable,
    }


def compare_plan(river, plan_points):
    rows = []
    lo, hi = river["extent"]
    vertical = river["independent_axis"] == "lat"
    for name, lon, lat in plan_points:
        probe = lat if vertical else lon
        rows.append({
            "name": name,
            "lon": lon,
            "lat": lat,
            "offset_m": round(point_to_curve(lon, lat, river["polyline"]), 1),
            "in_range": min(lo, hi) <= probe <= max(lo, hi),
        })
    return rows


def main():
    print("正在由桥隧坐标拟合两江中心线…")
    yangtze = build_river("长江", load_points(YANGTZE))
    han = build_river("汉江", load_points(HAN))

    mouth_rows = load_points([HAN_MOUTH])
    mouth_offset = None
    if mouth_rows:
        m = mouth_rows[0]
        mouth_offset = round(point_to_curve(m["lon"], m["lat"], yangtze["polyline"]), 1)
        print(f"  自洽校验：汉江汇入口到长江中心线 {mouth_offset} m")

    payload = {
        "crs": "WGS84 (EPSG:4326)",
        "note": "polyline 为 lon/lat 序列，约 200 m 一个点。",
        "confluence": mouth_rows[0] if mouth_rows else None,
        "confluence_offset_to_yangtze_m": mouth_offset,
        "rivers": [yangtze, han],
        "cross_check_vs_plan": {
            "yangtze": compare_plan(yangtze, PLAN_YANGTZE),
            "han": compare_plan(han, PLAN_HAN),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nwrote {OUT.relative_to(ROOT)}")
    for key, label in (("yangtze", "长江"), ("han", "汉江")):
        print(f"\n  DEV_PLAN {label} 控制点偏离拟合中心线：")
        for r in payload["cross_check_vs_plan"][key]:
            warn = "" if r["in_range"] else "   ⚠ 超出锚点实测范围"
            print(f"    {r['name']:<16}{r['offset_m']:>8.0f} m{warn}")


if __name__ == "__main__":
    main()
