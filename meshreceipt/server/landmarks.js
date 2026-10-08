import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { HERITAGE } from '../public/previews/heritage-data.js';
import { WUHAN_TOWERS, HUANGHE_VERSIONS, huangheVersion, wuhanModelPath } from '../public/previews/wuhan-data.js';

async function modelReady(workspace, item) {
  try {
    if (item.kind === 'procedural') {
      const files = [new URL(`../public${item.modulePath}`, import.meta.url),
        ...['three.module.js', 'OrbitControls.js'].map(name => path.join(workspace, 'GTA-WH', 'vendor', name))];
      const info = await Promise.all(files.map(file => stat(file)));
      return info.every(file => file.isFile() && file.size > 20);
    }
    const file = item.modelUrl ? new URL(`../public${item.modelUrl}`, import.meta.url)
      : path.join(workspace, 'GTA-WH', wuhanModelPath(item));
    const info = await stat(file);
    if (!info.isFile() || info.size < 20) return false;
    if (item.file || item.modelUrl) {
      const vendor = path.join(workspace, 'GTA-WH', 'vendor');
      const dependencies = await Promise.all(['three.module.js', 'OrbitControls.js', 'GLTFLoader.js',
        'meshopt_decoder.module.js', 'utils/BufferGeometryUtils.js'].map(name => stat(path.join(vendor, name))));
      return dependencies.every(file => file.isFile() && file.size > 20);
    }
    if (info.size > 2 * 1024 * 1024) return false;
    const model = JSON.parse(await readFile(file, 'utf8'));
    if (model.asset?.version !== '2.0' || !model.meshes?.length) return false;
    const root = path.dirname(file);
    for (const resource of [...(model.buffers || []), ...(model.images || [])]) {
      if (!resource.uri) continue;
      const uri = decodeURIComponent(resource.uri);
      if (uri.includes('\\') || uri.includes(':') || uri.startsWith('/')) return false;
      const target = path.resolve(root, uri);
      if (!target.startsWith(`${root}${path.sep}`)) return false;
      const dependency = await stat(target);
      if (!dependency.isFile() || dependency.size === 0) return false;
    }
    return true;
  } catch { return false; }
}

