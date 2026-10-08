// 碰撞网格:建筑占地 OBB(有向包围盒)的空间哈希 —— 车辆/行人/相机/无人机共用
// 治"车穿楼 / 人穿墙 / 相机进屋 / 树穿楼"这类穿模。
//
// 数据布局:每栋 7 个 float —— cx, cz, hx, hz, cosθ, sinθ, topY
// 旋转约定与 three 的 rotation.y 严格一致:
//     world = [[cosθ, sinθ], [-sinθ, cosθ]] · local
// 即 local(1,0) 在 θ=90° 时落到 world(0,-1)(+X → -Z),与 three 的 Ry(θ) 相同。
// 判定带竖向上下文:盒顶面 topY 低于实体足下 1.2 m 时不阻挡(车在桥上/楼顶不受影响)。

const STRIDE = 7;

export class CollisionGrid {
  constructor(cell = 28) {
    this.cell = cell;
    this._buf = [];          // 构建期普通数组(避免多次扩容 typed array)
    this.n = 0;
    this.ready = false;
    this.B = null;
  }

  /** 追加一个 OBB(cx,cz 中心;hx,hz 半尺寸;c,s 为 cosθ/sinθ;top 顶面标高) */
  addOBB(cx, cz, hx, hz, c, s, top) {
    this._buf.push(cx, cz, hx, hz, c, s, top);
    this.n++;
    this.ready = false;
  }

  /** 追加旋转矩形(x,z 中心;w,d 全尺寸;rot = three 的 rotation.y;top 顶面标高) */
  addRect(x, z, w, d, rot, top) {
    this.addOBB(x, z, w / 2, d / 2, Math.cos(rot), Math.sin(rot), top);
  }

  /** 追加圆形占地(用内接方形近似,略保守) */
  addCircle(x, z, r, top) {
    this.addOBB(x, z, r, r, 1, 0, top);
  }

  /** 批量追加烘焙好的 stride=7 float 数组 */
  addRaw(arr) {
    if (!arr || !arr.length) return this;
    for (let i = 0; i < arr.length; i++) this._buf.push(arr[i]);
    this.n += arr.length / STRIDE;
    this.ready = false;
    return this;
  }

  /** 计数排序建格:两遍扫描,零 Map/GC 压力,11 万栋 < 100 ms */
  build() {
    const N = this.n;
    this.B = new Float32Array(this._buf);
    this._buf = null;
    if (!N) { this.ready = true; return this; }

    const cell = this.cell;
    const B = this.B;
    const ext = new Float32Array(N * 2);
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) {
      const o = i * STRIDE;
      const hx = B[o + 2], hz = B[o + 3], c = B[o + 4], s = B[o + 5];
      const ex = Math.abs(hx * c) + Math.abs(hz * s);
      const ez = Math.abs(hx * s) + Math.abs(hz * c);
      ext[i * 2] = ex; ext[i * 2 + 1] = ez;
      const x = B[o], z = B[o + 1];
      if (x - ex < minX) minX = x - ex;
      if (x + ex > maxX) maxX = x + ex;
      if (z - ez < minZ) minZ = z - ez;
      if (z + ez > maxZ) maxZ = z + ez;
    }
    minX -= 4; minZ -= 4; maxX += 4; maxZ += 4;
    this.minX = minX; this.minZ = minZ;
    const nx = this.nx = Math.max(1, Math.ceil((maxX - minX) / cell));
    const nz = this.nz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
    const nc = nx * nz;

