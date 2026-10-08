#!/usr/bin/env bash
# Pull full claims (P625 precision + sources) for every curated QID.
# Writes to artifacts/claims/ and never deletes anything: the sandbox's safety
# hook intercepts rm and left the previous run with a half-empty directory.
# The QID list comes from a file python writes in binary mode, because a stray
# CR on Windows turns the whole ids= batch into "no-such-entity".
set -u
cd "$(dirname "$0")/.."
OUT=artifacts/claims
mkdir -p "$OUT"

python scripts/write_batches.py

total=$(wc -l < "$OUT/batches.txt")
batch=0
while IFS= read -r ids; do
  [ -z "$ids" ] && continue
  batch=$((batch + 1))
  slug=$(printf 'b%03d' "$batch")
  for attempt in 1 2 3 4; do
    code=$(curl -s -m 90 -G "https://www.wikidata.org/w/api.php" \
      --data-urlencode "action=wbgetentities" --data-urlencode "ids=$ids" \
      --data-urlencode "props=claims|labels|descriptions" \
      --data-urlencode "languages=zh|zh-hans|en" \
      --data-urlencode "format=json" --data-urlencode "formatversion=2" \
      -o "$OUT/$slug.json" -w "%{http_code}")
    [ "$code" = "200" ] && [ -s "$OUT/$slug.json" ] && break
    sleep 2
  done
  echo "batch $batch/$total http=$code size=$(wc -c <"$OUT/$slug.json")"
done < "$OUT/batches.txt"
echo "done: $batch batches"
