# 黄鹤楼本地加工与验收记录

2026-10-07 本地运行；不是网页端真实 Agent 任务，不是 BOT 主网存证，不是公开发布。

## 实际资产与结果

固定输入：`public/previews/models/huanghe-blender/refined.glb`，358 个节点、358 个网格、979,280 个三角形、16 个材质，无纹理和动画。

| 项目 | 实测字节数 | MiB |
|---|---:|---:|
| 原 GLB／恢复 GLB | 25,563,692 | 24.38 |
| Brotli 传输文件 | 7,021,827 | 6.70 |
| 精简传输目录总计（含证据） | 7,045,960 | 6.72 |

压缩文件减少 72.53%；包含证据的精简目录相对原 GLB 减少 72.44%。这是字节数量对比，不是实测下载速度；接收者仍需约 24.38 MiB 空间保存解压后的模型。生产者完整目录保留原始对照文件，不应拿它宣称同样的传输收益。

操作为标准 Brotli 无损交付压缩，不是自研三维压缩或模型外观优化。消费端已实际恢复模型，并与原 GLB 逐字节比较一致；提取目录也可再次独立验签、复算。精简传输依赖处理前确认的可信原模型哈希，不能把包内声明当作来源真实性证明。

冻结规则：输入 ≤32 MiB，传输 ≤16 MiB，至少减少 20%，有指定关键构件，解压后完全保真。规则未因结果修改。PASS 只表示这些技术条件通过，不证明黄鹤楼实景准确、模型视觉质量、版权或商业可用性。

## 交付指纹

```text
taskId: 7e935d31-bb9d-40ca-a35d-3debe2444189
attemptId: eefe77ce-3aec-4971-bd45-9d54ee0929fd
inputHash/outputHash: ec6d409eed5beb55b0ef2d14b21253e1c6140cff7e4bca33f7e229433bff9342
transferHash: 00526bf334db37c221b6643ef2eacbf0fb6ab30ba28ff841faee6dee7ec3c72d
reportHash: 257b327fa5f11f3ad04d799954ae9b98a131940786540afdc7e089aecc77820a
manifestHash: df17eec69ab5dc9c895b0e865a8773918ead6a1ff99f97d1efafacc3e9bd3a2b
local issuer: 0x78142aC01812e5E02b6E7c0cA3F77ec1662729bd
instance: 36ca1529-720e-4e26-99f4-0008172e5e17
providerId: huanghe-lossless-local
```

这是离线临时服务签名身份，不是部署钱包，不构成独立第三方背书。其私钥未落盘、未输出。源文件和字体再分发许可未确认，所有产物明确禁止推定公开再分发。

生产者目录：`data/large-tasks/huanghe-delivery-a2c0be8e-2710-4964-a65e-45fdc431e6d0/`。

精简传输目录：`data/large-tasks/huanghe-transport-7e935d31-bb9d-40ca-a35d-3debe2444189/`。

实际接收目录：`data/large-tasks/huanghe-compact-recipient-7e935d31-bb9d-40ca-a35d-3debe2444189/`。仅同机另一目录/进程，不是队友跨机器验收。

## 只读复核命令

在项目根目录运行，无需 `.env`、作者任务数据库或运行中的服务：

```sh
node experiments/huanghe-transfer/consume.js \
  data/large-tasks/huanghe-transport-7e935d31-bb9d-40ca-a35d-3debe2444189 \
  --issuer 0x78142aC01812e5E02b6E7c0cA3F77ec1662729bd \
  --instance 36ca1529-720e-4e26-99f4-0008172e5e17 \
  --provider huanghe-lossless-local \
  --input-hash ec6d409eed5beb55b0ef2d14b21253e1c6140cff7e4bca33f7e229433bff9342
```

若提取，增加 `--out` 指定不存在的新目录；不要覆盖已有接收目录。以上身份与哈希来自本次受控本地运行及预先核对的模型快照，仍不是公众可依赖的可信服务注册体系。

## 反例与回归

另一个独立任务 `d0f4acce-d288-48b0-921e-7307ab5d1409` 在压缩前对原模型二进制单字节做受控篡改。压缩和解压均成功，仍因字节不一致而 FAIL；签名及独立复算通过，但消费退出码为 1，不能提取成合格模型。目录为 `data/large-tasks/huanghe-negative-d73d76b4-f33d-4d20-8ba0-01e8fcac8010/`。这不是外部服务真实作恶，不可计入信誉历史。

- 新实验测试：18/18 通过（篡改、截断、尾随垃圾、解压展开上限、错身份／原哈希、缺失与符号链接、FAIL 拒绝提取、精简包再复核等）。
- 原验收、合约、链上展示和 UI 定向回归：28/28 通过。
- 原流光亭交付包仍通过验签、复算；原 outputHash/reportHash 保持不变。
- 没有宣称全套 HTTP／浏览器测试通过，没有更改现有服务、网页、依赖、API 配置或部署状态。

## 未完成项

新 profile 尚未接到现有网页任务、真实 Agent 编排、旧 JSON 包消费入口或 BOT 合约登记入口。原流程不会自动接受此目录格式。来源许可、跨机器消费、浏览器加载／帧率和低配设备资源测试仍待完成；不把这次本地 PASS 替代原流光亭主网任务。

单次生产端观测：处理约 1.50 秒，检查约 1.48 秒，峰值 RSS 335,568 KiB（约 328 MiB）。不同运行/并发负载会改变耗时，未做重复性能基准；256 MiB JS 堆设置不等于 256 MiB 总内存上限。执行指标不属于独立复算的验收报告核心。
