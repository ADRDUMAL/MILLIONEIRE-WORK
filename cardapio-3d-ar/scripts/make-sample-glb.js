// Gera samples/prato-exemplo.glb: um prato (disco) com uma "porção" (calota) por cima, 1 m de largura.
// Serve para testar upload manual, calibração de escala, 3D e AR sem depender de gerador externo.
import fs from 'node:fs';
import path from 'node:path';
import { serializeGlb } from '../src/lib/glb.js';

function disk({ radius, y0, y1, segments, color }) {
  const pos = [], nrm = [], idx = [];
  const ring = (y, ny) => { const start = pos.length / 3; for (let i = 0; i < segments; i++) { const a = (i / segments) * Math.PI * 2; pos.push(Math.cos(a) * radius, y, Math.sin(a) * radius); nrm.push(0, ny, 0); } return start; };
  const cTop = pos.length / 3; pos.push(0, y1, 0); nrm.push(0, 1, 0);
  const top = ring(y1, 1);
  const cBot = pos.length / 3; pos.push(0, y0, 0); nrm.push(0, -1, 0);
  const bot = ring(y0, -1);
  const sideT = pos.length / 3; for (let i = 0; i < segments; i++) { const a = (i / segments) * Math.PI * 2; pos.push(Math.cos(a) * radius, y1, Math.sin(a) * radius); nrm.push(Math.cos(a), 0, Math.sin(a)); }
  const sideB = pos.length / 3; for (let i = 0; i < segments; i++) { const a = (i / segments) * Math.PI * 2; pos.push(Math.cos(a) * radius, y0, Math.sin(a) * radius); nrm.push(Math.cos(a), 0, Math.sin(a)); }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(cTop, top + j, top + i);
    idx.push(cBot, bot + i, bot + j);
    idx.push(sideT + i, sideT + j, sideB + i, sideB + i, sideT + j, sideB + j);
  }
  return { pos, nrm, idx, color };
}
function dome({ radius, height, y0, segments, rings, color }) {
  const pos = [], nrm = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const t = (r / rings) * (Math.PI / 2);
    const rr = Math.cos(t) * radius, y = y0 + Math.sin(t) * height;
    for (let i = 0; i < segments; i++) { const a = (i / segments) * Math.PI * 2; pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr); const n = [Math.cos(a) * Math.cos(t), Math.sin(t) * (radius / height), Math.sin(a) * Math.cos(t)]; const l = Math.hypot(...n); nrm.push(n[0] / l, n[1] / l, n[2] / l); }
  }
  for (let r = 0; r < rings; r++) for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments, a = r * segments + i, b = r * segments + j, c = (r + 1) * segments + i, d = (r + 1) * segments + j;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, nrm, idx, color };
}

const parts = [
  disk({ radius: 0.5, y0: 0, y1: 0.02, segments: 48, color: [0.95, 0.95, 0.93, 1] }),
  dome({ radius: 0.32, height: 0.12, y0: 0.02, segments: 48, rings: 12, color: [0.55, 0.30, 0.12, 1] }),
];
const bufs = []; let offset = 0;
const bufferViews = [], accessors = [], primitives = [], materials = [];
const push = (arr, Ctor, target, type, componentType) => {
  let b = Buffer.from(new Ctor(arr).buffer);
  const pad = (4 - (b.length % 4)) % 4; if (pad) b = Buffer.concat([b, Buffer.alloc(pad)]);
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length, target });
  bufs.push(b); offset += b.length;
  const n = type === 'VEC3' ? 3 : 1; const acc = { bufferView: bufferViews.length - 1, componentType, count: arr.length / n, type };
  if (type === 'VEC3') { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); } acc.min = mn; acc.max = mx; }
  accessors.push(acc); return accessors.length - 1;
};
for (const p of parts) {
  const POSITION = push(p.pos, Float32Array, 34962, 'VEC3', 5126);
  const NORMAL = push(p.nrm, Float32Array, 34962, 'VEC3', 5126);
  const indices = push(p.idx, Uint16Array, 34963, 'SCALAR', 5123);
  materials.push({ pbrMetallicRoughness: { baseColorFactor: p.color, metallicFactor: 0, roughnessFactor: 0.7 } });
  primitives.push({ attributes: { POSITION, NORMAL }, indices, material: materials.length - 1 });
}
const bin = Buffer.concat(bufs);
const json = { asset: { version: '2.0', generator: 'cardapio-3d sample' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'prato' }], meshes: [{ primitives }], materials, accessors, bufferViews, buffers: [{ byteLength: bin.length }] };
const out = path.resolve('samples/prato-exemplo.glb');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, serializeGlb(json, bin));
console.log(`gravado ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} kB)`);
