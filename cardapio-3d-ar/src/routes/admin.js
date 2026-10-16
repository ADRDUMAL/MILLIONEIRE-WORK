import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, audit } from '../db.js';
import { requireAdmin, csrfAfterUpload, sha256, token } from '../auth.js';
import { html, page, badge, money, STATUS_LABEL, STATUSES, POSITIONS, POSITION_LABEL, SUBSCRIPTION_LABEL } from '../html.js';
import { readFlash, redirectWith } from '../lib/flash.js';
import { isGlb, isUsdz, writeUnder, resolveUnder, removeQuiet, randomName, memoryUpload } from '../lib/files.js';
import { analyzeGlb, rescaleGlb } from '../lib/glb.js';
import { planUsage, startGeneration, pollPending } from '../lib/generation.js';
import { baseUrl, menuUrl, slugify, parseNum } from '../lib/util.js';


const r = Router();
r.use(requireAdmin);

const NAV = (active) => [
  { href: '/admin', label: 'Fila', active: active === 'fila' },
  { href: '/admin/restaurantes', label: 'Restaurantes', active: active === 'restaurantes' },
];
const render = (req, res, opts) => res.send(page({ user: req.user, flash: readFlash(req, res), wide: true, ...opts, nav: NAV(opts.nav) }));
const csrf = (req) => html`<input type="hidden" name="_csrf" value="${req.user.csrf}">`;
const fmtDate = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '');

function loadRestaurant(req, res, next) {
  const rest = get(req.app.locals.db, 'SELECT * FROM restaurants WHERE id = ?', Number(req.params.id));
  if (!rest) return res.status(404).send('Restaurante não encontrado.');
  req.rest = rest; next();
}
function loadDish(req, res, next) {
  const dish = get(req.app.locals.db, 'SELECT d.*, r.name AS restaurant_name, r.slug FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id WHERE d.id = ?', Number(req.params.id));
  if (!dish) return res.status(404).send('Prato não encontrado.');
  req.dish = dish; next();
}
const setStatus = (db, dishId, status, note = '') => run(db, "UPDATE dishes SET status = ?, status_note = ?, updated_at = datetime('now') WHERE id = ?", status, note, dishId);

// ---------- Fila ----------
r.get('/', (req, res) => {
  const { db, provider } = req.app.locals;
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const rid = Number(req.query.restaurant) || 0;
  const where = ['1=1']; const params = [];
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (rid) { where.push('d.restaurant_id = ?'); params.push(rid); }
  if (!status && !rid) where.push("d.status NOT IN ('draft')");
  const dishes = all(db, `SELECT d.*, r.name AS restaurant_name, (SELECT COUNT(*) FROM captures c WHERE c.dish_id = d.id) AS photos FROM dishes d JOIN restaurants r ON r.id = d.restaurant_id WHERE ${where.join(' AND ')} ORDER BY CASE d.status WHEN 'awaiting_review' THEN 0 WHEN 'model_review' THEN 1 WHEN 'generating' THEN 2 WHEN 'approved_for_generation' THEN 3 ELSE 9 END, d.updated_at DESC LIMIT 300`, ...params);
  const counts = Object.fromEntries(all(db, 'SELECT status, COUNT(*) AS n FROM dishes GROUP BY status').map((x) => [x.status, x.n]));
  const rests = all(db, 'SELECT id, name FROM restaurants ORDER BY name');
  render(req, res, { title: 'Fila de revisão', nav: 'fila', body: html`
    <h1>Fila de revisão</h1>
    <p class="muted">Gerador 3D: <strong>${provider.label}</strong>${provider.configured ? html` · custo estimado por geração US$ ${provider.estimatedCostUsd.toFixed(2)}` : ' — envio manual de GLB disponível'}
      ${provider.configured ? html`<form method="post" action="/admin/verificar" class="inline">${csrf(req)}<button class="link">Verificar tarefas agora</button></form>` : ''}</p>
    <form method="get" action="/admin" class="filters">
      <select name="status"><option value="">Todos (exceto rascunho)</option>${STATUSES.map((s) => html`<option value="${s}" ${s === status ? 'selected' : ''}>${STATUS_LABEL[s]} (${counts[s] || 0})</option>`)}</select>
      <select name="restaurant"><option value="">Todos os restaurantes</option>${rests.map((x) => html`<option value="${x.id}" ${x.id === rid ? 'selected' : ''}>${x.name}</option>`)}</select>
      <button>Filtrar</button>
    </form>
    ${dishes.length ? dishes.map((d) => html`
      <a class="row" href="/admin/pratos/${d.id}">
        <span class="thumb">${d.cover_public_path ? html`<img src="/files/${d.cover_public_path}" alt="">` : ''}</span>
        <span class="grow"><strong>${d.name}</strong> <small class="muted">· ${d.restaurant_name}</small><br><small>${d.photos} foto(s) · largura ${d.width_cm ?? '?'} cm · atualizado ${fmtDate(d.updated_at)}</small></span>
        ${badge(d.status)}
      </a>`) : html`<p class="muted">Nada na fila com esse filtro.</p>`}` });
});

