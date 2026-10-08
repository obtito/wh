// 共享地面查询:地形 + 桥面 + 堤式道路 + 水域判定(车辆/步行/无人机共用)
//
// 竖向上下文:调用方传入实体当前高度 entityY ——
//   桥面只在实体接近桥面高度时生效(桥下游泳/行车不会被瞬移上桥);
//   堤式贴江道路(路面走廊)优先于地形。
import { toV2List, distToPolyline, pointInPolygon } from './geo.js';
import { RIVER, LAKES } from './data.js';
import { terrainHeight, roadHeightAt } from './world.js';
import { bridgeHeightAt } from './bridges.js';

const RIVER_PTS = toV2List(RIVER.pts);
const BRANCHES = RIVER.branches.map((b) => ({ hw: b.halfWidth, pts: toV2List(b.pts) }));
const LAKE_POLYS = LAKES.map((l) => toV2List(l.pts));

/** 水域判定(bridgeY 上下文:桥上不算水;堤式路面走廊内不算水) */
export function isWater(x, z, entityY = Infinity) {
  const bridgeY = bridgeHeightAt(x, z);
  if (bridgeY != null && (entityY === Infinity || entityY > bridgeY - 2.5)) return false;
  if (roadHeightAt(x, z) != null) return false;
  if (distToPolyline(x, z, RIVER_PTS) < RIVER.halfWidth) return true;
  for (const b of BRANCHES) if (distToPolyline(x, z, b.pts) < b.hw) return true;
  for (const p of LAKE_POLYS) if (pointInPolygon(x, z, p)) return true;
  return false;
}

/** 站立面高度:桥面(需竖向接近)/堤式路 > 地形 */
export function groundY(x, z, entityY = Infinity) {
  const b = bridgeHeightAt(x, z);
  const t = Math.max(terrainHeight(x, z), 0);
  if (b != null && b >= t - 1.5 && (entityY === Infinity || entityY > b - 2.5)) return b;
  const r = roadHeightAt(x, z);
  if (r != null && r > t) return r;
  return t;
}
