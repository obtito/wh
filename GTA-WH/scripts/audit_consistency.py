"""Geometric self-consistency audit of the landmark set.

Two independent checks that catch errors no amount of precision metadata can:

  1. **水域穿模** — a temple, tower or museum cannot sit in the middle of the
     Yangtze. Distances are measured against the river centrelines fitted in
     build_hydro.py, so a landmark that lands inside the channel is either a
     wrong coordinate or a wrong entity. Bridges and tunnels are supposed to
     cross the channel, so they are excluded.

  2. **工程约束** — a bridge or tunnel must actually touch the river it is named
     after. Wuhan Yangtze bridges should be within a few hundred metres of the
     Yangtze centreline; Han river crossings likewise. A "Yangtze bridge" 1.5 km
     away from the fitted Yangtze axis is a red flag on one side or the other.

Output: data/consistency-audit.json
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COORDS = ROOT / "data" / "wikidata-coords.json"
HYDRO = ROOT / "data" / "hydro-centerlines.json"
OUT = ROOT / "data" / "consistency-audit.json"

M_PER_DEG = 111320.0

# 航道半宽(米):超出即为"在岸上"。长江武汉段主槽约 1.1–1.5 km 宽,汉江约 200–400 m。
CHANNEL_HALF_WIDTH_M = {"长江": 700.0, "汉江": 250.0}

# 允许落在水里的类别
AQUATIC_CATEGORIES = {"桥梁", "隧道", "河流", "湖泊", "舰船"}


def dist_m(lon1, lat1, lon2, lat2):
    mlat = (lat1 + lat2) / 2
    return math.hypot((lat1 - lat2) * M_PER_DEG,
                      (lon1 - lon2) * M_PER_DEG * math.cos(math.radians(mlat)))


def dist_to_polyline(lon, lat, pts):
    """点到折线的最短距离(米),逐段投影。

    同时返回垂足是否落在折线端点上——落在端点意味着这个点在拟合范围之外,
    那种"远"是外插造成的,不是数据错了,必须和真的不贴河区分开。
    """
    best = float("inf")
    at_end = True
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        # 转成局部米制平面
        mlat = (y1 + y2) / 2
        kx = M_PER_DEG * math.cos(math.radians(mlat))
        ky = M_PER_DEG
        ax, ay = (lon - x1) * kx, (lat - y1) * ky
        bx, by = (x2 - x1) * kx, (y2 - y1) * ky
        seg2 = bx * bx + by * by
        if seg2 == 0:
            t = 0.0
        else:
            t = max(0.0, min(1.0, (ax * bx + ay * by) / seg2))
        d = math.hypot(ax - t * bx, ay - t * by)
        if d < best:
            best = d
            # 只有落在折线内部(非首尾段端点)才算"在拟合范围内"
            at_end = (i == 0 and t <= 1e-9) or (i == len(pts) - 2 and t >= 1 - 1e-9)
    return best, at_end


def main():
    coords = json.loads(COORDS.read_text(encoding="utf-8"))
    hydro = json.loads(HYDRO.read_text(encoding="utf-8"))
    rivers = {r["name"]: r for r in hydro["rivers"]}

    in_water = []
    bridge_check = []
    for r in coords["landmarks"]:
        if r["usability"] in ("out_of_region", "not_a_place"):
            continue
        near, ends = {}, {}
        for name, river in rivers.items():
            d, at_end = dist_to_polyline(r["lon"], r["lat"], river["polyline"])
            near[name] = round(d, 1)
            ends[name] = at_end
        if r["category"] in AQUATIC_CATEGORIES:
            if r["category"] in ("桥梁", "隧道"):
                # 不猜它属于哪条河,直接取最近的;
                # 只有当垂足落在折线内部(即在拟合范围内)还离得远,才算真存疑。
                name = min(near, key=lambda k: near[k])
                if near[name] > 400:
                    bridge_check.append({
                        "qid": r["qid"], "name": r["name"], "category": r["category"],
                        "nearest_river": name, "distance_to_axis_m": near[name],
                        "distance_to_rivers_m": near,
                        "reason": "在拟合范围之外(远郊桥隧)" if ends[name] else "**在拟合范围内却不贴河**",
                        "suspect": not ends[name],
                    })
            continue
        for name, d in near.items():
            if d < CHANNEL_HALF_WIDTH_M.get(name, 500):
                in_water.append({
                    "qid": r["qid"], "name": r["name"], "category": r["category"],
                    "river": name, "distance_to_axis_m": d,
                    "channel_half_width_m": CHANNEL_HALF_WIDTH_M[name],
                    "lat": r["lat"], "lon": r["lon"],
                    "half_range_m": r["half_range_m"],
                    "featured": r["featured"],
                })
                break

    in_water.sort(key=lambda x: x["distance_to_axis_m"])
    bridge_check.sort(key=lambda x: (not x["suspect"], -x["distance_to_axis_m"]))
    n_suspect = sum(1 for x in bridge_check if x["suspect"])

    out = {
        "method": (
            "以 build_hydro.py 由桥梁/隧道坐标拟合的长江、汉江中心线为基准,"
            "计算每个地标到中心线的垂距。非过江类地标若落在航道半宽内,判定为"
            "坐标或实体错误;过江类工程取最近河道,离轴线超过 400 m 且垂足落在"
            "折线内部(即在拟合范围内)才算真存疑,落在端点的一律算'拟合范围之外'。"
        ),
        "channel_half_width_m": CHANNEL_HALF_WIDTH_M,
        "in_channel_count": len(in_water),
        "in_channel": in_water,
        "far_crossing_count": len(bridge_check),
        "suspect_crossing_count": n_suspect,
        "far_crossings": bridge_check,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"落在河道内的非过江地标: {len(in_water)} 处")
    for x in in_water:
        star = "★" if x["featured"] else " "
        print(f"  {star}{x['name']:<14}{x['category']:<6} 距{x['river']}轴线 {x['distance_to_axis_m']:7.0f} m "
              f"(航道半宽 {x['channel_half_width_m']:.0f} m) ±{x['half_range_m']}m  {x['qid']}")
    print(f"\n离最近河道轴线 > 400 m 的过江工程: {len(bridge_check)} 处"
          f"（其中真存疑 {n_suspect} 处）")
    for x in bridge_check:
        print(f"  {x['name']:<16} 最近={x['nearest_river']} 距轴线 {x['distance_to_axis_m']:7.0f} m  "
              f"{x['reason']}  {x['qid']}")
    print(f"\nwrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