r.post('/verificar', async (req, res) => {
  const { db, cfg, provider } = req.app.locals;
  const results = await pollPending({ db, cfg, provider });
  redirectWith(res, req.get('referer') || '/admin', 'ok', results.length ? `Verificadas ${results.length} tarefa(s): ${results.map((x) => x.status || x.error).join(', ')}` : 'Nenhuma tarefa pendente.');
});

// ---------- Restaurantes ----------
r.get('/restaurantes', (req, res) => {
  const rests = all(req.app.locals.db, 'SELECT r.*, (SELECT COUNT(*) FROM dishes d WHERE d.restaurant_id = r.id) AS dishes, (SELECT COUNT(*) FROM memberships m WHERE m.restaurant_id = r.id) AS members FROM restaurants r ORDER BY r.name');
  render(req, res, { title: 'Restaurantes', nav: 'restaurantes', body: html`
    <h1>Restaurantes</h1>
    <p><a class="button primary" href="/admin/restaurantes/novo">+ Convidar restaurante</a></p>
    ${rests.map((x) => html`<a class="row" href="/admin/restaurantes/${x.id}"><span class="grow"><strong>${x.name}</strong><br><small>/m/${x.slug} · ${x.dishes} prato(s) · ${x.members} acesso(s) · plano ${x.plan_name} · ${SUBSCRIPTION_LABEL[x.subscription_status]}</small></span></a>`)}` });
});

