"""Consolidate every Wikidata page we fetched into one machine-readable coordinate file.

Input  : artifacts/wikidata/{p*,e*,search/s*} produced by the fetch_*.sh scripts
Output : data/wikidata-coords.json  — one entry per landmark, deduplicated by QID,
         restricted to the Wuhan bounding box, with the source QID recorded.

The file is meant to be dropped straight into another pipeline: `name` is the
Chinese label when available, `lon`/`lat` are WGS84 degrees.
"""
from __future__ import annotations

import glob
import json
import math
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "wikidata-coords.json"

# Wuhan default search window — wide enough to keep 天河机场/盘龙城 out on purpose
# while still catching every landmark in the playable core.
CORE = {"lon": (114.15, 114.50), "lat": (30.42, 30.72)}


def load_pages(pattern: str) -> dict[str, dict]:
    """Return {qid: entity} for a family of wbgetentities pages."""
    merged: dict[str, dict] = {}
    for page in sorted(glob.glob(str(ROOT / pattern))):
        try:
            body = json.loads(Path(page).read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue  # truncated download; the next run may fix it
        for qid, item in (body.get("entities") or {}).items():
            if not isinstance(item, dict) or not str(qid).startswith("Q"):
                continue
            merged[qid] = {"item": item, "page": os.path.basename(page)}
    return merged


def extract(entity: dict) -> dict | None:
    item = entity["item"]
    coord = None
    for claim in (item.get("claims") or {}).get("P625", []):
        dv = claim.get("mainsnak", {}).get("datavalue", {})
        if dv.get("type") == "globecoordinate":
            coord = dv["value"]
            break
    if not coord:
        return None
    labels = item.get("labels") or {}
    desc = item.get("descriptions") or {}
    return {
        "qid": item["id"],
        "name": labels.get("zh", {}).get("value") or labels.get("zh-hans", {}).get("value"),
        "name_en": labels.get("en", {}).get("value"),
        "desc": desc.get("zh", {}).get("value") or desc.get("en", {}).get("value"),
        "lat": round(coord["latitude"], 6),
        "lon": round(coord["longitude"], 6),
    }


def main() -> None:
    entities: dict[str, dict] = {}
    for pattern in ("artifacts/wikidata/p*.json", "artifacts/wikidata/e*.json",
                    "artifacts/wikidata/en/e*.json", "artifacts/wikidata/search/s*.json"):
        entities.update(load_pages(pattern))

    rows = []
    for entity in entities.values():
        row = extract(entity)
        if not row:
            continue
        if not (CORE["lon"][0] < row["lon"] < CORE["lon"][1]
                and CORE["lat"][0] < row["lat"] < CORE["lat"][1]):
            continue  # e.g. 长江 measured at the river source in Qinghai
        rows.append(row)

    rows.sort(key=lambda r: (r["name"] is None, r["name"] or "", r["qid"]))
    payload = {
        "crs": "WGS84 (EPSG:4326)",
        "source": "Wikidata coordinate location (P625) via the MediaWiki Action API",
        "license": "Wikidata facts are CC0; keep attribution in data/ATTRIBUTION.md",
        "core_bbox": CORE,
        "count": len(rows),
        "landmarks": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} with {len(rows)} landmarks")
    for r in rows:
        print(f'  {r["lat"]:.5f},{r["lon"]:.5f}  {r["qid"]:>10}  {r["name"]}')


if __name__ == "__main__":
    main()
