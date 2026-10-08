# 琢信 MeshReceipt 核心交付版

AI 协作的三维资产加工、验收与分发应用。此包包含三个项目自有样例、实际处理与拒收、签名交付包、离线复算、原流光亭交付证据和 BOT 主网三笔历史凭据。

## 运行

需要 Node.js 22.9 或更高版本。安装依赖需要网络；完成安装后的样例加工和交付包消费可在本机执行。

```sh
npm ci --ignore-scripts
npm test
npm run build
npm start
```

打开 http://127.0.0.1:4318 。端口已被占用时在本机 .env 写入另一个 PORT，或在启动环境中设置 PORT。服务只监听本机。此版直接显示自有样例，不依赖 GTA-WH、GTA-NJ 或作者数据库。

“处理并交付模型”默认执行确定性编排：服务 A 实际删去动画而 FAIL，服务 B 处理后在列出的规则下 PASS。新任务可能参考本机历史而直接选服务 B。实时 Agent 需自行配置受信任 API 并在页面确认数据与费用；默认安装不会调用付费模型。

主页的流光亭交付卡片使用原有真实网页任务的文件和历史主网凭据。创建的新任务具有新身份和新指纹，不沿用原任务的上链状态。刷新页面后主网状态回到历史凭据；手动只读核对成功才显示本次读取匹配。

## 独立消费

先通过团队可信渠道确认签名地址、实例、服务标识和工具版本，再执行：

```sh
npm run consume -- docs/evidence/pavilion-qualified.json --issuer 0x89b55cA3dd9F2b5ADd33A61504B3B531589D5c36 --instance 819eea82-7664-4f53-b9cc-101982158359 --provider careful-demo --out recipient-qualified
```

输出目录必须不存在。成功退出 0，提取的 model.glb 可导入 GLB 查看器。保留原包或整个提取目录；其中 verification.json 是消费端结果，seal.json 保留原发布签名。

队友可运行 `npm run handoff:check -- recipient-result.json`，自动验证合格包、FAIL 取证和篡改拒绝并读取模型。此命令保留临时接收目录，结果注明机器信息；仍需实际浏览器打开，并由队友确认是否在另一台电脑执行。具体见[队友验证](docs/release/队友验证.md)。

只读主网复核为 `npm run mainnet:verify`；需要保存新结果时使用 `npm run mainnet:verify -- --out new-mainnet-check.json`。它查询固定的原三笔交易和一个 PASS，不需要钱包，不签名或发送交易。网络失败会返回失败状态，原历史凭据保留。

## 验收范围和来源

当前规则检查格式、大小、指定节点、层级、几何和动画。材质、纹理视觉质量未验收。两个演示服务和验收者由同一团队控制；有效签名和上链不代表独立质量、版权或视觉保真。主网记录为事后声明，最终性尚未独立检查。

本包排除了第三方地标、私钥、.env、原任务数据库、作者的 node_modules 和旧 dist。自有程序化样例的 CC0 声明见包清单；应用代码的整体发行许可仍由团队确认，不从第三方库许可推导。

文件版本和哈希见 RELEASE.json。比赛新增功能、来源和未完成事项见[提交说明](docs/release/提交说明.md)及[来源与许可](docs/release/来源与许可.md)。