const planForm = (req, x, action) => html`
  <form method="post" action="${action}" class="card">${csrf(req)}
    <label>Nome do restaurante <input name="name" required maxlength="80" value="${x.name || ''}"></label>
    ${x.id ? '' : html`<label>E-mail do responsável (recebe o convite) <input type="email" name="email" required></label>`}
    <div class="grid2">
      <label>Plano <input name="plan_name" maxlength="30" value="${x.plan_name ?? 'beta'}"></label>
      <label>Assinatura <select name="subscription_status">${Object.entries(SUBSCRIPTION_LABEL).map(([k, v]) => html`<option value="${k}" ${k === (x.subscription_status || 'trial') ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label>Limite de pratos em 3D <input type="number" name="max_dishes_3d" min="0" max="500" value="${x.max_dishes_3d ?? 5}"></label>
      <label>Tentativas de geração incluídas <input type="number" name="max_attempts" min="0" max="5000" value="${x.max_attempts ?? 10}"></label>
    </div>
    <label>Observação de cobrança (manual no beta) <input name="subscription_note" maxlength="200" value="${x.subscription_note || ''}"></label>
    <button class="primary">${x.id ? 'Salvar' : 'Criar e gerar convite'}</button>
  </form>`;

r.get('/restaurantes/novo', (req, res) => render(req, res, { title: 'Novo restaurante', nav: 'restaurantes', body: html`<h1>Convidar restaurante</h1>${planForm(req, {}, '/admin/restaurantes')}` }));

function readPlan(req) {
  return {
    name: String(req.body.name || '').trim().slice(0, 80),
    plan_name: String(req.body.plan_name || 'beta').trim().slice(0, 30),
    subscription_status: Object.keys(SUBSCRIPTION_LABEL).includes(req.body.subscription_status) ? req.body.subscription_status : 'trial',
    max_dishes_3d: Math.max(0, Math.min(500, Number(req.body.max_dishes_3d) || 0)),
    max_attempts: Math.max(0, Math.min(5000, Number(req.body.max_attempts) || 0)),
    subscription_note: String(req.body.subscription_note || '').trim().slice(0, 200),
  };
}
function createInvite(db, restaurantId, email, userId) {
  const t = token(24);
  run(db, "INSERT INTO invites (token_hash, restaurant_id, email, created_by, expires_at) VALUES (?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days'))", sha256(t), restaurantId, email, userId);
  return t;
}

r.post('/restaurantes', (req, res) => {
  const { db } = req.app.locals;
  const p = readPlan(req);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!p.name || !email.includes('@')) return redirectWith(res, '/admin/restaurantes/novo', 'error', 'Informe nome e e-mail válidos.');
  let slug = slugify(p.name);
  while (get(db, 'SELECT 1 FROM restaurants WHERE slug = ?', slug)) slug = `${slugify(p.name)}-${token(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  const { lastInsertRowid: id } = run(db, 'INSERT INTO restaurants (name, slug, plan_name, subscription_status, max_dishes_3d, max_attempts, subscription_note) VALUES (?,?,?,?,?,?,?)',
    p.name, slug, p.plan_name, p.subscription_status, p.max_dishes_3d, p.max_attempts, p.subscription_note);
  const t = createInvite(db, id, email, req.user.id);
  audit(db, { userId: req.user.id, restaurantId: id, action: 'restaurant.create', detail: { email } });
  redirectWith(res, `/admin/restaurantes/${id}?convite=${t}`, 'ok', 'Restaurante criado. Envie o link de convite abaixo.');
});

r.get('/restaurantes/:id', loadRestaurant, (req, res) => {
  const { db } = req.app.locals;
  const x = req.rest;
  const usage = planUsage(db, x);
  const members = all(db, 'SELECT u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.restaurant_id = ?', x.id);
  const invites = all(db, "SELECT * FROM invites WHERE restaurant_id = ? AND used_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY id DESC", x.id);
  const cost = get(db, "SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(a.actual_credits/100.0, a.estimated_cost_usd)),0) AS usd, COALESCE(SUM(a.review_minutes),0) AS minutes FROM generation_attempts a JOIN dishes d ON d.id = a.dish_id WHERE d.restaurant_id = ? AND a.provider != 'manual'", x.id);
  const inviteLink = req.query.convite ? `${baseUrl(req)}/convite/${String(req.query.convite).replace(/[^A-Za-z0-9_-]/g, '')}` : null;
  render(req, res, { title: x.name, nav: 'restaurantes', body: html`
    <p><a href="/admin/restaurantes">← Restaurantes</a></p>
    <h1>${x.name}</h1>
    <p class="muted">Cardápio público: <a href="${menuUrl(req, x)}" target="_blank" rel="noopener">${menuUrl(req, x)}</a> · <a href="/admin?restaurant=${x.id}">ver fila</a> · <a href="/admin/restaurantes/${x.id}/export.json">exportar JSON</a></p>
    ${inviteLink ? html`<div class="flash ok"><strong>Link de convite (7 dias, uso único):</strong><br><code class="wrap">${inviteLink}</code></div>` : ''}
    <div class="stats">
      <div class="stat"><b>${usage.dishes3d}/${usage.maxDishes3d}</b><span>pratos em 3D</span></div>
      <div class="stat"><b>${usage.attempts}/${usage.maxAttempts}</b><span>tentativas usadas</span></div>
      <div class="stat"><b>US$ ${Number(cost.usd).toFixed(2)}</b><span>API (real ou estimado)</span></div>
      <div class="stat"><b>${cost.minutes} min</b><span>revisão registrada</span></div>
    </div>
    <h2>Plano e limites</h2>
    ${planForm(req, x, `/admin/restaurantes/${x.id}`)}
    <h2>Acessos</h2>
    ${members.length ? html`<ul>${members.map((m) => html`<li>${m.email} — ${m.name} (${m.role})</li>`)}</ul>` : html`<p class="muted">Ninguém aceitou convite ainda.</p>`}
    ${invites.map((i) => html`<p class="muted">Convite pendente para ${i.email} (expira ${fmtDate(i.expires_at)})</p>`)}
    <form method="post" action="/admin/restaurantes/${x.id}/convite" class="card inline-form">${csrf(req)}
      <input type="email" name="email" placeholder="e-mail para convidar ou restaurar acesso" required>
      <button>Gerar link de convite</button>
    </form>` });
});
r.post('/restaurantes/:id', loadRestaurant, (req, res) => {
  const p = readPlan(req);
  if (!p.name) return redirectWith(res, `/admin/restaurantes/${req.rest.id}`, 'error', 'Informe o nome.');
  run(req.app.locals.db, 'UPDATE restaurants SET name = ?, plan_name = ?, subscription_status = ?, max_dishes_3d = ?, max_attempts = ?, subscription_note = ? WHERE id = ?',
    p.name, p.plan_name, p.subscription_status, p.max_dishes_3d, p.max_attempts, p.subscription_note, req.rest.id);
  audit(req.app.locals.db, { userId: req.user.id, restaurantId: req.rest.id, action: 'restaurant.plan', detail: p });
  redirectWith(res, `/admin/restaurantes/${req.rest.id}`, 'ok', 'Plano salvo.');
});
r.post('/restaurantes/:id/convite', loadRestaurant, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email.includes('@')) return redirectWith(res, `/admin/restaurantes/${req.rest.id}`, 'error', 'E-mail inválido.');
  const t = createInvite(req.app.locals.db, req.rest.id, email, req.user.id);
  audit(req.app.locals.db, { userId: req.user.id, restaurantId: req.rest.id, action: 'invite.create', detail: { email } });
  res.redirect(`/admin/restaurantes/${req.rest.id}?convite=${t}`);
});
r.get('/restaurantes/:id/export.json', loadRestaurant, (req, res) => {
  const { db } = req.app.locals;
  const out = {
    restaurant: req.rest,
    categories: all(db, 'SELECT * FROM categories WHERE restaurant_id = ?', req.rest.id),
    dishes: all(db, 'SELECT * FROM dishes WHERE restaurant_id = ?', req.rest.id).map((d) => ({
      ...d,
      captures: all(db, 'SELECT position, private_path, mime, bytes, width, height, created_at FROM captures WHERE dish_id = ?', d.id),
      attempts: all(db, 'SELECT * FROM generation_attempts WHERE dish_id = ?', d.id),
      models: all(db, 'SELECT * FROM models WHERE dish_id = ?', d.id),
    })),
    usage: all(db, 'SELECT * FROM usage_daily WHERE restaurant_id = ?', req.rest.id),
  };
  res.setHeader('Content-Disposition', `attachment; filename="${req.rest.slug}.json"`);
  res.json(out);
});

