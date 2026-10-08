// Shared visible-water footprints: same smoothing, width and miter as world.js/lib.js.
import { toV2List, smoothPolyline, clamp, pointInPolygon } from './geo.js';
import { RIVER, LAKES } from './data.js';
export const RIVER_SURFACE_POINTS = smoothPolyline(toV2List(RIVER.pts), 8);
export const BRANCH_SURFACES = RIVER.branches.map(b => ({ ...b, points: smoothPolyline(toV2List(b.pts), 8) }));
export function yangtzeWidth(t) {
  return RIVER.halfWidth * 2 * (0.82 + 0.30 * Math.sin(Math.PI * clamp(t, 0, 1)) - 0.12 * Math.exp(-(((t - 0.33) / 0.06) ** 2)) + 0.06 * Math.sin(t * 21));
}
function ribbonCells(points, width) {
  const pairs = points.map((here, i) => {
    const prev = points[Math.max(0,i-1)], next = points[Math.min(points.length-1,i+1)];
    let ax=here[0]-prev[0], az=here[1]-prev[1], bx=next[0]-here[0], bz=next[1]-here[1];
    if (!i) { ax=bx; az=bz; } if (i===points.length-1) { bx=ax; bz=az; }
    const al=Math.hypot(ax,az)||1, bl=Math.hypot(bx,bz)||1; ax/=al; az/=al; bx/=bl; bz/=bl;
    let nx=-az-bz,nz=ax+bx; const nl=Math.hypot(nx,nz);
    if(nl<0.001){nx=-bz;nz=bx;}else{nx/=nl;nz/=nl;}
    const w=typeof width==='function'?width(i/(points.length-1)):width;
    const m=Math.min(1.5,1/Math.max(0.2,nx*-bz+nz*bx))*w/2;
    return [[here[0]+nx*m,here[1]+nz*m],[here[0]-nx*m,here[1]-nz*m]];
  });
  const cells=[];
  for(let i=1;i<pairs.length;i++) {
    // Match the two triangles actually rendered by ribbonGeometry.
    cells.push([pairs[i-1][0],pairs[i][0],pairs[i-1][1]], [pairs[i-1][1],pairs[i][0],pairs[i][1]]);
  }
  return cells;
}
export const WATER_FOOTPRINTS = [
  ...ribbonCells(RIVER_SURFACE_POINTS,yangtzeWidth),
  ...BRANCH_SURFACES.flatMap(b=>ribbonCells(b.points,b.halfWidth*2)),
  ...LAKES.map(l=>toV2List(l.pts)),
];
const CELL=256, grid=new Map();
const bounds=p=>({minX:Math.min(...p.map(v=>v[0])),maxX:Math.max(...p.map(v=>v[0])),minZ:Math.min(...p.map(v=>v[1])),maxZ:Math.max(...p.map(v=>v[1]))});
const boxes=WATER_FOOTPRINTS.map(bounds);
boxes.forEach((b,i)=>{
  for(let x=Math.floor(b.minX/CELL);x<=Math.floor(b.maxX/CELL);x++)for(let z=Math.floor(b.minZ/CELL);z<=Math.floor(b.maxZ/CELL);z++){
    const key=x+','+z; if(!grid.has(key))grid.set(key,[]); grid.get(key).push(i);
  }
});
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersects(a,b,c,d){
  if(Math.max(a[0],b[0])<Math.min(c[0],d[0])||Math.max(c[0],d[0])<Math.min(a[0],b[0])||Math.max(a[1],b[1])<Math.min(c[1],d[1])||Math.max(c[1],d[1])<Math.min(a[1],b[1]))return false;
  return cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0;
}
export function footprintOverlapsWater(poly) {
  if(poly.length<3)return false;
  const b=bounds(poly), seen=new Set();
  for(let x=Math.floor(b.minX/CELL);x<=Math.floor(b.maxX/CELL);x++)for(let z=Math.floor(b.minZ/CELL);z<=Math.floor(b.maxZ/CELL);z++){
    for(const i of grid.get(x+','+z)||[]){
      if(seen.has(i))continue; seen.add(i);
      const bb=boxes[i];if(b.maxX<bb.minX||b.minX>bb.maxX||b.maxZ<bb.minZ||b.minZ>bb.maxZ)continue;
      const water=WATER_FOOTPRINTS[i];
      if(poly.some(p=>pointInPolygon(p[0],p[1],water))||water.some(p=>pointInPolygon(p[0],p[1],poly)))return true;
      for(let j=0;j<poly.length;j++)for(let k=0;k<water.length;k++)if(intersects(poly[j],poly[(j+1)%poly.length],water[k],water[(k+1)%water.length]))return true;
    }
  }
  return false;
}
export function waterAt(x,z){
  for(const i of grid.get(Math.floor(x/CELL)+','+Math.floor(z/CELL))||[])if(pointInPolygon(x,z,WATER_FOOTPRINTS[i]))return true;
  return false;
}
