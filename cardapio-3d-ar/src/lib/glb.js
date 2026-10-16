// Leitura e reescala de GLB (glTF 2.0 binário) sem dependências.
// Só o chunk JSON é interpretado; o BIN é copiado intacto. Nada do arquivo é executado.

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export function parseGlb(buf) {
  if (buf.length < 20 || buf.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error('Não é um arquivo GLB');
  if (buf.readUInt32LE(4) !== 2) throw new Error('Versão de glTF não suportada');
  let off = 12; let json = null; let bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off); const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8'));
    else if (type === BIN_CHUNK) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('GLB sem chunk JSON');
  if (json.buffers?.some((b) => b.uri)) throw new Error('GLB com buffers externos não é aceito');
  if (json.images?.some((i) => i.uri && !i.uri.startsWith('data:'))) throw new Error('GLB com texturas externas não é aceito');
  return { json, bin };
}

export function serializeGlb(json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (jsonBuf.length % 4)) % 4;
  if (pad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);
  const parts = [Buffer.alloc(12), Buffer.alloc(8), jsonBuf];
  parts[1].writeUInt32LE(jsonBuf.length, 0); parts[1].writeUInt32LE(JSON_CHUNK, 4);
  if (bin) {
    const bpad = (4 - (bin.length % 4)) % 4;
    const binBuf = bpad ? Buffer.concat([bin, Buffer.alloc(bpad, 0)]) : bin;
    const h = Buffer.alloc(8); h.writeUInt32LE(binBuf.length, 0); h.writeUInt32LE(BIN_CHUNK, 4);
    parts.push(h, binBuf);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  parts[0].write('glTF', 0, 'ascii'); parts[0].writeUInt32LE(2, 4); parts[0].writeUInt32LE(total, 8);
  return Buffer.concat(parts);
}

// --- matrizes 4x4 column-major (como no glTF) ---
const I = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const xx = qx*qx, yy = qy*qy, zz = qz*qz, xy = qx*qy, xz = qx*qz, yz = qy*qz, wx = qw*qx, wy = qw*qy, wz = qw*qz;
  return [
    (1-2*(yy+zz))*sx, (2*(xy+wz))*sx, (2*(xz-wy))*sx, 0,
    (2*(xy-wz))*sy, (1-2*(xx+zz))*sy, (2*(yz+wx))*sy, 0,
    (2*(xz+wy))*sz, (2*(yz-wx))*sz, (1-2*(xx+yy))*sz, 0,
    tx, ty, tz, 1,
  ];
}
function apply(m, [x, y, z]) {
  return [m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]];
}

function sceneRoots(json) {
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene?.nodes?.length) return scene.nodes;
  // Sem cena definida: considera nós que não são filhos de ninguém.
  const children = new Set((json.nodes || []).flatMap((n) => n.children || []));
  return (json.nodes || []).map((_, i) => i).filter((i) => !children.has(i));
}

// Caixa envolvente em unidades do arquivo (glTF usa metros, +Y para cima).
export function boundingBox(json) {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  const seen = new Set();
  const visit = (idx, parent) => {
    if (seen.has(idx)) return; seen.add(idx);
    const node = json.nodes[idx]; const world = mul(parent, trs(node));
    if (node.mesh != null) {
      for (const prim of json.meshes[node.mesh].primitives || []) {
        const acc = json.accessors?.[prim.attributes?.POSITION];
        if (!acc?.min || !acc?.max) continue;
        for (const cx of [acc.min[0], acc.max[0]]) for (const cy of [acc.min[1], acc.max[1]]) for (const cz of [acc.min[2], acc.max[2]]) {
          const p = apply(world, [cx, cy, cz]);
          for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
        }
      }
    }
    for (const c of node.children || []) visit(c, world);
  };
  for (const r of sceneRoots(json)) visit(r, I());
  if (!Number.isFinite(min[0])) return null;
  const size = max.map((v, i) => v - min[i]);
  return { min, max, size, width: Math.max(size[0], size[2]), height: size[1] };
}

// Devolve novo GLB com um nó raiz de escala, mantendo o resto igual.
export function rescaleGlb(buf, factor) {
  const { json, bin } = parseGlb(buf);
  const roots = sceneRoots(json);
  json.nodes = json.nodes || [];
  const idx = json.nodes.push({ name: "escala_real", scale: [factor, factor, factor], children: roots }) - 1;
  json.scenes = json.scenes?.length ? json.scenes : [{ nodes: [] }];
  json.scenes[json.scene ?? 0].nodes = [idx];
  json.scene = json.scene ?? 0;
  return serializeGlb(json, bin);
}

export function analyzeGlb(buf) {
  const { json } = parseGlb(buf);
  return { bbox: boundingBox(json), meshes: json.meshes?.length || 0, images: json.images?.length || 0 };
}