// ---------- Prato (revisão) ----------
r.get('/pratos/:id/foto/:pos', loadDish, (req, res) => {
  const c = get(req.app.locals.db, 'SELECT * FROM captures WHERE dish_id = ? AND position = ?', req.dish.id, req.params.pos);
  const abs = c && resolveUnder(req.app.locals.cfg.privateDir, c.private_path);
  if (!abs || !fs.existsSync(abs)) return res.status(404).send('Sem foto.');
  res.type(c.mime).sendFile(abs, { dotfiles: 'allow', headers: { 'Cache-Control': 'private, max-age=300' } });
});
r.get('/pratos/:id/modelos/:mid/preview.glb', loadDish, (req, res) => {
  const m = get(req.app.locals.db, 'SELECT * FROM models WHERE id = ? AND dish_id = ?', Number(req.params.mid), req.dish.id);
  const abs = m && resolveUnder(req.app.locals.cfg.privateDir, m.original_private_path);
  if (!abs || !fs.existsSync(abs)) return res.status(404).send('Sem modelo.');
  res.type('model/gltf-binary').sendFile(abs, { dotfiles: 'allow', headers: { 'Cache-Control': 'private, max-age=300' } });
});

r.get('/pratos/:id', loadDish, (req, res) => {
  const { db, provider, cfg } = req.app.locals;
  const d = req.dish;
  const rest = get(db, 'SELECT * FROM restaurants WHERE id = ?', d.restaurant_id);
  const usage = planUsage(db, rest);
  const caps = Object.fromEntries(all(db, 'SELECT * FROM captures WHERE dish_id = ?', d.id).map((c) => [c.position, c]));
  const attempts = all(db, 'SELECT * FROM generation_attempts WHERE dish_id = ? ORDER BY attempt_no DESC', d.id);
  const models = all(db, 'SELECT * FROM models WHERE dish_id = ? ORDER BY id DESC', d.id);
  const hasRequired = ['front', 'left', 'back', 'right'].every((p) => caps[p]);
  const busy = ['generating'].includes(d.status);
  const modelCard = (m) => {
    const bbox = m.bbox_json ? JSON.parse(m.bbox_json) : null;
    const target = m.target_width_cm || d.width_cm || '';
    return html`
      <div class="card model-card">
        <p><strong>Modelo #${m.id}</strong> · ${m.source} · ${(m.glb_bytes / 1e6).toFixed(1)} MB · <span class="badge s-${m.status}">${{ candidate: 'Candidato', published: 'Publicado', rejected: 'Rejeitado', replaced: 'Substituído' }[m.status] || m.status}</span>
          ${bbox ? html`<br><small class="muted">Caixa no arquivo: ${bbox.size.map((v) => v.toFixed(3)).join(' × ')} m (largura ${(bbox.width * 100).toFixed(1)} cm, altura ${(bbox.height * 100).toFixed(1)} cm)</small>` : ''}
          ${m.status === 'published' ? html`<br><small>Escala ${m.scale_factor.toFixed(4)} → ${m.target_width_cm} cm. ${m.glb_bytes > cfg.modelWarnBytes ? '⚠ acima de 10 MB: pode demorar no celular.' : ''} ${m.usdz_public_path ? 'USDZ próprio.' : 'USDZ gerado pelo visualizador no iPhone.'}</small>` : ''}
        </p>
        <model-viewer src="/admin/pratos/${d.id}/modelos/${m.id}/preview.glb" camera-controls auto-rotate shadow-intensity="1" style="width:100%;height:320px;background:#f3f3f3;border-radius:8px"></model-viewer>
        ${m.status !== 'published' && m.status !== 'rejected' ? html`
          <form method="post" action="/admin/pratos/${d.id}/modelos/${m.id}/publicar" class="inline-form">${csrf(req)}
            <label>Largura real (cm) <input name="target_width_cm" inputmode="decimal" value="${target}" required class="narrow"></label>
            <button class="primary" ${bbox ? '' : 'disabled'}>Calibrar e publicar</button>
          </form>
          <form method="post" action="/admin/pratos/${d.id}/modelos/${m.id}/rejeitar" class="inline-form">${csrf(req)}
            <input name="reason" placeholder="motivo (objeto estranho, comida diferente, proporção...)" required maxlength="200">
            <select name="next"><option value="needs_photos">→ pedir novas fotos</option><option value="approved_for_generation">→ gerar de novo</option><option value="rejected">→ rejeitar prato</option></select>
            <button class="danger">Rejeitar modelo</button>
          </form>` : ''}
        ${m.status === 'published' ? html`<form method="post" action="/admin/pratos/${d.id}/despublicar" class="inline">${csrf(req)}<button class="danger">Despublicar</button></form>` : ''}
      </div>`;
  };
  render(req, res, {
    title: d.name, nav: 'fila', head: '<script type="module" src="/static/vendor/model-viewer.min.js"></script>',
    body: html`
      <p><a href="/admin">← Fila</a> · <a href="/admin/restaurantes/${d.restaurant_id}">${d.restaurant_name}</a></p>
      <h1>${d.name} ${badge(d.status)}</h1>
      <p class="muted">${money(d.price_cents)} · serve ${d.serves} · largura ${d.width_cm ?? '?'} cm · altura ${d.height_cm ?? '?'} cm · ${d.description || 'sem descrição'}${d.is_sold_out ? ' · ESGOTADO' : ''}${d.is_visible ? '' : ' · oculto no cardápio'}</p>
      ${d.status_note ? html`<p class="flash info">Nota atual: ${d.status_note}</p>` : ''}
      <p class="muted">Plano: ${usage.dishes3d}/${usage.maxDishes3d} pratos 3D · ${usage.attempts}/${usage.maxAttempts} tentativas · assinatura ${SUBSCRIPTION_LABEL[rest.subscription_status]}</p>

      <h2>Fotos</h2>
      <div class="slots">${POSITIONS.map((p) => html`<div class="slot"><div class="slot-head"><strong>${POSITION_LABEL[p]}</strong> <small class="muted">${caps[p] ? `${caps[p].width}×${caps[p].height} · ${(caps[p].bytes / 1e3).toFixed(0)} kB` : '—'}</small></div>
        <div class="slot-preview">${caps[p] ? html`<a href="/admin/pratos/${d.id}/foto/${p}" target="_blank"><img src="/admin/pratos/${d.id}/foto/${p}?v=${caps[p].id}" alt="${p}"></a>` : html`<div class="placeholder">sem foto</div>`}</div></div>`)}</div>

      <h2>Ações</h2>
      <div class="card">
        <form method="post" action="/admin/pratos/${d.id}/acao" class="inline-form">${csrf(req)}
          <input name="note" placeholder="motivo curto (obrigatório para pedir fotos/rejeitar)" maxlength="200">
          <button name="action" value="needs_photos" ${busy ? 'disabled' : ''}>Pedir novas fotos</button>
          <button name="action" value="approve" ${!hasRequired || busy ? 'disabled' : ''}>Aprovar para geração</button>
          <button name="action" value="generate" class="primary" ${!hasRequired || busy || !provider.configured || usage.attemptsLeft <= 0 || !usage.subscriptionOk ? 'disabled' : ''} onclick="return confirm('Iniciar geração paga (~US$ ${provider.estimatedCostUsd.toFixed(2)})?')">Gerar 3D agora (${provider.label})</button>
          <button name="action" value="reject" class="danger" ${busy ? 'disabled' : ''}>Rejeitar</button>
          <button name="action" value="reset" ${busy ? 'disabled' : ''}>Voltar para rascunho</button>
        </form>
        ${!provider.configured ? html`<p class="hint">Gerador não configurado (sem <code>TRIPO_API_KEY</code>). Use o envio manual abaixo.</p>` : ''}
        ${usage.attemptsLeft <= 0 ? html`<p class="hint">Limite de tentativas do plano atingido — ajuste no cadastro do restaurante.</p>` : ''}
        <form method="post" action="/admin/pratos/${d.id}/modelo" enctype="multipart/form-data" class="inline-form">${csrf(req)}
          <label>GLB <input type="file" name="glb" accept=".glb,model/gltf-binary" required></label>
          <label>USDZ (opcional) <input type="file" name="usdz" accept=".usdz"></label>
          <button ${busy ? 'disabled' : ''}>Enviar modelo manual</button>
        </form>
      </div>

      ${models.length ? html`<h2>Modelos</h2>${models.map(modelCard)}` : ''}

      <h2>Tentativas e custo</h2>
      ${attempts.length ? html`<table class="table"><thead><tr><th>#</th><th>Fornecedor</th><th>Status</th><th>Custo</th><th>Revisão (min)</th><th>Motivo de rejeição / erro</th><th>Quando</th></tr></thead><tbody>
        ${attempts.map((a) => html`<tr><td>${a.attempt_no}</td><td>${a.provider}${a.provider_task_id ? html`<br><small class="muted">${a.provider_task_id}</small>` : ''}</td><td>${a.status} ${a.status === 'running' ? `${a.progress}%` : ''}</td>
          <td>${a.actual_credits != null ? `${a.actual_credits} créditos (≈US$ ${(a.actual_credits / 100).toFixed(2)})` : `≈US$ ${a.estimated_cost_usd.toFixed(2)} (est.)`}</td>
          <td><form method="post" action="/admin/tentativas/${a.id}" class="inline-form">${csrf(req)}<input type="number" name="review_minutes" min="0" max="600" value="${a.review_minutes}" class="narrow"><input name="rejection_reason" value="${a.rejection_reason}" placeholder="motivo" maxlength="200"><button>Salvar</button></form></td>
          <td><small>${a.rejection_reason}${a.error_message ? html`<br><span class="danger">${a.error_message}</span>` : ''}</small></td><td><small>${fmtDate(a.created_at)}</small></td></tr>`)}
      </tbody></table>` : html`<p class="muted">Nenhuma tentativa ainda.</p>`}`,
  });
});

