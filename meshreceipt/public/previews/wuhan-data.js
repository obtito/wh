// Display heights follow GTA-WH/js/sites.js, not a new survey of the buildings.
export const WUHAN_TOWERS = [
  { id: 'greenland', name: '武汉绿地中心', dir: 'wuhan-greenland-center', displayHeight: 475.6,
    sourceUrl: 'https://sketchfab.com/3d-models/wuhan-greenland-center-795a3cec308d44a985dacfda99239a3e' },
  { id: 'wuhan-center', name: '武汉中心', dir: 'wuhan-center', displayHeight: 438,
    sourceUrl: 'https://sketchfab.com/3d-models/wuhan-center-413eb58cc89c4423bf51ce63c2ab1393' },
  { id: 'ctf-finance', name: '周大福金融中心', dir: 'wuhan-ctf-finance', displayHeight: 400,
    sourceUrl: 'https://sketchfab.com/3d-models/wuhanctf-finance-center-ae06b8933f7e4b5fb749425afb2e454e' },
  { id: 'shipping-center', name: '武汉航运中心', dir: 'wuhan-shipping-center', displayHeight: 236,
    sourceUrl: 'https://sketchfab.com/3d-models/wuhan-yangtze-river-shipping-center-fc4c62c332234ef6abffac9d87e4bc2f' },
  { id: 'panhai-times', name: '泛海时代广场', dir: 'wuhan-panhai-times', displayHeight: 200,
    sourceUrl: 'https://sketchfab.com/3d-models/wuhan-pan-hai-times-center-landmark-tower-c5dfa1384c0b4ae3a08a49e2ed7ae2e4' },
];

export const HUANGHE = {
  id: 'huanghe', name: '黄鹤楼', kind: 'procedural', stage: 3, revision: 'photo-refinement-final',
  modulePath: '/previews/models/huanghe-code/tower.js',
  displayHeight: 51.4, sourceUrl: '/previews/models/huanghe-code/source.json',
};

// A presentation revision of the same GLB, not a newly optimized mesh file.
export const HUANGHE_VERSIONS = [
  { id: 'blender-refined', name: 'Blender · 实景优化版', kind: 'glb',
    modelUrl: '/previews/models/huanghe-blender/refined.glb',
    displayHeight: 53.46979904174805, preserveScale: true, rotationY: Math.PI,
    sourceUrl: '/previews/models/huanghe-blender/source.json', hint: '新增 · 10/07 Blender 导出',
    description: '新增 Blender 实景优化版：保留橙赭瓦面、棕红木作、回纹栏杆、低石台与原生匾额。按导出文件的米制尺度展示，不套用旧 GLB 着色或重复添加宝顶。照片参照的近似重建，非测绘复原；园景为展示设计，未完成琢信质量验收。',
    attribution: 'GTA-WH 本地 Blender 实景优化快照 · 2026-10-07 · 独立模型授权待确认' },
  { id: 'glb-latest', name: 'GLB · 最新展示修订', kind: 'glb',
    dir: 'huanghe-tower', file: 'huanghe-main-tower-lod2.glb', displayHeight: 51.4,
    presentation: 'gta-wh-20261007', sourceUrl: '/previews/models/huanghe-glb/source.json',
    description: '上个 GLB 的最新展示修订：复用 GTA-WH 屋顶与朱柱材质修正，补上葫芦宝顶和黄鹤楼匾额；原 GLB 网格未改写。园景为展示设计，非实地复原。',
    attribution: 'China_Tower / 0G-Bhqc · 原仓库标注 MIT；展示修订源自 GTA-WH 本地版本' },
  { id: 'glb-original', name: 'GLB · 原始材质版', kind: 'glb',
    dir: 'huanghe-tower', file: 'huanghe-main-tower-lod2.glb', displayHeight: 51.4,
    sourceUrl: '/previews/models/huanghe-glb/source.json',
    description: '同一个 China_Tower GLB，保留原始材质，不加 GTA-WH 的屋顶与朱柱着色、宝顶和匾额。与最新展示修订使用同一套园景和光照，便于对比。',
    attribution: 'China_Tower / 0G-Bhqc · 原仓库标注 MIT；公开再分发前须核对许可' },
  { ...HUANGHE, id: 'code-stage3', name: 'Three.js · 代码改进版',
    description: '独立代码生成的 stage 3 / photo-refinement-final 版本，五重主檐、原生材质与实例化柱梁。不是上个 GLB 的修改版；尺寸含推定，未完成质量验收。',
    attribution: 'GTA-WH 本地代码快照 · stage 3 / photo-refinement-final · 独立授权待确认' },
];
export const HUANGHE_DEFAULT_VERSION = 'glb-latest';

export function huangheVersion(id = HUANGHE_DEFAULT_VERSION) {
  const version = HUANGHE_VERSIONS.find(item => item.id === id);
  if (!version) throw new Error(`未知黄鹤楼模型版本：${id}`);
  return version;
}

export function wuhanModelPath(item) {
  if (item.kind === 'procedural') throw new Error('程序化模型没有 GLB 路径');
  if (item.modelUrl) throw new Error('项目内快照使用 modelUrl，不在 GTA-WH 资产路径中');
  return `assets/models/${item.dir}/${item.file || 'scene.gltf'}`;
}

export function wuhanModelUrl(item) {
  if (item.kind === 'procedural') throw new Error('程序化模型没有 GLB URL');
  return item.modelUrl || `/api/source/wuhan/${wuhanModelPath(item)}`;
}
