# 黄鹤楼：独立的大型资产无损交付实验

本实验接入现有本地 Blender 黄鹤楼 GLB，不重新建模，不覆盖流光亭任务，不改原网页、服务、合约或 `texture-only.v1` 的 10 MiB 限制。

## 任务与规则

输入为 `public/previews/models/huanghe-blender/refined.glb` 的固定快照。加工动作为 Brotli 无损传输压缩（quality 4），不是网格简化、三维专用压缩、纹理优化或外观改善。

在运行前固定 `meshreceipt.lossless-transfer.v1` 规则：输入不超过 32 MiB；传输文件不超过 16 MiB；至少减少 20% 传输字节；解压后 GLB 必须逐字节一致；台基和一层屋顶关键节点存在。仅支持无外部资源、无扩展、无纹理、无动画的静态 GLB；最多 500 节点、500 网格、200 万三角形、1200 万 accessor 元素、2 MiB JSON。

格式检查与字节保真不等于实景准确、版权确认、外观优良或性能达标。该模型和字体再分发许可仍待确认；所有产物标记 `redistributionAuthorized: false`，仅限本地评估。不要把实验目录挂成公开静态目录，也不要上传到对象存储或 IPFS。

## 运行

在项目根目录、沿用现有依赖（无需新安装）执行：

```sh
node --test experiments/huanghe-transfer/test.js
node experiments/huanghe-transfer/run.js
node experiments/huanghe-transfer/run.js --negative-control
```

每次创建全新 `data/large-tasks/huanghe-*` 目录和 UUID；不会覆盖旧任务。输入 SHA-256 必须与已有 `source.json` 相符。负例单独成任务，明确标记为受控单字节篡改；不是 AI 真实选择的服务失败，也不应计入公共信誉。

生产者是团队控制的本地适配器，本实验没有调用真实 AI、没有启动网页、没有上链或公开分发。新的离线签名身份只存在本次进程内；不使用部署钱包，不保存或输出私钥。产物包含原模型、压缩模型、规则、报告、来源声明、交付签名、清单和清单签名；`execution.json` 是未复算的单次本地耗时/资源观测，不是独立性能认证。

## 独立消费

使用运行结果中通过独立可信渠道确认的 `trustedIdentity`，以及在处理前确认的原模型 SHA-256；不能仅信任包内自带地址或原模型哈希：

```sh
node experiments/huanghe-transfer/consume.js /absolute/path/to/delivery \
  --issuer TRUSTED_ADDRESS --instance TRUSTED_INSTANCE_UUID \
  --provider huanghe-lossless-local --input-hash TRUSTED_ORIGINAL_SHA256 \
  --out /absolute/path/to/new-recipient-directory
```

消费工具仅需要上述目录和可信工具代码/依赖版本，不依赖作者数据库、服务、密钥或输入原路径。先验签、检查每个文件、复算规则，再创建新的提取目录并恢复 `model.glb`；不覆盖已有目录。未传 `--out` 时只读核验。PASS 退出码 0，已验证 FAIL 退出码 1，INCONCLUSIVE 为 2，验证/操作异常为 3。FAIL 不得提取成合格模型。

生产者目录保留原始对照文件，**这份完整目录不代表节省下载量**。精简传输另用：

```sh
node experiments/huanghe-transfer/export.js /absolute/path/to/delivery \
  --issuer TRUSTED_ADDRESS --instance TRUSTED_INSTANCE_UUID \
  --provider huanghe-lossless-local --input-hash TRUSTED_ORIGINAL_SHA256 \
  --out /absolute/path/to/new-transport-directory
```

精简目录不重复传输 `original.glb`；PASS 消费者从压缩包恢复它，先匹配事先可信确认的原始哈希，再复算报告。此步骤基于 SHA-256 的抗碰撞假设，不是拥有两份独立原始数据；结果明确标记 `originalSource`。缺失原始文件时不支持 FAIL 取证，其他文件缺失、原文件篡改或符号链接不允许走恢复路径。提取目录保留压缩数据、清单和签名，因此仍可再次独立核验。权限仍为仅本地评估，导出不是公开发布授权。

性能对比应同时报告压缩文件字节数、精简传输目录总字节数、解压成本；不能只用压缩比宣称端到端下载变快。未来 HTTP 分发 `.glb.br` 应作为不透明文件，不要设置导致客户端自动解压的 `Content-Encoding: br` 后再校验压缩文件哈希。

消费者限制解压输出长度并拒绝压缩流尾随字节，防止无界展开或附加垃圾绕过。生产端子进程设置 256 MiB JS 堆上限和 60 秒超时；它不是 OS 沙箱，也不是 256 MiB 的进程总内存上限。浏览器加载/帧率、低配设备表现和真实队友跨机器验证尚未覆盖。

## 哈希与旧协议的边界

- `inputHash`：原 GLB 的 SHA-256。
- `outputHash`：解压所得 GLB 的 SHA-256。PASS 时必然等于 `inputHash`，不能宣称原始模型文件本身变小。
- `transferHash`：`model.glb.br` 的 SHA-256，单独绑定传输文件。
- `reportHash`：规范化新验收报告的 SHA-256；清单与交付签名同时绑定这些字段。

此格式是独立的目录交付协议，**不是现有 `meshreceipt.bundle.v2` JSON 包**。原网页/消费 CLI 不识别它，不要将它送入旧纹理验收或把新数据混入旧报告。后续若接网页、分发层或链上记录，必须显式分派到新规则；不能沿用旧规则冒充已接入。

相关原生解压边界见 Node.js 官方 `zlib` 文档：https://nodejs.org/download/release/v24.20.0/docs/api/zlib.html 。
