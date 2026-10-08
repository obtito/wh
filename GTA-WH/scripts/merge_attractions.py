"""Merge raw Wikidata pages into reviewed seed coordinates for the Wuhan city dataset."""
from __future__ import annotations

import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "attractions.raw.json"


def load_pages() -> list[dict]:
    rows: list[dict] = []
    for page in sorted(glob.glob(str(ROOT / "artifacts" / "wikidata" / "p*.json"))):
        title = Path(page + ".title").read_text(encoding="utf-8").strip()
        try:
            body = json.loads(Path(page).read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            rows.append({"query": title, "qid": None, "lat": None, "lon": None, "note": "truncated"})
            continue
        entities = body.get("entities") or {}
        if not entities:
            rows.append({"query": title, "qid": None, "lat": None, "lon": None})
            continue
        for qid, item in entities.items():
            coord = None
            for claim in (item.get("claims") or {}).get("P625", []):
                dv = claim.get("mainsnak", {}).get("datavalue", {})
                if dv.get("type") == "globecoordinate":
                    coord = dv["value"]
                    break
            labels = item.get("labels") or {}
            rows.append({
                "query": title,
                "qid": qid,
                "label_zh": labels.get("zh", {}).get("value"),
                "label_en": labels.get("en", {}).get("value"),
                "lat": coord["latitude"] if coord else None,
                "lon": coord["longitude"] if coord else None,
            })
    return rows


def main() -> None:
    rows = load_pages()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    hits = [r for r in rows if r["lat"] is not None]
    print(f"{len(rows)} queries, {len(hits)} with coordinates")
    for r in rows:
        pos = f'{r["lat"]:.5f},{r["lon"]:.5f}' if r["lat"] else "MISSING"
        print(f'  {pos:<22}  {r["query"]:<22} {r["qid"]}  {r.get("label_en") or ""}')


if __name__ == "__main__":
    main()
