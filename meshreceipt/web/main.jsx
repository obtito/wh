import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import BundleExport from './BundleExport.jsx';
import ModelControls from './ModelControls.jsx';
import ModelEvidence from './ModelEvidence.jsx';
import ChainEvidence from './ChainEvidence.jsx';
import PreviewCache from './PreviewCache.jsx';
import MainnetReceipt from './MainnetReceipt.jsx';
import { previewKind } from './preview-cache.js';
import { chainContext, chainContextMatches, createChainEvidence, parseChainEvidence, verifyChainRecords } from './chain-evidence.js';
import './style.css';

const PUBLIC_EXHIBITION = import.meta.env.VITE_PUBLIC_EXHIBITION === '1';
const CHECK_NAMES = { format: '格式有效', 'file-size': '体积达标', 'required-nodes': '指定节点', hierarchy: '结构保留', geometry: '几何保留', animation: '动画保留' };
const STATUS_NAMES = { QUEUED: '等待执行', RUNNING: '正在处理', PASSED: '验收通过', NOT_ACCEPTED: '未通过验收', ERROR: '执行异常', INTERRUPTED: '已中断' };
const fmt = bytes => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(2)} MB` : `${(bytes / 1e3).toFixed(1)} KB`;
const short = hash => hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : '—';
async function api(url, body) {
  if (PUBLIC_EXHIBITION) {
    if (body !== undefined) throw new Error('公开展示版不运行服务端任务，请下载源码在本机运行');
    url = `${url}.json`;
  }
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-meshreceipt': 'local-demo' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result;
}
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }

function Mark({ small = false }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M20 3 35 12v16L20 37 5 28V12Z"/><path d="m12 15 8-5 8 5v10l-8 5-8-5Zm0 0 8 6 8-6M20 21v9"/></svg></span>;
}
function AssetIllustration({ asset }) {
  if (asset.poster) return <picture><source srcSet={asset.poster.replace(/\.png$/, '.webp')} type="image/webp"/><img className={`asset-poster${asset.id === 'wuhan-landmarks' ? ' collection-poster' : ''}`} src={asset.poster} alt={`${asset.title}${asset.posterKind || '原项目截图'}`} loading="lazy" decoding="async" /></picture>;
  return <svg className="asset-illustration" viewBox="0 0 360 250" aria-label={`${asset.title}封面示意图，非模型预览`} role="img">
    <defs><linearGradient id={`g-${asset.id}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={asset.color}/><stop offset="1" stopColor="#ded6c4"/></linearGradient></defs>
    <ellipse cx="180" cy="217" rx="110" ry="13" fill="#000" opacity=".08"/>
    {asset.id === 'wuhan-landmarks' ? <g fill={`url(#g-${asset.id})`} stroke="#f2eee3" strokeWidth="1.5">
      <path d="M53 210V77l15-38 15 38v133Z"/><path d="M104 210V80l15-22 17 14v138Z"/><path d="M155 210V92l14-16 16 16v118Z"/><path d="M207 210V125l12-9 20 9v85Z"/><path d="M259 210V143l19-9 17 9v67Z"/>
      {[92, 111, 130, 149, 168, 187].map(y => <path key={y} d={`M56 ${y}h24m27 ${y > 130 ? 0 : 3}h26m24 0h24`}/>)}
    </g> : asset.id === 'nanjing-wall' ? <g fill={`url(#g-${asset.id})`} stroke="#f2eee3" strokeWidth="2"><path d="m60 142 145-43 115 58v55l-145 22-115-45Z"/><path d="m60 142 30-8v-17l21-6v17l25-8v-17l21-6v17l26-8v-17l22-7 114 59v20l-114-57-145 45Z"/><path d="M142 210v-34c0-31 42-29 42-4v47" fill="#675f4e"/></g>
      : <g fill={`url(#g-${asset.id})`} stroke="#f7f4eb" strokeWidth="1.5"><path d="m86 212 95-32 95 32-95 28Z"/><path d="m120 179 60-22 60 22v17l-60 22-60-22Z"/>
        {[0, 1, 2].map(i => <g key={i} transform={`translate(0 ${-i * 39})`}><path d="m150 168 30-12 30 12v31l-30 12-30-12Z"/><path d="m117 158 63-24 63 24-63 25Z"/><path d="m117 158 63 10 63-10-63 25Z" fill={asset.color}/></g>)}<path d="m166 56 14-31 14 31-14 9Z"/></g>}
    <text x="180" y="247" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#827e70">封面示意 · 实际模型请进入详情</text>
  </svg>;
}
function Model({ src, name, className = '', active = true }) {
  const ref = useRef(null), [failed, setFailed] = useState(false), [ready, setReady] = useState(false);
  useEffect(() => {
    setFailed(false); setReady(false);
    const element = ref.current; const error = () => setFailed(true), loaded = () => setReady(true);
    element?.addEventListener('error', error); element?.addEventListener('load', loaded);
    let active = true;
    import('@google/model-viewer').catch(() => { if (active) setFailed(true); });
    return () => { active = false; element?.removeEventListener('error', error); element?.removeEventListener('load', loaded); };
  }, [src]);
  useEffect(() => { const element = ref.current; if (ready && element) { if (active) element.play?.(); else element.pause?.(); } }, [active, ready]);
  return <div className={`model-stage ${className}`}>
    {failed ? <div className="model-notice">模型预览未能加载。请检查文件或解码器网络；这不代表验收通过。</div>
      : <model-viewer ref={ref} src={src} alt={name} camera-controls auto-rotate={active || undefined} autoplay={active || undefined} shadow-intensity="1" exposure="1.1" environment-image="neutral" />}
    {!failed && !ready && <span className="loading-model">正在载入三维模型…</span>}
    <span className="stage-caption">拖动旋转 · 滚轮缩放</span>
  </div>;
}

