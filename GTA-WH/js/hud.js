// HUD:小地图(canvas)/ 地标列表 / POI 卡片 / 任务条 / 模式提示
import { toV2, toV2List } from './geo.js';
import { RIVER, LAKES, ROADS, BRIDGES, LANDMARKS, CATEGORIES, TOUR } from './data.js';

const CAT_COLOR = {};
for (const c of CATEGORIES) CAT_COLOR[c.key] = c.color;

/* ---------- 地图静态层(水系/道路,一次绘制) ---------- */
const MAP_SPAN = 33000;                       // 静态层覆盖 ±16.5 km(罩满 32 km 地面)
function buildStaticLayer(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const S = size / (MAP_SPAN * 2);
  const X = (x) => (x + MAP_SPAN) * S;
  const Z = (z) => (z + MAP_SPAN) * S;
  ctx.fillStyle = '#141a20';
  ctx.fillRect(0, 0, size, size);
  // 水系
  ctx.strokeStyle = '#3d6f9e';
  ctx.lineWidth = Math.max(2, RIVER.halfWidth * 2 * S);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  toV2List(RIVER.pts).forEach(([x, z], i) => i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)));
  ctx.stroke();
  ctx.lineWidth = Math.max(1.5, 200 * S);
  for (const b of RIVER.branches) {
    ctx.beginPath();
    toV2List(b.pts).forEach(([x, z], i) => i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)));
    ctx.stroke();
  }
  ctx.fillStyle = '#3d6f9e';
  for (const lk of LAKES) {
    const poly = toV2List(lk.pts);
    ctx.beginPath();
    poly.forEach(([x, z], i) => i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)));
    ctx.closePath();
    ctx.fill();
  }
  // 道路
  ctx.strokeStyle = '#4a4f45';
  for (const r of ROADS) {
    ctx.lineWidth = r.major ? 2.4 : 1.4;
    ctx.beginPath();
    toV2List(r.pts).forEach(([x, z], i) => i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)));
    ctx.stroke();
  }
  return c;
}

