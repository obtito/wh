#!/usr/bin/env bash
# Second pass: pull the entries the zhwiki lookup missed, using their English labels.
set -u
cd "$(dirname "$0")/.."
OUT=artifacts/wikidata/en
mkdir -p "$OUT"

TITLES=(
  "East Lake (Wuhan)" "Wuhan Yangtze River Bridge" "Second Wuhan Yangtze River Bridge"
  "Yingwuzhou Yangtze River Bridge" "Yangsigang Yangtze River Bridge"
  "Baishazhou Yangtze River Bridge" "Erqi Yangtze River Bridge" "Tianxingzhou Bridge"
  "Hankou" "Wuchang" "Hanyang District, Wuhan" "Jianghan Road"
  "Wuhan Sports Center" "Huazhong University of Science and Technology"
  "Wuhan Center Tower" "Wuhan Greenland Center" "Guiyuan Temple" "Qingchuan Pavilion"
  "Yellow Crane Tower" "Chu River and Han Street" "Hubei Provincial Museum"
  "Wuhan Museum" "Wuhan Library" "Zhongshan Park, Wuhan" "Jiefang Park"
  "Hubu Alley" "Tanhualin" "Baotong Temple" "Wuchang Uprising" "Wuchang Railway Station"
  "Hankou Railway Station" "Wuhan Tianhe International Airport" "Optics Valley Square"
)

i=0
for t in "${TITLES[@]}"; do
  i=$((i + 1))
  slug=$(printf 'e%02d' "$i")
  dest="$OUT/$slug.json"
  for attempt in 1 2 3 4; do
    code=$(curl -s -m 45 -G "https://www.wikidata.org/w/api.php" \
      --data-urlencode "action=wbgetentities" --data-urlencode "sites=enwiki" \
      --data-urlencode "titles=$t" \
      --data-urlencode "props=claims|labels" --data-urlencode "languages=zh|en" \
      --data-urlencode "format=json" --data-urlencode "formatversion=2" \
      -o "$dest" -w "%{http_code}")
    if [ "$code" = "200" ] && [ -s "$dest" ]; then break; fi
    sleep 1
  done
  printf '%s  %-46s %s\n' "$code" "$t" "$([ -s "$dest" ] && echo ok || echo FAILED)"
  printf '%s\n' "$t" > "$dest.title"
done
echo "done: $i entities"
