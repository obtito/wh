# 琢信 · MeshReceipt

数字资产展厅、三维预览、模型处理验收与 BOT 主网交付凭据。

- `meshreceipt/`：完整应用、合约、验收器、测试和公开凭据。
- `GTA-NJ/`、`GTA-WH/`：现有展厅依赖的南京、武汉预览源码及素材，保留各项目署名与许可说明。
- 公开展示版保留展厅、电影转场、三维交互、收藏与主网材料下载；任务处理需要本机 Node 后端。
- 城市共建第一版直接沿用 GTA-WH 地图快照：道路、水系、山体、8 处点位，支持搜索定位、两类路网切换及点位需求草案下载。公开底图数据与本机任务数据库分开保存。

## 本机完整运行

需要 Node 22.9+。

```sh
cd meshreceipt
npm ci --ignore-scripts
npm run build
npm start
```

打开 http://127.0.0.1:4318。默认确定性演示；实时模型需自行在 `.env` 配置，不包含任何密钥或本机任务数据库。

## 公开网页构建

```sh
npm --prefix meshreceipt ci --ignore-scripts
npm run build
```

输出 `site/` 为独立静态展示，既有归档不会显示成本次主网核验成功。网页不发送链上交易。模型与上游素材的说明见各项目 README 和 docs/ATTRIBUTION.md。

公开网页：https://meshreceipt-wh.youngbeech1.chatgpt.site

`deployment/hosting.json` 保存公开网站身份；托管用的静态源快照位于独立发布目录，应用源码不依赖托管平台。

首页与城市地图已合并：主导航在首页展开地图，旧 `/city/` 地址回到 `/#city-building`。地图仅在展开时加载，收起后保留状态。底图文件并发上限 4、优先浏览器缓存，临时超时自动重试 2 次并显示加载进度。