function TaskPanel({ task, config, active = true }) {
  const [proofs, setProofs] = useState({}), [working, setWorking] = useState(null), [error, setError] = useState('');
  const [chain, setChain] = useState(() => parseChainEvidence(readLocal(`meshreceipt.chain.${task.id}`, null)));
  const [chainFresh, setChainFresh] = useState(false);
  const chainScope = chainContext(task, config);
  useEffect(() => { setProofs({}); setError(''); setChainFresh(false); setChain(parseChainEvidence(readLocal(`meshreceipt.chain.${task.id}`, null))); }, [task.id, chainScope]);
  async function verify(attempt) {
    setWorking(attempt.id); setError('');
    try { const result = await api(`/api/tasks/${task.id}/attempts/${attempt.id}/verify`, {}); setProofs(previous => ({ ...previous, [attempt.id]: result })); }
    catch (err) { setError(err.message); } finally { setWorking(null); }
  }
  async function connectChain() {
    if (!window.ethereum) throw new Error('未发现钱包，请安装支持 EVM 的钱包。');
    const { BrowserProvider, Contract, ZeroAddress, id, isAddress } = await import('ethers');
    if (!config.contractAddress || !isAddress(config.contractAddress)) throw new Error('尚未配置已部署的合约地址。');
    const provider = new BrowserProvider(window.ethereum), network = await provider.getNetwork();
    if (Number(network.chainId) !== config.chainId) throw new Error(`请先手动切换到 Chain ID ${config.chainId}。不会自动发送或跨链。`);
    if (await provider.getCode(config.contractAddress) === '0x') throw new Error('地址没有合约代码。');
    return { provider, contract: new Contract(config.contractAddress, config.abi, provider), ZeroAddress, id };
  }
  async function reverifyCompleted() {
    for (const attempt of task.attempts.filter(a => a.status === 'COMPLETED')) {
      const proof = await api(`/api/tasks/${task.id}/attempts/${attempt.id}/verify`, {});
      if (!proof.integrity || !proof.signatureValid || proof.verdict !== attempt.verdict || proof.reportHash !== attempt.reportHash) throw new Error('复核失败，拒绝确认链上声明。');
    }
  }
  function saveChainEvidence(transactions = []) {
    const evidence = createChainEvidence(task, config, transactions);
    if (!evidence) throw new Error('链上记录的展示信息无效。');
    // Persistence failure must not turn a successful chain read into a failed transaction.
    try { localStorage.setItem(`meshreceipt.chain.${task.id}`, JSON.stringify(evidence)); } catch { /* Fresh result remains in memory only. */ }
    setChain(evidence); setChainFresh(true);
  }
  async function recheckChain() {
    setWorking('chain-check'); setError(''); setChainFresh(false);
    try {
      const { contract } = await connectChain();
      await reverifyCompleted(); await verifyChainRecords(contract, task);
      saveChainEvidence();
    } catch (err) { setError(err.shortMessage || err.message); } finally { setWorking(null); }
  }
  async function recordChain() {
    setWorking('chain'); setError(''); setChainFresh(false);
    try {
      const { provider, contract: reader, ZeroAddress, id } = await connectChain();
      await provider.send('eth_requestAccounts', []); const signer = await provider.getSigner();
      const contract = reader.connect(signer);
      if ((await contract.attester()).toLowerCase() !== (await signer.getAddress()).toLowerCase()) throw new Error('当前钱包不是合约授权的验收者。');
      const completed = task.attempts.filter(a => a.status === 'COMPLETED');
      await reverifyCompleted();
      if (!window.confirm(`将向 Chain ID ${config.chainId} 的 ${config.contractAddress} 提交任务及 ${completed.length} 条验收声明，会产生 Gas 和钱包确认。此为事后存证，不是事前链上承诺。是否继续？`)) return;
      const taskId = id(task.id), existing = await contract.tasks(taskId), transactions = [];
      if (existing.requester === ZeroAddress) { const tx = await contract.registerTask(taskId, `0x${task.inputHash}`, `0x${task.policyHash}`); await tx.wait(); transactions.push(tx.hash); }
      else if (existing.inputHash !== `0x${task.inputHash}` || existing.policyHash !== `0x${task.policyHash}`) throw new Error('链上任务与本地任务不一致。');
      for (const attempt of completed) {
        const attemptId = id(`${task.id}:${attempt.id}`), stored = await contract.receipts(attemptId);
        const verdict = { PASS: 1, FAIL: 2, INCONCLUSIVE: 3 }[attempt.verdict];
        if (!verdict) throw new Error('无法记录运行异常。');
        if (Number(stored.verdict) !== 0) {
          if (stored.taskId !== taskId || stored.outputHash !== `0x${attempt.outputHash}` || stored.reportHash !== `0x${attempt.reportHash}`
            || Number(stored.verdict) !== verdict || stored.provider.toLowerCase() !== attempt.delivery.issuer.toLowerCase()) throw new Error('链上尝试与本地尝试不一致。');
          continue;
        }
        const tx = await contract.recordReceipt(taskId, attemptId, attempt.delivery.issuer, `0x${attempt.outputHash}`, `0x${attempt.reportHash}`, verdict);
        await tx.wait(); transactions.push(tx.hash);
      }
      await verifyChainRecords(contract, task);
      saveChainEvidence(transactions);
    } catch (err) { setError(err.shortMessage || err.message); } finally { setWorking(null); }
  }
  const completed = task.attempts.filter(a => a.status === 'COMPLETED');
  const success = completed.find(a => a.verdict === 'PASS');
  return <section className="task-panel">
    <div className="section-heading"><div><span className="eyebrow">DELIVERY / EVIDENCE</span><h3>一次交付，一份依据</h3></div><span className={`badge ${task.status === 'PASSED' ? 'pass' : ''}`}>{STATUS_NAMES[task.status] || task.status}</span></div>
    <div className="task-info"><span>{task.mode === 'model' ? '实时模型工具调用' : '确定性演示编排 · 非实时 AI'}</span><span>{task.attempts.length} 次尝试 · 引用 {task.historyUsed.length} 条历史</span></div>
    {task.mode === 'model' && <ModelEvidence trace={task.agentRun}/>}
    <div className="commitments"><div><small>原文件 SHA-256</small><code title={task.inputHash}>{short(task.inputHash)}</code></div><div><small>规则 SHA-256</small><code title={task.policyHash}>{short(task.policyHash)}</code></div><div><small>任务 ID</small><code title={task.id}>{short(task.id)}</code></div></div>
    <div className="timeline" role="log" aria-label="任务执行记录" aria-live="polite">{task.events.map(event => <div className={`timeline-event ${event.kind}`} key={event.id}><span className="timeline-dot"/><div><small>{new Date(event.at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small><p>{event.message}</p></div></div>)}</div>
    {task.attempts.map((attempt, index) => <article className="attempt" key={attempt.id}>
      <div className="attempt-heading"><span className="attempt-index">0{index + 1}</span><strong>{attempt.providerName}</strong><span className={`badge ${attempt.verdict === 'PASS' ? 'pass' : attempt.verdict === 'FAIL' ? 'fail' : ''}`}>{attempt.verdict || (attempt.status === 'ERROR' ? '执行异常' : '处理中')}</span></div>
      {attempt.verdict === 'PASS' && <p className="quality-boundary">限定规则通过；材质、纹理视觉质量未验收。不代表整体质量合格。</p>}
      <div className="check-grid">{attempt.checks?.map(check => <span key={check.id} className={check.pass ? 'check-pass' : 'check-fail'}>{check.pass ? '✓' : '×'} {CHECK_NAMES[check.id] || check.id}{check.actual !== undefined && <small>{fmt(check.actual)}</small>}</span>)}</div>
      {attempt.error && <p className="error-text">{attempt.error}</p>}
      {attempt.status === 'COMPLETED' && <><div className="attempt-links"><a href={attempt.reportUrl} target="_blank" rel="noreferrer">报告 JSON ↗</a><a href={attempt.modelUrl} download>交付 GLB ↓</a><button className="text-button" disabled={!!working} onClick={() => verify(attempt)}>{working === attempt.id ? '复核中…' : '重新运行验收 ↗'}</button></div><small className="hash-note" title={attempt.delivery.issuer}>演示签名者 {short(attempt.delivery.issuer)} · 报告 {short(attempt.reportHash)}</small></>}
      {proofs[attempt.id] && <p className={`proof-result ${proofs[attempt.id].integrity && proofs[attempt.id].signatureValid ? '' : 'error-text'}`}>文件与报告：{proofs[attempt.id].integrity ? '一致' : '不一致'} · 来源签名：{proofs[attempt.id].signatureValid ? '有效' : '无效'} · 复算结论：{proofs[attempt.id].verdict}</p>}
      {attempt.status === 'COMPLETED' && <BundleExport key={`${task.id}:${attempt.id}`} task={task} attempt={attempt}/>}
    </article>)}
    {success && <div className="comparison"><div><span className="viewer-label">原版本</span><Model src={`/api/tasks/${task.id}/original`} name="原始模型" active={active}/></div><div><span className="viewer-label">限定规则通过 · {fmt(success.outputBytes)}</span><Model src={success.modelUrl} name="通过限定规则的交付模型" active={active}/></div></div>}
    <div className="attempt-links"><a href={`/api/tasks/${task.id}/original`} download>原文件 ↓</a><a href={`/api/tasks/${task.id}/policy`} target="_blank" rel="noreferrer">固定规则 ↗</a></div>
    {completed.length > 0 && <div className="chain-panel"><div><strong>链上声明</strong><p>{config.contractAddress ? `网络 ${config.chainId} · 存证需授权验收者钱包确认` : '合约已具备本地实现；尚未配置部署地址，当前记录仅在本机。'}</p></div><div className="attempt-links"><button className="text-button" disabled={!config.contractAddress || !!working} onClick={recheckChain}>{working === 'chain-check' ? '读取并核对中…' : '重新核对链上记录（不发交易）'}</button><button className="button secondary" disabled={!config.contractAddress || !!working} onClick={recordChain}>{working === 'chain' ? '等待钱包/交易…' : '提交链上存证'}</button></div></div>}
    <ChainEvidence evidence={chain} fresh={chainFresh} contextMatches={chainContextMatches(chain, task, config)}/>
    {(error || task.error) && <p className="error-text" role="alert">{error || task.error}</p>}
  </section>;
}

function App() {
  const [assets, setAssets] = useState([]), [tasks, setTasks] = useState([]), [config, setConfig] = useState({}), [tab, setTab] = useState('landmarks');
  const [selected, setSelected] = useState(null), [task, setTask] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [lastSelected, setLastSelected] = useState(null);
  const displayed = selected || lastSelected;
  const [mode, setMode] = useState('demo'), [instruction, setInstruction] = useState('压缩纹理并降低体积，保留结构、几何与原有动画。');
  const [confirmedModelData, setConfirmedModelData] = useState(false);
  const [publishedEvidence, setPublishedEvidence] = useState(null), [readingMainnet, setReadingMainnet] = useState(false), [mainnetError, setMainnetError] = useState('');
  const [favorites, setFavorites] = useState(() => { const value = readLocal('meshreceipt.favorites', []); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []; });
  const dialog = useRef(null);
  useEffect(() => { Promise.all([api('/api/assets'), api('/api/tasks'), api('/api/config')]).then(([a, t, c]) => { setAssets(a); setTasks(t); setConfig(c); if (c.coreOnly) setTab('lab'); }).catch(err => setError(err.message));
    api('/api/mainnet-evidence').then(setPublishedEvidence).catch(err => setMainnetError(err.message)); }, []);
  async function checkPublishedReceipt() {
    setReadingMainnet(true); setMainnetError('');
    setPublishedEvidence(previous => previous ? { ...previous, status: 'archive-only', chainVerification: undefined } : previous);
    try { setPublishedEvidence(await api('/api/mainnet-evidence/verify', {})); }
    catch (err) { setMainnetError(err.message); } finally { setReadingMainnet(false); }
  }
  useLayoutEffect(() => {
    const element = dialog.current;
    if (selected) {
      document.documentElement.classList.add('asset-open');
      if (!element.open) element.showModal();
      element.scrollTop = 0;
    } else {
      element?.close();
      document.documentElement.classList.remove('asset-open');
    }
    return () => document.documentElement.classList.remove('asset-open');
  }, [selected?.id]);
  useEffect(() => {
    if (!task || !['QUEUED', 'RUNNING'].includes(task.status)) return;
    let active = true;
    const interval = setInterval(async () => {
      try { const updated = await api(`/api/tasks/${task.id}`); if (active) { setTask(updated); if (!['QUEUED', 'RUNNING'].includes(updated.status)) setTasks(await api('/api/tasks')); } }
      catch (err) { if (active) setError(err.message); }
    }, 1000);
    return () => { active = false; clearInterval(interval); };
  }, [task?.id, task?.status]);
  function collect(id) { const updated = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]; setFavorites(updated); localStorage.setItem('meshreceipt.favorites', JSON.stringify(updated)); }
  function open(asset, existing = null) { setError(''); setSelected(asset); setLastSelected(asset); setTask(existing); setConfirmedModelData(false); }
  async function start() {
    setBusy(true); setError('');
    try { const created = await api('/api/tasks', { assetId: selected.id, mode, instruction, ...(mode === 'model' ? { confirmModelData: confirmedModelData } : {}) }); setTask(created); setConfirmedModelData(false); setTasks(await api('/api/tasks')); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const attempts = tasks.flatMap(item => item.attempts).filter(a => a.status === 'COMPLETED');
  const visible = assets.filter(asset => tab === 'landmarks' ? asset.previewOnly : tab === 'lab' ? !asset.previewOnly : favorites.includes(asset.id));
  const featured = assets.find(asset => asset.id === 'huanghe' && asset.previewUrl && asset.poster) || assets.find(asset => asset.id === 'zifeng') || assets.find(asset => !asset.previewOnly);
  return <>
    <header className="site-header"><a className="brand" href="#"><Mark/><span>琢信<small>MESHRECEIPT</small></span></a><nav aria-label="主导航"><a href="#gallery">数字资产</a>{config.coreOnly === false && <a href="/city/index.html">城市共建 ↗</a>}<a href="#records">履约记录</a><a href="#method">验收方法</a></nav><span className="demo-pill"><i/> {PUBLIC_EXHIBITION ? '公开展示版' : '本地开发原型'}</span></header>
    <main>
      <section className="hero"><div className="hero-copy"><span className="eyebrow">OPEN ASSETS. SHARED EVIDENCE.</span><h1>共琢成器，<br/>履约有据<span>。</span></h1><p>让每一份数字模型的改进，都有可复核的依据。<br/>加工模型，验收交付，把成果交给下一位使用者。</p><div className="hero-actions"><button className="button primary" onClick={() => { if (PUBLIC_EXHIBITION) { document.getElementById('delivery-evidence')?.scrollIntoView({ behavior: 'smooth' }); return; } const asset = assets.find(a => !a.previewOnly); if (asset) open(asset); }}>{PUBLIC_EXHIBITION ? '查看交付与主网凭据' : '处理并交付模型'} <span>→</span></button><a className="button quiet" href="#gallery">探索数字资产 <span>↗</span></a></div><div className="hero-foot"><span>开放模型</span><i/><span>确定性验收</span><i/><span>公共履约证据</span></div></div>
        <button className="hero-art" disabled={!featured} onClick={() => featured && open(featured)} aria-label={`查看${featured?.title || '模型'}三维预览`}><div className="art-grid"/><span className="art-number">{featured?.serial || 'OPEN / MODEL'}</span>{featured?.poster ? <picture><source srcSet={featured.poster.replace(/\.png$/, '.webp')} type="image/webp"/><img src={featured.poster} alt={`${featured.title}${featured.posterKind || '原项目截图'}`} decoding="async" fetchPriority="high"/></picture> : featured && <AssetIllustration asset={featured}/>}<div className="art-caption"><div><small>{featured?.previewOnly ? '城市地标' : '自有共建样例'} · {featured?.posterKind || '程序化模型'}</small><h2>{featured?.title || '开放模型'}</h2></div><span>进入三维预览 ↗</span></div></button>
      </section>
      <section className="facts" aria-label="实际运行统计"><div><strong>{assets.filter(a => a.previewOnly).length.toString().padStart(2, '0')}</strong><span>城市地标条目</span></div><div><strong>{assets.filter(a => !a.previewOnly).length.toString().padStart(2, '0')}</strong><span>可验收测试样例</span></div><div><strong>{tasks.length.toString().padStart(2, '0')}</strong><span>本机任务记录</span></div><div><strong>{attempts.length.toString().padStart(2, '0')}</strong><span>已完成验收尝试</span></div><p>不只是收藏<br/><b>让改进留下依据。</b></p></section>
      <MainnetReceipt evidence={publishedEvidence} busy={readingMainnet} error={mainnetError} onVerify={checkPublishedReceipt}/>
      <section className="gallery" id="gallery"><div className="section-heading"><div><span className="eyebrow">THE COLLECTION</span><h2>数字资产，共同雕琢</h2></div><p>展示不等于验收，收藏不等于链上持有。</p></div><div className="tabs" role="tablist" aria-label="资产分类">{[['landmarks', '城市地标'], ['lab', '验收实验室'], ['favorites', `我的收藏 ${favorites.length}`]].map(([id, label]) => <button role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} key={id}>{label}</button>)}</div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="asset-grid">{visible.map(asset => <article className="asset-card" key={asset.id}><button className="card-image" onClick={() => open(asset)} aria-label={`查看${asset.title}`}><span className="asset-tag">{asset.category}</span><AssetIllustration asset={asset}/><span className="card-serial">{asset.serial}</span><span className="card-arrow">↗</span></button><div className="card-body"><div><h3><button onClick={() => open(asset)}>{asset.title}</button></h3><p>{asset.subtitle}</p></div><button className={`favorite ${favorites.includes(asset.id) ? 'saved' : ''}`} aria-label={`${favorites.includes(asset.id) ? '取消收藏' : '收藏'}${asset.title}`} aria-pressed={favorites.includes(asset.id)} onClick={() => collect(asset.id)}>{favorites.includes(asset.id) ? '♥' : '♡'}</button></div><div className="card-footer"><span><i className={asset.previewOnly ? 'pending-dot' : 'green-dot'}/>{asset.readiness}</span><small>{asset.previewOnly ? '来源已标注' : '限定支持范围'}</small></div></article>)}</div>
        {!visible.length && <div className="empty-state">{assets.length ? '还没有收藏。点击资产卡片上的心形按钮，建立你的本机展柜。' : '正在读取本地资产…'}</div>}
      </section>
      <section className="method" id="method"><div><span className="eyebrow">CRAFT WITH CONFIDENCE</span><h2>改进可以不同，<br/>验收必须有据。</h2><p>规则先确定，交付再检查。没有完成的检查，不会被算作通过。</p><span className="method-note">GitHub 可管理协作与版本；琢信的验收器可以作为 CI 检查。</span></div><div className="method-steps">{[['01', '事前固定规则', '绑定原文件与规则指纹，限定体积、结构、几何和动画要求。'], ['02', '验收真实交付', '运行模型处理与逐项检查，明确区分失败、异常与无法判定。'], ['03', '复用履约依据', '保留失败尝试，下一次任务读取同模型、同规则的历史。']].map(([num, title, text]) => <div key={num}><span>{num}</span><section><h3>{title}</h3><p>{text}</p></section></div>)}</div></section>
      <section className="records" id="records"><div className="section-heading"><div><span className="eyebrow">SHARED DELIVERY LOG</span><h2>公共履约记录</h2></div><button className="text-button" onClick={() => api('/api/tasks').then(setTasks).catch(err => setError(err.message))}>刷新记录 ↻</button></div><p className="section-description">{PUBLIC_EXHIBITION ? '公开网页保留原交付凭据与下载材料。任务处理请在本机运行仓库源码。' : '本机演示记录；两个服务由同一团队控制。不将少量记录包装成总体信誉评分。'}</p>
        {!tasks.length ? <div className="empty-state record-empty"><Mark small/><h3>{PUBLIC_EXHIBITION ? '原交付的主网凭据已公开' : '第一份依据，等待你的验收'}</h3><p>{PUBLIC_EXHIBITION ? '上方可查看合约、三笔主网交易并下载合格包和失败取证包。' : '进入验收实验室，运行一次真实处理，保留成功与失败。'}</p><button className="button secondary" disabled={PUBLIC_EXHIBITION} onClick={() => { setTab('lab'); document.getElementById('gallery').scrollIntoView({ behavior: 'smooth' }); }}>进入实验室 →</button></div>
          : <div className="records-list">{tasks.map(item => <button className="record-row" key={item.id} onClick={() => open(assets.find(a => a.id === item.assetId), item)}><div className="record-symbol">◇</div><div><strong>{item.assetTitle}</strong><small>{item.mode === 'model' ? '实时模型' : '确定性演示'} · {item.attempts.length} 次尝试 · 引用 {item.historyUsed.length} 条历史</small></div><span className={`badge ${item.status === 'PASSED' ? 'pass' : ''}`}>{STATUS_NAMES[item.status] || item.status}</span><time>{new Date(item.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><span>↗</span></button>)}</div>}
      </section>
    </main>
    <footer className="site-footer"><a className="brand" href="#"><Mark small/><span>琢信<small>MESHRECEIPT</small></span></a><p>共琢成器，履约有据。<br/><small>原型不提供 NFT 发行、交易、收益分配或版权证明。收藏仅保存在当前浏览器。</small></p><span>BOT 主网凭据 / GCC 服务验收方向</span></footer>
    <dialog ref={dialog} className="asset-dialog" data-preview={previewKind(displayed)} aria-label={displayed?.title || '资产详情'} onCancel={() => setSelected(null)} onClick={event => { if (event.target === dialog.current) setSelected(null); }}>
      {displayed && <><div className="dialog-heading"><div><span className="eyebrow">{displayed.serial} / {displayed.category}</span><h2>{displayed.title}</h2></div><button className="close-button" aria-label="关闭资产详情" onClick={() => setSelected(null)}>×</button></div><div className="detail-grid"><div><PreviewCache asset={displayed} active={Boolean(selected)}>{displayed.modelUrl ? <Model src={displayed.modelUrl} name={displayed.title} active={Boolean(selected)}/> : <div className="model-stage unavailable"><AssetIllustration asset={displayed}/><p>模型文件尚未获取，不显示虚假的三维预览。</p></div>}</PreviewCache><p className="preview-note">{displayed.previewOnly ? '来源模型或程序化预览；展示不等于琢信验收凭证。' : '项目自有程序化测试模型；不是任何真实景点复刻。'}</p></div><div className="asset-detail"><span className="badge">{displayed.readiness}</span><h3>作品与来源</h3><p>{displayed.story}</p><dl><dt>素材来源</dt><dd>{displayed.source}</dd><dt>授权说明</dt><dd>{displayed.license}</dd><dt>验收状态</dt><dd>{displayed.previewOnly ? '暂不可验收；需要导出或适配扩展' : '可运行限定规则验收，不代表视觉质量'}</dd></dl>{displayed.components && <ul className="component-sources" aria-label="模型来源与文件状态">{displayed.components.map(item => <li key={item.id}><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.name} ↗</a><small>{item.author} · {item.ready ? '文件已就绪' : '文件待补齐'}</small></li>)}</ul>}{displayed.sourceUrl && <a className="text-link" href={displayed.sourceUrl} target="_blank" rel="noreferrer">查看来源与版本 ↗</a>}<button className="button secondary" onClick={() => collect(displayed.id)}>{favorites.includes(displayed.id) ? '已收藏 · 取消收藏' : '加入我的收藏 ♡'}</button><small className="local-note">仅本机收藏，不是链上持有或版权证书。</small></div></div>
        {PUBLIC_EXHIBITION && !displayed.previewOnly && <section className="task-create"><h3>模型可公开检视</h3><p>处理、验收和任务记录需要 Node 后端。<a href="https://github.com/obtito/wh" target="_blank" rel="noreferrer">下载完整源码并在本机运行 ↗</a></p></section>}
        {!PUBLIC_EXHIBITION && !displayed.previewOnly && <section className="task-create"><div><span className="eyebrow">START A DELIVERY TASK</span><h3>让改进接受检验</h3><p>固定规则：不超过 {fmt(displayed.policy.maxOutputBytes)}；保留指定节点、结构、几何和动画。当前不支持任意文件上传。</p></div><label>任务说明<textarea value={instruction} maxLength={500} onChange={event => { setInstruction(event.target.value); setConfirmedModelData(false); }} /></label><ModelControls mode={mode} onModeChange={value => { setMode(value); setConfirmedModelData(false); }} confirmed={confirmedModelData} onConfirmedChange={setConfirmedModelData} config={config} busy={busy} running={['QUEUED', 'RUNNING'].includes(task?.status)} onStart={start}/><p className="trust-note">两种服务均为团队控制的演示适配器。其中一个故意删除动画，用于证明失败路径；有效签名不等于独立质量证明。模型目录只展示中性名称，不提示哪一个故障。</p></section>}
        {error && <p className="error-text" role="alert">{error}</p>}{task && <TaskPanel task={task} config={config} active={Boolean(selected)}/>}</>}
    </dialog>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
