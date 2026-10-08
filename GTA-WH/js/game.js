// 玩法状态机:观察 / 驾驶 / 步行 / 无人机 模式切换 + 输入 + 打卡调度
import * as THREE from 'three';
import { toV2 } from './geo.js';
import { Vehicle } from './vehicle.js';
import { Player } from './player.js';
import { FlyCam } from './flycam.js';
import { groundY } from './ground.js';

export const MODE_NAME = { orbit: '观察模式', drive: '驾驶模式', walk: '步行模式', fly: '无人机模式' };

export class Game {
  constructor(scene, camera, hud) {
    this.scene = scene;
    this.camera = camera;
    this.hud = hud;
    this.mode = 'orbit';

    // 出生点:江汉关旁沿江大道(车头朝东北)
    const [sx, sz] = toV2(114.2830, 30.5760);
    this.vehicle = new Vehicle(scene, sx, sz, 0.65);
    this.player = new Player(scene, sx + 12, sz + 8, 0.65);
    this.player.mesh.visible = false;
    this.fly = new FlyCam(camera);

    // 输入
    this.keys = {};
    this.camYaw = 0.65;
    this.camPitch = 0.12;
    this.dragging = false;
    this.checkTimer = 0;
    this._bindInput();
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (k === '1') this.setMode('orbit');
      if (k === '2') this.enterCar();
      if (k === '3') this.setMode('fly');
      if (k === 'f') this.toggleCar();
      if (k === 'm') this.hud?.toggleZoom();
      if (k === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    // 切窗/失焦清空按键:否则切走时按住的键在回来后卡死
    window.addEventListener('blur', () => { this.keys = {}; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys = {}; });
    // 鼠标:观察/步行/无人机视角转(拖拽)
    const cv = this.camera.domElement ?? document.querySelector('#scene');
    cv.addEventListener('pointerdown', (e) => { this.dragging = true; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.movementX * 0.0042, dy = e.movementY * 0.0036;
      if (this.mode === 'fly') this.fly.look(dx, dy);
      else if (this.mode !== 'drive') {
        this.camYaw -= dx;
        this.camPitch = Math.max(-0.5, Math.min(0.9, this.camPitch + dy));
      }
    });
  }

  setMode(m, silent = false) {
    if (this.mode === m) return;
    // 退出旧模式
    if (this.mode === 'walk') this.player.mesh.visible = false;
    this.mode = m;
    if (m === 'walk') {
      // 从车旁下车
      const v = this.vehicle.mesh.position;
      this.player.mesh.position.set(v.x + Math.cos(this.vehicle.heading) * 4, Math.max(groundY(v.x, v.z), 0.5), v.z - Math.sin(this.vehicle.heading) * 4);
      this.player.mesh.visible = true;
      this.camYaw = this.vehicle.heading;
    }
    if (m === 'fly') {
      // 从当前相机朝向接管无人机视角,避免瞬移回开场方向
      const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.fly.yaw = e.y;
      this.fly.pitch = Math.max(-1.2, Math.min(1.2, e.x));
    }
    if (!silent) this.hud?.modeTip(`${MODE_NAME[m]}${m === 'drive' ? ' · WASD 驾驶' : m === 'walk' ? ' · WASD 行走' : m === 'fly' ? ' · WASD+QE 飞行' : ' · 拖拽环视'}`);
  }

  enterCar() { this.setMode('drive'); }
  toggleCar() {
    if (this.mode === 'drive') this.setMode('walk');
    else if (this.mode === 'walk') {
      const v = this.vehicle.mesh.position;
      const p = this.player.mesh.position;
      if (Math.hypot(p.x - v.x, p.z - v.z) < 10) this.setMode('drive');
      else this.hud?.modeTip('🚗 附近没有车辆');
    } else this.setMode('drive');
  }

  input() {
    const k = this.keys;
    return {
      throttle: (k['w'] ? 1 : 0) + (k['s'] ? -1 : 0),
      steer: (k['a'] ? 1 : 0) + (k['d'] ? -1 : 0),
      brake: !!k[' '],
      drift: !!k[' '],          // 手刹漂移(Space);Shift 只做加速,两者解耦
      boost: !!k['shift'],
      jump: !!k[' '],
      fwd: !!k['w'], back: !!k['s'], left: !!k['a'], right: !!k['d'],
      up: !!k['q'], down: !!k['e'],
    };
  }

  update(dt, nightK, controls) {
    const inp = this.input();

    if (this.mode === 'orbit') {
      controls.enabled = true;
      controls.update();
    } else {
      controls.enabled = false;
    }

    if (this.mode === 'drive') {
      const spd = this.vehicle.update(dt, inp, nightK);
      this.player.mesh.visible = false;
      this.vehicle.applyCamera(this.camera, dt);
      this.camYaw = this.vehicle.heading;
      this._pos = this.vehicle.mesh.position;
      this._heading = this.vehicle.heading;
    } else if (this.mode === 'walk') {
      this.player.update(dt, inp, this.camYaw, nightK);
      this.player.applyCamera(this.camera, dt, this.camYaw, this.camPitch);
      this._pos = this.player.mesh.position;
      this._heading = this.player.mesh.rotation.y;
    } else if (this.mode === 'fly') {
      this.fly.update(dt, inp, this.camera);
      this._pos = this.camera.position;
      this._heading = this.fly.yaw + Math.PI;   // yaw=朝向的水平角,地图北=-z:箭头角 = yaw+π 对齐 minimap 坐标系
    } else {
      this._pos = controls.target;
      this._heading = this.camYaw;
    }

    // 打卡(节流)
    this.checkTimer -= dt;
    if (this.checkTimer <= 0 && this._pos) {
      this.checkTimer = 0.3;
      this.hud?.checkVisit(this._pos.x, this._pos.z);
    }
  }

  get speedKmh() {
    return Math.abs(this.vehicle.speed) * 3.6;
  }
}
