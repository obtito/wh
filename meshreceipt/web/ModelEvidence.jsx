import React from 'react';

export default function ModelEvidence({ trace }) {
  if (!trace) return <p className="trust-note">该实时任务没有新版调用摘要，不能据此展示完整 API 调用证据。</p>;
  return <details className="model-evidence"><summary>Agent 调用摘要 · {trace.rounds.filter(round => round.responseReceived).length} 轮响应 · {trace.status}</summary>
    <p className="trust-note">{trace.source === 'test-fixture' ? '测试夹具响应，不是真实联网 AI。' : 'Responses API 的本机执行记录，不是第三方签名证明。'} 请求模型：{trace.model}；请求推理档位：{trace.reasoningEffort || '旧记录未提供'}。不保存原始响应、私有推理或密钥；PASS 仅由代码验收产生。</p>
    <ul>{trace.rounds.map(round => <li key={round.round}>
      <strong>第 {round.round} 轮 · {round.status}</strong><small> 响应 ID：{round.responseId || '未取得'} · tokens：{round.usage?.total_tokens ?? '未提供'}</small>
      {round.calls.map(call => <p key={call.callId}>{call.tool} {call.providerId || ''} · {call.status}{call.verdict ? ` / ${call.verdict}` : ''}</p>)}
    </li>)}</ul>
  </details>;
}