r.post('/pratos/:id/acao', loadDish, async (req, res) => {
  const { db, cfg, provider } = req.app.locals;
  const d = req.dish;
  const note = String(req.body.note || '').trim().slice(0, 200);
  const back = `/admin/pratos/${d.id}`;
  const action = String(req.body.action || '');
  const log = (a, detail) => audit(db, { userId: req.user.id, restaurantId: d.restaurant_id, dishId: d.id, action: a, detail });
  if (d.status === 'generating') return redirectWith(res, back, 'error', 'Aguarde a geração terminar.');
  if (action === 'needs_photos') {
    if (!note) return redirectWith(res, back, 'error', 'Escreva o motivo para o restaurante.');
    setStatus(db, d.id, 'needs_photos', note); log('dish.needs_photos', note);
    return redirectWith(res, back, 'ok', 'Restaurante será avisado para refazer as fotos.');
  }
  if (action === 'approve') { setStatus(db, d.id, 'approved_for_generation', ''); log('dish.approve'); return redirectWith(res, back, 'ok', 'Aprovado. Acione a geração ou envie um modelo manual.'); }
  if (action === 'reject') {
    if (!note) return redirectWith(res, back, 'error', 'Escreva o motivo da rejeição.');
    unpublish(db, cfg, d);
    setStatus(db, d.id, 'rejected', note); log('dish.reject', note);
    return redirectWith(res, back, 'ok', 'Prato rejeitado.');
  }
  if (action === 'reset') { unpublish(db, cfg, d); setStatus(db, d.id, 'draft', ''); log('dish.reset'); return redirectWith(res, back, 'ok', 'Voltou para rascunho.'); }
  if (action === 'generate') {
    const rest = get(db, 'SELECT * FROM restaurants WHERE id = ?', d.restaurant_id);
    try {
      const { taskId } = await startGeneration({ db, cfg, provider, dish: d, restaurant: rest, userId: req.user.id });
      return redirectWith(res, back, 'ok', `Geração iniciada (tarefa ${taskId}). A página atualiza quando a tarefa terminar; use "Verificar tarefas agora" para conferir.`);
    } catch (e) { return redirectWith(res, back, 'error', e.message); }
  }
  redirectWith(res, back, 'error', 'Ação desconhecida.');
});

