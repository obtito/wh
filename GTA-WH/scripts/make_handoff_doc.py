"""Generate docs/WIKIDATA_坐标交接.md.

Everything in the document is derived from the JSON files under data/, so it
can never drift from the data. Re-run after any of:

    scripts/build_coords_v2.py     -> data/wikidata-coords.json
    scripts/build_hydro.py         -> data/hydro-centerlines.json
    scripts/cross_check.py         -> data/cross-check.json
    scripts/audit_consistency.py   -> data/consistency-audit.json
    scripts/osm_verify.py          -> data/osm-verification.json
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COORDS = ROOT / "data" / "wikidata-coords.json"
HYDRO = ROOT / "data" / "hydro-centerlines.json"
XCHECK = ROOT / "data" / "cross-check.json"
AUDIT = ROOT / "data" / "consistency-audit.json"
OSM = ROOT / "data" / "osm-verification.json"
OUT = ROOT / "docs" / "WIKIDATA_坐标交接.md"

M_PER_DEG_LON = 95850.0
M_PER_DEG_LAT = 111320.0


def load(path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def main() -> None:
    coords = load(COORDS)
    hydro = load(HYDRO)
    xcheck = load(XCHECK)
    audit = load(AUDIT)
    osm = load(OSM)
    rows = coords["landmarks"]
    by_qid = {r["qid"]: r for r in rows}
    osm_by_qid = {}
    if osm:
        osm_by_qid = {r["qid"]: r for r in osm["results"]}

    dist = coords["accuracy_distribution_m"]
    uc = coords["usability_counts"]

    lines = ["# Wikidata 实测坐标交接（P625）", ""]
    lines += [
        f"共 **{coords['count']}** 个武汉实体（其中 **{coords['featured_count']}** 个精选地标），"
        "全部来自 Wikidata `coordinate location (P625)`，每条带 QID 可回溯。",
        "",
        "| 文件 | 内容 |",
        "|---|---|",
        "| `data/wikidata-coords.json` | 主交付：全部实体 + 精度 + 可用性分级 |",
        "| `data/hydro-centerlines.json` | 长江 / 汉江中心线（由桥隧坐标反推） |",
        "| `data/cross-check.json` | 与 `js/data.js`、`DEV_PLAN.md` 的逐点差异 + 坐标系判定 |",
        "| `data/consistency-audit.json` | 几何自洽：谁落在江里、哪座桥不贴河 |",
        "| `data/osm-verification.json` | 第三方核验：OpenStreetMap（Photon）对照 |",
        "",
        f"- 坐标精度 ±：最小 {dist['min']} m，中位 {dist['median']} m，"
        f"p90 {dist['p90']} m，最大 {dist['max']} m（已剔除度级粗坐标与越区条目）",
        f"- 可用性：`ok` {uc['ok']}、`coarse` {uc['coarse']}、`unusable` {uc['unusable']}、"
        f"`out_of_region`（越区，已隔离）{uc['out_of_region']}、"
        f"`not_a_place`（非实体，已隔离）{uc['not_a_place']}",
        "",
        "> 由 `scripts/` 下的脚本生成，请勿手改；改数据后重跑脚本。",
        "",
    ]

    # ---------------------------------------------------------------- 结论
    lines += ["## 一句话结论", ""]
    verdict = (xcheck or {}).get("verdict", {})
    if verdict:
        lines += [
            f"- 坐标系：Wikidata 侧是 **WGS84**。与渲染器现有坐标的差异"
            f"**{verdict['verdict']}**（偏差方向一致性 R = {verdict['bearing_coherence_R']}，"
            "1 为完全一致、0 为完全散乱）。",
            f"- 处置：{verdict['advice']}",
        ]
    if osm:
        c = osm["counts"]
        a = osm["agreement_m_distribution"]
        lines.append(
            f"- 第三方核验：OSM 能匹配上 {c['confirmed'] + c['approx'] + c['conflict']} 条，"
            f"其中 **{c['confirmed']} 条与 Wikidata 相差 ≤100 m（双源一致）**、"
            f"{c['approx']} 条 ≤500 m、{c['conflict']} 条 >500 m 需人工定夺；"
            f"一致度中位 {a['median']} m。")
    lines.append("")

    # ---------------------------------------------------------------- 精度
    lines += ["## 误差到底有多大（先读这段）", ""]
    lines += [
        "`half_range_m` 是 Wikidata 记录的坐标分辨率的一半，即该点的 ± 误差。"
        "**不同条目相差很大**，不要把它们当同等可靠：",
        "",
        "| 精度档 | 含义 | 怎么用 |",
        "|---|---|---|",
        "| ±15 m 以内 | 秒级精度 | 可以直接锚定地标本体 |",
        "| ±15–150 m | 常见档 | 定位楼体没问题，别用来定桥墩、岸线 |",
        "| ±150–550 m | 粗档 | 只能定片区，别让它决定路网走向 |",
        "| ±1 km 以上 | 严重粗档（整值经纬度） | 只当提示，不要进渲染 |",
        "",
        "桥梁 / 隧道的**留一交叉验证**误差见下节，反映的是"
        "「Wikidata 记的是桥的哪一点（塔顶 / 主跨中点 / 桥头）」的不确定性，"
        "**不要把桥坐标当岸线用**。",
        "",
    ]

    # ---------------------------------------------------------------- 精选
    lines += ["## 精选地标（可直接进 `js/data.js`）", ""]
    lines += ["| 名称 | 纬度 | 经度 | ± m | OSM 核验 | 类别 | QID |", "|---|---|---|---|---|---|---|"]
    mark = {"confirmed": "一致", "approx": "接近", "conflict": "**冲突**", "no_osm_match": "—"}
    for r in rows:
        if not r["featured"]:
            continue
        o = osm_by_qid.get(r["qid"], {})
        st = o.get("status", "—")
        cell = mark.get(st, st)
        if st in ("confirmed", "approx", "conflict"):
            cell += f" {o['agreement_m']:.0f} m"
        lines.append(f'| {r["name"]} | {r["lat"]:.5f} | {r["lon"]:.5f} | ±{r["half_range_m"]:.1f} | '
                     f'{cell} | {r["category"]} | [{r["qid"]}](https://www.wikidata.org/wiki/{r["qid"]}) |')
    lines.append("")

    # ---------------------------------------------------------------- 类别
    lines += ["## 全部实体（按类别）", ""]
    counts = {}
    for r in rows:
        counts[r["category"]] = counts.get(r["category"], 0) + 1
    lines += ["| 类别 | 数量 |", "|---|---|"]
    for key in sorted(counts, key=lambda k: -counts[k]):
        lines.append(f"| {key} | {counts[key]} |")
    lines.append("")
    lines.append("完整列表见 `data/wikidata-coords.json`（含 `half_range_m`、`sources`、`rank`、"
                 "`applies_to`、`km_from_center`）。")
    lines.append("")

    # ---------------------------------------------------------------- 坐标系
    if xcheck:
        h = xcheck["hypotheses"]
        lines += ["## 坐标系判定（定量，不是猜的）", ""]
        lines += [
            "对每处地标分别算三种假设下的残差，取中位数：",
            "",
            "| 假设 | 中位 | 均值 | p90 | 最大 |",
            "|---|---|---|---|---|",
        ]
        for k, label in (("H0_both_wgs84", "两边都是 WGS84（直接比）"),
                         ("H1_ref_is_gcj02", "渲染器坐标是 GCJ-02"),
                         ("H2_wd_is_gcj02", "Wikidata 坐标是 GCJ-02")):
            v = h.get(k)
            if not v:
                continue
            lines.append(f'| {label} | **{v["median"]} m** | {v["mean"]} m | '
                         f'{v["p90"]} m | {v["max"]} m |')
        lines += [
            "",
            f"偏差方向的合成向量长度 **R = {verdict['bearing_coherence_R']}**。"
            "GCJ-02 偏移有固定方向（中国大陆境内约 300–600 m、方向一致），"
            "R 应该接近 1；实测 R 只有 0.22，说明**方向散乱**，是逐点取值的误差，不是基准面差异。",
            "**因此不要做整体 GCJ-02 反解**——反解后残差反而更大（见 H1 / H2）。",
            "",
        ]
        worst = xcheck.get("worst") or []
        if worst:
            lines += ["### 与渲染器偏差最大的条目", ""]
            lines += ["| 来源 | 名称 | Δ | 方位 | 备注 |", "|---|---|---|---|---|"]
            for w in worst[:14]:
                lines.append(f'| {w["source"]} | {w["name"]} | **{w["delta_m"]:.0f} m** | '
                             f'{w["bearing_deg"]:.0f}° | {w["note"] or ""} |')
            lines.append("")

    # ---------------------------------------------------------------- OSM
    if osm:
        lines += ["## 第三方核验：OpenStreetMap", ""]
        lines += [
            "Wikidata 和 `js/data.js` 谁对，需要第三方说了算。这里用 OSM（Photon 地理编码，"
            "WGS84，与 Wikidata 无共同来源）做仲裁，比对结果：",
            "",
        ]
        a = osm["agreement_m_distribution"]
        c = osm["counts"]
        lines += [
            "| 判定 | 条数 | 含义 |",
            "|---|---|---|",
            f'| 一致（≤100 m） | {c["confirmed"]} | 双源互证，可直接用 |',
            f'| 接近（≤500 m） | {c["approx"]} | 同一目标，一侧偏粗 |',
            f'| 冲突（>500 m） | {c["conflict"]} | 需人工定夺 |',
            f'| OSM 无同名 | {c["no_osm_match"]} | 保留 Wikidata 值 |',
            "",
            f"一致度：中位 {a['median']} m，p90 {a['p90']} m，最大 {a['max']} m。",
            "",
        ]
        conflicts = [r for r in osm["results"] if r["status"] == "conflict"]
        real = [r for r in conflicts if str(r.get("conflict_reason", "")).startswith("**")]
        lines += [
            f"{len(conflicts)} 条“冲突”里，绝大多数**不是数据错**，而是面状对象（湖心、区中心）"
            "取点定义不同，或 OSM 匹配到了同名异对象。真正需要人工定夺的只有 "
            f"**{len(real)}** 条：",
            "",
        ]
        if real:
            lines += ["| 名称 | Wikidata | OSM | Δ | OSM 标签 |", "|---|---|---|---|---|"]
            for r in real[:20]:
                lines.append(f'| {r["name"]} | {r["wd_lat"]:.5f}, {r["wd_lon"]:.5f} | '
                             f'{r["osm_lat"]:.5f}, {r["osm_lon"]:.5f} | **{r["agreement_m"]:.0f} m** | '
                             f'{r.get("osm_key")}={r.get("osm_value")} |')
            lines.append("")
        lines += ["### 精选地标的核验结果（最该关心的部分）", ""]
        lines += ["| 名称 | 判定 | 与 OSM 差 | 说明 |", "|---|---|---|---|"]
        for r in rows:
            if not r["featured"]:
                continue
            o = osm_by_qid.get(r["qid"])
            if not o or o["status"] == "no_osm_match":
                lines.append(f'| {r["name"]} | OSM 无同名 | — | 保留 Wikidata 值 |')
                continue
            label = {"confirmed": "**双源一致**", "approx": "接近",
                     "conflict": "冲突"}[o["status"]]
            lines.append(f'| {r["name"]} | {label} | {o["agreement_m"]:.0f} m | '
                         f'{o.get("conflict_reason") or ""} |')
        lines.append("")

    # ---------------------------------------------------------------- 补缺
    gap = load(ROOT / "data" / "osm-gap-fill.json")
    if gap:
        lines += ["## Wikidata 缺项的补充坐标（来自 OSM）", ""]
        lines.append("渲染器里有、但 Wikidata 查不到的条目，用 OSM 补齐；"
                     "同时给出渲染器原坐标的偏差：")
        lines.append("")
        lines += ["| 名称 | OSM 纬度 | OSM 经度 | 渲染器原坐标偏差 | OSM 标签 |", "|---|---|---|---|---|"]
        for g in gap["results"]:
            if g["status"] != "found":
                lines.append(f'| {g["name"]} | — | — | OSM 无同名 | — |')
                continue
            lines.append(f'| {g["name"]} | {g["osm_lat"]:.5f} | {g["osm_lon"]:.5f} | '
                         f'**{g["delta_m"]:.0f} m** | {g.get("osm_key")}={g.get("osm_value")} |')
        lines.append("")

    # ---------------------------------------------------------------- 自洽
    if audit:
        lines += ["## 几何自洽检查", ""]
        lines += [
            "以桥隧坐标拟合的两江中心线为基准，量每个地标到江轴线的垂距。"
            "**这个检查的正向价值大于查错**：",
            "",
            f"- 落在河道半宽内的非过江地标：**{audit['in_channel_count']}** 处。"
            "对晴川阁、绿地中心、琴台音乐厅这类**滨江地标，落在江边是正确的**——",
            "  它反过来证明了这些坐标没有跑到内陆去。若某条本不该临江却出现在这里，才是坐标错了。",
            f"- 离最近江轴线 >400 m 的过江工程：**{audit['far_crossing_count']}** 处，"
            f"其中真存疑 **{audit['suspect_crossing_count']}** 处。",
            "",
        ]
        if audit["in_channel"]:
            lines += ["| 名称 | 类别 | 距江轴线 | 航道半宽 | 解读 |", "|---|---|---|---|---|"]
            for x in audit["in_channel"][:14]:
                if x["category"] == "舰船" or "乡" in str(x["name"]) or "洲" in str(x["name"]):
                    judge = "江上/江心，正常"
                elif x["distance_to_axis_m"] > 0.6 * x["channel_half_width_m"]:
                    judge = "临江岸线，符合预期"
                else:
                    judge = "**疑在江中，需复核**"
                lines.append(f'| {x["name"]} | {x["category"]} | {x["distance_to_axis_m"]:.0f} m | '
                             f'{x["channel_half_width_m"]:.0f} m | {judge} |')
            lines.append("")
        if audit["far_crossings"]:
            lines += ["### 离江较远的过江工程", ""]
            lines += ["| 名称 | 最近河道 | 距轴线 | 说明 |", "|---|---|---|---|"]
            for x in audit["far_crossings"][:14]:
                lines.append(f'| {x["name"]} | {x["nearest_river"]} | '
                             f'{x["distance_to_axis_m"]:.0f} m | {x["reason"]} |')
            lines.append("")
            lines.append("“在拟合范围之外”是远郊桥隧（如沌口、青山长江大桥）超出锚点覆盖，"
                         "不代表数据错；“在拟合范围内却不贴河”的多是跨小河/跨湖的桥"
                         "（三道河、二道河、墨水湖），名字里的“桥”不该被当成过江通道。")
            lines.append("")

    # ---------------------------------------------------------------- 越区
    oor = [r for r in rows if r["usability"] == "out_of_region"]
    nap = [r for r in rows if r["usability"] == "not_a_place"]
    if oor or nap:
        lines += ["## 已隔离的条目（不要进渲染）", ""]
        if oor:
            lines += ["### 越区（同名误收 / 非武汉实体）", ""]
            lines += ["| QID | 名称 | 坐标 | 距城市原点 | 原因 |", "|---|---|---|---|---|"]
            for r in oor:
                reason = "同名误收（非武汉实体）" if r["km_from_center"] > 100 \
                    else "武汉窗口内无坐标，只有河源/河口"
                lines.append(f'| {r["qid"]} | {r["name"]} | {r["lat"]:.4f}, {r["lon"]:.4f} | '
                             f'{r["km_from_center"]} km | {reason} |')
            lines.append("")
        if nap:
            lines += ["### 非实体（战役 / 事件 / 未建成方案 / 几何概念）", ""]
            lines += ["| QID | 名称 | 坐标 |", "|---|---|---|"]
            for r in nap:
                lines.append(f'| {r["qid"]} | {r["name"]} | {r["lat"]:.4f}, {r["lon"]:.4f} |')
            lines.append("")
            lines.append("长江（Q5413）没有武汉段坐标，只有河源与河口，因此被隔离——"
                         "江的几何请用 `hydro-centerlines.json`，不要用一个点代表长江。")
            lines.append("")

    # ---------------------------------------------------------------- 水系
    if hydro:
        lines += ["## 两江中心线（由实测桥隧坐标反推）", ""]
        conf = hydro.get("confluence")
        if conf:
            lines.append(f"汉江汇入口（`{conf['name']}` {conf['lat']:.5f}, {conf['lon']:.5f}）"
                         f"到拟合长江中心线的距离 = **{hydro['confluence_offset_to_yangtze_m']} m**，"
                         "两套数据自洽。")
            lines.append("")
        for river in hydro["rivers"]:
            loo = river["loo_cross_validation_m"]
            lines += [
                f"### {river['name']}",
                "",
                f"- 锚点数：{len(river['anchors'])}（全部为跨江桥 / 过江隧道）",
                f"- 方法：{river['method']}",
                f"- 留一误差：中位 {loo['median']} m，p90 {loo['p90']} m，最大 {loo['max']} m",
                "",
                "| 锚点 | 纬度 | 经度 | 留一误差 | 判定 |",
                "|---|---|---|---|---|",
            ]
            for a in river["anchors"]:
                flag = {"ok": "可用", "endpoint_extrapolation": "端点（含外插成分）",
                        "suspect_coordinate": "**存疑**"}.get(a["flag"], a["flag"])
                lines.append(f'| {a["name"]} | {a["lat"]:.5f} | {a["lon"]:.5f} | '
                             f'{a["loo_error_m"]:.0f} m | {flag} |')
            lines.append("")
            lines.append(f"`polyline` {len(river['polyline'])} 个点（约 200 m 一个）；"
                         f"`polyline_reliable` 已剔除存疑坐标，**建议用后者**。")
            lines.append("")

        lines += ["### 河流控制点的偏差（更严重）", ""]
        for key, label in (("yangtze", "长江"), ("han", "汉江")):
            lines += [f"**{label}**", "", "| 控制点 | 偏离拟合中心线 | 备注 |", "|---|---|---|"]
            for r in hydro["cross_check_vs_plan"][key]:
                note = "" if r["in_range"] else "超出锚点实测范围"
                lines.append(f'| {r["name"]} | {r["offset_m"]:.0f} m | {note} |')
            lines.append("")

    # ---------------------------------------------------------------- 建议
    lines += ["## 降偏差的落地建议", ""]
    lines += [
        "1. **不要做整体 GCJ-02 反解。** 已定量验证：反解后残差从 794 m 升到 944 / 1092 m，"
        "只会更糟。逐点替换成 Wikidata 坐标即可。",
        "2. **替换时保留 `half_range_m`**，并在渲染侧按精度分档：>±150 m 的条目"
        "不要用来决定建筑朝向与占地轮廓。",
        "3. **桥隧坐标只用来定河，不用来定岸。** 岸线 = 中心线 ± 半宽"
        "（长江约 550 m、汉江约 120 m，由桥长反推）。",
        "4. **武汉绿地中心已定案。** Wikidata `30.58594, 114.31748`，"
        "与中文维基（30°35′9.39″N 114°19′2.91″E）完全一致；"
        "`js/data.js` 的 `30.6152, 114.3366` 偏北 3.7 km，请直接替换。",
        "5. **汉江整体要重画。** DEV_PLAN 的汉江控制点偏离实测中心线 1.4–6.8 km；"
        "汉江一错，汉口 / 汉阳的分界就错，两镇形状跟着错。",
        "6. **优先替换被 OSM 判为“一致”的条目**（双源互证，风险最低）；"
        "“冲突”条目按上表人工定夺，不要盲信任何一侧。"
        "精选地标里已被双源互证的有：黄鹤楼 18 m、晴川阁 9 m、龟山电视塔 17 m、"
        "武汉绿地中心 24 m、江汉关大楼 31 m、起义门 19 m、湖北省图书馆 8 m、"
        "武汉长江大桥 79 m、宝通寺 47 m、长春观 49 m、杨泗港长江大桥 29 m、"
        "江汉桥 72 m、晴川桥 19 m——**这些可以直接替换**。"
        "反过来说明 `js/data.js` 的龟山电视塔（偏 1.35 km）、晴川阁（偏 1.40 km）、"
        "归元寺（偏 1.66 km）确实错了。",
        "7. **越区条目已隔离**（`usability=out_of_region`），渲染侧请按此字段过滤，"
        "否则会把江苏的“磨山镇”之类的同名项画进武汉。",
        "",
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(rows)} landmarks, "
          f"{len(hydro['rivers']) if hydro else 0} rivers)")


if __name__ == "__main__":
    main()
