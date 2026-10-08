// Photo-derived campus proportions, shared by buildings, grading and tree clearance.
// These scene dimensions are an approximation, not an architectural survey.
import { LANDMARKS } from './data.js';
import { toV2, bearingToRot, clamp } from './geo.js';

const lm=LANDMARKS.find(l=>l.id==='whu'),centre=toV2(lm.lon,lm.lat);
export const WHU_ROT=bearingToRot(lm.params.rot);
const C=Math.cos(WHU_ROT),S=Math.sin(WHU_ROT);
export const WHU_LAYOUT={
  blocks:[-55.5,-18.5,18.5,55.5],gates:[-37,0,37],
  width:29,frontZ:22,backZ:-62,rows:[16,-20,-56],
  terraceY:40.3,frontY:24.9,libraryZ:-111,treeShift:42,
};
export function whuPoint(x,z){return[centre[0]+C*x+S*z,centre[1]-S*x+C*z];}
export function whuLocal(x,z){const dx=x-centre[0],dz=z-centre[1];return[C*dx-S*dz,S*dx+C*dz];}

// The real complex is cut into a hill. Grade only its reserved building pad,
// blending back into the procedural hill before the surrounding streets.
export function whuGroundGrade(x,z,natural){
  const [lx,lz]=whuLocal(x,z);
  // Extend the graded forecourt beyond the portals so the coarse hill triangles
  // cannot interpolate the natural slope over the first stair treads.
  const outside=Math.max(Math.abs(lx)-79,-148-lz,lz-40,0);
  if(outside>=24)return natural;
  const t=clamp(outside/24,0,1),blend=1-t*t*(3-2*t);
  // Keep one plane through the entrance: a lower clamp here would form a
  // convex crease that coarse terrain triangles interpolate above the stairs.
  const grade=WHU_LAYOUT.frontY-.05+Math.min((22-lz)*.125,WHU_LAYOUT.terraceY-WHU_LAYOUT.frontY-.6);
  return natural+(grade-natural)*blend;
}

export const WHU_KEEPOUTS=[
  {x:0,z:-20,w:151,d:89}, // Dormitory walls, three gates and all eight light wells.
  {x:0,z:-80,w:151,d:36}, // Continuous upper terrace.
  {x:0,z:WHU_LAYOUT.libraryZ,w:54,d:42},
  {x:0,z:25,w:10,d:50}, // Central approach to the avenue.
  ...[-37,37].map(x=>({x,z:36,w:7,d:28})),
];
