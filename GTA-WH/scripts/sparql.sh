#!/usr/bin/env bash
# Run a SPARQL file against Wikidata Query Service.
# WDQS through this sandbox proxy intermittently returns 000, so retry hard.
#   usage: bash scripts/sparql.sh scripts/queries/xxx.rq artifacts/sparql/xxx.json
set -u
cd "$(dirname "$0")/.."
QUERY_FILE="$1"
OUT="$2"
mkdir -p "$(dirname "$OUT")"

QUERY=$(cat "$QUERY_FILE")
for attempt in 1 2 3 4 5 6; do
  code=$(curl -s -m 90 -G "https://query.wikidata.org/sparql" \
    --data-urlencode "query=$QUERY" \
    -H "Accept: application/sparql-results+json" \
    -A "GTA-WH/0.1 (city prototype)" \
    -o "$OUT" -w "%{http_code}")
  if [ "$code" = "200" ] && [ -s "$OUT" ]; then
    rows=$(grep -o '"value"' "$OUT" | wc -l)
    echo "OK attempt=$attempt bytes=$(wc -c <"$OUT")"
    exit 0
  fi
  sleep 3
done
echo "FAILED after 6 attempts (last=$code)"
exit 1
