import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, client, createRestaurant, createDish, uploadPhoto, fakeJpeg, fakeGlb } from './helpers.js';
import { analyzeGlb } from '../src/lib/glb.js';
import { get } from '../src/db.js';

let srv, admin, A, B;

before(async () => {
  srv = await startTestServer();
  admin = client(srv.base);
  const login = await admin.login('admin@test.local', 'senha-admin-123');
  assert.equal(login.status, 302);
  A = await createRestaurant(srv.base, admin, 'Cantina A', 'a@test.local');
  B = await createRestaurant(srv.base, admin, 'Bistrô B', 'b@test.local');
});
after(async () => { await srv.close(); });

test('login inválido é recusado e rotas privadas exigem sessão', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.login('a@test.local', 'errada')).status, 401);
  assert.equal((await anon.get('/app')).status, 302);
  assert.equal((await anon.get('/admin')).status, 302);
  assert.equal((await A.owner.get('/admin')).status, 403, 'restaurante não entra no admin');
});

test('mutação sem CSRF é bloqueada', async () => {
  const r = await A.owner.post('/app/config', { name: 'Hack' });
  assert.equal(r.status, 403);
});

test('isolamento: restaurante B não vê nem altera prato/fotos de A', async () => {
  const dishA = await createDish(A.owner);
  assert.equal((await A.owner.get(`/app/pratos/${dishA}`)).status, 200);
  assert.equal((await B.owner.get(`/app/pratos/${dishA}`)).status, 404);
  const csrfB = await B.owner.csrf('/app');
  assert.equal((await B.owner.post(`/app/pratos/${dishA}`, { _csrf: csrfB, name: 'Invadido', price: '1', serves: 1, width_cm: 20 })).status, 404);
  assert.equal((await uploadPhoto(B.owner, dishA, 'front', fakeJpeg(), csrfB)).status, 404);
  assert.equal((await B.owner.get(`/app/pratos/${dishA}/foto/front`)).status, 404);
  assert.equal((await B.owner.post(`/app/pratos/${dishA}/excluir`, { _csrf: csrfB })).status, 404);
  assert.equal(get(srv.db, 'SELECT name FROM dishes WHERE id = ?', dishA).name, 'Feijoada');
  // painel de B não lista pratos de A
  assert.ok(!(await B.owner.get('/app')).text.includes('Feijoada'));
  // admin vê o prato
  assert.equal((await admin.get(`/admin/pratos/${dishA}`)).status, 200);
});

test('upload valida tipo, tamanho mínimo e posição', async () => {
  const dish = await createDish(A.owner, { name: 'Moqueca' });
  const csrf = await A.owner.csrf(`/app/pratos/${dish}`);
  const bad = await uploadPhoto(A.owner, dish, 'front', Buffer.from('nao e imagem'), csrf);
  assert.equal(bad.status, 400);
  const tiny = await uploadPhoto(A.owner, dish, 'front', fakeJpeg(200, 200), csrf);
  assert.equal(tiny.status, 400);
  const badPos = await uploadPhoto(A.owner, dish, 'diagonal', fakeJpeg(), csrf);
  assert.equal(badPos.status, 400);
  const ok = await uploadPhoto(A.owner, dish, 'front', fakeJpeg(), csrf);
  assert.equal(ok.status, 200);
  assert.equal(ok.json().complete, false);
  // foto privada acessível pelo dono e pelo admin; anônimo não
  assert.equal((await A.owner.get(`/app/pratos/${dish}/foto/front`)).status, 200);
  assert.equal((await admin.get(`/admin/pratos/${dish}/foto/front`)).status, 200);
  assert.equal((await client(srv.base).get(`/app/pratos/${dish}/foto/front`)).status, 302);
  // capa pública foi gerada a partir da frente
  const row = get(srv.db, 'SELECT cover_public_path FROM dishes WHERE id = ?', dish);
  assert.ok(row.cover_public_path && fs.existsSync(path.join(srv.cfg.publicDir, row.cover_public_path)));
});

