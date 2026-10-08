// Shared point metadata and render planning. No wallet, upload, or approval side effects.
export const CITY_SCHEMA = 'meshreceipt.city-base.v1';
export const POINT_IDS = ['huanghelou', 'jianghanguan', 'qingchuan', 'guishantower', 'guiyuan', 'guqintai', 'whu', 'greenland'];
export const ROAD_MODES = Object.freeze({ scene: '场景路网（经调整）', original: '原始 OSM 路网参考' });

export function validCoordinate(lon, lat) {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

export function createPoints(landmarks, baseVersion, project) {
  if (!Array.isArray(landmarks) || typeof baseVersion !== 'string' || !/^[a-f0-9]{64}$/.test(baseVersion)) throw new Error('Invalid city base');
  return POINT_IDS.map(id => {
    const source = landmarks.find(point => point.id === id);
    if (!source || !validCoordinate(source.lon, source.lat)) throw new Error(`Missing or invalid reference point: ${id}`);
    const [x, z] = project(source.lon, source.lat);
    if (![x, z].every(Number.isFinite)) throw new Error('Invalid projected coordinate');
    return {
      cityId: 'wuhan', pointId: `wuhan:${id}`, baseVersion, sourceId: id, name: source.name,
      lon: source.lon, lat: source.lat, x, z, coordinateSource: 'GTA-WH/js/data.js',
      coordinateStatus: 'reference-unverified', state: 'awaiting-model', candidates: 0,
      footprint: null, groundDatum: 'GTA-WH procedural scene ground; not surveyed elevation',
      rotation: null, author: null, acceptedVersion: null,
      heightReferenceM: Number.isFinite(source.heightM) ? source.heightM : null,
      note: '位置、占地与朝向待逐点核对；此处不代表建筑或土地所有权。',
    };
  });
}

export function validateRoads(value) {
  const roads = Array.isArray(value) ? value : value?.roads;
  if (!Array.isArray(roads) || roads.length > 10_000) throw new Error('Invalid road collection');
  for (const road of roads) {
    if (!road || !Array.isArray(road.g) || road.g.length < 2 || road.g.length > 10_000
      || road.g.some(pair => !Array.isArray(pair) || pair.length !== 2 || !validCoordinate(...pair))) throw new Error('Invalid road coordinates');
    if (!road.t || typeof road.t !== 'object' || Array.isArray(road.t)) throw new Error('Invalid road tags');
  }
  return roads;
}

export function filterPoints(points, query) {
  const text = String(query).trim().toLocaleLowerCase();
  return points.filter(point => `${point.name} ${point.pointId}`.toLocaleLowerCase().includes(text));
}

// Label callouts may move; their geographic anchors must never move with them.
export function layoutLabels(entries, width, height, top = 150, bottom = 85) {
  const occupied = [], placed = [];
  for (const entry of [...entries].sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)))) {
    const w = entry.width, h = entry.height;
    const offsets = Array.from({ length: 6 }, (_, row) => [0, -1, 1, -2, 2]
      .map(column => [column * (w + 8), -16 - row * (h + 9)])).flat();
    let chosen = null;
    for (const [dx, dy] of offsets) {
      const x = Math.max(w / 2 + 10, Math.min(width - w / 2 - 10, entry.x + dx));
      const y = Math.max(top + h, Math.min(height - bottom, entry.y + dy));
      const box = { left: x - w / 2, right: x + w / 2, top: y - h, bottom: y };
      if (occupied.some(other => box.left < other.right + 5 && box.right > other.left - 5 && box.top < other.bottom + 5 && box.bottom > other.top - 5)) continue;
      chosen = { id: entry.id, x, y, anchorX: entry.x, anchorY: entry.y, box }; break;
    }
    if (chosen) { occupied.push(chosen.box); placed.push(chosen); }
  }
  return placed;
}

export function pointRequest(point) {
  if (!point || point.state !== 'awaiting-model' || point.coordinateStatus !== 'reference-unverified') throw new Error('Unsupported point state');
  return {
    schema: 'meshreceipt.city-point-request.v1', cityId: point.cityId, pointId: point.pointId,
    baseVersion: point.baseVersion, name: point.name,
    referencePlacement: { longitude: point.lon, latitude: point.lat, source: point.coordinateSource,
      sceneX: point.x, sceneZ: point.z, units: 'meter', xAxis: 'east', zAxis: 'south', status: point.coordinateStatus },
    footprint: null, rotation: null, groundDatum: point.groundDatum,
    requirements: { format: 'GLB 2.0', units: 'meter', upAxis: 'Y', origin: 'base-center', sourceAndLicenseRequired: true },
    readiness: 'draft-only', submissionEnabled: false, onChain: false,
    pending: ['坐标与实体核对', '占地边界', '朝向与地面基准', '资源预算', '新建模型验收规则', '贡献登记与审核'],
    warning: '点位需求草案，不是验收通过、认领权、版权授权或链上凭证。',
  };
}
