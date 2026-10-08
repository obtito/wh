// 步行模式:第三人称小人 + WASD 相对相机移动 + 跳跃/涉水
import * as THREE from 'three';
import { clamp, lerp } from './geo.js';
import { groundY, isWater } from './ground.js';
import { mat, put, UNIT } from './lib.js';
import { worldCollision } from './collision.js';

/** 程序化小人(胶囊 + 头 + 四肢摆动) */
function buildAvatar() {
  const g = new THREE.Group();
  const cloth = mat('#3a5a8c', { rough: 0.8 });
  const skin = mat('#d8a882', { rough: 0.9 });
  const pants = mat('#2c3038', { rough: 0.9 });
  put(g, UNIT.cyl, pants, { pos: [0, 0.0, 0], scale: [0.36, 0.85, 0.30] });            // 腿(整体近似)
  put(g, UNIT.box, cloth, { pos: [0, 0.85, 0], scale: [0.46, 0.62, 0.28] });           // 上身
  put(g, UNIT.sphere, skin, { pos: [0, 1.62, 0], scale: [0.24, 0.28, 0.24] });         // 头
  // 手臂(前后摆)
  const armL = put(g, UNIT.box, cloth, { pos: [-0.30, 0.95, 0], scale: [0.11, 0.52, 0.11] });
  const armR = put(g, UNIT.box, cloth, { pos: [0.30, 0.95, 0], scale: [0.11, 0.52, 0.11] });
  // 腿(两截,摆动)
  const legL = put(g, UNIT.box, pants, { pos: [-0.11, 0.42, 0], scale: [0.13, 0.44, 0.13] });
  const legR = put(g, UNIT.box, pants, { pos: [0.11, 0.42, 0], scale: [0.13, 0.44, 0.13] });
  g.userData.limbs = { armL, armR, legL, legR };
  return g;
}

export class Player {
  constructor(scene, x, z, heading = 0) {
    this.mesh = buildAvatar();
    this.mesh.position.set(x, groundY(x, z), z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.heading = heading;
    this.vy = 0;
    this.phase = 0;
    this.swimming = false;
  }

  update(dt, input, camYaw, nightK) {
    // 相对相机方向的移动
    let mx = 0, mz = 0;
    if (input.fwd) { mx += Math.sin(camYaw); mz += Math.cos(camYaw); }
    if (input.back) { mx -= Math.sin(camYaw); mz -= Math.cos(camYaw); }
    if (input.left) { mx += Math.cos(camYaw); mz -= Math.sin(camYaw); }
    if (input.right) { mx -= Math.cos(camYaw); mz += Math.sin(camYaw); }
    const moving = mx !== 0 || mz !== 0;
    const speed = this.swimming ? 2.6 : (input.boost ? 8.5 : 4.2);

    let nx = this.mesh.position.x, nz = this.mesh.position.z;
    if (moving) {
      const len = Math.hypot(mx, mz);
      nx += (mx / len) * speed * dt;
      nz += (mz / len) * speed * dt;
      this.heading = Math.atan2(mx, mz);
    }

    // 建筑碰撞:半径 0.55 m 的圆推出墙体(治"人穿墙")
    if (worldCollision.ready) {
      worldCollision.resolve(nx, nz, 0.55, this.mesh.position.y, _res);
      nx = _res.x; nz = _res.z;
    }

    // 水域:游泳(贴水面;桥面上下文用当前身高判定)
    this.swimming = isWater(nx, nz, this.mesh.position.y);
    const gy = groundY(nx, nz, this.mesh.position.y);
    const floor = this.swimming ? 0.9 : gy;

    // 跳跃/重力(着地判定用容差,下坡沿面 vy 会被即时清零,不会累积导致跳不起来)
    const grounded = this.mesh.position.y <= floor + 0.12 && this.vy <= 0;
    if (input.jump && grounded && !this.swimming) this.vy = 5.2;
    this.vy -= 14 * dt;
    let y = this.mesh.position.y + this.vy * dt;
    if (y <= floor) { y = floor; this.vy = 0; }

    this.mesh.position.set(nx, y, nz);
    // 朝向平滑
    let dh = this.heading - this.mesh.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.mesh.rotation.y += dh * Math.min(1, dt * 12);

    // 四肢摆动
    this.phase += dt * (moving ? (input.boost ? 13 : 8) : 0);
    const sw = moving ? Math.sin(this.phase) * 0.6 : 0;
    const L = this.mesh.userData.limbs;
    L.armL.rotation.x = sw;
    L.armR.rotation.x = -sw;
    L.legL.rotation.x = -sw * 0.9;
    L.legR.rotation.x = sw * 0.9;

    return { moving, speed };
  }

  /** 第三人称跟随相机(俯仰控制视线高度,复用临时向量,防穿地) */
  applyCamera(camera, dt, camYaw, camPitch) {
    const dist = 7.5 - camPitch * 2.5;
    const cx = this.mesh.position.x - Math.sin(camYaw) * dist;
    const cz = this.mesh.position.z - Math.cos(camYaw) * dist;
    const cy = this.mesh.position.y + 3.0;
    const k = 1 - Math.pow(0.0003, dt);
    _v1.set(cx, cy, cz);
    camera.position.lerp(_v1, k);
    // 相机不进楼:自身体向机位步进,撞墙即在墙前收住
    if (worldCollision.ready) {
      worldCollision.freePath(
        this.mesh.position.x, this.mesh.position.z,
        camera.position.x, camera.position.z,
        camera.position.y, 1.0, _res,
      );
      if (_res.hit) { camera.position.x = _res.x; camera.position.z = _res.z; }
    }
    const camGround = groundY(camera.position.x, camera.position.z, camera.position.y);
    if (camera.position.y < camGround + 1.2) camera.position.y = camGround + 1.2;
    // 视线随俯仰抬升/下压(负=俯视)
    camera.lookAt(
      this.mesh.position.x,
      this.mesh.position.y + 1.5 + camPitch * 6,
      this.mesh.position.z,
    );
  }
}

const _v1 = new THREE.Vector3();
const _res = { x: 0, z: 0, hit: false };