    const starts = new Int32Array(nc + 1);
    const c0 = new Int32Array(N), c1 = new Int32Array(N), r0 = new Int32Array(N), r1 = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const o = i * STRIDE;
      const x = B[o], z = B[o + 1], ex = ext[i * 2], ez = ext[i * 2 + 1];
      const a = Math.min(nx - 1, Math.max(0, ((x - ex - minX) / cell) | 0));
      const b = Math.min(nx - 1, Math.max(0, ((x + ex - minX) / cell) | 0));
      const a2 = Math.min(nz - 1, Math.max(0, ((z - ez - minZ) / cell) | 0));
      const b2 = Math.min(nz - 1, Math.max(0, ((z + ez - minZ) / cell) | 0));
      c0[i] = a; c1[i] = b; r0[i] = a2; r1[i] = b2;
      for (let ix = a; ix <= b; ix++) {
        const base = ix * nz;
        for (let iz = a2; iz <= b2; iz++) starts[base + iz + 1]++;
      }
    }
    let acc = 0;
    for (let k = 0; k < nc; k++) { const v = starts[k + 1]; starts[k] = acc; acc += v; }
    starts[nc] = acc;

    const items = new Int32Array(acc);
    const cur = new Int32Array(nc);
    for (let k = 0; k < nc; k++) cur[k] = starts[k];
    for (let i = 0; i < N; i++) {
      for (let ix = c0[i]; ix <= c1[i]; ix++) {
        const base = ix * nz;
        for (let iz = r0[i]; iz <= r1[i]; iz++) items[cur[base + iz]++] = i;
      }
    }
    this.starts = starts;
    this.items = items;
    this.mark = new Int32Array(N);
    this.gen = 0;
    this.ready = true;
    return this;
  }

  /**
   * 圆 vs OBB 推出:把半径 r 的圆推出所有侵占它的盒
   * @returns {hit, x, z} 修正后的位置
   */
  resolve(x0, z0, r, y, out) {
    out.hit = false; out.x = x0; out.z = z0;
    if (!this.ready || !this.n) return out;
    const B = this.B, cell = this.cell, nx = this.nx, nz = this.nz;
    const starts = this.starts, items = this.items, mark = this.mark;
    let x = x0, z = z0;

    for (let iter = 0; iter < 2; iter++) {
      const ix = ((x - this.minX) / cell) | 0;
      const iz = ((z - this.minZ) / cell) | 0;
      if (ix < -1 || ix > nx || iz < -1 || iz > nz) break;
      const g = ++this.gen;
      let sx = 0, sz = 0, any = false;
      const ax = Math.max(0, ix - 1), bx = Math.min(nx - 1, ix + 1);
      const az = Math.max(0, iz - 1), bz = Math.min(nz - 1, iz + 1);
      for (let a = ax; a <= bx; a++) {
        const base = a * nz;
        for (let b = az; b <= bz; b++) {
          const k = base + b;
          for (let p = starts[k], e = starts[k + 1]; p < e; p++) {
            const i = items[p];
            if (mark[i] === g) continue;
            mark[i] = g;
            const o = i * STRIDE;
            if (B[o + 6] <= y + 1.2) continue;             // 盒顶低于实体足下 → 不阻挡
            const cx = B[o], cz = B[o + 1], hx = B[o + 2], hz = B[o + 3], c = B[o + 4], s = B[o + 5];
            const px = x - cx, pz = z - cz;
            const lx = px * c - pz * s;                    // world → local
            const lz = px * s + pz * c;
            const qx = lx < -hx ? -hx : lx > hx ? hx : lx;
            const qz = lz < -hz ? -hz : lz > hz ? hz : lz;
            let dx = lx - qx, dz = lz - qz;
            const d2 = dx * dx + dz * dz;
            if (d2 > r * r) continue;
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2), push = r - d;
              dx = (dx / d) * push; dz = (dz / d) * push;
            } else {
              // 圆心已在盒内:沿最小穿透轴弹出
              const ox = hx - Math.abs(lx), oz = hz - Math.abs(lz);
              if (ox <= oz) { dx = (lx >= 0 ? 1 : -1) * (ox + r); dz = 0; }
              else { dx = 0; dz = (lz >= 0 ? 1 : -1) * (oz + r); }
            }
            sx += dx * c + dz * s;                         // local → world
            sz += -dx * s + dz * c;
            any = true;
          }
        }
      }
      if (!any) break;
      x += sx; z += sz;
      out.hit = true;
    }
    out.x = x; out.z = z;
    return out;
  }

  /** 点是否"净空"(pad 为额外安全边距) */
  free(x, z, y, pad = 0) {
    if (!this.ready || !this.n) return true;
    const out = _tmp;
    this.resolve(x, z, pad, y, out);
    return !out.hit;
  }

  /**
   * 从 (x0,z0) 向 (x1,z1) 步进,返回最后一个净空点(相机防穿墙用)
   * 假设起点净空;一旦撞墙就在撞墙前停下,相机自然贴近目标而非进屋。
   */
  freePath(x0, z0, x1, z1, y, pad, out) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.min(24, Math.ceil(len / 2.5)));
    let lx = x0, lz = z0, hit = false;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t, pz = z0 + dz * t;
      if (this.free(px, pz, y, pad)) { lx = px; lz = pz; }
      else { hit = true; break; }
    }
    out.x = lx; out.z = lz; out.hit = hit;
    return out;
  }
}

const _tmp = { x: 0, z: 0, hit: false };

/** 单例:全场景共用一张建筑占地网格 */
export const worldCollision = new CollisionGrid(28);
