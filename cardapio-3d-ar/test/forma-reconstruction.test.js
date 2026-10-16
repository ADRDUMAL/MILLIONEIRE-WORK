// Forma 3D · Fase 3B — reconstrução real via KIRI, testada contra um servidor HTTP falso.
// Nenhum teste aqui toca a API real nem consome créditos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { run, get } from '../src/db.js';
import { isGlb } from '../src/lib/files.js';
import { mapKiriStatus, kiriProvider } from '../src/forma/providers/kiri.js';
import { buildStoredZip, listEntries, findGlbEntry, extractEntry, isSafeEntryName } from '../src/forma/zip.js';
import { fakeJpeg, fakeGlb } from './helpers.js';

const API_KEY = 'kiri-test-key-XYZ';
let mock, mockUrl;
const state = { jobs: {}, calls: [], lastUpload: null, auth: null, statusFor: {}, zipVariant: {} };

// ---------- Servidor KIRI falso ----------
before(async () => {
  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      state.calls.push(req.method + ' ' + url.pathname);
      state.auth = req.headers.authorization;
      if (req.method === 'POST' && ['/api/v1/open/photo/image', '/api/v1/open/photo/video', '/api/v1/open/featureless/image'].includes(url.pathname)) {
        if (state.rejectUpload === 'auth') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code: 1001, msg: 'unauthorized', ok: false })); }
        if (state.rejectUpload === 'credits') return json(200, { code: 3001, msg: 'Insufficient balance', ok: false });
        const raw = body.toString('latin1');
        const files = (raw.match(/name="imagesFiles"|name="videoFile"/g) || []).length;
        const field = (n) => (raw.match(new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`)) || [])[1];
        const serialize = 'ser_' + (Object.keys(state.jobs).length + 1);
        state.jobs[serialize] = { status: 3 };
        state.lastPath = url.pathname;
        state.lastUpload = { files, kind: url.pathname.endsWith('video') ? 'video' : 'photos', modelQuality: field('modelQuality'), textureQuality: field('textureQuality'), isMask: field('isMask'), textureSmoothing: field('textureSmoothing'), fileFormat: field('fileFormat') };
        if (raw.includes('name="modelQuality"') && field('modelQuality') === '9') return json(200, { code: 2001, msg: `parâmetro inválido (chave ${API_KEY})`, ok: false });
        return json(200, { code: 0, msg: 'success', ok: true, data: { serialize, calculateType: 1 } });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/open/model/getStatus') {
        const ser = url.searchParams.get('serialize'); const j = state.jobs[ser];
        if (!j) return json(200, { code: 2002, msg: 'serialize not found', ok: false });
        if (j.flaky) { j.flaky -= 1; res.writeHead(503); return res.end('unavailable'); }
        return json(200, { code: 0, ok: true, data: { serialize: ser, status: j.status } });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/open/model/getModelZip') {
        const ser = url.searchParams.get('serialize');
        return json(200, { code: 0, ok: true, data: { serialize: ser, modelUrl: `${mockUrl}/zip/${ser}` } });
      }
      const z = url.pathname.match(/^\/zip\/(.+)$/);
      if (z) {
        const variant = state.zipVariant[z[1]] || 'ok';
        const payload = variant === 'notzip' ? Buffer.from('isto não é um zip')
          : variant === 'slip' ? buildStoredZip({ '../evil.glb': fakeGlb() })
          : variant === 'badglb' ? buildStoredZip({ 'model.glb': Buffer.from('lixo lixo lixo lixo lixo lixo') })
          : buildStoredZip({ 'readme.txt': Buffer.from('ok'), 'result/model.glb': fakeGlb() });
        res.writeHead(200, { 'content-type': 'application/zip', 'content-length': payload.length });
        return res.end(payload);
      }
      json(404, { code: 1, msg: 'nope', ok: false });
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

// ---------- App de teste com a Forma 3D configurada ----------
const servers = [];
async function startForma(formaOverrides = {}, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forma3b-'));
  const cfg = buildConfig({ dataDir, dbFile: path.join(dataDir, 'app.sqlite'), privateDir: path.join(dataDir, 'private'), publicDir: path.join(dataDir, 'public'), sessionSecure: false, baseUrl: '' });
  cfg.tripo = { ...cfg.tripo, apiKey: '' };
  cfg.forma = { ...cfg.forma, dir: path.join(dataDir, 'forma'), realProcessingEnabled: true, providerName: 'kiri', maxRealJobs: 50, pollSeconds: 1, ...formaOverrides,
    kiri: { ...cfg.forma.kiri, apiKey: API_KEY, baseUrl: mockUrl, ...(formaOverrides.kiri || {}) } };
  const app = createApp(cfg, { log: { error: () => {}, log: () => {} }, formaEnv: { NODE_ENV: 'test', ...env } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = { base, app, db: app.locals.db, jobs: app.locals.forma.jobs, cfg, close: async () => { await new Promise((r) => server.close(r)); app.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
  servers.push(ctx);
  return ctx;
}
after(async () => { for (const s of servers) await s.close(); });

const photosForm = (n, { method = 'photos', productId = 'p1', width = 1600, height = 1200 } = {}) => {
  const fd = new FormData();
  fd.append('method', method); fd.append('productId', productId);
  for (let i = 0; i < n; i++) fd.append('photos', new Blob([fakeJpeg(width, height)], { type: 'image/jpeg' }), `foto-${i + 1}.jpg`);
  return fd;
};
const postJob = (base, fd, headers = {}) => fetch(`${base}/api/forma/reconstruction/jobs`, { method: 'POST', body: fd, headers });
const getJob = async (ctx, id) => {
  // Zera o limitador de consultas (5 s por tarefa) para o teste não esperar.
  run(ctx.db, 'UPDATE forma_reconstruction_jobs SET last_polled_at = NULL, next_poll_at = NULL WHERE id = ?', id);
  const r = await fetch(`${ctx.base}/api/forma/reconstruction/jobs/${id}`);
  return { status: r.status, body: await r.json(), text: JSON.stringify(await Promise.resolve()) };
};
const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); } throw new Error('tempo esgotado'); };
const serializeOf = (ctx, id) => get(ctx.db, 'SELECT provider_ref FROM forma_reconstruction_jobs WHERE id = ?', id).provider_ref;
const fakeMp4 = () => { const b = Buffer.alloc(64, 0); b.writeUInt32BE(24, 0); b.write('ftyp', 4); b.write('isom', 8); b.writeUInt32BE(40, 24); b.write('mdat', 28); return b; };

// ---------- Unidades ----------
test('mapeamento de status do KIRI para a Forma 3D', () => {
  assert.equal(mapKiriStatus(-1), 'uploading');
  assert.equal(mapKiriStatus(3), 'queued');
  assert.equal(mapKiriStatus(0), 'processing');
  assert.equal(mapKiriStatus(1), 'error');
  assert.equal(mapKiriStatus(2), 'done');
  assert.equal(mapKiriStatus(4), 'expired');
});

test('leitor de ZIP: extrai GLB, recusa zip-slip e detecta CRC', () => {
  const zip = buildStoredZip({ 'a/model.glb': fakeGlb(), 'x.txt': Buffer.from('x') });
  const entries = listEntries(zip);
  const glb = extractEntry(zip, findGlbEntry(entries));
  assert.ok(isGlb(glb));
  assert.equal(isSafeEntryName('../evil.glb'), false);
  assert.equal(isSafeEntryName('/abs.glb'), false);
  assert.equal(isSafeEntryName('C:\\x.glb'), false);
  assert.throws(() => findGlbEntry(listEntries(buildStoredZip({ '../evil.glb': fakeGlb() }))), /inseguro/);
  const broken = Buffer.from(zip); broken[30 + 'a/model.glb'.length + 5] ^= 0xff; // corrompe dados
  assert.throws(() => extractEntry(broken, findGlbEntry(listEntries(broken))), /CRC|Tamanho/);
});

test('provider: a chave nunca aparece em mensagens de erro', async () => {
  const p = kiriProvider({ apiKey: API_KEY, baseUrl: mockUrl, modelQuality: 9 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiri-')); const fp = path.join(dir, 'f.jpg'); fs.writeFileSync(fp, fakeJpeg());
  await assert.rejects(p.createJob({ method: 'photos', files: [{ path: fp, name: 'f.jpg', mime: 'image/jpeg' }] }), (e) => { assert.ok(!e.message.includes(API_KEY)); assert.match(e.message, /chave removida/); return true; });
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- Modo sem chave / desativado ----------
test('chave ausente: servidor sobe, config informa simulação e POST é recusado', async () => {
  const ctx = await startForma({ kiri: { apiKey: '' } });
  const cfgRes = await (await fetch(`${ctx.base}/api/forma/reconstruction/config`)).json();
  assert.equal(cfgRes.mode, 'mock'); assert.equal(cfgRes.simulated, true); assert.match(cfgRes.reason, /KIRI_API_KEY/);
  assert.ok(!JSON.stringify(cfgRes).includes('apiKey'));
  const r = await postJob(ctx.base, photosForm(20));
  assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'REAL_PROCESSING_DISABLED');
});

test('provider desativado por flag: fallback para simulação', async () => {
  const ctx = await startForma({ realProcessingEnabled: false });
  const cfgRes = await (await fetch(`${ctx.base}/api/forma/reconstruction/config`)).json();
  assert.equal(cfgRes.enabled, false); assert.equal(cfgRes.provider, 'mock');
  const r = await postJob(ctx.base, photosForm(20));
  assert.equal(r.status, 503);
});

test('provider "mock" selecionado explicitamente: nunca chama o KIRI', async () => {
  const ctx = await startForma({ providerName: 'mock' });
  const before = state.calls.length;
  const r = await postJob(ctx.base, photosForm(20));
  assert.equal(r.status, 503);
  assert.equal(state.calls.length, before);
});

test('produção sem liberação explícita bloqueia; com liberação exige administrador', async () => {
  const a = await startForma({}, { NODE_ENV: 'production' });
  assert.equal((await postJob(a.base, photosForm(20))).status, 503);
  const b = await startForma({ allowRealInProduction: true }, { NODE_ENV: 'production' });
  const r = await postJob(b.base, photosForm(20));
  assert.equal(r.status, 403); assert.equal((await r.json()).error.code, 'ADMIN_REQUIRED');
});

// ---------- Validações de entrada ----------
test('quantidade insuficiente e excesso de fotos', async () => {
  const ctx = await startForma();
  let r = await postJob(ctx.base, photosForm(19));
  assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'TOO_FEW_PHOTOS');
  r = await postJob(ctx.base, photosForm(301));
  assert.equal(r.status, 400); assert.match((await r.json()).error.code, /TOO_MANY/);
  assert.equal(get(ctx.db, 'SELECT COUNT(*) AS n FROM forma_reconstruction_jobs').n, 0);
  assert.equal(fs.readdirSync(ctx.jobs.dirs.temp).length, 0, 'temporários limpos após recusa');
});

test('foto que não é imagem e vídeo inválido são recusados no servidor', async () => {
  const ctx = await startForma();
  const fd = photosForm(19); fd.append('photos', new Blob([Buffer.from('texto puro')], { type: 'image/jpeg' }), 'fake.jpg');
  let r = await postJob(ctx.base, fd);
  assert.equal((await r.json()).error.code, 'INVALID_IMAGE');
  const vf = new FormData(); vf.append('method', 'video'); vf.append('video', new Blob([Buffer.from('\x1aE\xdf\xa3webm')], { type: 'video/webm' }), 'giro.webm');
  r = await postJob(ctx.base, vf);
  assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'INVALID_VIDEO');
  const empty = new FormData(); empty.append('method', 'video'); empty.append('video', new Blob([]), 'vazio.mp4');
  r = await postJob(ctx.base, empty);
  assert.equal((await r.json()).error.code, 'EMPTY_FILE');
});

// ---------- Fluxo completo com o KIRI falso ----------
test('criação de job: envia ao KIRI com os parâmetros iniciais e responde só com o id interno', async () => {
  const ctx = await startForma();
  const r = await postJob(ctx.base, photosForm(20), { 'Idempotency-Key': 'click-1' });
  assert.equal(r.status, 202);
  const { job } = await r.json();
  assert.match(job.jobId, /^frj_/); assert.equal(job.status, 'uploading'); assert.equal(job.simulated, false); assert.equal(job.progress, null);
  assert.ok(!('providerRef' in job) && !('serialize' in job));
  await waitFor(() => get(ctx.db, 'SELECT provider_ref FROM forma_reconstruction_jobs WHERE id = ?', job.jobId).provider_ref);
  assert.equal(state.auth, `Bearer ${API_KEY}`);
  assert.deepEqual(state.lastUpload, { files: 20, kind: 'photos', modelQuality: '1', textureQuality: '1', isMask: '1', textureSmoothing: '0', fileFormat: 'GLB' });
  const st = await getJob(ctx, job.jobId);
  assert.equal(st.body.job.status, 'queued');
  assert.ok(!JSON.stringify(st.body).includes(API_KEY) && !JSON.stringify(st.body).includes('ser_'));
});

test('clique duplicado: mesma Idempotency-Key devolve a mesma tarefa sem novo envio', async () => {
  const ctx = await startForma();
  const uploadsBefore = state.calls.filter((c) => c.includes('photo/image')).length;
  const KEY = 'dup-0123456789abcdef'; // a chave precisa ter entropia (≥ 16 caracteres)
  const a = await (await postJob(ctx.base, photosForm(20), { 'Idempotency-Key': KEY })).json();
  const r = await postJob(ctx.base, photosForm(20), { 'Idempotency-Key': KEY });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.duplicate, true); assert.equal(b.job.jobId, a.job.jobId);
  await waitFor(() => serializeOf(ctx, a.job.jobId));
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(state.calls.filter((c) => c.includes('photo/image')).length - uploadsBefore, 1);
  assert.equal(get(ctx.db, 'SELECT COUNT(*) AS n FROM forma_reconstruction_jobs').n, 1);
  // Chave curta ("click-1") não vale como idempotência: cada envio cria a própria tarefa.
  const c = await (await postJob(ctx.base, photosForm(20), { 'Idempotency-Key': 'click-1' })).json();
  const d = await (await postJob(ctx.base, photosForm(20), { 'Idempotency-Key': 'click-1' })).json();
  assert.notEqual(c.job.jobId, d.job.jobId);
  // A chave pertence a quem a enviou: outro cliente (outro IP/sessão) com a mesma chave não recebe a tarefa alheia.
  const other = await (await postJob(ctx.base, photosForm(20), { 'Idempotency-Key': KEY, 'X-Forwarded-For': '203.0.113.9' })).json();
  assert.equal(other.duplicate, false);
});

test('limite de jobs reais configurável', async () => {
  const ctx = await startForma({ maxRealJobs: 1 });
  assert.equal((await postJob(ctx.base, photosForm(20))).status, 202);
  const r = await postJob(ctx.base, photosForm(20));
  assert.equal(r.status, 429); assert.equal((await r.json()).error.code, 'JOB_LIMIT');
});

test('acompanhamento: fila → processando → download do ZIP → GLB validado → modelo servido', async () => {
  const ctx = await startForma();
  const { job } = await (await postJob(ctx.base, photosForm(20))).json();
  const ser = await waitFor(() => serializeOf(ctx, job.jobId));
  assert.equal((await getJob(ctx, job.jobId)).body.job.status, 'queued');
  state.jobs[ser].status = 0;
  const p = (await getJob(ctx, job.jobId)).body.job;
  assert.equal(p.status, 'processing'); assert.equal(p.progress, null); assert.ok(p.stage.length > 0);
  state.jobs[ser].status = 2;
  // O download do modelo acontece em segundo plano: a consulta responde na hora e a tarefa fica "pronta" logo depois.
  const done = await waitFor(async () => { const j = (await getJob(ctx, job.jobId)).body.job; return j.status === 'done' ? j : null; });
  assert.equal(done.status, 'done');
  assert.equal(done.modelUrl, `/api/forma/reconstruction/jobs/${job.jobId}/model`);
  const m = await fetch(ctx.base + done.modelUrl);
  assert.equal(m.status, 200); assert.equal(m.headers.get('content-type'), 'model/gltf-binary');
  assert.ok(isGlb(Buffer.from(await m.arrayBuffer())));
  assert.ok(fs.existsSync(path.join(ctx.jobs.dirs.models, `${job.jobId}.glb`)));
  assert.ok(!fs.existsSync(path.join(ctx.jobs.dirs.uploads, job.jobId)), 'uploads removidos após sucesso');
  assert.equal(fs.readdirSync(ctx.jobs.dirs.temp).filter((n) => n.endsWith('.zip')).length, 0, 'zip temporário removido');
  assert.equal(get(ctx.db, "SELECT COUNT(*) AS n FROM forma_reconstruction_assets WHERE job_id = ? AND kind = 'model'", job.jobId).n, 1);
});

test('vídeo MP4 válido é aceito e enviado como videoFile', async () => {
  const ctx = await startForma();
  const fd = new FormData(); fd.append('method', 'video'); fd.append('video', new Blob([fakeMp4()], { type: 'video/mp4' }), 'giro.mp4');
  const r = await postJob(ctx.base, fd);
  assert.equal(r.status, 202);
  const body = await r.json();
  assert.match(body.warning, /confirmar/); // sem moov: resolução não confirmada, aviso claro
  await waitFor(() => serializeOf(ctx, body.job.jobId));
  assert.equal(state.lastUpload.kind, 'video'); assert.equal(state.lastUpload.files, 1);
});

test('falha do provider (status 1) vira erro com orientação de captura', async () => {
  const ctx = await startForma();
  const { job } = await (await postJob(ctx.base, photosForm(20))).json();
  const ser = await waitFor(() => serializeOf(ctx, job.jobId));
  state.jobs[ser].status = 1;
  const j = (await getJob(ctx, job.jobId)).body.job;
  assert.equal(j.status, 'error'); assert.match(j.message, /captura/);
});

test('resultado expirado (status 4) orienta reenvio', async () => {
  const ctx = await startForma();
  const { job } = await (await postJob(ctx.base, photosForm(20))).json();
  const ser = await waitFor(() => serializeOf(ctx, job.jobId));
  state.jobs[ser].status = 4;
  const j = (await getJob(ctx, job.jobId)).body.job;
  assert.equal(j.status, 'expired'); assert.match(j.message, /novamente/);
});

test('erros temporários do KIRI aplicam backoff e não derrubam a tarefa', async () => {
  const ctx = await startForma();
  const { job } = await (await postJob(ctx.base, photosForm(20))).json();
  const ser = await waitFor(() => serializeOf(ctx, job.jobId));
  state.jobs[ser].flaky = 2;
  const j = (await getJob(ctx, job.jobId)).body.job;
  assert.equal(j.status, 'queued'); assert.match(j.stage, /nova tentativa/);
  assert.equal(get(ctx.db, 'SELECT poll_errors FROM forma_reconstruction_jobs WHERE id = ?', job.jobId).poll_errors, 1);
});

test('download inválido, ZIP inseguro e GLB inválido falham com segurança', async () => {
  const ctx = await startForma();
  for (const [variant, pattern] of [['notzip', /ZIP/], ['slip', /inseguro/], ['badglb', /GLB|glTF/]]) {
    const { job } = await (await postJob(ctx.base, photosForm(20))).json();
    const ser = await waitFor(() => serializeOf(ctx, job.jobId));
    state.zipVariant[ser] = variant; state.jobs[ser].status = 2;
    const j = await waitFor(async () => { const x = (await getJob(ctx, job.jobId)).body.job; return x.status === 'error' ? x : null; });
    assert.equal(j.status, 'error', variant); assert.match(j.message, pattern);
    assert.equal(j.errorCode, 'RESULT_INVALID'); assert.equal(j.retryable, false, 'reenviar as mesmas fotos não muda um resultado inválido');
    assert.equal(j.modelUrl, null);
    assert.equal((await fetch(`${ctx.base}/api/forma/reconstruction/jobs/${job.jobId}/model`)).status, 404);
  }
  assert.ok(!fs.readdirSync(ctx.jobs.dirs.models).length, 'nenhum GLB gravado a partir de pacotes inválidos');
  assert.ok(!fs.existsSync(path.join(ctx.jobs.dirs.models, '..', 'evil.glb')));
});

test('cancelar e apagar uma tarefa', async () => {
  const ctx = await startForma();
  const { job } = await (await postJob(ctx.base, photosForm(20))).json();
  await waitFor(() => serializeOf(ctx, job.jobId));
  const r = await fetch(`${ctx.base}/api/forma/reconstruction/jobs/${job.jobId}`, { method: 'DELETE' });
  assert.equal((await r.json()).job.status, 'cancelled');
  assert.equal((await fetch(`${ctx.base}/api/forma/reconstruction/jobs/${job.jobId}?purge=1`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${ctx.base}/api/forma/reconstruction/jobs/${job.jobId}`)).status, 404);
});

