# GTA-WH · 武汉江城 · 开放世界原型

> 参照 [GTA_SZ](https://github.com/linranff/GTA_SZ)(Babylon.js 深圳)与本地 GTA-NJ(Three.js 南京)的技术路线,
> 为**武汉**打造的浏览器端开放世界游戏原型:**两江三镇、17 处地标精建、5 座大桥、可驾驶可步行可飞行**。

无构建步骤、无 CDN 依赖 —— 任意静态服务器打开 `index.html` 即玩。

```bash
node tools/serve.mjs          # → http://localhost:8140/
# 或 python -m http.server 8080
```

> 必须通过 HTTP 访问(ES Module 跨域限制),`file://` 打开无效。

---

## 玩法

| 键 | 功能 | | 键 | 功能 |
|---|---|---|---|---|
| **1 / 2 / 3** | 观察 / 驾驶 / 无人机 | | **F** | 上下车 |
| **W A S D** | 油门转向 / 行走 | | **Space** | 手刹 / 跳 |
| **Shift** | 冲刺(驾驶漂移) | | **Q / E** | 无人机升降 |
| **N** | 昼夜自动流转 | | **M** | 小地图缩放 |
| **L** | 地标索引 | | **H** | 操作说明 |
| 顶部滑杆 | 调时间 | | 鼠标拖拽 | 环视/无人机转向 |

- **驾驶**:街机手感(加速/转向/Shift 漂移),可开上**武汉长江大桥**看火车从下层驶过
- **打卡**:靠近地标自动弹卡(名称/史实/实测尺寸),集齐 17+5 处
- **观光线**:地标面板「观光任务」开启 10 站武汉三镇观光线
- **昼夜**:拖动时间滑杆或按 N,看黄鹤楼金顶泛光、路灯桥灯点亮、江滩夜色

## 城市(程序化几何与外部建筑模型结合,坐标为公开地图约测值)

- **骨架**:长江(1.1km 级江面)+ 汉江 + 东湖双湖 + 沙湖/南湖/月湖/水果湖 + 楚河
- **山**:蛇山/龟山/珞珈山/磨山/洪山/凤凰山/喻家山
- **路**:沿江大道/中山大道/解放大道/武珞路—珞喻路/临江大道/徐东大街等 27 条主干
- **17 地标**:黄鹤楼(五层攒尖 51.4m)、江汉关、龟山电视塔、晴川阁、归元寺、古琴台、
  省博物馆(编钟阵列)、楚河汉街、汉秀红灯笼、绿地中心(475m Lathe)、武大樱顶、磨山楚天台、
  光谷星河、江汉路历史街区、汉口江滩、昙华林、红楼
- **5 桥**:武汉长江大桥(公铁双层桁架+动画列车+桥头堡)、长江二桥(斜拉)、鹦鹉洲(三塔悬索·国际橙)、
  江汉桥、晴川桥(红拱)
- **12 分区**:汉口里分红砖/江汉路民国/二七滨江天际线/武昌老城坡顶/光谷玻璃塔/武大绿瓦/青山红钢城…

道路沿可见岸线重新规划，建筑与导入高楼按完整占地避让水域。五个外部高楼保留至少 10 米的岸线间距。
武汉长江大桥按双层桥面、九孔八墩、灰石桥头堡细化，重复水上桥路已移除；[建模依据与验证](docs/YANGTZE-BRIDGE.md)。
黄鹤楼游戏模型使用原有 GLB，屋顶为哑光赭金色；独立的代码建模备选版及对比视频在
[`assets/models/huanghe-tower-code/`](assets/models/huanghe-tower-code/README.md)。
Blender 建模源码也保留在 `yellow-crane-tower-new-20261007/` 和 `yellow-crane-tower-refined-20261007/`；
可重新生成的 Blender 导出包、重复模型文件、视频运行依赖和缓存不纳入 Git。

## 技术要点

- **1 单位 = 1 米全真实尺度**,高斯-克吕格投影(原点 114.295E/30.560N),米制物理
- 程序化城市:分区网格 + 水域/山体/道路/地标占地排他,建筑 InstancedMesh(逐实例 UV 重映射)
- 中式建筑构件库(arch.js):举折/反宇/翼角高度场屋顶 + 正脊/戗脊/斗拱/须弥座(黄鹤楼/晴川阁/归元寺用)
- 桥面高程剖面 `bridgeHeightAt()`:车辆可查任意点的桥面高度 → 大桥可行驶
- 昼夜:程序化天空 → PMREM 共享 IBL,窗光/路灯/桥灯/车灯/塔顶航空灯随夜色点亮
- 水面:自定义 shader(波浪法线 + 菲涅尔 + 天空渐变反射 + 太阳高光)

## 工具链

```bash
node --experimental-vm-modules tools/check.mjs   # 语法预检(vm.SourceTextModule,防白屏)
node tools/smoke.mjs                             # 152 项数据/几何冒烟
node tools/heights.mjs                           # 建筑高度、江滩构件及桥面检查(19 项)
node tools/water-clearance.mjs                   # 烘焙建筑与五个外部高楼的水域避让
node tools/road-clearance.mjs                    # 道路水域净空、建筑碰撞与桥面回归
node tools/bridge-check.mjs                      # 五桥连续桥面与几何验证
node tools/landmark-check.mjs                    # 17 个景点的结构、颜色与几何预算
node tools/yellow-crane-check.mjs                # 独立黄鹤楼代码模型与原游戏模型隔离
node tools/sakura-check.mjs                      # 武大樱花大道、完整花冠净空与性能预算
node tools/campus-surface-check.mjs              # 步道与实际山体三角网格、路口接缝和树根贴地
node tools/whu-check.mjs                         # 樱顶四院八天井、拱门贯通、阶梯与平台净空
node tools/city-spatial-check.mjs                # 城市分区完整性、视锥剔除与阴影提交量
node tools/city-loading-check.mjs                # 可选碰撞资源失败时保留城市模型
node tools/actor-performance-check.mjs           # 行人动画降频、路线插值与小地图缓存
node tools/frame-budget-check.mjs                # 自适应分辨率稳定性与恢复边界
node tools/mapplot.mjs                           # 骨架平面真值图 PNG
node tools/shot.mjs                              # 无头浏览器实测 + 5 视角截图
```

GitHub 调试技能来源及本轮修复记录见 [SKILL-DIAGNOSTICS.md](docs/SKILL-DIAGNOSTICS.md)。

## 目录

```
index.html          入口 + HUD          js/geo.js         高斯投影/噪声/太阳
css/style.css       玻璃拟态 UI          js/data.js        武汉唯一数据源
js/world.js         地形/水面/道路       js/city.js        三镇建筑/树/车流/路灯
js/arch.js          中式构件库           js/landmarks.js   17 地标
js/bridges.js       5 桥 + 桥面查询      js/vehicle.js     车辆物理
js/player.js        步行小人             js/flycam.js      无人机
js/game.js          模式状态机           js/hud.js         小地图/卡片/任务
js/main.js          装配 + 主循环         vendor/           three.js 本地化
tools/              验证工具链           docs/             计划与截图
```

## 数据口径与致谢

- 坐标为 Google Maps / 公开地图参考的**约测值**(误差 ±50–200m),地标尺寸为公开资料口径,
  不做测绘级 1:1 宣称;详见 `js/data.js` 各条 spec。
- [GTA_SZ](https://github.com/linranff/GTA_SZ)(MIT)的「本地原点+统一缩放 / 程序化底图+地标精建 / 昼夜 IBL」思路致谢
- THREE.js MIT(vendor 本地化);水面 shader 与城市 AO 思路参照本地 GTA-NJ 项目
