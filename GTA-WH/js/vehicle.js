// 载具:街机车辆(加速/转向/漂移手感)+ 追尾相机 + 车体网格
import * as THREE from 'three';
import { clamp, lerp } from './geo.js';
import { groundY, isWater } from './ground.js';
import { bridgeHeightAt } from './bridges.js';
import { mat, put, UNIT, registerEnv } from './lib.js';
import { worldCollision } from './collision.js';

/* ---------- 车体(程序化小轿车) ---------- */
export function buildCarMesh(bodyColor = '#c9412e') {
  const g = new THREE.Group();
  const paint = mat(bodyColor, { rough: 0.28, metal: 0.5, env: 1.3 });
  const glass = mat('#20303a', { rough: 0.12, metal: 0.4, env: 1.5 });
  const dark = mat('#1c1e22', { rough: 0.7 });
  // 车身(前低后高的两段)
  put(g, UNIT.box, paint, { pos: [0, 0.55, 0], scale: [1.84, 0.62, 4.6] });         // 底盘体
  put(g, UNIT.box, paint, { pos: [0, 1.02, -0.25], scale: [1.7, 0.52, 2.5] });      // 座舱
  put(g, UNIT.box, glass, { pos: [0, 1.06, -0.25], scale: [1.56, 0.4, 2.2] });      // 玻璃舱
  put(g, UNIT.box, dark, { pos: [0, 0.5, 2.28], scale: [1.6, 0.34, 0.3] });         // 前杠
  put(g, UNIT.box, dark, { pos: [0, 0.5, -2.28], scale: [1.6, 0.34, 0.3] });        // 后杠
  // 车灯(夜间点亮)
  const headMat = mat('#fff4d8', { emissive: '#ffedb0', emissiveIntensity: 0.1 });
  headMat.userData.nightGlow = 3.2;
  const tailMat = mat('#7a1410', { emissive: '#c01808', emissiveIntensity: 0.1 });
  tailMat.userData.nightGlow = 2.6;
  for (const sx of [-0.62, 0.62]) {
    put(g, UNIT.box, headMat, { pos: [sx, 0.86, 2.31], scale: [0.42, 0.16, 0.06] });
    put(g, UNIT.box, tailMat, { pos: [sx, 0.86, -2.31], scale: [0.42, 0.16, 0.06] });
  }
  // 车轮
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14).rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.86, 1.45], [0.86, 1.45], [-0.86, -1.5], [0.86, -1.5]]) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(wx, 0.34, wz);
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.userData.headMat = headMat;
  g.userData.tailMat = tailMat;
  return g;
}