/* ---------- HUD 控制器 ---------- */
export function initHUD({ onGoto, onToggleTour }) {
  const $ = (s) => document.querySelector(s);
  const listBody = $('#listBody');
  const minimap = $('#minimap');
  const mctx = minimap.getContext('2d');
  const BASE = 240;

  let staticLayer = null;
  try { staticLayer = buildStaticLayer(1024); } catch (e) { /* node/无 DOM */ }

  // POI 合表(地标 + 桥)
  const pois = [
    ...LANDMARKS.map((l) => ({ id: l.id, name: l.name, cat: l.cat, ...toV2(l.lon, l.lat) })),
    ...BRIDGES.map((b) => ({ id: b.id, name: b.name, cat: b.cat, ...toV2(b.lon, b.lat) })),
  ];
  const visited = new Set();

  /* --- 列表 --- */
  $('#listCount').textContent = pois.length;
  function renderList() {
    listBody.innerHTML = '';
    for (const p of pois) {
      const row = document.createElement('div');
      row.className = 'lm-item' + (visited.has(p.id) ? ' lm-gone' : '');
      row.dataset.id = p.id;
      row.innerHTML = `<span class="lm-dot" style="background:${CAT_COLOR[p.cat] || '#999'}"></span><span class="lm-name">${p.name}</span>${visited.has(p.id) ? '<span class="chip">✓</span>' : ''}`;
      row.addEventListener('click', () => showPOI(p.id, true));
      listBody.appendChild(row);
    }
  }
  renderList();

  /* --- POI 卡片 --- */
  let activePOI = null;
  function showPOI(id, fromClick = false) {
    const all = [...LANDMARKS, ...BRIDGES];
    const item = all.find((l) => l.id === id);
    if (!item) return;
    activePOI = item;
    $('#poiCard').classList.remove('hidden');
    $('#poiCat').textContent = CATEGORIES.find((c) => c.key === item.cat)?.name || '';
    $('#poiCat').style.color = CAT_COLOR[item.cat] || '#999';
    $('#poiName').textContent = item.name;
    $('#poiTags').innerHTML = (item.tags || []).map((t) => `<span>${t}</span>`).join('');
    $('#poiDesc').textContent = item.desc || '';
    $('#poiSpec').innerHTML = (item.spec || []).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    // 列表高亮
    listBody.querySelectorAll('.lm-item').forEach((r) => r.classList.toggle('active', r.dataset.id === id));
    if (fromClick && onGoto) onGoto(item);
  }
  $('#poiClose').addEventListener('click', () => $('#poiCard').classList.add('hidden'));
  $('#poiGoto').addEventListener('click', () => { if (activePOI && onGoto) onGoto(activePOI); });

  /* --- 任务 --- */
  let tourActive = false, tourStep = 0;
  function setTour(active) {
    tourActive = active;
    $('#tourBar').classList.toggle('hidden', !active);
    if (active) { tourStep = TOUR.steps.findIndex((s) => !visited.has(s.poi)); if (tourStep < 0) tourStep = 0; }
    renderTour();
  }
  function renderTour() {
    if (!tourActive) return;
    $('#tourStep').textContent = `${Math.min(tourStep + 1, TOUR.steps.length)}/${TOUR.steps.length}`;
    $('#tourName').textContent = TOUR.name;
    const step = TOUR.steps[tourStep];
    $('#tourBrief').textContent = step ? `${step.brief}(打卡点:${(pois.find((p) => p.id === step.poi) || {}).name || step.poi})` : '🎉 观光线完成!武汉三镇尽收眼底。';
    $('#tourBarFill').style.width = `${(Math.min(tourStep, TOUR.steps.length) / TOUR.steps.length) * 100}%`;
  }
  if (onToggleTour) $('#btnTourFly').addEventListener('click', () => onToggleTour());
  setTour(false);

  /* --- 打卡 --- */
  const CHECK_R = 150;
  function checkVisit(x, z) {
    let hit = null;
    for (const p of pois) {
      if (visited.has(p.id)) continue;
      if (Math.hypot(p[0] - x, p[1] - z) < CHECK_R) { hit = p; break; }
    }
    if (!hit) return null;
    visited.add(hit.id);
    showPOI(hit.id);
    renderList();
    if (tourActive) {
      // 跳步兼容:提前打卡了未来步骤的 POI 时,任务指针直接越过它(否则永久卡死)
      let step = TOUR.steps[tourStep];
      while (step && visited.has(step.poi)) {
        tourStep++;
        step = TOUR.steps[tourStep];
      }
      renderTour();
    }
    toast(`📍 已打卡:${hit.name}(${visited.size}/${pois.length})`);
    return hit;
  }

  /* --- 提示条 --- */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#modeTip');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }
  function modeTip(msg) { toast(msg); }

  /* --- 小地图 --- */
  let zoom = 1;                                 // 1px = 20m;放大档 1px=80m→0.25
  function drawMinimap(px, pz, heading, mode) {
    const size = minimap.width;
    const ctx = mctx;
    ctx.clearRect(0, 0, size, size);
    if (!staticLayer) return;
    // 视野跨度:普通 4.8 km,放大 19 km
    const span = zoom === 1 ? 4800 : 19200;
    const s = size / span;
    const srcS = 1024 / (MAP_SPAN * 2);
    // 把静态层对应区域画进来:世界 → 静态层像素
    const sx = (px + MAP_SPAN) * srcS - (span * srcS) / 2;
    const sy = (pz + MAP_SPAN) * srcS - (span * srcS) / 2;
    const sw = span * srcS;
    ctx.drawImage(staticLayer, sx, sy, sw, sw, 0, 0, size, size);
    // POI 点
    for (const p of pois) {
      const dx = (p[0] - px) * s + size / 2;
      const dz = (p[1] - pz) * s + size / 2;
      if (dx < -4 || dz < -4 || dx > size + 4 || dz > size + 4) continue;
      ctx.fillStyle = CAT_COLOR[p.cat] || '#999';
      ctx.globalAlpha = visited.has(p.id) ? 0.45 : 1;
      ctx.beginPath();
      ctx.arc(dx, dz, visited.has(p.id) ? 2.5 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // 玩家箭头(指向 heading,北=上)
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-heading + Math.PI);
    ctx.fillStyle = mode === 'drive' ? '#ffd24a' : '#7ee08a';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    // 指北针
    ctx.fillStyle = '#d8a940';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', size - 16, 16);
  }
  function toggleZoom() { zoom = zoom === 1 ? 0.25 : 1; }

  return { drawMinimap, checkVisit, showPOI, toggleZoom, modeTip, setTour, visited, pois, renderTour };
}
