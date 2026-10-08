// 几何真值平面图:把 data.js 的水系/山体/道路/地标投到 PNG,肉眼校验城市骨架
// 用法: node tools/mapplot.mjs [输出.png]
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { toV2, toV2List, distToPolyline } from '../js/geo.js';
import { RIVER, LAKES, MOUNTAINS, ROADS, BRIDGES, LANDMARKS, DISTRICTS } from '../js/data.js';

/* ---------- 极简 PNG 编码(RGBA8,无滤波) ---------- */
function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                 // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 画布 ---------- */
const W = 2600, H = 2100;
const EX = 15500, EZ = 12500;               // 场景范围 ±15.5 km / ±12.5 km
const img = Buffer.alloc(W * H * 4);
const px = (x, z, r, g, b, a = 255) => {
  const cx = Math.round((x / (EX * 2) + 0.5) * (W - 1));
  const cy = Math.round((z / (EZ * 2) + 0.5) * (H - 1));
  const rb = 6, re = 3;                     // 半径 6 模糊边 + 3 实心
  for (let dy = -rb; dy <= rb; dy++) for (let dx = -rb; dx <= rb; dx++) {
    const X = cx + dx, Y = cy + dy;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const d = Math.hypot(dx, dy);
    if (d > rb) continue;
    const wgt = d < re ? 1 : 1 - (d - re) / (rb - re);
    const i = (Y * W + X) * 4;
    img[i] = Math.round(img[i] * (1 - wgt) + r * wgt);
    img[i + 1] = Math.round(img[i + 1] * (1 - wgt) + g * wgt);
    img[i + 2] = Math.round(img[i + 2] * (1 - wgt) + b * wgt);
    img[i + 3] = 255;
  }
};
const line = (pts, r, g, b, a = 255) => {
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 6) + 1;
    for (let k = 0; k <= n; k++) px(ax + (bx - ax) * k / n, az + (bz - az) * k / n, r, g, b, a);
  }
};

// 底色
img.fill(0);
for (let i = 0; i < W * H; i++) { img[i * 4] = 26; img[i * 4 + 1] = 32; img[i * 4 + 2] = 40; img[i * 4 + 3] = 255; }

// 分区
for (const d of DISTRICTS) {
  const poly = toV2List(d.poly);
  line([...poly, poly[0]], 52, 60, 52, 255);
}

// 山体(绿色圆)
for (const m of MOUNTAINS) {
  const [x, z] = toV2(m.lon, m.lat);
  for (let t = 0; t < Math.PI * 2; t += 0.02) {
    const c = Math.cos(t * 0 + t), s = Math.sin(t);
    // 旋转椭圆
    const rot = (m.rot || 0) * Math.PI / 180;
    const ex0 = Math.cos(t) * m.rx, ez0 = Math.sin(t) * m.rz;
    px(x + ex0 * Math.cos(rot) - ez0 * Math.sin(rot), z + ex0 * Math.sin(rot) + ez0 * Math.cos(rot), 58, 92, 56);
  }
  px(x, z, 110, 160, 100);
}

// 水系
line(toV2List(RIVER.pts), 90, 150, 210);
for (const br of RIVER.branches) line(toV2List(br.pts), 90, 150, 210);
for (const lk of LAKES) {
  const poly = toV2List(lk.pts);
  line([...poly, poly[0]], 110, 170, 220);
}

// 道路
for (const r of ROADS) line(toV2List(r.pts), r.major ? 220 : 150, r.major ? 200 : 140, r.major ? 120 : 110);

// 桥(橙色)
for (const br of BRIDGES) line(toV2List(br.axis), 255, 130, 40);

// 地标(金点 + 名字无法画,输出坐标表)
const marks = [];
for (const lm of LANDMARKS) {
  const [x, z] = toV2(lm.lon, lm.lat);
  px(x, z, 255, 205, 80);
  marks.push(`${lm.name.padEnd(8, '　')} x=${Math.round(x).toString().padStart(6)} z=${Math.round(z).toString().padStart(6)} 距长江${Math.round(distToPolyline(x, z, toV2List(RIVER.pts)))}m`);
}
for (const br of BRIDGES) {
  const mid = [(br.axis[0][0] + br.axis[1][0]) / 2, (br.axis[0][1] + br.axis[1][1]) / 2];
  const [x, z] = toV2(...mid);
  px(x, z, 255, 130, 40);
  marks.push(`${br.name.padEnd(8, '　')} x=${Math.round(x).toString().padStart(6)} z=${Math.round(z).toString().padStart(6)}`);
}

const out = process.argv[2] || 'docs/mapplot.png';
writeFileSync(out, encodePNG(W, H, img));
console.log(`平面真值图 → ${out} (${W}×${H})`);
console.log(marks.join('\n'));
