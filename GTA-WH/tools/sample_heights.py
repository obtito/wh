# -*- coding: utf-8 -*-
# CNBH-10m 建筑高度栅格 → 逐建筑采样回填(data/cnbh-heights.json,对齐 overture feature 顺序)
# 栅格为 UTM 49N(EPSG:32649),采样前做 WGS84→UTM 变换
import json, io, sys
import rasterio
from rasterio.warp import transform as warp_transform
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

src = json.load(open('data/overture-buildings.json', encoding='utf-8'))
feats = src['features']

tiff = rasterio.open('data/cnbh/CNBH10m_X115Y31.tif')
print('tif:', tiff.crs, tiff.width, 'x', tiff.height)

def centroid_lonlat(f):
    g = f.get('geometry') or {}
    rings = []
    if g.get('type') == 'Polygon':
        rings = [g['coordinates'][0]]
    elif g.get('type') == 'MultiPolygon':
        rings = [p[0] for p in g['coordinates']]
    if not rings:
        return None
    # 取最大环(MultiPolygon 的主楼体)
    ring = max(rings, key=len)
    if len(ring) < 3:
        return None
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))

heights = {}
lons, lats, idxs = [], [], []
for i, f in enumerate(feats):
    c = centroid_lonlat(f)
    if c:
        lons.append(c[0]); lats.append(c[1]); idxs.append(i)

xs, ys = warp_transform('EPSG:4326', tiff.crs, lons, lats)

hits = 0
from collections import Counter
dist = Counter()
for x, y, i in zip(xs, ys, idxs):
    if not (tiff.bounds.left <= x < tiff.bounds.right and tiff.bounds.bottom <= y < tiff.bounds.top):
        continue
    row, col = tiff.index(x, y)
    r0, c0 = max(0, row - 1), max(0, col - 1)
    r1, c1 = min(tiff.height, row + 2), min(tiff.width, col + 2)
    win = tiff.read(1, window=((r0, r1), (c0, c1)))
    vals = [v for v in win.ravel() if v is not None and 2 < v < 650]
    if not vals:
        continue
    h = float(max(vals))
    heights[i] = round(h, 1)
    hits += 1
    dist[min(int(h // 15) * 15, 120)] += 1

json.dump(heights, open('data/cnbh-heights.json', 'w'))
print(f'采样完成: {hits}/{len(feats)} 栋拿到真实高度({hits * 100 // len(feats)}%)')
for k in sorted(dist):
    print(f'  {k:>3}-{k+15:>3}m: {"#" * min(50, dist[k] // 80)} {dist[k]}')
