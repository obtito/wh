# 资产署名(ATTRIBUTION)

本项目以程序化生成为主,外部数据与资产按其许可证署名如下。

## 数据

| 数据 | 来源 | 许可证 | 署名 |
|---|---|---|---|
| 建筑/路网轮廓 `data/osm/` | [OpenStreetMap](https://www.openstreetmap.org) 经 Overpass API 提取(核心区 114.22–114.42°E, 30.50–30.64°N) | **ODbL 1.0** | © OpenStreetMap contributors;若再分发本数据需以同许可提供 |
| 地标坐标 `data/wikidata-coords.json` | [Wikidata](https://www.wikidata.org)(329 条武汉地标,含精度) | CC0 1.0 | 无需署名 |
| 建筑高度 `data/cnbh/`(CNBH-10m 栅格采样,93% 覆盖) | [CNBH-10m](https://zenodo.org/records/7827315)(Zenodo) | CC BY 4.0 | Li et al., CNBH-10m, Zenodo |
| 水系中心线 `data/hydro-centerlines.json` | OpenStreetMap 水系(OSM ODbL 衍生) | ODbL 1.0 | © OpenStreetMap contributors |

## 模型

| 资产 | 来源 | 许可证 | 署名 |
|---|---|---|---|
| `assets/models/huanghe-tower/huanghe-main-tower-lod2.glb` | [China_Tower](https://github.com/0G-Bhqc/China_Tower)(黄鹤楼精建模 LOD2,meshopt 压缩,1.37M 面;现役主楼,全分辨率贴图自 highmodel 移植) | **MIT** | Copyright © 0G-Bhqc;保留本表即视为署名 |
| `assets/models/tongling-railway-bridge/` | [铜陵长江公铁大桥](https://sketchfab.com/3d-models/c29ea5437cfd4569ad86fbefcc64d15b) by **hello123D**(245k 面,改造为武汉长江大桥) | CC-BY 4.0 | 保留本表即视为署名 |
| `assets/models/wuhan-greenland-center/` | [Wuhan Greenland Center](https://sketchfab.com/3d-models/wuhan-greenland-center-795a3cec308d44a985dacfda99239a3e) by **Void**(37.7k 面) | CC-BY 4.0 | 保留本表即视为署名 |
| `assets/models/wuhan-center/` | [Wuhan Center](https://sketchfab.com/3d-models/wuhan-center-413eb58cc89c4423bf51ce63c2ab1393) by **Void**(13k 面) | CC-BY 4.0 | 保留本表即视为署名 |
| `assets/models/wuhan-ctf-finance/` | [Wuhan CTF Finance Center](https://sketchfab.com/3d-models/wuhanctf-finance-center-ae06b8933f7e4b5fb749425afb2e454e) by **Void**(9.5k 面) | CC-BY 4.0 | 保留本表即视为署名 |
| `assets/models/wuhan-shipping-center/` | [Wuhan Yangtze River Shipping Center](https://sketchfab.com/3d-models/wuhan-yangtze-river-shipping-center-fc4c62c332234ef6abffac9d87e4bc2f) by **Void**(18.7k 面) | CC-BY 4.0 | 保留本表即视为署名 |
| `assets/models/wuhan-panhai-times/` | [Wuhan Pan Hai Times Center](https://sketchfab.com/3d-models/wuhan-pan-hai-times-center-landmark-tower-c5dfa1384c0b4ae3a08a49e2ed7ae2e4) by **Void**(7.4k 面) | CC-BY 4.0 | 保留本表即视为署名 |
| `assets/npc/` + `assets/props/`(角色 / 街道小品) | [KayKit Character Pack](https://kaylousberg.com) & [City Builder Bits](https://kaylousberg.com) by Kay Lousberg | CC0 1.0 | 无需署名 |
| `assets/cars/*.glb` + `Textures/colormap.png`(20 台车) | [Kenney Car Kit](https://kenney.nl/assets/car-kit),经 [shorepine/kenney](https://github.com/shorepine/kenney) 镜像 | **CC0 1.0** | 无需署名,仍致谢 Kenney |
| `assets/trees/*.glb`(6 树型,93176 实例) | [Kenney Nature Kit](https://kenney.nl/assets/nature-kit),经 [shorepine/kenney](https://github.com/shorepine/kenney) 镜像 | **CC0 1.0** | 无需署名,仍致谢 Kenney |

## 贴图 / 代码

| 资产 | 来源 | 许可证 | 署名 |
|---|---|---|---|
| `assets/textures/brick_diffuse.jpg` / `brick_bump.jpg` | [mrdoob/three.js](https://github.com/mrdoob/three.js) examples/textures | 随 three.js 示例分发 | three.js authors |
| `assets/textures/rough_concrete_*_2k.jpg` | [Poly Haven — rough_concrete](https://polyhaven.com/a/rough_concrete) | **CC0** | 无需署名 |
| `vendor/three.module.js` / `GLTFLoader.js` / `DRACOLoader.js` / `utils/` | three.js r160 | MIT | Copyright © 2010-2024 three.js authors |
| Draco 解码器 `assets/draco/` | [google/draco](https://github.com/google/draco) | Apache-2.0 | Copyright © 2017 Google Draco Authors |

## 新增资产守则

- 只引入 **CC0** 或 **CC-BY**(CC-BY 在本表登记署名);**ODbL 数据**再分发时保持同许可
- **CC-BY-NC(非商用)一律不进仓库**
- Sketchfab 下载的模型逐个核对原页面许可证并登记
- 模型统一 GLB/gltf、Y-up、米制,Draco / meshopt 压缩可用(解码器已内置)