const modelUpload = memoryUpload(40 * 1024 * 1024, 2).fields([{ name: 'glb', maxCount: 1 }, { name: 'usdz', maxCount: 1 }]);
r.post('/pratos/:id/modelo', loadDish, (req, res, next) => modelUpload(req, res, (err) => (err ? redirectWith(res, `/admin/pratos/${req.dish.id}`, 'error', 'Arquivo grande demais (máx. 40 MB).') : next())), csrfAfterUpload, (req, res) => {
  const { db, cfg } = req.app.locals;
  const d = req.dish;
  const back = `/admin/pratos/${d.id}`;
  const glb = req.files?.glb?.[0]?.buffer;
  const usdz = req.files?.usdz?.[0]?.buffer;
  if (!glb || !isGlb(glb)) return redirectWith(res, back, 'error', 'Envie um arquivo GLB válido (glTF binário 2.0).');
  if (usdz && !isUsdz(usdz)) return redirectWith(res, back, 'error', 'USDZ inválido.');
  let info;
  try { info = analyzeGlb(glb); } catch (e) { return redirectWith(res, back, 'error', `GLB recusado: ${e.message}`); }
  if (!info.bbox) return redirectWith(res, back, 'error', 'GLB sem geometria mensurável (accessors sem min/max).');
  const attemptNo = (get(db, 'SELECT COALESCE(MAX(attempt_no),0) AS n FROM generation_attempts WHERE dish_id = ?', d.id).n || 0) + 1;
  const { lastInsertRowid: attemptId } = run(db, "INSERT INTO generation_attempts (dish_id, attempt_no, provider, status, estimated_cost_usd, triggered_by, finished_at) VALUES (?,?,?,?,?,?, datetime('now'))", d.id, attemptNo, 'manual', 'success', 0, req.user.id);
  const rel = path.posix.join('models', randomName('glb'));
  writeUnder(cfg.privateDir, rel, glb);
  let usdzRel = null;
  if (usdz) { usdzRel = path.posix.join('models', randomName('usdz')); writeUnder(cfg.privateDir, usdzRel, usdz); }
  run(db, 'INSERT INTO models (dish_id, attempt_id, source, original_private_path, usdz_private_path, bbox_json, glb_bytes) VALUES (?,?,?,?,?,?,?)', d.id, attemptId, 'manual', rel, usdzRel, JSON.stringify(info.bbox), glb.length);
  if (d.status !== 'published') setStatus(db, d.id, 'model_review', '');
  audit(db, { userId: req.user.id, restaurantId: d.restaurant_id, dishId: d.id, action: 'model.manual_upload', detail: { bytes: glb.length } });
  redirectWith(res, back, 'ok', 'Modelo recebido. Confira a prévia, calibre a largura e publique.');
});

