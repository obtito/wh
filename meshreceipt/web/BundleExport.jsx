import React, { useState } from 'react';

export default function BundleExport({ task, attempt }) {
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [downloaded, setDownloaded] = useState(null);
  const filename = kind => `meshreceipt-${kind}-${task.id}-${attempt.id}.json`;
  async function download(kind) {
    setBusy(true); setError(''); setDownloaded(null);
    try {
      const response = await fetch(`/api/tasks/${task.id}/attempts/${attempt.id}/bundle`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-meshreceipt': 'local-demo' },
        body: JSON.stringify({ kind, confirmDistribution: confirmed }),
      });
      if (!response.ok) throw new Error((await response.json()).error || '交付包导出失败');
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = filename(kind); document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setDownloaded(kind);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  if (!task.distributionSource) return <p className="trust-note">旧任务没有冻结分发授权，仍可诊断下载；请用自有样例创建新任务后导出交付包。</p>;
  return <section className="bundle-export" aria-label="交付包导出">
    <strong>模型与依据，一同交付</strong>
    <p>包内包含原模型、处理结果、固定规则、报告、签名和使用说明。仅本项目自有 CC0 样例；许可是发布者声明，不是版权证明。</p>
    <p className="quality-boundary">PASS 仅指限定规则通过；材质、纹理视觉质量未验收。不代表整体质量合格。</p>
    <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/> 我确认将原模型和处理结果一同导出，供他人离线取得与复核。</label>
    <div className="attempt-links">
      {attempt.verdict === 'PASS' && <button className="button secondary" disabled={!confirmed || busy} onClick={() => download('qualified')}>导出限定规则合格包 ↓</button>}
      <button className="text-button" disabled={!confirmed || busy} onClick={() => download('evidence')}>导出履约取证包 ↓</button>
      {busy && <span role="status">重新验收并封装中…</span>}
    </div>
    {downloaded && <p role="status">已生成并发起下载：{downloaded === 'qualified' ? '合格交付包' : '履约取证包'}。离线导出不代表已公开上线或链上存证。</p>}
    <details><summary>交给另一位使用者：独立复核与提取</summary>
      <p>使用可信版本的本项目工具。先通过可信渠道确认以下服务身份，不要直接信任包内自带的身份信息。</p>
      <code className="bundle-command">npm run consume -- {filename(downloaded || (attempt.verdict === 'PASS' ? 'qualified' : 'evidence'))} --issuer {attempt.delivery.issuer} --instance {attempt.delivery.instance} --provider {attempt.providerId} --out imported-{attempt.id}</code>
      <p>输出目录必须不存在；验证完成后提取 model.glb，可在支持 GLB 的查看器中打开。新包内有 README.txt；提取会保留 manifest.json 与 seal.json，请保留整个目录或原包。消费工具兼容旧 v1 包。FAIL 取证包不是合格模型，退出码为 1；PASS 只覆盖已列规则，不保证视觉保真。</p>
    </details>
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
