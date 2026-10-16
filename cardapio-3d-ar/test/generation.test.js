import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startTestServer, client, createRestaurant, createDish, uploadPhoto, fakeJpeg, fakeGlb } from './helpers.js';
import { tripoProvider } from '../src/lib/generators/tripo.js';
import { startGeneration, pollPending } from '../src/lib/generation.js';
import { get, all } from '../src/db.js';

// Simula a API v3 da Tripo: POST /files, POST /generation/multiview-to-model, GET /tasks/:id
let mock, mockUrl, srv, admin, R, dish;
const state = { uploads: 0, tasks: {}, lastBody: null, auth: null };

before(async () => {
  mock = http.createServer((req, res) => {
    state.auth = req.headers.authorization;
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (req.method === 'POST' && req.url === '/files') { state.uploads += 1; return json(200, { code: 0, data: { file_token: `file_${state.uploads}` } }); }
      if (req.method === 'POST' && req.url === '/generation/multiview-to-model') {
        state.lastBody = JSON.parse(body.toString());
        const id = `task_${Object.keys(state.tasks).length + 1}`;
        state.tasks[id] = { status: 'running', progress: 10 };
        return json(200, { code: 0, data: { task_id: id } });
      }
      const m = req.url.match(/^\/tasks\/(.+)$/);
      if (req.method === 'GET' && m) {
        const t = state.tasks[m[1]];
        if (!t) return json(404, { code: 2000, message: 'task not found' });
        return json(200, { code: 0, data: { task_id: m[1], type: 'multiview_to_model', status: t.status, progress: t.progress, output: t.status === 'success' ? { model_url: `${mockUrl}/model.glb`, rendered_image_url: `${mockUrl}/p.png` } : {}, credits_consumed: t.status === 'success' ? 30 : undefined, error_message: t.error } });
      }
      if (req.url === '/model.glb') { res.writeHead(200, { 'content-type': 'model/gltf-binary' }); return res.end(fakeGlb()); }
      json(404, { code: 1, message: 'nope' });
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;

  srv = await startTestServer();
  admin = client(srv.base);
  await admin.login('admin@test.local', 'senha-admin-123');
  R = await createRestaurant(srv.base, admin, 'Gerador', 'g@test.local', { max_attempts: 1 });
  dish = await createDish(R.owner, { name: 'Bobó' });
  const csrf = await R.owner.csrf(`/app/pratos/${dish}`);
  for (const p of ['front', 'left', 'back', 'right']) await uploadPhoto(R.owner, dish, p, fakeJpeg(), csrf);
  await R.owner.post(`/app/pratos/${dish}/enviar`, { _csrf: csrf });
});
after(async () => { await srv.close(); await new Promise((r) => mock.close(r)); });

test('geração via adaptador Tripo: início manual, polling, download e limite de tentativas', async () => {
  const provider = tripoProvider({ apiKey: 'chave-teste', baseUrl: mockUrl, model: 'v3.0-20250812', estimatedCostUsd: 0.3 });
  const db = srv.db; const cfg = srv.cfg;
  const restaurant = get(db, 'SELECT * FROM restaurants WHERE id = ?', R.id);
  const d = get(db, 'SELECT * FROM dishes WHERE id = ?', dish);
  assert.equal(d.status, 'awaiting_review');
  // Nada é gerado automaticamente ao receber fotos
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM generation_attempts').n, 0);

  const { taskId } = await startGeneration({ db, cfg, provider, dish: d, restaurant, userId: 1 });
  assert.equal(taskId, 'task_1');
  assert.equal(state.uploads, 4, 'quatro vistas enviadas');
  assert.equal(state.auth, 'Bearer chave-teste');
  assert.deepEqual(state.lastBody.inputs, [{ front: { file_token: 'file_1' } }, { left: { file_token: 'file_2' } }, { back: { file_token: 'file_3' } }, { right: { file_token: 'file_4' } }]);
  assert.equal(state.lastBody.model, 'v3.0-20250812');
  assert.equal(get(db, 'SELECT status FROM dishes WHERE id = ?', dish).status, 'generating');

  // Ainda rodando
  let res = await pollPending({ db, cfg, provider, log: { error: () => {} } });
  assert.deepEqual(res, [{ attemptId: 1, status: 'running' }]);
  assert.equal(get(db, 'SELECT progress FROM generation_attempts WHERE id = 1').progress, 10);

  // Sucesso: modelo baixado para área privada, prato vai para revisão
  state.tasks.task_1 = { status: 'success', progress: 100 };
  res = await pollPending({ db, cfg, provider, log: { error: () => {} } });
  assert.equal(res[0].status, 'success');
  const attempt = get(db, 'SELECT * FROM generation_attempts WHERE id = 1');
  assert.equal(attempt.status, 'success');
  assert.equal(attempt.actual_credits, 30);
  const model = get(db, 'SELECT * FROM models WHERE dish_id = ?', dish);
  assert.equal(model.source, 'tripo');
  assert.equal(model.status, 'candidate');
  assert.ok(model.bbox_json.includes('"width":1'));
  assert.equal(get(db, 'SELECT status FROM dishes WHERE id = ?', dish).status, 'model_review');
  // Nada público ainda
  const slug = restaurant.slug;
  assert.ok(!(await client(srv.base).get(`/m/${slug}/p/${dish}`)).text.includes('<model-viewer'));

  // Limite de tentativas (max_attempts = 1) bloqueia nova geração
  await assert.rejects(() => startGeneration({ db, cfg, provider, dish: get(db, 'SELECT * FROM dishes WHERE id = ?', dish), restaurant, userId: 1 }), /Limite de tentativas/);
  assert.equal(all(db, 'SELECT id FROM generation_attempts').length, 1);
});

test('falha na API marca tentativa e prato como falha, sem modelo', async () => {
  const provider = tripoProvider({ apiKey: 'k', baseUrl: mockUrl, model: 'v3.0-20250812', estimatedCostUsd: 0.3 });
  const db = srv.db; const cfg = srv.cfg;
  const S = await createRestaurant(srv.base, admin, 'Falha', 'f@test.local', { max_attempts: 3 });
  const d2 = await createDish(S.owner, { name: 'Erro' });
  const csrf = await S.owner.csrf(`/app/pratos/${d2}`);
  for (const p of ['front', 'left', 'back', 'right']) await uploadPhoto(S.owner, d2, p, fakeJpeg(), csrf);
  const restaurant = get(db, 'SELECT * FROM restaurants WHERE id = ?', S.id);
  const { taskId } = await startGeneration({ db, cfg, provider, dish: get(db, 'SELECT * FROM dishes WHERE id = ?', d2), restaurant, userId: 1 });
  state.tasks[taskId] = { status: 'failed', progress: 0, error: 'inconsistent views' };
  await pollPending({ db, cfg, provider, log: { error: () => {} } });
  const a = get(db, 'SELECT * FROM generation_attempts WHERE provider_task_id = ?', taskId);
  assert.equal(a.status, 'failed');
  assert.match(a.error_message, /inconsistent/);
  assert.equal(get(db, 'SELECT status FROM dishes WHERE id = ?', d2).status, 'failed');
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM models WHERE dish_id = ?', d2).n, 0);
  // Restaurante pode refazer as fotos após falha
  assert.equal((await uploadPhoto(S.owner, d2, 'front', fakeJpeg(), csrf)).status, 200);
});
