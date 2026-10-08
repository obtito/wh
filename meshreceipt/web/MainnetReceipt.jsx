import React from 'react';

const PUBLIC_EXHIBITION = import.meta.env.VITE_PUBLIC_EXHIBITION === '1';
const short = value => `${value.slice(0, 10)}…${value.slice(-8)}`;
export default function MainnetReceipt({ evidence, busy = false, error = '', onVerify }) {
  if (!evidence?.archive) return null;
  const archive = evidence.archive, fresh = evidence.status === 'verified-now' && evidence.chainVerification?.scope === 'single-pavilion-pass';
  const invocation = evidence.invocation;
  return <section className="published-receipt" id="delivery-evidence" aria-label="流光亭交付与主网凭据">
    <div className="section-heading"><div><span className="eyebrow">A DELIVERY YOU CAN VERIFY</span><h2>流光亭交付与主网凭据</h2></div>
      <span className="badge">{fresh ? '本次主网只读核对通过' : '主网历史凭据已归档'}</span></div>
    <p>这份自有模型经历实际处理、FAIL 后重试和限定规则 PASS。{PUBLIC_EXHIBITION ? '原合格包在发布构建时完成验签和复算；下载后可在本机独立核验。' : '原合格包已在本次读取中重新验签和复算，可交给另一位使用者独立核验。'}</p>
    {invocation?.agentRun && <details className="published-invocation"><summary>查看原任务的历史 AI 工具调用（非本次实时调用）</summary>
      <p>请求模型：{invocation.agentRun.model} · 推理档位：{invocation.agentRun.reasoningEffort} · 中转报告用量：{invocation.usage?.total ?? '未提供'} tokens</p>
      <ol>{invocation.agentRun.rounds.map(round => <li key={round.round}>第 {round.round} 轮 · {round.status} · {round.calls.map(call => `${call.tool}${call.providerId ? ` / ${call.providerId}` : ''}${call.verdict ? ` → ${call.verdict}` : ''}`).join('；')}</li>)}</ol>
      <p>{invocation.note}</p></details>}
    <div className="published-grid"><div><h3>同一份交付</h3><dl>
      <dt>任务</dt><dd>{archive.delivery.taskId}</dd><dt>输出指纹</dt><dd title={archive.delivery.outputHash}>{short(archive.delivery.outputHash)}</dd>
      <dt>报告指纹</dt><dd title={archive.delivery.reportHash}>{short(archive.delivery.reportHash)}</dd>
      <dt>可信服务签名地址</dt><dd>{archive.delivery.provider}</dd><dt>服务实例</dt><dd>{archive.delivery.instance}</dd>
    </dl><p className="quality-boundary">PASS 仅覆盖列出的结构规则；材质、纹理视觉质量未验收。消费前请经可信渠道确认签名地址、实例和工具版本。</p>
      <div className="attempt-links"><a href={PUBLIC_EXHIBITION ? "/api/mainnet-evidence/bundle.json" : "/api/mainnet-evidence/bundle"} download="pavilion-qualified.json">下载原合格交付包 ↓</a>
        <a href={PUBLIC_EXHIBITION ? "/api/mainnet-evidence/failure.json" : "/api/mainnet-evidence/failure"} download="pavilion-failure.json">下载 FAIL 取证包 ↓</a></div></div>
      <div><h3>BOT 主网 677</h3><p>{fresh ? `本次读取时间：${evidence.chainVerification.checkedAt}` : `原凭据核验时间：${archive.checkedAt}；本次尚未重新读取主网。`}</p>
        <a className="text-link" href={`https://scan.botchain.ai/address/${archive.contract}`} target="_blank" rel="noreferrer">{archive.contract} ↗</a>
        <div className="receipt-transactions">{archive.transactions.map(tx => <a key={tx.hash} href={`https://scan.botchain.ai/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.operation} · {short(tx.hash)} ↗</a>)}</div>
        <p>仅存证原任务中的这一份 PASS；FAIL 保留链下取证。链上是固定验收者的事后声明，最终性尚未独立检查。</p>
        <button className="button secondary" disabled={busy || PUBLIC_EXHIBITION} onClick={onVerify}>{PUBLIC_EXHIBITION ? '请通过上方区块浏览器核对交易' : busy ? '正在只读核对…' : '重新核对这份交付（不发交易）'}</button>
        {error && <p className="error-text" role="alert">{error}。仍保留历史凭据，不显示本次验证成功。</p>}</div></div>
  </section>;
}
