import React, { useEffect, useRef, useState } from 'react';
import { previewKind, retainPreviewEntries } from './preview-cache.js';
import { acceptCinematicStatus, cinematicPoster } from './cinematic-session.js';

export default function PreviewCache({ asset, active, children }) {
  const [entries, setEntries] = useState([]), [slowUrl, setSlowUrl] = useState(null);
  const [cinema, setCinema] = useState(null);
  const frames = useRef(new Map()), current = useRef({ asset, active });
  const session = useRef(null), sequence = useRef(0), watchdog = useRef(null);
  current.current = { asset, active };
  const notify = (frame, url) => frame?.contentWindow?.postMessage({
    type: 'meshreceipt-preview-visibility', active: current.current.active && current.current.asset?.previewUrl === url,
  }, location.origin);
  const entry = entries.find(item => item.url === asset?.previewUrl);
  const status = entry?.status || 'loading';
  const currentCinema = cinema?.url === asset?.previewUrl ? cinema : null;
  const needsIntro = status === 'ready' && asset?.poster && !entry?.cinematicPlayed;
  const phase = currentCinema?.phase ?? (needsIntro ? 'pending' : 'idle');
  const entering = ['pending', 'preparing', 'running'].includes(phase);

  function finishTransition(next) {
    clearTimeout(watchdog.current);
    session.current = next; setCinema(next);
    setEntries(previous => previous.map(item => item.url === next.url ? { ...item, cinematicPlayed: true } : item));
  }
  function skipTransition() {
    const pending = session.current;
    if (!pending || pending.phase === 'complete') return;
    frames.current.get(pending.url)?.contentWindow?.postMessage({ type: 'meshreceipt-cinematic', action: 'skip', requestId: pending.requestId }, location.origin);
    finishTransition({ ...pending, phase: 'complete' });
  }
  function playTransition(item) {
    const frame = frames.current.get(item.previewUrl);
    if (!frame) return;
    clearTimeout(watchdog.current);
    const next = { url: item.previewUrl, requestId: `entrance-${++sequence.current}`, phase: 'preparing' };
    session.current = next; setCinema(next);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishTransition({ ...next, phase: 'complete' });
      return;
    }
    frame.contentWindow.postMessage({ type: 'meshreceipt-cinematic', action: 'play', requestId: next.requestId,
      poster: cinematicPoster(item.poster) }, location.origin);
    // A missing/old child module must never trap the user behind the cover.
    watchdog.current = setTimeout(() => {
      if (session.current?.requestId === next.requestId) skipTransition();
    }, 8000);
  }

  useEffect(() => {
    if (!active || !asset?.previewUrl) return;
    if (frames.current.has(asset.previewUrl)) {
      setEntries(previous => retainPreviewEntries(previous, asset));
      return;
    }
    // Paint the dialog and cached cover before starting another WebGL document.
    let next;
    const first = requestAnimationFrame(() => {
      next = requestAnimationFrame(() => setEntries(previous => retainPreviewEntries(previous, asset)));
    });
    return () => { cancelAnimationFrame(first); if (next !== undefined) cancelAnimationFrame(next); };
  }, [active, asset?.previewUrl]);
  useEffect(() => { frames.current.forEach((frame, url) => notify(frame, url)); }, [active, asset?.previewUrl, entries]);
  useEffect(() => {
    const message = event => {
      if (event.origin !== location.origin) return;
      const match = [...frames.current].find(([, frame]) => frame.contentWindow === event.source);
      if (!match) return;
      const [url, frame] = match;
      if (event.data?.type === 'meshreceipt-preview-ready') notify(frame, url);
      if (event.data?.type === 'meshreceipt-cinematic-status' && current.current.active) {
        if (session.current?.url !== url) return;
        const next = acceptCinematicStatus(session.current, event.data, current.current.asset?.previewUrl);
        if (next === session.current) return;
        if (next.phase === 'complete') finishTransition(next);
        else {
          // Preparation and visible playback have separate deadlines. A cold
          // shader compile must not consume the animation's remaining time.
          clearTimeout(watchdog.current);
          session.current = next; setCinema(next);
          watchdog.current = setTimeout(() => {
            if (session.current?.requestId === next.requestId) skipTransition();
          }, 4000);
        }
      }
      if (event.data?.type !== 'meshreceipt-preview-status' || !['ready', 'error'].includes(event.data.status)) return;
      setEntries(previous => previous.map(item => item.url === url ? { ...item, status: event.data.status } : item));
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, []);
  useEffect(() => {
    if (active && needsIntro && session.current?.url !== asset.previewUrl) playTransition(asset);
  }, [active, asset?.previewUrl, status, entry?.cinematicPlayed]);
  useEffect(() => () => {
    const pending = session.current;
    clearTimeout(watchdog.current);
    if (pending && pending.phase !== 'complete') {
      frames.current.get(pending.url)?.contentWindow?.postMessage({ type: 'meshreceipt-cinematic', action: 'skip', requestId: pending.requestId }, location.origin);
      setEntries(previous => previous.map(item => item.url === pending.url ? { ...item, cinematicPlayed: true } : item));
    }
    session.current = null; setCinema(null);
  }, [active, asset?.previewUrl]);
  useEffect(() => {
    setSlowUrl(null);
    if (!active || !asset?.previewUrl || status !== 'loading') return;
    const timer = setTimeout(() => setSlowUrl(asset.previewUrl), 15000);
    return () => clearTimeout(timer);
  }, [active, asset?.previewUrl, status, entry?.revision]);
  function retry() {
    skipTransition(); session.current = null; setCinema(null); setSlowUrl(null);
    setEntries(previous => previous.map(item => item.url === asset.previewUrl
      ? { ...item, status: 'loading', cinematicPlayed: false, revision: item.revision + 1 } : item));
  }
  return <>
    <div className="preview-cache" data-preview-kind={previewKind(asset)} data-state={status} data-cinematic={phase}
      data-cinematic-metrics={currentCinema?.metrics ? JSON.stringify(currentCinema.metrics) : undefined}
      aria-busy={active && (status === 'loading' || entering)} hidden={!asset?.previewUrl}>
      {[...entries].sort((a, b) => a.url.localeCompare(b.url)).map(item => <iframe key={`${item.url}:${item.revision}`}
        src={item.url} title={item.title} className="source-preview" hidden={!active || item.url !== asset?.previewUrl}
        ref={frame => { if (frame) frames.current.set(item.url, frame); else frames.current.delete(item.url); }}
        onLoad={event => {
          const frame = event.currentTarget;
          frame.dataset.loads = String(Number(frame.dataset.loads || 0) + 1);
          notify(frame, item.url);
        }}/>) }
      {active && (status !== 'ready' || entering) && <div className="preview-loading" role="status" aria-live="polite">
        {asset?.poster && <picture><source srcSet={cinematicPoster(asset.poster)} type="image/webp"/>
          <img src={asset.poster} alt="" decoding="async"/></picture>}
        <div className="preview-loading-caption">
          <span className="eyebrow">{status === 'error' ? '预览暂未打开' : '从光影，走入真实空间'}</span>
          <strong>{asset?.title}</strong>
          <p>{status === 'error' ? '模型加载遇到问题，请重试。' : slowUrl === asset?.previewUrl ? '模型较大，仍在载入…' : entering ? '封面正在展开' : '正在准备三维场景…'}</p>
          {(status === 'error' || slowUrl === asset?.previewUrl) && <div className="preview-loading-actions">
            <button type="button" onClick={retry}>重新加载</button>
            <a href={asset.previewUrl} target="_blank" rel="noreferrer">单独打开 ↗</a>
          </div>}
        </div>
      </div>}
      {active && status === 'ready' && asset?.poster && <div className="cinematic-actions">
        {entering ? <button type="button" onClick={skipTransition}>跳过动画 <span aria-hidden="true">↗</span></button>
          : <button type="button" onClick={() => playTransition(asset)} aria-label="重播电影转场"><span aria-hidden="true">↻</span> 重播转场</button>}
      </div>}
    </div>
    {!asset?.previewUrl && children}
  </>;
}
