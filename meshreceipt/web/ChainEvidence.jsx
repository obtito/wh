import React from 'react';

export default function ChainEvidence({ evidence, fresh = false, contextMatches = false }) {
  if (!evidence) return null;
  const verifiedNow = fresh && contextMatches;
  const explorer = { 677: 'https://scan.botchain.ai', 968: 'https://scan.bohr.life' }[evidence.network];
  return <div className="chain-evidence" role="status">
    <p>{verifiedNow ? '本次重新核验：' : '历史缓存（未重新核验）：'}网络 {evidence.network} · {evidence.contract}（事后存证）。</p>
    <p>{verifiedNow ? '已读取该链上的任务及全部已完成回执，对照当前输入、规则、输出、报告、服务身份和结论。' : '仅显示浏览器保存的历史信息，不代表本次链上核验；缓存不是可信证据。'}</p>
    {!contextMatches && <p>缓存与当前任务或网络／合约配置不匹配，或旧缓存缺少交付上下文；请重新核对。</p>}
    <p>记录时间：{evidence.checkedAt}。刷新或切换任务／配置后，须重新核验。</p>
    {explorer && <a href={`${explorer}/address/${evidence.contract}`} target="_blank" rel="noreferrer">查看该合约 ↗</a>}
    {evidence.transactions.map(hash => explorer ? <a key={hash} href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">{hash.slice(0, 10)}…{hash.slice(-6)} ↗</a> : <code key={hash}>{hash}</code>)}
  </div>;
}
