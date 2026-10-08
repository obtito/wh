// 无人机模式:六向自由飞行 + 鼠标转向
import * as THREE from 'three';
import { clamp } from './geo.js';
import { groundY } from './ground.js';
import { worldCollision } from './collision.js';

export class FlyCam {
  constructor(camera) {
    this.yaw = camera.rotation.y;
    this.pitch = clamp(camera.rotation.x, -1.2, 1.2);
  }

  update(dt, input, camera) {
    const boost = input.boost ? 4 : 1;
    const speed = 42 * boost;
    // 视线方向移动
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = camera.position;
    if (input.fwd) p.addScaledVector(dir, speed * dt);
    if (input.back) p.addScaledVector(dir, -speed * dt);
    if (input.left) p.addScaledVector(right, -speed * dt);
    if (input.right) p.addScaledVector(right, speed * dt);
    if (input.up) p.y += speed * 0.7 * dt;
    if (input.down) p.y -= speed * 0.7 * dt;
    // 不穿楼:机身 3 m 半径推出(楼顶低于当前高度时自然放行)
    if (worldCollision.ready) {
      worldCollision.resolve(p.x, p.z, 3, p.y, _res);
      p.x = _res.x; p.z = _res.z;
    }
    // 最低不穿地(带高度上下文:桥下飞行不会被桥面走廊抬升)
    const gy = groundY(p.x, p.z, p.y) + 2;
    if (p.y < gy) p.y = gy;
    p.y = clamp(p.y, 2, 2500);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(this.yaw);
    camera.rotateX(this.pitch);
  }

  /** 鼠标拖转(dyaw/dpitch 弧度) */
  look(dyaw, dpitch) {
    this.yaw -= dyaw;
    this.pitch = clamp(this.pitch - dpitch, -1.35, 1.35);
  }
}

const _res = { x: 0, z: 0, hit: false };
