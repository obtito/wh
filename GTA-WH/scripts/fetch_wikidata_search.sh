#!/usr/bin/env bash
# Resolve the landmarks that a plain zhwiki/enwiki page lookup missed.
# Each keyword goes through wbsearchentities first, then wbgetentities for P625.
set -u
cd "$(dirname "$0")/.."
OUT=artifacts/wikidata/search
mkdir -p "$OUT"

KEYWORDS=(
  "江汉关" "晴川阁" "古琴台" "中山公园 武汉" "解放公园" "户部巷" "首义广场"
  "长春观 武汉" "卓刀泉寺" "南湖 武汉" "墨水湖" "月湖 武汉" "楚河汉街"
  "磨山" "汉秀剧场" "汉口江滩" "楚天台" "武汉大学 樱顶" "郭郑湖" "水果湖"
)

i=0
for kw in "${KEYWORDS[@]}"; do
  i=$((i + 1))
  slug=$(printf 's%02d' "$i")
  printf '%s\n' "$kw" > "$OUT/$slug.kw"
  # 1) search
  for attempt in 1 2 3; do
    code=$(curl -s -m 40 -G "https://www.wikidata.org/w/api.php" \
      --data-urlencode "action=wbsearchentities" --data-urlencode "search=$kw" \
      --data-urlencode "language=zh" --data-urlencode "uselang=zh" \
      --data-urlencode "type=item" --data-urlencode "limit=3" \
      --data-urlencode "format=json" --data-urlencode "formatversion=2" \
      -o "$OUT/$slug.search.json" -w "%{http_code}")
    [ "$code" = "200" ] && [ -s "$OUT/$slug.search.json" ] && break
    sleep 1
  done
  qid=$(OUTPATH="$OUT/$slug.search.json" python -c "
import json,os
try:
    d=json.load(open(os.environ['OUTPATH']))
    ids=[h['id'] for h in (d.get('search') or []) if h.get('id')]
    print('|'.join(ids[:3]))
except Exception:
    print('')
")
  if [ -z "$qid" ]; then printf 'search-failed  %s\n' "$kw"; continue; fi
  printf '%s\n' "$qid" > "$OUT/$slug.qid"
  # 2) fetch coordinates
  for attempt in 1 2 3; do
    code=$(curl -s -m 40 -G "https://www.wikidata.org/w/api.php" \
      --data-urlencode "action=wbgetentities" --data-urlencode "ids=$qid" \
      --data-urlencode "props=claims|labels|descriptions" \
      --data-urlencode "languages=zh|en" \
      --data-urlencode "format=json" --data-urlencode "formatversion=2" \
      -o "$OUT/$slug.json" -w "%{http_code}")
    [ "$code" = "200" ] && [ -s "$OUT/$slug.json" ] && break
    sleep 1
  done
  printf '%s  %-16s %s\n' "$code" "$kw" "$qid"
done
echo "done"
