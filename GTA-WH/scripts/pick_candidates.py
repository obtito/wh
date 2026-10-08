"""Turn the raw SPARQL bbox dump into a curated QID candidate list.

The bbox query returns ~800 items, most of which are metro stations and hotels —
useless as landmarks and noisy for anyone consuming the data. We keep the kinds
that map to a playable city: bridges, tunnels, rivers, lakes, towers, temples,
heritage sites, universities, government buildings and rail termini.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "artifacts" / "sparql" / "wuhan_box.json"
OUT = ROOT / "artifacts" / "sparql" / "candidates.json"

NOISE_KINDS = {
    "地铁站", "地下站", "高架站", "電車站", "电车车站", "终点站", "单轨站", "已停运车站",
    "飯店", "酒店", "飯店building", "醫療機構", "醫院", "医疗机构", "医院",
    "街道", "住宅", "企業", "企业", "公司",
}
KEEP_KINDS = {
    "公路橋", "桥", "斜拉橋", "鐵路隧道", "隧道", "湖泊", "河流", "摩天大樓", "超高層建築",
    "文物保护单位", "文化遺產", "塔", "佛寺", "主教座堂", "教堂", "清真寺", "圖書館", "图书馆",
    "建筑物", "大學", "教育机构", "中华人民共和国教育部直属高等学校", "組織", "政府機構",
    "機場", "飞机场", "汉口租界", "纪念碑", "博物馆", "體育場", "体育场", "公園", "公园",
    "鐵路車站", "铁路车站", "车站", "植物园", "植物園", "劇院", "剧院",
}

# Names we always want, whatever their instance-of turned out to be.
PINNED = {
    "Q462372",  # 黄鹤楼
    "Q8039097",  # 武汉长江大桥
    "Q11124749",  # 武汉长江二桥
    "Q11124760",  # 鹦鹉洲长江大桥
    "Q11124688",  # 杨泗港长江大桥
    "Q8039078",  # 白沙洲长江大桥
    "Q11124442",  # 二七长江大桥
    "Q7267796",  # 晴川桥
    "Q11134644",  # 江汉桥
    "Q11091992",  # 月湖桥
    "Q1407294",  # 龟山电视塔
    "Q5616939",  # 归元寺
    "Q11090196",  # 晴川阁
    "Q10913488",  # 古琴台
    "Q1108197",  # 武汉大学
    "Q4391403",  # 湖北省博物馆
    "Q11088377",  # 昙华林
    "Q17040884",  # 起义门
    "Q30946741",  # 辛亥革命博物馆
    "Q10949510",  # 宝通寺
    "Q1143096", "Q1320237",
}
# Yangtze / Han crossings — these double as anchors for the river centreline fit.
YANGTZE_CROSSINGS = [
    "Q8039078", "Q11124688", "Q11124760", "Q8039097", "Q140981257",
    "Q11124515", "Q11124752", "Q11124749", "Q24836268", "Q11124442",
]
HAN_CROSSINGS = ["Q140986087", "Q60995269", "Q11091992", "Q11134644", "Q7267796"]


def main() -> None:
    payload = json.loads(SRC.read_text(encoding="utf-8"))
    items: dict[str, dict] = {}
    for b in payload["results"]["bindings"]:
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        row = items.setdefault(qid, {"qid": qid, "label": None, "coord": None, "kinds": []})
        row["label"] = b.get("itemLabel", {}).get("value", row["label"])
        if not row["coord"] and "coord" in b:
            row["coord"] = b["coord"]["value"]
        kind = b.get("kindLabel", {}).get("value")
        if kind and kind not in row["kinds"]:
            row["kinds"].append(kind)

    kept = []
    for qid, row in items.items():
        kinds = set(row["kinds"])
        if qid in PINNED or kinds & KEEP_KINDS:
            keep = True
        else:
            keep = not (kinds & NOISE_KINDS)
        if keep and row["coord"]:
            kept.append(row)

    kept.sort(key=lambda r: r["qid"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "total_in_box": len(items),
        "kept": len(kept),
        "yangtze_crossings": YANGTZE_CROSSINGS,
        "han_crossings": HAN_CROSSINGS,
        "items": kept,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(items)} items in box -> kept {len(kept)}")


if __name__ == "__main__":
    main()
