# 封面到实时模型的转场

实现入口：`web/PreviewCache.jsx`、`GTA-NJ/js/preview-cinematic.js`，共用现有五个预览的 Three.js 渲染器。

## 效果与边界

- 模型首帧成功后，封面沿有噪声的光带碎解；GPU 实例化碎片旋转、散开，露出每帧重新绘制的三维场景。
- 模型相机从略远的距离推进到原机位。结束或中止都恢复相机、控制器和原来的自动旋转状态。
- 实际模型的几何和材质不因艺术封面而改变；不是两个静态截图之间的淡入淡出。
- 缓存中的模型重新打开时保留视角，可主动重播。跳过、关闭、切换、页面隐藏、用户操作和减少动态效果偏好均可中止动画。

## GitHub 调研

2026-10-08 检查了以下原项目：

- [Three.js 官方场景转场](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_postprocessing_transition.html)，[MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE)：参考实时场景参与转场的结构。
- [threejs-image-particles-transition](https://github.com/Tolexia/threejs-image-particles-transition)，项目声明 MIT：参考封面颜色采样与 GPU 粒子空间运动。
- [gl-transitions/perlin.glsl](https://github.com/gl-transitions/gl-transitions/blob/master/transitions/perlin.glsl)，文件注明 Rich Harris / MIT：参考连续噪声控制揭幕进度。
- [three.bas](https://github.com/zadvorsky/three.bas)，[MIT](https://github.com/zadvorsky/three.bas/blob/master/LICENCE)：参考属性缓冲加单一进度参数的动画方式。其文档标注的旧版兼容范围不适合直接引入当前项目。

本项目的组合着色器和生命周期控制为独立实现，没有整包引入上述项目，也没有复制其图片、演示模型或依赖树。现有 Three.js 许可与素材署名继续保留。

## 性能策略与验证方式

封面使用本地 WebP，上传前限制纹理边长；碎片数量有固定上限，位置由顶点着色器计算。动画只使用当前预览的 WebGL 上下文，预热实际绘制后才通知外层移除封面。临时纹理、几何、材质及渲染目标在结束时释放，静止后回到按需绘制。

`canvas[data-cinematic-metrics]` 记录最近一次动画的帧间隔、CPU 提交时间和资源计数；外层 `.preview-cache[data-cinematic-metrics]` 同步记录完成结果。帧间隔不是 GPU 查询计时，截图和其他活跃应用会影响结果。进行性能复测时，应先重播、等待完成，再读属性；不要在同一轮中截图。视觉检查另起一轮。

验证应覆盖五个模型、首次载入、重复播放、准备中关闭、播放中跳过、缓存重开，以及资源数量是否随多次播放持续增长。

## 本机验证（2026-10-08）

Codex 内置浏览器，页面视口 1280 × 720；采样期间未截图。渲染器原 DPR 为 1.5 或 2，转场目标 DPR 为 1；结束后回到原生渲染。首次准备、纹理上传和实际绘制预热在封面遮挡时完成，未混入可见动画的帧间隔。

| 场景 | 动画帧数 | 帧间隔 p95 | 最大帧间隔 | >50ms 帧 |
|---|---:|---:|---:|---:|
| 紫峰大厦 | 95 | 17.6 ms | 18.8 ms | 0 |
| 黄鹤楼 | 95 | 17.9 ms | 18.2 ms | 0 |
| 武汉建筑群 | 95 | 17.3 ms | 17.8 ms | 0 |
| 南京城墙 | 94 | 18.1 ms | 18.7 ms | 0 |
| 中山陵 | 94 | 18.1 ms | 18.8 ms | 0 |

五个场景均完成约 1.55 秒动画。中山陵连续三次重播，几何/纹理计数始终回到 16/0；五个模型完成后也均回到各自播放前计数。播放中跳过和关闭重开已实测，缓存 iframe 的加载次数保持 1。浏览器未记录渲染错误。

调优时发现对整个 renderer 临时切换 DPR 会在恢复时耗时约 199 ms，该方案已弃用。最终采用独立 HDR 场景与特效渲染目标，复用同一上下文，结束资源清理实测 0.3–0.5 ms。临时目标在最多 65 万像素下约占 10.4 MB，另有封面纹理；不将 renderer.info 计数解释为完整 GPU 内存测量。

这些结果是当前设备、视口与负载下的测量，不代表所有显卡和设备都能恒定 60 FPS。原始记录见 `cinematic-performance-2026-10-08.json`。
