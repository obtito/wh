# -*- coding: utf-8 -*-
"""权威数据校准(行级安全版):用 Wikidata/OSM 逐点替换 js/data.js
- 地标/桥:进入 id 锚点块后,只在块内行级替换 lon/lat/axis/totalM
- 山体:单行条目整行替换
- 水系:状态机扫描 pts 数组(括号深度),整体替换
数据源:data/wikidata-coords.json(CC0)、data/hydro-centerlines.json(OSM ODbL)
"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

P = 'js/data.js'
src = open(P, encoding='utf-8').read()
lines = src.split('\n')

def fmt(v):  # 6 位小数,去尾零
    s = f'{v:.6f}'.rstrip('0').rstrip('.')
    return s if s else '0'

# ---------- 工具:块定位(id 行 → 块结束行,即下一个顶层 '  },' / '  {') ----------
def block_range(prefix):
    """返回 (start, end):start=id 匹配行,end=块终止行(不含)"""
    for i, l in enumerate(lines):
        if prefix in l:
            j = i + 1
            depth = l.count('{') - l.count('}')
            while j < len(lines):
                depth += lines[j].count('{') - lines[j].count('}')
                if depth <= 0 and (lines[j].rstrip().endswith('},') or lines[j].rstrip().endswith('}')):
                    return i, j + 1
                j += 1
            return i, len(lines)
    return None, None

def sub_in_block(prefix, patterns):
    """块内行级正则替换;patterns=[(regex, repl)]。返回是否全部命中。"""
    s, e = block_range(prefix)
    if s is None:
        print('⚠ 未找到块:', prefix)
        return False
    ok_all = True
    for pat, repl in patterns:
        hit = False
        for i in range(s, e):
            new, n = re.subn(pat, repl, lines[i])
            if n:
                lines[i] = new
                hit = True
                break
        if not hit:
            print(f'⚠ 块 {prefix} 内未命中: {pat}')
            ok_all = False
    return ok_all

import re

# ---------- A. 水系中心线(OSM 权威) ----------
hydro = json.load(open('data/hydro-centerlines.json', encoding='utf-8'))
yt = hydro['rivers'][0]['polyline']
hj = hydro['rivers'][1]['polyline']

def thin(pl, step):
    out = pl[::step]
    if out[-1] != pl[-1]:
        out.append(pl[-1])
    return out

def replace_pts_array(header_prefix, pts):
    """定位 header 行(或其后 3 行内含 pts: [ 的行),用括号深度找数组结束,整体替换"""
    for i, l in enumerate(lines):
        if header_prefix in l:
            # 向下找 pts: [
            k = i
            while k < min(i + 4, len(lines)) and 'pts: [' not in lines[k]:
                k += 1
            if k >= min(i + 4, len(lines)):
                continue
            depth = lines[k].count('[') - lines[k].count(']')
            j = k
            while depth > 0:
                j += 1
                depth += lines[j].count('[') - lines[j].count(']')
            indent = re.match(r'\s*', lines[k]).group(0)
            body = (indent + 'pts: [\n' + ',\n'.join(indent + '  ' + f'[{fmt(p[0])}, {fmt(p[1])}]' for p in pts) + ',\n' + indent + '],')
            lines[k:j + 1] = body.split('\n')
            return True
    return False

# 长江(RIVER 定义行)
if not replace_pts_array('export const RIVER', thin(yt, 3)):
    print('⚠ 长江 pts 未替换')
# 汉江(branch 内)
for i, l in enumerate(lines):
    if "name: '汉江'" in l and 'halfWidth' in l:
        # 下一行的 pts
        if replace_pts_array_at := None:
            pass
        break
# 手动处理汉江:找 '汉江' 行后的 pts
def replace_pts_after(anchor_line_idx, pts):
    i = anchor_line_idx + 1
    while i < len(lines) and 'pts: [' not in lines[i]:
        i += 1
    if i >= len(lines):
        return False
    l = lines[i]
    depth = l.count('[') - l.count(']')
    j = i
    while depth > 0:
        j += 1
        depth += lines[j].count('[') - lines[j].count(']')
    indent = re.match(r'\s*', l).group(0)
    body = (indent + 'pts: [\n' + ',\n'.join(indent + '  ' + f'[{fmt(p[0])}, {fmt(p[1])}]' for p in pts) + ',\n' + indent + '],')
    lines[i:j + 1] = body.split('\n')
    return True

for i, l in enumerate(lines):
    if "name: '汉江'" in l:
        if not replace_pts_after(i, thin(hj, 2)):
            print('⚠ 汉江 pts 未替换')
        # 半宽
        lines[i] = re.sub(r'halfWidth: \d+', 'halfWidth: 150', lines[i])
        break

# ---------- B. 地标坐标(Wikidata) ----------
LM = {
  'huanghelou':   (114.296944, 30.546944),
  'guishantower': (114.275083, 30.558156),
  'qingchuan':    (114.279798, 30.558671),
  'jianghanguan': (114.292079, 30.578736),
  'jianghanlu':   (114.295200, 30.582400),
  'hankoujiangtan': (114.301300, 30.585400),
  'hubsmuseum':   (114.358889, 30.563889),
  'chuhehanjie':  (114.335818, 30.556202),
  'greenland':    (114.317475, 30.585942),
  'whu':          (114.361111, 30.540833),
  'chutiantai':   (114.417914, 30.551175),
  'opticsvalley': (114.398610, 30.505560),
  'guiyuan':      (114.254673, 30.548082),
  'guqintai':     (114.258333, 30.556667),
  'tanhualin':    (114.311561, 30.551639),
  'redmansion':   (114.300278, 30.539722),
}
for lid, (lon, lat) in LM.items():
    sub_in_block(f"id: '{lid}',", [
        (r'lon: [\d.]+, lat: [\d.]+,', f'lon: {fmt(lon)}, lat: {fmt(lat)},'),
    ])

# ---------- C. 桥轴 + 全长 + 中心 POI(Wikidata) ----------
BR = {
  'yangtzebridge': dict(axis='[[114.276400, 30.557200], [114.289200, 30.547200]]', total=1670, lon=114.282787, lat=30.552201),
  'yingwuzhou':    dict(axis='[[114.270430, 30.536230], [114.288370, 30.525370]]', total=2100, lon=114.279400, lat=30.530800),
  'bridge2':       dict(axis='[[114.313250, 30.611130], [114.327090, 30.599170]]', total=1876, lon=114.320165, lat=30.605152),
  'jianghanbridge': dict(axis='[[114.262238, 30.566079], [114.261096, 30.563365]]', total=320, lon=114.261667, lat=30.564722),
}
for bid, b in BR.items():
    sub_in_block(f"id: '{bid}',", [
        (r'axis: \[\[.*?\]\],', 'axis: ' + b['axis'] + ','),
        (r'totalM: \d+,', f'totalM: {b["total"]},'),
        (r'lon: [\d.]+, lat: [\d.]+,', f'lon: {fmt(b["lon"])}, lat: {fmt(b["lat"])},'),
    ])

# ---------- D. 山体(单行整行替换) ----------
MT_LINE = {
  'sheshan':     "  { id: 'sheshan',  name: '蛇山', lon: 114.3013, lat: 30.5458, rx: 1550, rz: 330, h: 72, rot: 68, rough: 0.5 },",
  'guishan':     "  { id: 'guishan',  name: '龟山', lon: 114.2730, lat: 30.5565, rx: 700, rz: 260, h: 86, rot: 110, rough: 0.45 },",
  'luojiashan':  "  { id: 'luojiashan', name: '珞珈山', lon: 114.3635, lat: 30.5365, rx: 820, rz: 620, h: 118, rot: 40, rough: 0.55 },",
  'moshan':      "  { id: 'moshan',   name: '磨山', lon: 114.4180, lat: 30.5485, rx: 620, rz: 800, h: 104, rot: 5, rough: 0.5 },",
}
for mid, newline in MT_LINE.items():
    hit = False
    for i, l in enumerate(lines):
        if f"id: '{mid}'" in l:
            lines[i] = newline
            hit = True
            break
    if not hit:
        print('⚠ 未匹配山:', mid)

# ---------- E. 接线道路(单行替换 pts) ----------
RD = {
  '大桥接线·武昌': '[[114.289200, 30.547200], [114.2935, 30.5425]]',
  '大桥接线·汉阳': '[[114.276400, 30.557200], [114.266000, 30.560000], [114.260000, 30.557000]]',
  '鹦鹉洲接线·武昌': '[[114.288370, 30.525370], [114.284000, 30.523000]]',
  '鹦鹉洲接线·汉阳': '[[114.270430, 30.536230], [114.264000, 30.532000]]',
  '江汉桥接线·汉口': '[[114.262238, 30.566079], [114.268000, 30.568500], [114.277000, 30.571800]]',
  '江汉桥接线·汉阳': '[[114.261096, 30.563365], [114.266500, 30.559500]]',
  '晴川桥接线·汉阳': '[[114.277000, 30.564100], [114.268000, 30.562000]]',
}
for name, pts in RD.items():
    hit = False
    for i, l in enumerate(lines):
        if f"name: '{name}'" in l:
            lines[i] = re.sub(r'pts: \[\[.*?\]\]', 'pts: ' + pts, lines[i])
            hit = True
            break
    if not hit:
        print('⚠ 未匹配路:', name)

# 二桥两端接线(整行替换黄浦大街/徐东大街)
for i, l in enumerate(lines):
    if "name: '黄浦大街'" in l:
        lines[i] = "  { name: '黄浦大街', w: 45, pts: [[114.3230, 30.6130], [114.3170, 30.6090], [114.3133, 30.6111]] },"
    if "name: '徐东大街'" in l:
        lines[i] = "  { name: '徐东大街', w: 45, pts: [[114.3150, 30.5715], [114.3110, 30.5780], [114.3085, 30.5850], [114.3120, 30.5900], [114.3185, 30.5945], [114.3271, 30.5992]] },"

# ---------- F. 月湖北移(归元寺新位置避让) ----------
for i, l in enumerate(lines):
    if "[114.2480, 30.5498]" in l:
        lines[i] = l.replace('[114.2480, 30.5498]', '[114.2480, 30.5506]').replace('[114.2535, 30.5480]', '[114.2535, 30.5488]').replace('[114.2565, 30.5492]', '[114.2565, 30.5500]')

open(P, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print('校准完成')