// ---------- Captura V2: qualidade, superfícies difíceis, erros explicáveis e nova tentativa ----------
const withOptions = (fd, opts) => { for (const [k, v] of Object.entries(opts)) fd.append(k, v); return fd; };

test('preset "high" pede textura 4K e malha Alta; valor desconhecido cai no padrão do servidor', async () => {
  const ctx = await startForma();
  let { job } = await (await postJob(ctx.base, withOptions(photosForm(20, { width: 4032, height: 3024 }), { quality: 'high' }))).json();
  await waitFor(() => serializeOf(ctx, job.jobId));
  assert.equal(state.lastUpload.modelQuality, '0'); assert.equal(state.lastUpload.textureQuality, '0');
  assert.equal(job.quality, 'high');
  // Fotos pequenas (1600 px) não sustentam textura 4K: o servidor cai para 2K e avisa.
  const small = await (await postJob(ctx.base, withOptions(photosForm(20), { quality: 'high' }))).json();
  await waitFor(() => serializeOf(ctx, small.job.jobId));
  assert.equal(state.lastUpload.textureQuality, '1'); assert.equal(small.job.quality, 'standard'); assert.match(small.warning, /2K/);
  ({ job } = await (await postJob(ctx.base, withOptions(photosForm(20), { quality: '9; DROP' }))).json());
  await waitFor(() => serializeOf(ctx, job.jobId));
  assert.equal(state.lastUpload.modelQuality, '1'); assert.equal(job.quality, 'standard');
});