test('envio para revisão exige 4 fotos, aparece na fila e trava as fotos', async () => {
  const dish = await createDish(A.owner, { name: 'Picanha' });
  let csrf = await A.owner.csrf(`/app/pratos/${dish}`);
  const early = await A.owner.post(`/app/pratos/${dish}/enviar`, { _csrf: csrf });
  assert.equal(early.status, 302);
  assert.equal(get(srv.db, 'SELECT status FROM dishes WHERE id = ?', dish).status, 'draft');
  for (const p of ['front', 'left', 'back']) assert.equal((await uploadPhoto(A.owner, dish, p, fakeJpeg(), csrf)).status, 200);
  const last = await uploadPhoto(A.owner, dish, 'right', fakeJpeg(), csrf);
  assert.equal(last.json().complete, true);
  assert.equal((await A.owner.post(`/app/pratos/${dish}/enviar`, { _csrf: csrf })).status, 302);
  assert.equal(get(srv.db, 'SELECT status FROM dishes WHERE id = ?', dish).status, 'awaiting_review');
  const queue = await admin.get('/admin?status=awaiting_review');
  assert.ok(queue.text.includes('Picanha'));
  assert.equal((await uploadPhoto(A.owner, dish, 'front', fakeJpeg(), csrf)).status, 409, 'fotos travadas após envio');
  // preço e esgotado continuam editáveis sem mudar slug/QR
  const slugBefore = get(srv.db, 'SELECT slug FROM restaurants WHERE id = ?', A.id).slug;
  csrf = await A.owner.csrf(`/app/pratos/${dish}`);
  await A.owner.post(`/app/pratos/${dish}`, { _csrf: csrf, name: 'Picanha', price: '59,90', serves: 2, width_cm: 28, is_sold_out: '1', is_visible: '1' });
  const d = get(srv.db, 'SELECT price_cents, is_sold_out, status FROM dishes WHERE id = ?', dish);
  assert.deepEqual([d.price_cents, d.is_sold_out, d.status], [5990, 1, 'awaiting_review']);
  assert.equal(get(srv.db, 'SELECT slug FROM restaurants WHERE id = ?', A.id).slug, slugBefore);
  // pedido de novas fotos destrava
  const acsrf = await admin.csrf(`/admin/pratos/${dish}`);
  await admin.post(`/admin/pratos/${dish}/acao`, { _csrf: acsrf, action: 'needs_photos', note: 'Fundo com talheres' });
  assert.equal(get(srv.db, 'SELECT status FROM dishes WHERE id = ?', dish).status, 'needs_photos');
  assert.ok((await A.owner.get(`/app/pratos/${dish}`)).text.includes('Fundo com talheres'));
  assert.equal((await uploadPhoto(A.owner, dish, 'front', fakeJpeg(), csrf)).status, 200);
});

test('limite de pratos 3D do plano bloqueia envio', async () => {
  const C = await createRestaurant(srv.base, admin, 'Casa C', 'c@test.local', { max_dishes_3d: 1 });
  const submitAll = async (id) => {
    const csrf = await C.owner.csrf(`/app/pratos/${id}`);
    for (const p of ['front', 'left', 'back', 'right']) await uploadPhoto(C.owner, id, p, fakeJpeg(), csrf);
    return C.owner.post(`/app/pratos/${id}/enviar`, { _csrf: csrf });
  };
  const d1 = await createDish(C.owner, { name: 'Um' }); await submitAll(d1);
  assert.equal(get(srv.db, 'SELECT status FROM dishes WHERE id = ?', d1).status, 'awaiting_review');
  const d2 = await createDish(C.owner, { name: 'Dois' }); await submitAll(d2);
  assert.equal(get(srv.db, 'SELECT status FROM dishes WHERE id = ?', d2).status, 'draft', 'segundo prato bloqueado pelo limite');
  // geração paga bloqueada sem chave (gerador não configurado) e por limite de tentativas
  const acsrf = await admin.csrf(`/admin/pratos/${d1}`);
  const gen = await admin.post(`/admin/pratos/${d1}/acao`, { _csrf: acsrf, action: 'generate' });
  assert.equal(gen.status, 302);
  assert.equal(get(srv.db, 'SELECT COUNT(*) AS n FROM generation_attempts').n, 0, 'nenhuma tentativa criada sem gerador');
});

