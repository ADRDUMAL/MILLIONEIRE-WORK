// Forma 3D · Fase 4 — captura guiada pela câmera. O que dá para testar sem navegador:
// a página do assistente entrega a opção e o módulo; o MP4 produzido pelo MediaRecorder do Chrome
// (fixture real gravada com canvas.captureStream) passa na validação do servidor e vira uma tarefa
// de vídeo; o servidor sobe em HTTPS com certificado local. Nada aqui chama o KIRI real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { get } from '../src/db.js';
import { probeMp4, isMp4Like } from '../src/forma/media.js';
import { buildStoredZip } from '../src/forma/zip.js';
import { fakeGlb } from './helpers.js';

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/mediarecorder-chrome-1s.mp4');
const API_KEY = 'kiri-test-key-capture';
let mock, mockUrl;
const state = { uploads: [] };

before(async () => {
  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.method === 'POST' && url.pathname === '/api/v1/open/photo/video') {
        const raw = Buffer.concat(chunks).toString('latin1');
        state.uploads.push({ hasVideoFile: raw.includes('name="videoFile"'), filename: (raw.match(/name="videoFile"; filename="([^"]+)"/) || [])[1], contentType: (raw.match(/name="videoFile"[^\r]*\r\nContent-Type: ([^\r]+)/) || [])[1] });
        return json(200, { code: 200, msg: 'success', ok: true, data: { serialize: 'ser_cap_' + state.uploads.length, calculateType: 1 } });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/open/model/getStatus') return json(200, { code: 200, ok: true, data: { serialize: url.searchParams.get('serialize'), status: 2 } });
      if (req.method === 'GET' && url.pathname === '/api/v1/open/model/getModelZip') return json(200, { code: 200, ok: true, data: { serialize: url.searchParams.get('serialize'), modelUrl: `${mockUrl}/zip` } });
      if (url.pathname === '/zip') { const z = buildStoredZip({ 'model.glb': fakeGlb() }); res.writeHead(200, { 'content-type': 'application/zip', 'content-length': z.length }); return res.end(z); }
      json(404, { code: 1, msg: 'nope', ok: false });
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

const servers = [];
async function startForma(formaOverrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma4-'));
  const cfg = buildConfig({ dataDir, dbFile: path.join(dataDir, 'app.sqlite'), privateDir: path.join(dataDir, 'private'), publicDir: path.join(dataDir, 'public'), sessionSecure: false, baseUrl: '' });
  cfg.tripo = { ...cfg.tripo, apiKey: '' };
  cfg.forma = { ...cfg.forma, dir: path.join(dataDir, 'forma'), realProcessingEnabled: true, providerName: 'kiri', maxRealJobs: 5, pollSeconds: 1, ...formaOverrides, kiri: { ...cfg.forma.kiri, apiKey: API_KEY, baseUrl: mockUrl } };
  const app = createApp(cfg, { log: { error: () => {}, log: () => {} }, formaEnv: { NODE_ENV: 'test' } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const ctx = { app, db: app.locals.db, base: `http://127.0.0.1:${server.address().port}`, close: async () => { await new Promise((r) => server.close(r)); app.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
  servers.push(ctx);
  return ctx;
}
after(async () => { for (const s of servers) await s.close(); });
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('tempo esgotado'); await new Promise((r) => setTimeout(r, 60)); } };

// ---------- Fixture: MP4 fragmentado do MediaRecorder (Chrome 152, canvas 320×180, ~1,5 s) ----------
test('MP4 do MediaRecorder do Chrome: cabeçalho ftyp e metadados legíveis sem ffmpeg', () => {
  const buf = fs.readFileSync(FIXTURE);
  assert.ok(isMp4Like(buf.subarray(0, 16)));
  const info = probeMp4(FIXTURE);
  assert.equal(info.container, 'mp4');
  assert.equal(info.confirmed, true);
  assert.equal(info.width, 320); assert.equal(info.height, 180);
  assert.ok(info.durationSeconds > 1 && info.durationSeconds < 2, `duração inesperada: ${info.durationSeconds}`);
});

test('gravação da câmera segue o fluxo de vídeo existente: validação, envio como videoFile e modelo final', async () => {
  const ctx = await startForma();
  const fd = new FormData();
  fd.append('method', 'video'); fd.append('productId', 'p_capture');
  fd.append('video', new Blob([fs.readFileSync(FIXTURE)], { type: 'video/mp4' }), 'scan-camera-20260916-120000.mp4');
  const r = await fetch(`${ctx.base}/api/forma/reconstruction/jobs`, { method: 'POST', body: fd, headers: { 'Idempotency-Key': 'ck_capture_1' } });
  assert.equal(r.status, 202);
  const body = await r.json();
  assert.equal(body.warning, ''); // duração e resolução confirmadas no servidor: sem aviso
  assert.equal(body.job.method, 'video'); assert.equal(body.job.fileCount, 1);
  const row = await waitFor(() => { const j = get(ctx.db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', body.job.jobId); return j.provider_ref ? j : null; });
  assert.match(row.provider_ref, /^ser_cap_/);
  assert.equal(state.uploads.at(-1).hasVideoFile, true);
  assert.equal(state.uploads.at(-1).filename, 'scan-camera-20260916-120000.mp4');
  assert.equal(state.uploads.at(-1).contentType, 'video/mp4');
  const media = JSON.parse(row.options_json).media;
  assert.equal(media.width, 320); assert.equal(media.confirmed, true);
  // Sem ninguém consultando, o polling do servidor conclui a tarefa e o GLB fica disponível.
  const done = await waitFor(async () => { const j = (await (await fetch(`${ctx.base}/api/forma/reconstruction/jobs/${body.job.jobId}`)).json()).job; return j.status === 'done' ? j : null; }, 10000);
  const model = await fetch(`${ctx.base}${done.modelUrl}`);
  assert.equal(model.status, 200);
  assert.equal(Buffer.from(await model.arrayBuffer()).subarray(0, 4).toString(), 'glTF');
});

test('WebM gravado por navegadores sem MP4 continua recusado pelo servidor com mensagem clara', async () => {
  const ctx = await startForma();
  const fd = new FormData();
  fd.append('method', 'video');
  fd.append('video', new Blob([Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)])], { type: 'video/webm' }), 'scan-camera.webm');
  const r = await fetch(`${ctx.base}/api/forma/reconstruction/jobs`, { method: 'POST', body: fd });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error.code, 'INVALID_VIDEO');
  assert.match(body.error.message, /MP4 ou MOV/);
});

test('assistente V2: fotos guiadas em destaque, alternativas preservadas e módulos na ordem certa', async () => {
  const ctx = await startForma();
  const html = await (await fetch(`${ctx.base}/studio/produtos/novo`)).text();
  // Hierarquia da §11: um cartão grande recomendado, dois médios e um link para o arquivo 3D.
  assert.match(html, /class="mhero" data-method="camera" aria-pressed="true" id="scan-open"/);
  assert.match(html, /Capturar fotos guiadas/);
  assert.match(html, /Recomendado/); assert.match(html, /Melhor resultado/); assert.match(html, /Mais rápido/);
  assert.match(html, /Como você quer criar o modelo\?/);
  assert.match(html, /class="mopt" data-method="photos"/);
  assert.match(html, /class="mopt" data-method="video"/);
  assert.match(html, /class="mline" data-method="model"/);
  assert.doesNotMatch(html, /Vídeo 360°/, '"360°" confunde com vídeo equiretangular');
  // Fallback nativo visível, gravação de vídeo, superfície e confirmação de custo.
  assert.match(html, /id="photo-native"[^>]*capture="environment"/);
  assert.match(html, /id="video-record"/);
  assert.match(html, /Como é a superfície do produto\?/);
  assert.match(html, /name="quality" value="high"/);
  assert.match(html, /id="real-confirm"/);
  assert.match(html, /HTTPS/);
  // Módulos servidos na ordem em que dependem uns dos outros.
  const order = ['scanner/quality.js', 'scanner/coverage.js', 'scanner/heading.js', 'scanner/frames.js', 'scanner/camera.js', 'scanner/photo-check.js', 'forma-guided.js', 'forma-capture.js', 'forma-video.js', 'forma-new-product.js']
    .map((f) => html.indexOf(`/static/${f}?v=`));
  assert.ok(order.every((i) => i > 0), `módulo ausente: ${order}`);
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'ordem de carga mudou');
  // Câmera: só `ideal` em resolução (nunca `max`), escada 4K → 1080p e resolução real lida do track.
  const cam = await (await fetch(`${ctx.base}/static/scanner/camera.js`)).text();
  assert.match(cam, /window\.FormaCamera/);
  assert.match(cam, /ideal: 3840/); assert.match(cam, /getSettings/); assert.match(cam, /enumerateDevices/);
  assert.doesNotMatch(cam, /max: 1080/);
  const guided = await (await fetch(`${ctx.base}/static/forma-guided.js`)).text();
  assert.match(guided, /window\.FormaGuided/); assert.match(guided, /isSecureContext/);
  const vid = await (await fetch(`${ctx.base}/static/forma-video.js`)).text();
  assert.match(vid, /extractFrames/); assert.match(vid, /hvc1/);
  // A gravação de vídeo continua existindo para o método "Vídeo ao redor".
  const cap = await (await fetch(`${ctx.base}/static/forma-capture.js`)).text();
  assert.match(cap, /window\.FormaCapture/);
  assert.match(cap, /MediaRecorder\.isTypeSupported/);
  assert.match(cap, /MAX_SECONDS = 180/);
  const css = await (await fetch(`${ctx.base}/static/forma.css`)).text();
  assert.match(css, /\.gd-shutter/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion/);
});

test('servidor sobe em HTTPS com certificado local (HTTPS_KEY_FILE/HTTPS_CERT_FILE)', { skip: !hasOpenssl() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma4-tls-'));
  const key = path.join(dir, 'k.pem'), cert = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  const cfg = buildConfig({ dataDir: dir, dbFile: path.join(dir, 'app.sqlite'), privateDir: path.join(dir, 'private'), publicDir: path.join(dir, 'public'), sessionSecure: false, baseUrl: '' });
  cfg.tripo = { ...cfg.tripo, apiKey: '' };
  cfg.forma = { ...cfg.forma, dir: path.join(dir, 'forma'), realProcessingEnabled: false };
  const app = createApp(cfg, { log: { error: () => {}, log: () => {} }, formaEnv: { NODE_ENV: 'test' } });
  // Mesma composição usada por src/server.js quando as variáveis HTTPS_* estão definidas.
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await new Promise((resolve, reject) => https.get({ host: '127.0.0.1', port: server.address().port, path: '/studio/produtos/novo', rejectUnauthorized: false }, (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => resolve({ status: r.statusCode, body: b })); }).on('error', reject));
    assert.equal(res.status, 200);
    assert.match(res.body, /data-method="camera"/);
  } finally {
    await new Promise((r) => server.close(r)); app.shutdown(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

function hasOpenssl() { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } }
