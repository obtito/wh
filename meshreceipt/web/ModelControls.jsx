import React from 'react';

export default function ModelControls({ mode, onModeChange, confirmed, onConfirmedChange, config, busy, running, onStart }) {
  return <>
    <div className="task-controls"><label>执行方式<select value={mode} disabled={busy || running} onChange={event => onModeChange(event.target.value)}>
      <option value="demo">确定性演示编排（非实时 AI）</option>
      <option value="model" disabled={!config.modelAvailable}>实时模型 Agent{config.modelAvailable ? '（已配置，连接未验证）' : '（未配置）'}</option>
    </select></label><button className="button primary" disabled={busy || running || (mode === 'model' && !confirmed)} onClick={onStart}>{busy ? '创建任务…' : '创建并运行验收 →'}</button></div>
    {mode === 'model' && <div className="model-disclosure">
      <p className="trust-note">配置模型：{config.modelName || '未指定'}；推理档位：{config.modelReasoningEffort || '未指定'}。配置存在不代表连接成功；任务中显示实际调用结果。模型会收到资产标题、任务说明、固定规则、中性服务目录及本机历史摘要，不发送 GLB 或私钥。</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy || running} onChange={event => onConfirmedChange(event.target.checked)}/> 我确认以上数据可发送至本机配置的模型 API，允许本次付费调用。</label>
    </div>}
    {!config.modelAvailable && <p className="trust-note">实时模型未配置：请在本机 .env 设置 OPENAI_API_KEY 与 OPENAI_MODEL，重启后再验证；不要把密钥放进前端或聊天。</p>}
  </>;
}
