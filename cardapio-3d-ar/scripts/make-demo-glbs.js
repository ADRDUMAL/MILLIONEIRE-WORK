// Gera samples/demo/{caneca,cadeira,tenis}.glb: placeholders 3D simples e honestos para o preview
// (primitivas geométricas em escala real, em metros). Não substituem modelos reais de fotogrametria.
import fs from 'node:fs';
import path from 'node:path';
import { serializeGlb } from '../src/lib/glb.js';

const TAU = Math.PI * 2;
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

// Superfície de revolução (eixo Y) a partir de um perfil [[r, y], ...]. Cada segmento do perfil
// gera seu próprio par de anéis (arestas vivas entre segmentos, suave ao redor do eixo).
function lathe(profile, { segments = 48, color, roughness = 0.6, scale = [1, 1, 1], translate = [0, 0, 0] } = {}) {
  const pos = [], nrm = [], idx = [];
  for (let s = 0; s < profile.length - 1; s++) {
    const [r0, y0] = profile[s], [r1, y1] = profile[s + 1];
    const t = norm([r1 - r0, y1 - y0]); const n2 = [t[1], -t[0]]; // normal 2D apontando para fora
    const base = pos.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU, c = Math.cos(a), sn = Math.sin(a);
      for (const [r, y] of [[r0, y0], [r1, y1]]) {
        pos.push(c * r * scale[0] + translate[0], y * scale[1] + translate[1], sn * r * scale[2] + translate[2]);
        nrm.push(...norm([c * n2[0] / scale[0], n2[1] / scale[1], sn * n2[0] / scale[2]]));
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
  }
  return { pos, nrm, idx, color, roughness };
}

// Toro (ou arco de toro) no plano XY, centro em `translate`.
function torus({ R, r, arc = TAU, start = 0, segments = 40, tube = 14, color, roughness = 0.6, translate = [0, 0, 0] }) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + (i / segments) * arc, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= tube; j++) {
      const b = (j / tube) * TAU, cb = Math.cos(b), sb = Math.sin(b);
      pos.push((R + r * cb) * ca + translate[0], (R + r * cb) * sa + translate[1], r * sb + translate[2]);
      nrm.push(cb * ca, cb * sa, sb);
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < tube; j++) {
    const a = i * (tube + 1) + j, b = a + tube + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { pos, nrm, idx, color, roughness };
}

function box({ size: [w, h, d], translate: [x, y, z] = [0, 0, 0], color, roughness = 0.7 }) {
  const pos = [], nrm = [], idx = [];
  const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  const half = [w / 2, h / 2, d / 2];
  for (const [n, u, v] of faces) {
    const base = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(...[0, 1, 2].map((k) => (n[k] + su * u[k] + sv * v[k]) * half[k] + [x, y, z][k]));
      nrm.push(...n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, nrm, idx, color, roughness };
}

function writeGlb(file, name, parts) {
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
    const indices = push(p.idx, Uint32Array, 34963, 'SCALAR', 5125);
    materials.push({ pbrMetallicRoughness: { baseColorFactor: p.color, metallicFactor: 0, roughnessFactor: p.roughness } });
    primitives.push({ attributes: { POSITION, NORMAL }, indices, material: materials.length - 1 });
  }
  const bin = Buffer.concat(bufs);
  const json = { asset: { version: '2.0', generator: 'forma3d demo placeholder' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }], meshes: [{ primitives }], materials, accessors, bufferViews, buffers: [{ byteLength: bin.length }] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeGlb(json, bin));
  console.log(`gravado ${file} (${(fs.statSync(file).size / 1024).toFixed(1)} kB)`);
}

const out = (f) => path.resolve('samples/demo', f);
const CREAM = [0.93, 0.90, 0.84, 1], CLAY = [0.62, 0.36, 0.24, 1], OAK = [0.42, 0.28, 0.16, 1], FABRIC = [0.80, 0.56, 0.36, 1], BLUE = [0.19, 0.36, 1.0, 1], NAVY = [0.13, 0.18, 0.36, 1];

// Caneca: parede externa esmaltada, interior em cerâmica escura, alça em arco de toro.
writeGlb(out('caneca.glb'), 'caneca', [
  lathe([[0, 0], [0.036, 0], [0.041, 0.004], [0.042, 0.03], [0.040, 0.092], [0.043, 0.096], [0.036, 0.096], [0.036, 0.010], [0, 0.010]], { color: CREAM, roughness: 0.35 }),
  torus({ R: 0.026, r: 0.0065, arc: TAU * 0.66, start: -TAU * 0.33, translate: [0.052, 0.050, 0], color: CLAY, roughness: 0.5 }),
]);

// Cadeira: assento e encosto em tecido, quatro pés em madeira.
writeGlb(out('cadeira.glb'), 'cadeira', [
  box({ size: [0.46, 0.05, 0.46], translate: [0, 0.445, 0], color: FABRIC }),
  box({ size: [0.46, 0.44, 0.045], translate: [0, 0.70, -0.21], color: FABRIC }),
  ...[[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].map(([x, z]) => box({ size: [0.035, 0.42, 0.035], translate: [x, 0.21, z], color: OAK, roughness: 0.55 })),
]);

// Tênis: sola em espuma, cabedal e contraforte como calotas alongadas (silhueta simplificada).
const dome = [[1, 0], [0.98, 0.20], [0.92, 0.39], [0.83, 0.56], [0.71, 0.71], [0.56, 0.83], [0.39, 0.92], [0.20, 0.98], [0, 1]];
writeGlb(out('tenis.glb'), 'tenis', [
  box({ size: [0.30, 0.032, 0.11], translate: [0, 0.016, 0], color: CREAM, roughness: 0.8 }),
  lathe(dome, { scale: [0.14, 0.068, 0.052], translate: [0.02, 0.032, 0], color: BLUE, roughness: 0.75 }),
  lathe(dome, { scale: [0.075, 0.082, 0.05], translate: [-0.07, 0.032, 0], color: NAVY, roughness: 0.75 }),
]);