test('publicação: modelo manual só fica público após calibrar/publicar; despublicar remove', async () => {
  const dish = await createDish(A.owner, { name: 'Lasanha' });
  const csrf = await A.owner.csrf(`/app/pratos/${dish}`);
  for (const p of ['front', 'left', 'back', 'right']) await uploadPhoto(A.owner, dish, p, fakeJpeg(), csrf);
  await A.owner.post(`/app/pratos/${dish}/enviar`, { _csrf: csrf });
  const slug = get(srv.db, 'SELECT slug FROM restaurants WHERE id = ?', A.id).slug;
  const pub = client(srv.base);
  // Antes do 3D: página pública mostra o prato com foto e sem visualizador
  let page = await pub.get(`/m/${slug}/p/${dish}`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('Lasanha') && page.text.includes('/files/photos/'));
  assert.ok(!page.text.includes('<model-viewer'));
  assert.ok((await pub.get(`/m/${slug}`)).text.includes('Lasanha'));

  // Upload manual do GLB pelo admin
  const acsrf = await admin.csrf(`/admin/pratos/${dish}`);
  const fd = new FormData();
  fd.append('_csrf', acsrf);
  fd.append('glb', new Blob([fakeGlb()], { type: 'model/gltf-binary' }), 'prato.glb');
  const up = await admin.postMultipart(`/admin/pratos/${dish}/modelo`, fd);
  assert.equal(up.status, 302);
  const model = get(srv.db, 'SELECT * FROM models WHERE dish_id = ?', dish);
  assert.equal(model.status, 'candidate');
  assert.equal(get(srv.db, 'SELECT status FROM dishes WHERE id = ?', dish).status, 'model_review');
  // Candidato não é público
  page = await pub.get(`/m/${slug}/p/${dish}`);
  assert.ok(!page.text.includes('<model-viewer'));
  assert.equal((await pub.get(`/admin/pratos/${dish}/modelos/${model.id}/preview.glb`)).status, 302);
  // GLB inválido é recusado
  const fd2 = new FormData(); fd2.append('_csrf', acsrf); fd2.append('glb', new Blob([Buffer.from('lixo')]), 'x.glb');
  await admin.postMultipart(`/admin/pratos/${dish}/modelo`, fd2);
  assert.equal(get(srv.db, 'SELECT COUNT(*) AS n FROM models WHERE dish_id = ?', dish).n, 1);

  // Publicar com largura real 28 cm -> GLB público reescalado
  const r = await admin.post(`/admin/pratos/${dish}/modelos/${model.id}/publicar`, { _csrf: acsrf, target_width_cm: '28' });
  assert.equal(r.status, 302);
  const published = get(srv.db, 'SELECT * FROM models WHERE id = ?', model.id);
  assert.equal(published.status, 'published');
  assert.ok(published.glb_public_path);
  const glbRes = await fetch(`${srv.base}/files/${published.glb_public_path}`);
  assert.equal(glbRes.status, 200);
  const bbox = analyzeGlb(Buffer.from(await glbRes.arrayBuffer())).bbox;
  assert.ok(Math.abs(bbox.width - 0.28) < 1e-6, `largura reescalada ${bbox.width}`);
  page = await pub.get(`/m/${slug}/p/${dish}`);
  assert.ok(page.text.includes('<model-viewer') && page.text.includes(published.glb_public_path) && page.text.includes('Ver na minha mesa'));
  assert.equal(get(srv.db, 'SELECT status FROM dishes WHERE id = ?', dish).status, 'published');

  // Métricas: abertura do cardápio e visualização do prato contadas; beacon de AR aceito
  assert.equal((await pub.postJson('/api/track', { kind: 'ar_view', restaurant: A.id, dish })).status, 204);
  assert.equal((await pub.postJson('/api/track', { kind: 'ar_view', restaurant: B.id, dish })).status, 400, 'prato de outro restaurante não conta');
  assert.equal((await admin.postJson('/api/track', { kind: 'model_view', restaurant: A.id, dish })).status, 204, 'beacon funciona mesmo com sessão aberta (sem CSRF)');
  const m = await A.owner.get('/app/metricas');
  assert.ok(m.text.includes('aberturas em AR'));
  assert.ok(get(srv.db, "SELECT SUM(count) AS n FROM usage_daily WHERE restaurant_id = ? AND kind = 'dish_view'", A.id).n >= 2);

  // Despublicar: arquivo público some, página volta a mostrar foto
  await admin.post(`/admin/pratos/${dish}/despublicar`, { _csrf: acsrf });
  assert.equal((await fetch(`${srv.base}/files/${published.glb_public_path}`)).status, 404);
  page = await pub.get(`/m/${slug}/p/${dish}`);
  assert.ok(!page.text.includes('<model-viewer'));
  assert.equal(get(srv.db, 'SELECT status FROM dishes WHERE id = ?', dish).status, 'model_review');

  // Prato oculto não aparece
  const c2 = await A.owner.csrf(`/app/pratos/${dish}`);
  await A.owner.post(`/app/pratos/${dish}`, { _csrf: c2, name: 'Lasanha', price: '39,90', serves: 1, width_cm: 28 });
  assert.equal((await pub.get(`/m/${slug}/p/${dish}`)).status, 404);
  assert.ok(!(await pub.get(`/m/${slug}`)).text.includes('Lasanha'));
});

test('QR e link do cardápio são estáveis e o export funciona', async () => {
  const qr = await A.owner.get('/app/qr.png');
  assert.equal(qr.status, 200);
  assert.ok(qr.headers.get('content-type').includes('image/png'));
  const exp = await admin.get(`/admin/restaurantes/${A.id}/export.json`);
  assert.equal(exp.status, 200);
  const data = exp.json();
  assert.equal(data.restaurant.id, A.id);
  assert.ok(data.dishes.length >= 3);
  assert.equal((await A.owner.get(`/admin/restaurantes/${A.id}/export.json`)).status, 403);
});
