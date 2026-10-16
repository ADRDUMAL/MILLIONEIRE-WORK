import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { run } from '../src/db.js';
import { serializeGlb } from '../src/lib/glb.js';

export async function startTestServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardapio3d-'));
  const cfg = buildConfig({ dataDir, dbFile: path.join(dataDir, 'app.sqlite'), privateDir: path.join(dataDir, 'private'), publicDir: path.join(dataDir, 'public'), sessionSecure: false, baseUrl: '' });
  cfg.tripo = { ...cfg.tripo, apiKey: '' };
  const app = createApp(cfg, { log: { error: () => {}, log: () => {} } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  run(app.locals.db, 'INSERT INTO users (email, password_hash, name, is_admin) VALUES (?,?,?,1)', 'admin@test.local', hashPassword('senha-admin-123'), 'Admin');
  return {
    base, app, db: app.locals.db, cfg,
    close: async () => { await new Promise((r) => server.close(r)); app.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

// Cliente HTTP mínimo com cookies, sem seguir redirects (para inspecionar Location).
export function client(base) {
  let cookies = {};
  const jar = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = c.split(';'); const [k, v] = pair.split('=');
      if (attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a))) delete cookies[k.trim()]; else cookies[k.trim()] = v;
    }
  };
  const req = async (method, url, { body, headers = {}, form, multipart } = {}) => {
    const h = { cookie: jar(), ...headers };
    let payload = body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
    if (multipart) { payload = multipart; }
    const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
    absorb(res);
    const text = await res.text();
    return { status: res.status, headers: res.headers, location: res.headers.get('location'), text, json: () => JSON.parse(text) };
  };
  const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)?.[1] || html.match(/data-csrf="([^"]+)"/)?.[1];
  return {
    get: (url) => req('GET', url),
    post: (url, form) => req('POST', url, { form }),
    postJson: (url, obj, headers) => req('POST', url, { body: JSON.stringify(obj), headers: { 'content-type': 'application/json', ...headers } }),
    postMultipart: (url, fd, headers) => req('POST', url, { multipart: fd, headers }),
    csrfFrom,
    async login(email, password) { const r = await req('POST', '/entrar', { form: { email, password } }); return r; },
    async csrf(url = '/app') { const r = await req('GET', url); return csrfFrom(r.text); },
  };
}

// JPEG sintético: cabeçalho válido (SOI, APP0, SOF0 com dimensões, EOI). Não é decodificável, mas passa na validação de tipo/tamanho.
export function fakeJpeg(width = 640, height = 480) {
  const sof = Buffer.alloc(19); sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7); sof[9] = 3;
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(2000, 0x55), Buffer.from([0xff, 0xd9])]);
}
// GLB sintético com um "prato" de 1 m de largura (caixa 1 × 0.1 × 1 m).
export function fakeGlb() {
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 0.1, 0.5] }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] };
  return serializeGlb(json, Buffer.alloc(36));
}

export async function acceptInvite(c, inviteUrl, name = 'Dono') {
  const path = new URL(inviteUrl).pathname;
  const r = await c.post(path, { name, password: 'senha-forte-123' });
  return r;
}

// Fluxo completo: admin cria restaurante + convite; dono aceita. Retorna cliente logado do dono.
export async function createRestaurant(base, adminClient, name, email, plan = {}) {
  const csrf = await adminClient.csrf('/admin/restaurantes/novo');
  const r = await adminClient.post('/admin/restaurantes', { _csrf: csrf, name, email, plan_name: 'beta', subscription_status: 'trial', max_dishes_3d: 5, max_attempts: 10, ...plan });
  const token = r.location.match(/convite=([^&]+)/)[1];
  const owner = client(base);
  const acc = await owner.post(`/convite/${token}`, { name: 'Dono ' + name, password: 'senha-forte-123' });
  if (acc.status !== 302) throw new Error('convite falhou: ' + acc.status + ' ' + acc.text.slice(0, 200));
  const id = Number(r.location.match(/restaurantes\/(\d+)/)[1]);
  return { owner, id };
}

export async function createDish(owner, fields = {}) {
  const csrf = await owner.csrf('/app/pratos/novo');
  const r = await owner.post('/app/pratos', { _csrf: csrf, name: 'Feijoada', price: '49,90', serves: 2, width_cm: 28, height_cm: 6, ...fields });
  return Number(r.location.match(/pratos\/(\d+)/)[1]);
}

export async function uploadPhoto(owner, dishId, position, buf = fakeJpeg(), csrf) {
  csrf = csrf || await owner.csrf(`/app/pratos/${dishId}`);
  const fd = new FormData();
  fd.append('_csrf', csrf); fd.append('position', position);
  fd.append('photo', new Blob([buf], { type: 'image/jpeg' }), `${position}.jpg`);
  return owner.postMultipart(`/app/pratos/${dishId}/foto`, fd);
}
