"""Write artifacts/claims/batches.txt — one pipe-joined QID batch per line.

Binary mode on purpose: on Windows a text-mode write turns every "\n" into
"\r\n", and the trailing CR silently invalidates the whole ids= parameter of
wbgetentities (the API answers "no-such-entity" for the entire batch).
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CANDIDATES = ROOT / "artifacts" / "sparql" / "candidates.json"
OUTDIR = ROOT / "artifacts" / "claims"
BATCH = 20


def main() -> None:
    items = json.loads(CANDIDATES.read_text(encoding="utf-8"))["items"]
    qids = [i["qid"] for i in items]
    OUTDIR.mkdir(parents=True, exist_ok=True)
    payload = "\n".join("|".join(qids[k:k + BATCH]) for k in range(0, len(qids), BATCH)) + "\n"
    (OUTDIR / "batches.txt").write_bytes(payload.encode("ascii"))
    print(f"{len(qids)} entities -> {(len(qids) + BATCH - 1) // BATCH} batches of {BATCH}")


if __name__ == "__main__":
    main()