test('superfície lisa/metálica vai para o algoritmo Featureless; vídeo ignora e avisa', async () => {
  const ctx = await startForma();
  const { job } = await (await postJob(ctx.base, withOptions(photosForm(20), { surface: 'metallic', quality: 'high' }))).json();
  await waitFor(() => serializeOf(ctx, job.jobId));
  assert.equal(state.lastPath, '/api/v1/open/featureless/image');
  assert.equal(state.lastUpload.fileFormat, 'GLB'); assert.equal(state.lastUpload.modelQuality, undefined);
  assert.equal(job.endpoint, 'featureless'); assert.equal(job.surface, 'metallic');
  const fd = new FormData(); fd.append('method', 'video'); fd.append('surface', 'smooth'); fd.append('video', new Blob([fakeMp4()], { type: 'video/mp4' }), 'giro.mp4');
  const body = await (await postJob(ctx.base, fd)).json();
  assert.match(body.warning, /só funciona com fotos/);
  await waitFor(() => serializeOf(ctx, body.job.jobId));
  assert.equal(state.lastPath, '/api/v1/open/photo/video');
});

test('credencial recusada e saldo insuficiente viram códigos distintos, com etapa "upload"', async () => {
  const ctx = await startForma();
  for (const [mode, code] of [['auth', 'KIRI_AUTH'], ['credits', 'KIRI_CREDITS']]) {
    state.rejectUpload = mode;
    const { job } = await (await postJob(ctx.base, photosForm(20))).json();
    const j = await waitFor(async () => { const b = (await getJob(ctx, job.jobId)).body.job; return b.status === 'error' ? b : null; });
    assert.equal(j.errorCode, code); assert.equal(j.errorStage, 'upload'); assert.equal(j.retryable, true);
    assert.ok(!JSON.stringify(j).includes(API_KEY));
  }
  state.rejectUpload = null;
});