/* ---------- 车辆控制 ---------- */
export class Vehicle {
  constructor(scene, x, z, heading = 0) {
    // mesh 为常驻容器:先放程序化车占位,upgradeBody() 可异步换 GLB 车模
    this.mesh = new THREE.Group();
    this.body = buildCarMesh();
    this.mesh.add(this.body);
    this.mesh.position.set(x, groundY(x, z), z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.wheelSpin = 0;
    this.drift = 0;
    this.inWater = false;
    this.hasGLB = false;
  }

  /** 换装 GLB 车模(Kenney Car Kit CC0):归一化到 4.6 m 长、底面贴地 */
  async upgradeBody(loadGLB, url) {
    const g = await loadGLB(url);
    if (!g) return false;
    const box = new THREE.Box3().setFromObject(g);
    const len = Math.max(box.max.z - box.min.z, box.max.x - box.min.x, 0.01);
    g.scale.setScalar(4.6 / len);
    g.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(g);
    g.position.y -= b2.min.y;
    g.position.x -= (b2.max.x + b2.min.x) / 2;
    g.position.z -= (b2.max.z + b2.min.z) / 2;
    this.mesh.remove(this.body);
    this.body = g;
    this.mesh.add(g);
    this.hasGLB = true;
    return true;
  }

  update(dt, input, nightK) {
    const MAX = input.boost ? 52 : 36;          // m/s(约 130/187 km/h)
    const accel = input.boost ? 16 : 11;
    // 油门/刹车/倒车
    if (input.throttle > 0) this.speed += accel * input.throttle * dt;
    else if (input.throttle < 0) this.speed += input.throttle * (this.speed > 0.5 ? 22 : 7) * dt;
    if (input.brake) {
      const s = Math.sign(this.speed);
      this.speed -= s * Math.min(Math.abs(this.speed), 24 * dt);
    }
    // 阻力(系数使极速可逼近标称值)
    this.speed *= 1 - (0.12 + Math.abs(this.speed) * 0.0022) * dt;
    this.speed = clamp(this.speed, -12, MAX);

    // 转向:heading 增大 = 顺时针(朝南时 +x 东 = 左)→ A(steer=+1)左转 ✓
    const steerAuth = 2.6 / (1 + Math.abs(this.speed) * 0.045);
    const steerInput = input.steer * (input.drift ? 1.9 : 1);
    this.steer = lerp(this.steer, steerInput, 1 - Math.pow(0.0008, dt));
    this.heading += this.steer * steerAuth * dt * clamp(Math.abs(this.speed) / 4, 0, 1) * Math.sign(this.speed || 1);
    // 漂移侧滑(视觉朝向滞后)
    const targetDrift = input.drift ? this.steer * 0.5 : 0;
    this.drift = lerp(this.drift, targetDrift, 1 - Math.pow(0.001, dt));

    // 位移
    const dir = this.heading + this.drift * 0.6;
    const nx = this.mesh.position.x + Math.sin(dir) * this.speed * dt;
    const nz = this.mesh.position.z + Math.cos(dir) * this.speed * dt;

    // 水域:限速涉水(一次性限幅,不随帧率叠加锁死),可倒车退回岸上
    this.inWater = isWater(nx, nz, this.mesh.position.y);
    if (this.inWater) this.speed = clamp(this.speed, -3, 3);

    // 建筑碰撞:车头/车尾两个圆(半径 1.15 m)推出,撞墙掉速 —— 治"车穿楼"
    if (worldCollision.ready) {
      const cy = this.mesh.position.y;
      const dirx = Math.sin(dir), dirz = Math.cos(dir);
      let px = 0, pz = 0, hit = false;
      for (const off of [1.25, -1.25]) {
        const ox = nx + dirx * off, oz = nz + dirz * off;
        worldCollision.resolve(ox, oz, 1.15, cy, _res);
        if (_res.hit) { px += _res.x - ox; pz += _res.z - oz; hit = true; }
      }
      if (hit) { nx += px; nz += pz; this.speed *= 0.55; }
    }

    const gy = groundY(nx, nz, this.mesh.position.y);
    this.mesh.position.set(nx, lerp(this.mesh.position.y, Math.max(gy, this.inWater ? 0.55 : gy), 1 - Math.pow(0.0001, dt)), nz);
    this.mesh.rotation.y = dir + this.drift * 0.9;
    // 车身侧倾(向外倾)+ 俯仰(手感)
    this.mesh.rotation.z = lerp(this.mesh.rotation.z, this.steer * clamp(Math.abs(this.speed) / 40, 0, 1) * 0.09, 1 - Math.pow(0.001, dt));
    this.mesh.rotation.x = lerp(this.mesh.rotation.x, clamp((this.speed - this.lastSpeed || 0) * 0.02, -0.06, 0.06), 0.1);
    this.lastSpeed = this.speed;

    // 车轮滚动(程序化车体才有独立轮子;GLB 车模轮子随模型静止)
    if (this.body.userData.wheels) {
      this.wheelSpin += this.speed * dt / 0.34;
      for (const w of this.body.userData.wheels) w.rotation.x = this.wheelSpin;
    }

    // 夜间车灯(GLB 车体无 emissive 车灯时,在车头/车尾追加两个发光小盒)
    const hm = this.body.userData.headMat, tm = this.body.userData.tailMat;
    if (hm && tm) {
      hm.emissiveIntensity = 0.1 + nightK * 3.2;
      tm.emissiveIntensity = 0.1 + nightK * 2.6;
    } else if (this.hasGLB && !this._glbLights) {
      this._glbLights = true;
      const mk = (z, color) => {
        const m2 = mat(color, { emissive: color, emissiveIntensity: 0.1 });
        m2.userData.nightGlow = 3.0;
        put(this.body, UNIT.box, m2, { pos: [0, 0.75, z], scale: [1.5, 0.14, 0.08] });
        return m2;
      };
      this._hm2 = mk(2.25, '#fff4d8');
      this._tm2 = mk(-2.25, '#c01808');
    }
    if (this._hm2) this._hm2.emissiveIntensity = 0.1 + nightK * 3.0;
    if (this._tm2) this._tm2.emissiveIntensity = 0.1 + nightK * 2.4;

    return this.speed;
  }

  /** 追尾相机(复用临时向量,避免每帧 GC) */
  applyCamera(camera, dt) {
    const back = 9 + Math.abs(this.speed) * 0.14;
    const cx = this.mesh.position.x - Math.sin(this.heading) * back;
    const cz = this.mesh.position.z - Math.cos(this.heading) * back;
    const cy = this.mesh.position.y + 3.6 + Math.abs(this.speed) * 0.02;
    const k = 1 - Math.pow(0.0005, dt);
    _v1.set(cx, cy, cz);
    camera.position.lerp(_v1, k);
    // 相机不进楼:自车身向机位步进,撞墙即在墙前收住(不穿墙、不丢目标)
    if (worldCollision.ready) {
      worldCollision.freePath(
        this.mesh.position.x, this.mesh.position.z,
        camera.position.x, camera.position.z,
        camera.position.y, 1.2, _res,
      );
      if (_res.hit) { camera.position.x = _res.x; camera.position.z = _res.z; }
    }
    // 相机不穿地/不穿桥面
    const camGround = groundY(camera.position.x, camera.position.z, camera.position.y);
    if (camera.position.y < camGround + 1.6) camera.position.y = camGround + 1.6;
    const lx = this.mesh.position.x + Math.sin(this.heading) * 10;
    const lz = this.mesh.position.z + Math.cos(this.heading) * 10;
    camera.lookAt(lx, this.mesh.position.y + 1.6, lz);
  }
}

const _v1 = new THREE.Vector3();
const _res = { x: 0, z: 0, hit: false };