// Publica: reescala o GLB pela largura real, copia para a área pública e vincula ao prato.
r.post('/pratos/:id/modelos/:mid/publicar', loadDish, (req, res) => {
  const { db, cfg } = req.app.locals;
  const d = req.dish;
  const back = `/admin/pratos/${d.id}`;
  const m = get(db, 'SELECT * FROM models WHERE id = ? AND dish_id = ?', Number(req.params.mid), d.id);
  if (!m || !m.bbox_json) return redirectWith(res, back, 'error', 'Modelo inválido.');
  const target = parseNum(req.body.target_width_cm, { min: 5, max: 120, allowEmpty: false });
  if (Number.isNaN(target)) return redirectWith(res, back, 'error', 'Largura real deve estar entre 5 e 120 cm.');
  const bbox = JSON.parse(m.bbox_json);
  if (!(bbox.width > 0)) return redirectWith(res, back, 'error', 'Modelo sem largura mensurável.');
  const factor = (target / 100) / bbox.width;
  let scaled;
  try { scaled = rescaleGlb(fs.readFileSync(resolveUnder(cfg.privateDir, m.original_private_path)), factor); } catch (e) { return redirectWith(res, back, 'error', `Falha ao reescalar: ${e.message}`); }
  unpublish(db, cfg, d); // remove o modelo público anterior, se houver
  const rel = path.posix.join('models', randomName('glb'));
  writeUnder(cfg.publicDir, rel, scaled);
  let usdzRel = null;
  if (m.usdz_private_path) { usdzRel = path.posix.join('models', randomName('usdz')); writeUnder(cfg.publicDir, usdzRel, fs.readFileSync(resolveUnder(cfg.privateDir, m.usdz_private_path))); }
  run(db, "UPDATE models SET status = 'published', scale_factor = ?, target_width_cm = ?, glb_public_path = ?, usdz_public_path = ?, glb_bytes = ? WHERE id = ?", factor, target, rel, usdzRel, scaled.length, m.id);
  run(db, "UPDATE dishes SET status = 'published', status_note = '', published_model_id = ?, width_cm = ?, updated_at = datetime('now') WHERE id = ?", m.id, target, d.id);
  audit(db, { userId: req.user.id, restaurantId: d.restaurant_id, dishId: d.id, action: 'model.publish', detail: { modelId: m.id, factor, target } });
  const warn = scaled.length > cfg.modelWarnBytes ? ` Atenção: ${(scaled.length / 1e6).toFixed(1)} MB é pesado para celular.` : '';
  redirectWith(res, back, 'ok', `Publicado em ${target} cm de largura.${warn}`);
});