test('tentar novamente reenvia os arquivos guardados, sem novo upload, e conta no limite de custo', async () => {
  const ctx = await startForma({ maxRealJobs: 2 });
  const { job } = await (await postJob(ctx.base, photosForm(20))).json();
  const ser = await waitFor(() => serializeOf(ctx, job.jobId));
  state.jobs[ser].status = 1;
  const failed = (await getJob(ctx, job.jobId)).body.job;
  assert.equal(failed.errorCode, 'RECONSTRUCTION_FAILED'); assert.equal(failed.retryable, true);
  assert.equal(ctx.jobs.storedFiles(job.jobId).length, 20, 'fotos guardadas após a falha');
  const r = await fetch(`${ctx.base}/api/forma/reconstruction/jobs/${job.jobId}/retry`, { method: 'POST' });
  assert.equal(r.status, 202);
  const again = (await r.json()).job;
  assert.equal(again.status, 'uploading'); assert.equal(again.attempts, 2); assert.equal(again.errorCode, null);
  await waitFor(() => { const ref = serializeOf(ctx, job.jobId); return ref && ref !== ser ? ref : null; });
  assert.equal(state.lastUpload.files, 20);
  // 2 envios de 2 permitidos: um terceiro (novo ou reenvio) é recusado.
  assert.equal((await postJob(ctx.base, photosForm(20))).status, 429);
  const running = await fetch(`${ctx.base}/api/forma/reconstruction/jobs/${job.jobId}/retry`, { method: 'POST' });
  assert.equal(running.status, 409);
});

test('sonda de vídeo lê o codec da trilha de vídeo (MP4 do MediaRecorder)', async () => {
  const { probeMp4 } = await import('../src/forma/media.js');
  const info = probeMp4(path.join(import.meta.dirname, 'fixtures', 'mediarecorder-chrome-1s.mp4'));
  assert.equal(info.codec, 'avc1'); assert.equal(info.confirmed, true); assert.equal(info.width, 320);
});
