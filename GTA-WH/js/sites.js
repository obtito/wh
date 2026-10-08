// 共享排他站点:地标 / Sketchfab 真楼 / 摄影测量模型 的占地圆
// 单一事实来源,供 ①程序化城市避让 ②OSM 烘焙裁剪 ③运行时占位 三处共用
// (原先 main.js 里 `{ id, ...toV2(lon,lat), r }` 会把数组展开成 {0:x,1:z},
//  导致 e.x/e.z 为 undefined、排他判定恒不生效——这里统一收敛为 {x,z,r})
import { toV2 } from './geo.js';
import { LANDMARKS } from './data.js';

/** 地标占地半径(米;0 = 不排他) */
export const SITE_R = {
  huanghelou: 80, tvtower: 55, qingchuan: 45, jianghanguan: 48, jianghanlu: 30,
  hankoujiangtan: 0, hubsmuseum: 150, chuhehanjie: 240, hanxiu: 70, greenland: 65,
  whu: 330, chutiantai: 70, opticsvalley: 120, guiyuan: 140, guqintai: 45,
  tanhualin: 160, honglou: 65,
};

/** 地标占地圆(供城市生成排他) */
export function landmarkSites() {
  return LANDMARKS
    .map((l) => {
      const [x, z] = toV2(l.lon, l.lat);
      const r = SITE_R[l.id] ?? 60;
      return r > 0 ? { id: l.id, x, z, r } : null;
    })
    .filter(Boolean);
}

/** Sketchfab 武汉真实地标楼群(Void.com,CC-BY,按实测高度归一化放置) */
export const REAL_TOWERS = [
  { id: 'greenland-real', dir: 'wuhan-greenland-center', lon: 114.317475, lat: 30.585942, h: 475.6, r: 78, replace: 'lm:greenland' },
  { id: 'wuhan-center', dir: 'wuhan-center', lon: 114.239670, lat: 30.596650, h: 438, r: 72 },
  { id: 'ctf-finance', dir: 'wuhan-ctf-finance', lon: 114.3420, lat: 30.6120, h: 400, r: 68 },
  { id: 'shipping-center', dir: 'wuhan-shipping-center', lon: 114.3490, lat: 30.6230, h: 236, r: 62 },
  { id: 'panhai-times', dir: 'wuhan-panhai-times', lon: 114.3085, lat: 30.5955, h: 200, r: 58 },
];

/** 摄影测量替换模型占地(黄鹤楼 · 蛇山顶;坐标与 Wikidata Q462372/Overture 实测轮廓对齐) */
export const REAL_SITES = [
  { id: 'yellow-crane', lon: 114.296944, lat: 30.546944, r: 72 },
];

const circle = (id, lon, lat, r) => { const [x, z] = toV2(lon, lat); return { id, x, z, r }; };

export function realTowerSites() {
  return REAL_TOWERS.map((t) => circle(t.id, t.lon, t.lat, t.r));
}

/** 全量排他圆:地标 + 真楼 + 摄影测量模型 */
export function allExclusions() {
  return [
    ...landmarkSites(),
    ...realTowerSites(),
    ...REAL_SITES.map((s) => circle(s.id, s.lon, s.lat, s.r)),
  ];
}