export async function landmarkCatalog(workspace) {
  const yellowDefault = huangheVersion();
  const [versions, components] = await Promise.all([
    Promise.all(HUANGHE_VERSIONS.map(async item => ({
      id: item.id, name: item.name, kind: item.kind, sourceUrl: item.sourceUrl, ready: await modelReady(workspace, item),
    }))),
    Promise.all(WUHAN_TOWERS.map(async item => ({
      id: item.id, name: item.name, author: 'Void', sourceUrl: item.sourceUrl,
      ready: await modelReady(workspace, item), modelUrl: `/api/source/wuhan/${wuhanModelPath(item)}`,
    }))),
  ]);
  const yellowReady = versions.find(item => item.id === yellowDefault.id).ready;
  const readyCount = components.filter(item => item.ready).length;
  const mausoleum = HERITAGE.zhongshanling;
  return [
    { id: 'huanghe', title: '黄鹤楼', subtitle: '武汉 · GLB 最新展示修订 / 四版可切换', category: '城市地标', color: '#be914e', serial: 'WH·001',
      story: '默认仍为上个 China_Tower GLB 的 GTA-WH 最新展示修订（屋顶、朱柱材质及宝顶、匾额补件），原 GLB 网格未改写。现新增独立 Blender 实景优化版，接入 2026-10-07 的 refined.glb，保留橙赭瓦面、棕红木作、低石台与原生匾额，不套用旧版着色或补件。另可切换 GLB 原始材质版和 Three.js stage 3 代码改进版。四版均接入设计园景。Blender 版本已导出 GLB，但仍属照片参照的近似重建；Three.js 程序化模型尚未导出为可验收 GLB。园景非实地复原，格式可载入不代表质量验收通过。',
      source: 'GTA-WH / China_Tower GLB ＋ 本地展示修订', sourceUrl: yellowDefault.sourceUrl,
      license: 'China_Tower GLB 原仓库标注 MIT，公开再分发前须核对许可；独立代码版、Blender 模型及字体授权待确认，不能沿用 GLB 的 MIT 标注',
      previewUrl: yellowReady ? '/previews/wuhan.html?asset=huanghe' : null,
      poster: yellowReady ? '/previews/huanghe-poster-cinematic-lit.png' : null, posterKind: '夕阳灯带艺术封面',
      modelUrl: null,
      defaultVersion: yellowDefault.id, versions,
      components: [{ id: 'huanghe', name: '黄鹤楼 · GLB 最新展示修订', author: 'China_Tower / 0G-Bhqc ＋ GTA-WH 展示修订', sourceUrl: yellowDefault.sourceUrl, ready: yellowReady }],
      previewOnly: true, readiness: yellowReady ? 'GLB 最新展示修订 · 暂不验收' : '默认 GLB 文件待补齐', accent: '武汉 · 飞檐叠翠' },
    { id: 'wuhan-landmarks', title: '武汉地标建筑', subtitle: '武汉 · 五座现代建筑集合', category: '地标集合', color: '#718d9f', serial: 'WH·002',
      story: '汇集武汉绿地中心、武汉中心、周大福金融中心、武汉航运中心和泛海时代广场。新增连续街道、广场铺装、行道树、绿篱与日光阴影，支持五楼同屏和单体场景切换。封面以现有模型为参考，艺术化呈现雨后云隙光、湿润广场与城市绿化，并非模型原始截图；三维检视沿用原模型。原建筑与新增园景分别说明；集合按原工程高度参数等比展示，不是实际地理位置的武汉城市复原，也未合并为一个可验收文件。',
      source: 'GTA-WH / Sketchfab · Void（五座建筑）', sourceUrl: 'https://github.com/obtito/GTA-WH',
      license: '原仓库登记为 CC-BY 4.0，作者 Void；保留各模型链接，公开再分发前分别核对许可',
      previewUrl: '/previews/wuhan.html?asset=wuhan-landmarks', components,
      poster: readyCount === 5 ? '/previews/wuhan-landmarks-poster-cinematic.png' : null, posterKind: '雨后云隙光艺术封面',
      previewOnly: true, readiness: readyCount === 5 ? '五座模型就绪 · 暂不验收' : `${readyCount}/5 模型就绪 · 素材待补齐`, accent: '武汉 · 现代天际线' },
    { id: 'zifeng', title: '紫峰大厦', subtitle: '南京 · GTA-NJ 程序化模型', category: '城市地标', color: '#78969a', serial: 'NJ·001',
      story: '复用 GTA-NJ 紫峰原模型，新增全宽大画幅检视、按建筑轮廓自动取景和独立大屏入口，保留昼夜、方位与幕墙特写。原几何、材质及比例不改写。模型由代码生成，尚未导出为可验收的 GLB；外观与局部尺度包含原项目标明的估算。',
      source: 'GTA-NJ / js/zifeng.js', sourceUrl: 'https://github.com/obtito/GTA-NJ', license: '保留原项目署名；独立导出与发行授权待确认',
      previewUrl: '/previews/zifeng.html', poster: '/previews/zifeng-poster-cinematic.png', posterKind: '电影感艺术封面',
      previewOnly: true, readiness: '原项目三维预览', accent: '南京 · 天际线' },
    { id: 'nanjing-wall', title: '南京城墙', subtitle: '南京 · GTA-NJ 城门与城垣', category: '城市地标', color: '#8b8b72', serial: 'NJ·002',
      story: '沿用 GTA-NJ 的城门检视页面，可查看多处城门及门址。封面以多重城门、护城河石桥与金色天光构成电影海报式艺术组合，展现帝王城阙的气势，非单一地点的实景复原。当前接入的是原项目预览，不是已导出的城墙 GLB，也不声称是测绘级复刻。',
      source: 'GTA-NJ / 城门检视', sourceUrl: 'https://github.com/obtito/GTA-NJ', license: '几何与材料来源详见原项目署名；发行授权待确认',
      previewUrl: '/api/source/nanjing/preview-gates.html', poster: '/previews/nanjing-wall-poster-cinematic-v3.png', posterKind: '帝王城阙电影艺术封面',
      previewOnly: true, readiness: '原项目三维预览', accent: '南京 · 城垣记忆' },
    {
      id: 'zhongshanling', title: mausoleum.title, subtitle: '南京 · GTA-NJ 程序化组群', category: '城市地标',
      color: '#718d9f', serial: mausoleum.serial,
      story: `封面以晴空日光下的中山陵建筑与孙中山虚影构成电影海报式艺术画面。${mausoleum.summary} ${mausoleum.limitation} 目前为视角定位，不是独立构件资产或验收凭证。`,
      source: `GTA-NJ / js/landmarks.js / ${mausoleum.model}`, sourceUrl: 'https://github.com/obtito/GTA-NJ',
      license: '原项目及上游署名须保留；程序化代码与各扫描素材须分别核对授权',
      previewUrl: '/previews/heritage.html?asset=zhongshanling', previewOnly: true,
      poster: '/previews/zhongshanling-poster-cinematic-clear.png', posterKind: '孙中山虚影电影艺术封面',
      readiness: '程序化组群预览 · 未验收', accent: '南京 · 历史组群',
    },
  ];
}
