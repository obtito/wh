// 黄鹤楼备选代码模型：实景参考的折角方形、四面骑楼和五层复合飞檐。
// 所有几何/文字纹理由代码生成；不读取 GLB 或照片纹理。单位：米。
import * as THREE from 'three';

export const TOWER_SPEC = {
  height: 51.4,
  floors: [
    { half:15, y:2.2, h:10.2 }, { half:13.8, y:12.4, h:7.1 },
    { half:12.6, y:19.5, h:6.6 }, { half:11.4, y:26.1, h:6.5 },
    { half:9.5, y:32.6, h:7.4 },
  ],
  cut: .24,
};

export function buildYellowCraneTower({ stage=3 }={}) {
  const root=new THREE.Group();root.name='yellow-crane-code';
  root.userData={source:'procedural-only',revision:'photo-refinement-final',stage,dimensionsInferred:true};
  const materials={
    stone:new THREE.MeshStandardMaterial({color:'#cfbea0',roughness:.94}),
    wood:new THREE.MeshStandardMaterial({color:'#a66046',roughness:.8}),
    ceramic:new THREE.MeshStandardMaterial({color:'#bc813a',roughness:.58,metalness:0}),
    tileShade:new THREE.MeshStandardMaterial({color:'#a86c2d',roughness:.62,metalness:0}),
    underside:new THREE.MeshStandardMaterial({color:'#51392a',roughness:.91,side:THREE.DoubleSide}),
    paint:new THREE.MeshStandardMaterial({color:'#536f61',roughness:.84}),
    dark:new THREE.MeshStandardMaterial({color:'#312820',roughness:.92}),
    railing:new THREE.MeshStandardMaterial({color:'#b67d5c',roughness:.87}),
    plaster:new THREE.MeshStandardMaterial({color:'#c4ac83',roughness:.92}),
    red:new THREE.MeshStandardMaterial({color:'#913b32',roughness:.78}),
  };
  const unitBox=new THREE.BoxGeometry(1,1,1),unitColumn=new THREE.CylinderGeometry(1,1,1,12);
  const inst=new Map(),surfaces=new Map();let serial=0;
  function group(name,parent=root){const g=new THREE.Group();g.name=name;parent.add(g);return g;}
  function mesh(geo,key,parent,name){const m=new THREE.Mesh(geo,materials[key]);m.name=name||key+'-'+serial++;m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
  function item(geo,key,parent,pos,scale,rot=0){
    const tag=parent.uuid+':'+key+':'+geo.uuid;let b=inst.get(tag);
    if(!b)inst.set(tag,b={geo,key,parent,matrices:[]});
    b.matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(...pos),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),rot),new THREE.Vector3(...scale)));
  }
  function box(w,h,d,x,y,z,key,parent){item(unitBox,key,parent,[x,y+h/2,z],[w,h,d]);}
  function column(r,h,x,y,z,parent){item(unitColumn,'wood',parent,[x,y+h/2,z],[r,h,r]);}
  function clipped(a){const b=a*(1-TOWER_SPEC.cut);return [[-b,a],[b,a],[a,b],[a,-b],[b,-a],[-b,-a],[-a,-b],[-a,b]];}
  function prism(a,h,y,key,parent,name){
    const p=clipped(a),shape=new THREE.Shape();shape.moveTo(...p[0]);p.slice(1).forEach(v=>shape.lineTo(...v));shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});geo.rotateX(-Math.PI/2);geo.translate(0,y,0);
    return mesh(geo,key,parent,name);
  }
  function faceGroup(a,b,y,parent,name){
    const face=group(name,parent);const centre=[(a[0]+b[0])/2,(a[1]+b[1])/2];const tangent=new THREE.Vector2(b[0]-a[0],b[1]-a[1]).normalize();
    face.position.set(centre[0],y,centre[1]);face.rotation.y=-Math.atan2(tangent.y,tangent.x);return face;
  }
  function joinSurface(geo,key,parent){const tag=parent.uuid+':'+key;let bucket=surfaces.get(tag);if(!bucket)surfaces.set(tag,bucket={geos:[],key,parent});bucket.geos.push(geo);}
  function tube(points,r,key,parent){joinSurface(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),r<.1?4:8,r,3,false),key,parent);}
  function sampled(fn,nu,nv,key,parent){
    const p=[],uv=[],idx=[];for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){p.push(...fn(i/nu,j/nv).toArray());uv.push(i/nu,j/nv);}
    for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;idx.push(a,b,c,b,d,c);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();joinSurface(geo,key,parent);
  }
  function roof(a,inner,y,rise,parent,isTop=false){
    const square=[[-a,a],[a,a],[a,-a],[-a,-a]];
    for(let face=0;face<4;face++) {
      const p=square[face],q=square[(face+1)%4];
      const fn=(t,u)=>{const r=1-u*(1-inner/a);return new THREE.Vector3(((1-t)*p[0]+t*q[0])*r,y+rise*u*u+.22*Math.pow(1-u,8)+(stage>=3?2.7:1.55)*Math.pow(Math.abs(2*t-1),8)*Math.pow(1-u,3),((1-t)*p[1]+t*q[1])*r);};
      sampled(fn,16,10,'ceramic',parent);
      tube(Array.from({length:25},(_,i)=>fn(i/24,0)),.14,'ceramic',parent);
      tube(Array.from({length:17},(_,i)=>fn(0,i/16)),.2,'ceramic',parent);
      if(stage>=2)for(let i=1;i<24;i++)tube(Array.from({length:13},(_,j)=>fn(i/24,j/12)),.055,i%3===0?'tileShade':'ceramic',parent);
      // 薄屋檐边和木质底面，不留下悬空的裸露平面。
      const lower=(t,u)=>{const v=fn(1-t,u);v.y-=.3;return v;};sampled(lower,12,6,'underside',parent);
    }
    // 四面骑楼：两个带上翘的坡面组成各向外伸出的歇山近似屋面。
    for(let side=0;side<4;side++) {
      const arm=group('cardinal-gable-'+side,parent);arm.rotation.y=side*Math.PI/2;
      const w=a*.82,front=a+1.5,back=isTop?a*.3:a*.48,base=y+(isTop?1.6:.32),riseArm=isTop?2.6:1.7;
      for(const sign of [-1,1]) {
        const fn=(t,u)=>{
          const z=front+(back-front)*u,x=sign*w/2*(1-t),end=Math.pow(1-t,8);
          return new THREE.Vector3(x,base+riseArm*t*t+.32*Math.pow(1-t,8)+1.6*end*Math.pow(1-u,4),z);
        };
        // 两半屋面分别控制绕序，避免双面材质掩盖法线错误。
        sampled(sign===-1?fn:(t,u)=>fn(1-t,u),12,8,'ceramic',arm);
        tube(Array.from({length:17},(_,i)=>fn(i/16,0)),.15,'ceramic',arm);
        if(stage>=2)for(let i=1;i<10;i++)tube(Array.from({length:13},(_,j)=>fn(i/10,j/12)),.06,'ceramic',arm);
      }
      tube([new THREE.Vector3(0,base+riseArm,front),new THREE.Vector3(0,base+riseArm+.1,back)],.18,'ceramic',arm);
      if(stage>=2){
        const shape=new THREE.Shape();shape.moveTo(-w/2,-.22);for(let k=1;k<=32;k++){const x=-w/2+w*k/32,t=1-Math.abs(x)/(w/2);shape.lineTo(x,riseArm*t*t+.32*Math.pow(1-t,8)+1.6*Math.pow(1-t,8)-.22);}shape.lineTo(w/2,-.65);shape.lineTo(-w/2,-.65);shape.closePath();
        const geo=new THREE.ExtrudeGeometry(shape,{depth:.18,bevelEnabled:false});geo.translate(0,base-.45,front-.22);mesh(geo,'wood',arm,'gable-front-panel');
        for(let k=-2;k<=2;k++)box(.14,.8,.2,k*w/6,base-.5,front-.12,'railing',arm);
      }
    }
  }
  function railing(width,y,z,parent,key='railing') {
    for(const yy of [y,y+1.02])box(width,.13,.18,0,yy,z,key,parent);
    const count=Math.max(1,Math.floor(width/1.4));const bay=width/count;
    for(let i=0;i<=count;i++)box(.14,1.16,.18,-width/2+i*bay,y,z,key,parent);
    if(stage>=2)for(let i=0;i<count;i++) {
      const x=-width/2+(i+.5)*bay;
      box(bay*.7,.1,.12,x,y+.48,z,key,parent);
      for(const side of [-1,1]) {
        box(.09,.5,.12,x+side*bay*.28,y+.25,z,key,parent);
        box(bay*.23,.09,.12,x+side*bay*.18,y+.24,z,key,parent);
        box(.09,.3,.12,x+side*bay*.07,y+.58,z,key,parent);
      }
    }
  }
  const foundation=group('foundation');
  box(46,1,46,0,0,0,'stone',foundation);box(42,1.2,42,0,1,0,'stone',foundation);
  for(let side=0;side<4;side++) {
    const stair=group('entrance-stairs-'+side,foundation);stair.rotation.y=side*Math.PI/2;
    for(let i=0;i<11;i++)box(9,.2*(i+1),1,0,0,27-i*.6,'stone',stair);
    if(stage>=2)for(const sign of [-1,1])for(let i=0;i<11;i++) {
      box(.23,.8,.25,sign*4.65,i*.2,27-i*.6,'stone',stair);
      box(.32,.13,.7,sign*4.65,.75+i*.2,27-i*.6,'stone',stair);
    }
    const face=group('terrace-balustrade-'+side,foundation);face.rotation.y=side*Math.PI/2;
    for(const sign of [-1,1]){const rail=group('terrace-rail-'+sign,face);rail.position.x=sign*13;railing(14,2.2,20.5,rail,'stone');}
  }
  const storeys=group('storeys'),roofs=group('roof-assembly');
  TOWER_SPEC.floors.forEach(({half:a,y,h},idx)=>{
    const level=group('storey-'+(idx+1),storeys);
    prism(a,.38,y,'wood',level,'gallery-floor');prism(a*.7,h-.55,y+.38,'dark',level,'inner-core');
    const points=clipped(a-.2),seen=new Set();
    points.forEach((p,j)=>{
      const q=points[(j+1)%8],len=Math.hypot(q[0]-p[0],q[1]-p[1]),bays=j%2===0?4:1;
      for(let k=0;k<=bays;k++) {
        const t=k/bays,x=p[0]+(q[0]-p[0])*t,z=p[1]+(q[1]-p[1])*t,key=x.toFixed(3)+':'+z.toFixed(3);
        if(seen.has(key))continue;seen.add(key);column(idx===0?.35:.27,h-.4,x,y+.38,z,level);
        if(stage>=2) {
          box(.75,.22,.85,x,y+h-.8,z,'wood',level);box(1.25,.18,1.05,x,y+h-.55,z,'railing',level);
          box(.9,.18,1.55,x,y+h-1,z,'wood',level);
        }
      }
      const face=faceGroup(p,q,y,level,'gallery-face-'+j);
      if(idx>0)railing(len,.38,0,face);
      box(len,.4,.5,0,h-.5,0,'wood',face);
      if(stage>=2)box(len-.3,.14,.04,0,h-.37,.28,'paint',face);
      const inner=group('core-facade-'+j,face);inner.position.z=-a*.28;
      const count=j%2===0?5:1,w=len/count;
      for(let k=0;k<count;k++) {
        const x=-len/2+(k+.5)*w;
        box(w*.8,Math.min(h*.56,4.2),.2,x,1.5,0,'wood',inner);
        box(w*.67,Math.min(h*.5,3.7),.24,x,1.7,.14,'dark',inner);
        if(stage>=2)for(let f=-2;f<=2;f++)box(.07,Math.min(h*.5,3.7),.06,x+f*w*.12,1.7,.29,'railing',inner);
      }
    });
    const roofGroup=group('roof-'+(idx+1),roofs);roofGroup.userData.primaryRoof=true;
    roof(a+3.1,idx===4?0:(a+3.1)*.59,y+h-.65,idx===4?7:3.15,roofGroup,idx===4);
  });
  const finial=group('finial',roofs);
  const profile=[[0,0],[1.65,.15],[1.25,.45],[.75,.65],[1.13,1.35],[1.04,1.9],[.46,2.35],[.73,2.75],[.63,3.25],[.25,3.7],[.19,4.2],[0,4.25]];
  const cap=mesh(new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),24),'ceramic',finial,'gourd-profile');cap.position.y=46.35;
  const bead=mesh(new THREE.SphereGeometry(.27,16,10),'red',finial,'red-finial-bead');bead.position.y=50.83;
  const rod=mesh(new THREE.CylinderGeometry(.04,.04,.4,8),'tileShade',finial,'finial-rod');rod.position.y=51.2;
  if(stage>=2) {
    const entry=group('entry-canopy');entry.position.z=15.7;
    roof(6,2.3,6.9,2.2,entry);for(const x of [-4.7,4.7])column(.32,6.9,x,2.2,5.7,entry);
    if(typeof document!=='undefined')for(const [side,label]of[[0,'黄鹤楼'],[Math.PI,'楚天极目']]) {
      const c=document.createElement('canvas');c.width=768;c.height=256;const ctx=c.getContext('2d');ctx.fillStyle='#24211c';ctx.fillRect(0,0,768,256);ctx.strokeStyle='#c69b49';ctx.lineWidth=14;ctx.strokeRect(10,10,748,236);ctx.fillStyle='#d9b05a';ctx.font='bold 166px KaiTi, STKaiti, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,384,136,690);
      const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const m=new THREE.MeshStandardMaterial({map:t,roughness:.82});
      const sign=new THREE.Mesh(new THREE.BoxGeometry(5.6,2.5,.25),m);sign.name='plaque-'+label;sign.position.set(0,39.5,Math.cos(side)*13.35);sign.rotation.y=side;root.add(sign);
    }
  }
  // 将同一楼层内不同局部朝向的柱梁合为实例批次，保留语义楼层。
  root.updateMatrixWorld(true);
  const batches=new Map();
  function assembly(parent){let node=parent;while(node.parent&&node.parent!==root&&!/^storey-\d+$|^roof-\d+$/.test(node.name))node=node.parent;return node;}
  for(const b of inst.values()){
    const parent=assembly(b.parent),key=parent.uuid+':'+b.key+':'+b.geo.uuid;
    let batch=batches.get(key);if(!batch)batches.set(key,batch={...b,parent,matrices:[]});
    const local=new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(b.parent.matrixWorld);
    for(const matrix of b.matrices)batch.matrices.push(local.clone().multiply(matrix));
  }
  for(const b of batches.values()) {
    const m=new THREE.InstancedMesh(b.geo,materials[b.key],b.matrices.length);m.name=b.parent.name+'-'+b.key+'-instances';b.matrices.forEach((v,i)=>m.setMatrixAt(i,v));m.castShadow=m.receiveShadow=true;b.parent.add(m);
  }
  for(const b of surfaces.values()) {
    const arrays={position:[],normal:[],uv:[]};
    for(const g0 of b.geos){const g=g0.index?g0.toNonIndexed():g0;for(const key of Object.keys(arrays)){const a=g.attributes[key];if(a)arrays[key].push(a.array);} }
    const geo=new THREE.BufferGeometry();for(const [key,list]of Object.entries(arrays)){const out=new Float32Array(list.reduce((n,a)=>n+a.length,0));let offset=0;for(const a of list){out.set(a,offset);offset+=a.length;}geo.setAttribute(key,new THREE.BufferAttribute(out,key==='uv'?2:3));}
    mesh(geo,b.key,b.parent,b.parent.name+'-'+b.key+'-surfaces');
  }
  root.updateMatrixWorld(true);root.userData.primaryRoofCount=5;root.userData.cardinalGables=20;
  return root;
}
