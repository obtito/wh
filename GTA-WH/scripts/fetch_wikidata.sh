#!/usr/bin/env bash
# Pull WGS84 coordinates for Wuhan landmarks from Wikidata via the Action API.
# One page per request keeps the sandbox proxy happy; retries handle sporadic 000/28.
set -u
cd "$(dirname "$0")/.."
OUT=artifacts/wikidata
mkdir -p "$OUT"

TITLES=(
  "黄鹤楼" "东湖 (武汉市)" "武汉大学" "湖北省博物馆" "武汉长江大桥" "江汉关"
  "归元寺" "晴川阁" "古琴台" "楚河汉街" "武汉绿地中心" "光谷广场"
  "龟山电视塔" "辛亥革命博物馆" "起义门" "中山公园 (武汉)" "解放公园 (武汉)"
  "昙华林" "户部巷" "首义广场" "宝通寺" "长春观" "卓刀泉寺"
  "武汉站" "汉口站" "武昌站" "武汉天河国际机场"
  "鹦鹉洲长江大桥" "晴川桥" "武汉长江二桥" "江汉桥" "月湖桥" "武汉长江隧道"
  "月湖 (武汉市)" "墨水湖 (武汉)" "南湖 (武汉)" "沙湖 (武汉)" "汉江" "长江"
  "东湖磨山景区" "东湖绿道" "琴台大剧院" "武汉国际博览中心" "湖北省图书馆" "武汉博物馆"
  "黎黄陂路" "吉庆街" "武汉体育中心" "华中科技大学" "武汉理工大学" "华中师范大学"
  "盘龙城遗址" "木兰草原" "武汉欢乐谷" "武汉海昌极地海洋世界"
)

i=0
for t in "${TITLES[@]}"; do
  i=$((i + 1))
  slug=$(printf 'p%02d' "$i")
  dest="$OUT/$slug.json"
  ok=0
  for attempt in 1 2 3 4; do
    code=$(curl -s -m 45 -G "https://www.wikidata.org/w/api.php" \
      --data-urlencode "action=wbgetentities" --data-urlencode "sites=zhwiki" \
      --data-urlencode "titles=$t" \
      --data-urlencode "props=claims|labels" --data-urlencode "languages=zh|en" \
      --data-urlencode "format=json" --data-urlencode "formatversion=2" \
      -o "$dest" -w "%{http_code}")
    if [ "$code" = "200" ] && [ -s "$dest" ]; then ok=1; break; fi
    sleep 1
  done
  printf '%s  %-24s %s\n' "$code" "$t" "$([ $ok -eq 1 ] && echo ok || echo FAILED)"
  printf '%s\n' "$t" > "$dest.title"
done
echo "done: $i entities"