r.post('/pratos/:id/modelos/:mid/rejeitar', loadDish, (req, res) => {
  const { db, cfg } = req.app.locals;
  const d = req.dish;
  const m = get(db, 'SELECT * FROM models WHERE id = ? AND dish_id = ?', Number(req.params.mid), d.id);
  if (!m) return res.status(404).send('Modelo não encontrado.');
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  const next = ['needs_photos', 'approved_for_generation', 'rejected'].includes(req.body.next) ? req.body.next : 'needs_photos';
  if (m.status === 'published') unpublish(db, cfg, d);
  run(db, "UPDATE models SET status = 'rejected' WHERE id = ?", m.id);
  if (m.attempt_id) run(db, 'UPDATE generation_attempts SET rejection_reason = ? WHERE id = ?', reason, m.attempt_id);
  setStatus(db, d.id, next, next === 'approved_for_generation' ? '' : reason);
  audit(db, { userId: req.user.id, restaurantId: d.restaurant_id, dishId: d.id, action: 'model.reject', detail: { modelId: m.id, reason, next } });
  redirectWith(res, `/admin/pratos/${d.id}`, 'ok', 'Modelo rejeitado.');
});

r.post('/pratos/:id/despublicar', loadDish, (req, res) => {
  const { db, cfg } = req.app.locals;
  unpublish(db, cfg, req.dish);
  setStatus(db, req.dish.id, 'model_review', '');
  audit(db, { userId: req.user.id, restaurantId: req.dish.restaurant_id, dishId: req.dish.id, action: 'model.unpublish' });
  redirectWith(res, `/admin/pratos/${req.dish.id}`, 'ok', 'Modelo removido do cardápio público.');
});

// Remove arquivos públicos do modelo publicado e desvincula do prato.
function unpublish(db, cfg, dish) {
  for (const m of all(db, "SELECT * FROM models WHERE dish_id = ? AND status = 'published'", dish.id)) {
    for (const p of [m.glb_public_path, m.usdz_public_path]) if (p) removeQuiet(resolveUnder(cfg.publicDir, p));
    run(db, "UPDATE models SET status = 'replaced', glb_public_path = NULL, usdz_public_path = NULL WHERE id = ?", m.id);
  }
  run(db, 'UPDATE dishes SET published_model_id = NULL WHERE id = ?', dish.id);
}

r.post('/tentativas/:aid', (req, res) => {
  const { db } = req.app.locals;
  const a = get(db, 'SELECT * FROM generation_attempts WHERE id = ?', Number(req.params.aid));
  if (!a) return res.status(404).send('Tentativa não encontrada.');
  run(db, 'UPDATE generation_attempts SET review_minutes = ?, rejection_reason = ? WHERE id = ?', Math.max(0, Math.min(600, Number(req.body.review_minutes) || 0)), String(req.body.rejection_reason || '').trim().slice(0, 200), a.id);
  redirectWith(res, `/admin/pratos/${a.dish_id}`, 'ok', 'Registro salvo.');
});

export default r;

