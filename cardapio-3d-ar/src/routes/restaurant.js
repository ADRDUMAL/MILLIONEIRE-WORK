import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, audit } from '../db.js';
import { requireRestaurant, csrfAfterUpload } from '../auth.js';
import { html, raw, page, badge, money, STATUS_LABEL, POSITIONS, POSITION_LABEL, SUBSCRIPTION_LABEL } from '../html.js';
import { readFlash, redirectWith } from '../lib/flash.js';
import { sniffImage, imageSize, writeUnder, resolveUnder, removeQuiet, randomName, memoryUpload } from '../lib/files.js';
import { planUsage } from '../lib/generation.js';
import { menuUrl, qrPng, qrSvg, parsePriceCents, parseNum } from '../lib/util.js';

const r = Router();
r.use(requireRestaurant);

const NAV = (active) => [
  { href: '/app', label: 'Pratos', active: active === 'pratos' },
  { href: '/app/categorias', label: 'Categorias', active: active === 'categorias' },
  { href: '/app/qr', label: 'QR / Link', active: active === 'qr' },
  { href: '/app/metricas', label: 'Métricas', active: active === 'metricas' },
  { href: '/app/config', label: 'Casa', active: active === 'config' },
];
const render = (req, res, opts) => res.send(page({ user: req.user, flash: readFlash(req, res), ...opts, nav: NAV(opts.nav) }));
const csrf = (req) => html`<input type="hidden" name="_csrf" value="${req.user.csrf}">`;

// Carrega o prato somente se pertencer ao restaurante da sessão (404 para não revelar existência).
function loadDish(req, res, next) {
  const dish = get(req.app.locals.db, 'SELECT * FROM dishes WHERE id = ? AND restaurant_id = ?', Number(req.params.id), req.restaurant.id);
  if (!dish) return res.status(404).send('Prato não encontrado.');
  req.dish = dish; next();
}
const canEditPhotos = (d) => ['draft', 'needs_photos', 'rejected', 'failed'].includes(d.status);
const REQUIRED = ['front', 'left', 'back', 'right'];

// ---------- Painel ----------
r.get('/', (req, res) => {
  const { db } = req.app.locals;
  const rest = req.restaurant;
  const usage = planUsage(db, rest);
  const cats = all(db, 'SELECT * FROM categories WHERE restaurant_id = ? ORDER BY sort_order, name', rest.id);
  const dishes = all(db, 'SELECT * FROM dishes WHERE restaurant_id = ? ORDER BY sort_order, name', rest.id);
  const byCat = (cid) => dishes.filter((d) => d.category_id === cid);
  const item = (d) => html`
    <a class="row" href="/app/pratos/${d.id}">
      <span class="thumb">${d.cover_public_path ? html`<img src="/files/${d.cover_public_path}" alt="">` : ''}</span>
      <span class="grow"><strong>${d.name}</strong><br><small>${money(d.price_cents)} · serve ${d.serves}${d.is_sold_out ? ' · ESGOTADO' : ''}${d.is_visible ? '' : ' · oculto'}</small></span>
      ${badge(d.status)}
    </a>`;
  render(req, res, {
    title: rest.name, nav: 'pratos',
    body: html`
      <h1>${rest.name}</h1>
      <p class="muted">Plano ${rest.plan_name} · assinatura: ${SUBSCRIPTION_LABEL[rest.subscription_status] || rest.subscription_status} · pratos em 3D: ${usage.dishes3d}/${usage.maxDishes3d}</p>
      ${usage.subscriptionOk ? '' : html`<div class="flash error">Assinatura inativa: você pode editar preços e fotos, mas novos envios para 3D estão bloqueados. Fale com o suporte.</div>`}
      <p><a class="button primary" href="/app/pratos/novo">+ Novo prato</a> <a class="button" href="${menuUrl(req, rest)}" target="_blank" rel="noopener">Ver cardápio público</a></p>
      ${cats.map((c) => html`<h2>${c.name}</h2>${byCat(c.id).length ? byCat(c.id).map(item) : html`<p class="muted">Nenhum prato.</p>`}`)}
      ${byCat(null).length ? html`<h2>Sem categoria</h2>${byCat(null).map(item)}` : ''}
      ${dishes.length === 0 ? html`<p class="muted">Cadastre categorias e depois seus pratos.</p>` : ''}`,
  });
});

// ---------- Casa ----------
r.get('/config', (req, res) => {
  const rest = req.restaurant;
  render(req, res, { title: 'Dados da casa', nav: 'config', body: html`
    <h1>Dados da casa</h1>
    <form method="post" action="/app/config" class="card">${csrf(req)}
      <label>Nome <input name="name" required maxlength="80" value="${rest.name}"></label>
      <label>Frase curta (opcional) <input name="tagline" maxlength="120" value="${rest.tagline}"></label>
      <label>Telefone/WhatsApp (opcional) <input name="phone" maxlength="30" value="${rest.phone}" inputmode="tel"></label>
      <button class="primary">Salvar</button>
    </form>
    <p class="muted">O endereço do cardápio (<code>/m/${rest.slug}</code>) não muda ao alterar estes dados.</p>` });
});
r.post('/config', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return redirectWith(res, '/app/config', 'error', 'Informe o nome.');
  run(req.app.locals.db, 'UPDATE restaurants SET name = ?, tagline = ?, phone = ? WHERE id = ?',
    name, String(req.body.tagline || '').trim().slice(0, 120), String(req.body.phone || '').trim().slice(0, 30), req.restaurant.id);
  redirectWith(res, '/app/config', 'ok', 'Dados salvos.');
});

// ---------- Categorias ----------
r.get('/categorias', (req, res) => {
  const cats = all(req.app.locals.db, 'SELECT c.*, (SELECT COUNT(*) FROM dishes d WHERE d.category_id = c.id) AS n FROM categories c WHERE restaurant_id = ? ORDER BY sort_order, name', req.restaurant.id);
  render(req, res, { title: 'Categorias', nav: 'categorias', body: html`
    <h1>Categorias</h1>
    <form method="post" action="/app/categorias" class="card inline-form">${csrf(req)}
      <input name="name" placeholder="Ex.: Entradas" required maxlength="60"><button class="primary">Adicionar</button>
    </form>
    ${cats.map((c) => html`
      <form method="post" action="/app/categorias/${c.id}" class="card inline-form">${csrf(req)}
        <input name="name" value="${c.name}" required maxlength="60">
        <input name="sort_order" type="number" value="${c.sort_order}" title="Ordem" class="narrow" inputmode="numeric">
        <button>Salvar</button>
        <button name="delete" value="1" class="danger" ${c.n ? html`disabled title="Mova os pratos antes de excluir"` : ''} onclick="return confirm('Excluir categoria?')">Excluir</button>
        <small class="muted">${c.n} prato(s)</small>
      </form>`)}` });
});
r.post('/categorias', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (name) run(req.app.locals.db, 'INSERT INTO categories (restaurant_id, name, sort_order) VALUES (?,?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories WHERE restaurant_id = ?))', req.restaurant.id, name, req.restaurant.id);
  res.redirect('/app/categorias');
});
r.post('/categorias/:id', (req, res) => {
  const { db } = req.app.locals;
  const cat = get(db, 'SELECT * FROM categories WHERE id = ? AND restaurant_id = ?', Number(req.params.id), req.restaurant.id);
  if (!cat) return res.status(404).send('Categoria não encontrada.');
  if (req.body.delete) {
    if (get(db, 'SELECT 1 FROM dishes WHERE category_id = ?', cat.id)) return redirectWith(res, '/app/categorias', 'error', 'Mova os pratos antes de excluir.');
    run(db, 'DELETE FROM categories WHERE id = ?', cat.id);
  } else {
    const name = String(req.body.name || '').trim().slice(0, 60) || cat.name;
    run(db, 'UPDATE categories SET name = ?, sort_order = ? WHERE id = ?', name, Number(req.body.sort_order) || 0, cat.id);
  }
  res.redirect('/app/categorias');
});

// ---------- Pratos ----------
function dishForm(req, dish, cats) {
  const d = dish || { name: '', category_id: null, description: '', price_cents: 0, serves: 1, width_cm: '', height_cm: '', is_sold_out: 0, is_visible: 1 };
  const lockDims = dish && !canEditPhotos(dish) && dish.status !== 'awaiting_review';
  return html`
    <form method="post" action="${dish ? `/app/pratos/${dish.id}` : '/app/pratos'}" class="card">${csrf(req)}
      <label>Nome do prato <input name="name" required maxlength="80" value="${d.name}"></label>
      <label>Categoria <select name="category_id">
        <option value="">(sem categoria)</option>
        ${cats.map((c) => html`<option value="${c.id}" ${c.id === d.category_id ? 'selected' : ''}>${c.name}</option>`)}
      </select></label>
      <label>Descrição curta (opcional) <input name="description" maxlength="160" value="${d.description}"></label>
      <div class="grid2">
        <label>Preço (R$) <input name="price" required inputmode="decimal" value="${dish ? (d.price_cents / 100).toFixed(2).replace('.', ',') : ''}" placeholder="49,90"></label>
        <label>Serve quantas pessoas <input name="serves" type="number" min="1" max="20" required value="${d.serves}" inputmode="numeric"></label>
      </div>
      <div class="grid2">
        <label>Largura real do prato (cm) <input name="width_cm" inputmode="decimal" required value="${d.width_cm ?? ''}" placeholder="ex.: 28" ${lockDims ? 'readonly' : ''}></label>
        <label>Altura aproximada (cm, opcional) <input name="height_cm" inputmode="decimal" value="${d.height_cm ?? ''}" placeholder="ex.: 6" ${lockDims ? 'readonly' : ''}></label>
      </div>
      <p class="hint">A largura é usada para mostrar o prato no tamanho real na mesa do cliente. Meça de borda a borda do prato montado.</p>
      ${dish ? html`
        <label class="check"><input type="checkbox" name="is_sold_out" value="1" ${d.is_sold_out ? 'checked' : ''}> Esgotado hoje</label>
        <label class="check"><input type="checkbox" name="is_visible" value="1" ${d.is_visible ? 'checked' : ''}> Visível no cardápio</label>` : ''}
      <button class="primary">${dish ? 'Salvar alterações' : 'Criar prato e tirar fotos'}</button>
    </form>`;
}

r.get('/pratos/novo', (req, res) => {
  const cats = all(req.app.locals.db, 'SELECT * FROM categories WHERE restaurant_id = ? ORDER BY sort_order, name', req.restaurant.id);
  render(req, res, { title: 'Novo prato', nav: 'pratos', body: html`<h1>Novo prato</h1>${dishForm(req, null, cats)}` });
});

function readDishFields(req) {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const price = parsePriceCents(req.body.price);
  const serves = parseNum(req.body.serves, { min: 1, max: 20, allowEmpty: false });
  const width = parseNum(req.body.width_cm, { min: 5, max: 120 });
  const height = parseNum(req.body.height_cm, { min: 0.5, max: 60 });
  const errors = [];
  if (!name) errors.push('Informe o nome.');
  if (Number.isNaN(price)) errors.push('Preço inválido.');
  if (Number.isNaN(serves)) errors.push('Informe quantas pessoas serve (1 a 20).');
  if (Number.isNaN(width)) errors.push('Largura deve estar entre 5 e 120 cm.');
  if (Number.isNaN(height)) errors.push('Altura deve estar entre 0,5 e 60 cm.');
  const cat = req.body.category_id ? get(req.app.locals.db, 'SELECT id FROM categories WHERE id = ? AND restaurant_id = ?', Number(req.body.category_id), req.restaurant.id) : null;
  return { name, price, serves: Math.round(serves), width, height, categoryId: cat?.id ?? null, description: String(req.body.description || '').trim().slice(0, 160), errors };
}

r.post('/pratos', (req, res) => {
  const f = readDishFields(req);
  if (f.errors.length) return redirectWith(res, '/app/pratos/novo', 'error', f.errors.join(' '));
  const { lastInsertRowid } = run(req.app.locals.db,
    'INSERT INTO dishes (restaurant_id, category_id, name, description, price_cents, serves, width_cm, height_cm) VALUES (?,?,?,?,?,?,?,?)',
    req.restaurant.id, f.categoryId, f.name, f.description, f.price, f.serves, f.width, f.height);
  redirectWith(res, `/app/pratos/${lastInsertRowid}`, 'ok', 'Prato criado. Agora tire as 4 fotos.');
});

const TIPS = {
  front: 'Prato pronto, visto de frente, câmera na altura da mesa.',
  left: 'Gire você (não o prato) 90° para a esquerda.',
  back: 'Continue girando: agora o lado oposto à frente.',
  right: 'Último lado. Mesma altura e distância.',
  top: 'De cima, centralizado. Vira a foto de capa no cardápio.',
};

r.get('/pratos/:id', loadDish, (req, res) => {
  const { db } = req.app.locals;
  const dish = req.dish;
  const cats = all(db, 'SELECT * FROM categories WHERE restaurant_id = ? ORDER BY sort_order, name', req.restaurant.id);
  const caps = Object.fromEntries(all(db, 'SELECT * FROM captures WHERE dish_id = ?', dish.id).map((c) => [c.position, c]));
  const usage = planUsage(db, req.restaurant);
  const hasAll = REQUIRED.every((p) => caps[p]);
  const editable = canEditPhotos(dish);
  const slot = (p) => html`
    <div class="slot" data-position="${p}" data-has="${caps[p] ? '1' : '0'}">
      <div class="slot-head"><strong>${POSITION_LABEL[p]}</strong> <span class="slot-status muted">${caps[p] ? 'Salva ✓' : (p === 'top' ? 'opcional' : 'pendente')}</span></div>
      <div class="slot-preview">${caps[p] ? html`<img src="/app/pratos/${dish.id}/foto/${p}?v=${caps[p].id}" alt="${POSITION_LABEL[p]}">` : html`<div class="placeholder">${TIPS[p]}</div>`}</div>
      ${editable ? html`
        <div class="slot-actions">
          <label class="button primary">Tirar foto<input type="file" accept="image/*" capture="environment" hidden data-role="camera"></label>
          <label class="button">Galeria<input type="file" accept="image/*" hidden data-role="gallery"></label>
          <button type="button" class="link danger" data-role="remove" ${caps[p] ? '' : 'hidden'}>Remover</button>
        </div>` : ''}
    </div>`;
  render(req, res, {
    title: dish.name, nav: 'pratos', scripts: ['/static/capture.js'],
    body: html`
      <p><a href="/app">← Pratos</a></p>
      <h1>${dish.name} ${badge(dish.status)}</h1>
      ${dish.status_note ? html`<div class="flash ${dish.status === 'needs_photos' || dish.status === 'rejected' ? 'error' : 'info'}"><strong>Mensagem da revisão:</strong> ${dish.status_note}</div>` : ''}
      ${dish.status === 'awaiting_review' ? html`<div class="flash info">Fotos enviadas. Nossa equipe vai revisar e gerar o 3D. Você pode continuar editando preço e disponibilidade.</div>` : ''}
      ${dish.status === 'published' ? html`<div class="flash ok">Modelo 3D publicado. <a href="${menuUrl(req, req.restaurant)}/p/${dish.id}" target="_blank" rel="noopener">Ver no cardápio</a></div>` : ''}

      <section class="card" id="captura" data-dish="${dish.id}" data-csrf="${req.user.csrf}" data-editable="${editable ? '1' : '0'}">
        <h2>Fotos do prato</h2>
        <details class="tips" ${hasAll ? '' : 'open'}>
          <summary>Como fotografar (leia uma vez)</summary>
          <ul>
            <li><strong>Mesmo prato pronto</strong> nas 4 fotos: frente, esquerda, trás e direita.</li>
            <li>Boa luz, fundo simples (mesa lisa), prato inteiro no quadro.</li>
            <li>Sem talheres, taças ou mãos perto do prato. Prato parado.</li>
            <li>Câmera na mesma altura e distância nas 4 fotos; você gira ao redor, o prato não.</li>
            <li>A 5ª foto (de cima) é opcional e vira a capa no cardápio.</li>
          </ul>
        </details>
        <div class="slots">${POSITIONS.map(slot)}</div>
        ${editable ? html`
          <form method="post" action="/app/pratos/${dish.id}/enviar" class="submit-review">${csrf(req)}
            <button class="primary big" ${hasAll && dish.width_cm ? '' : 'disabled'} id="btn-enviar">Enviar para revisão</button>
            <p class="hint" id="enviar-hint">${hasAll ? (dish.width_cm ? 'Tudo pronto.' : 'Informe a largura do prato abaixo antes de enviar.') : 'Faltam fotos obrigatórias.'} Pratos em 3D disponíveis no plano: ${usage.dishesLeft} de ${usage.maxDishes3d}.</p>
          </form>` : html`<p class="hint">As fotos ficam travadas enquanto o prato está em revisão ou publicado.</p>`}
      </section>

      <h2>Dados do prato</h2>
      ${dishForm(req, dish, cats)}
      <form method="post" action="/app/pratos/${dish.id}/excluir" class="card" onsubmit="return confirm('Excluir este prato e suas fotos?')">${csrf(req)}
        <button class="danger">Excluir prato</button>
      </form>`,
  });
});

r.post('/pratos/:id', loadDish, (req, res) => {
  const f = readDishFields(req);
  if (f.errors.length) return redirectWith(res, `/app/pratos/${req.dish.id}`, 'error', f.errors.join(' '));
  const lockDims = !canEditPhotos(req.dish) && req.dish.status !== 'awaiting_review';
  const sql = `UPDATE dishes SET category_id = ?, name = ?, description = ?, price_cents = ?, serves = ?, ${lockDims ? '' : 'width_cm = ?, height_cm = ?,'} is_sold_out = ?, is_visible = ?, updated_at = datetime('now') WHERE id = ?`;
  const params = [f.categoryId, f.name, f.description, f.price, f.serves, ...(lockDims ? [] : [f.width, f.height]), req.body.is_sold_out ? 1 : 0, req.body.is_visible ? 1 : 0, req.dish.id];
  run(req.app.locals.db, sql, ...params);
  redirectWith(res, `/app/pratos/${req.dish.id}`, 'ok', 'Prato salvo.');
});

r.post('/pratos/:id/excluir', loadDish, (req, res) => {
  const { db, cfg } = req.app.locals;
  removeDishFiles(db, cfg, req.dish);
  run(db, 'DELETE FROM dishes WHERE id = ?', req.dish.id);
  audit(db, { userId: req.user.id, restaurantId: req.restaurant.id, dishId: req.dish.id, action: 'dish.delete' });
  redirectWith(res, '/app', 'ok', 'Prato excluído.');
});
export function removeDishFiles(db, cfg, dish) {
  for (const c of all(db, 'SELECT * FROM captures WHERE dish_id = ?', dish.id)) removeQuiet(resolveUnder(cfg.privateDir, c.private_path));
  for (const m of all(db, 'SELECT * FROM models WHERE dish_id = ?', dish.id)) {
    for (const p of [m.original_private_path, m.usdz_private_path]) if (p) removeQuiet(resolveUnder(cfg.privateDir, p));
    for (const p of [m.glb_public_path, m.usdz_public_path]) if (p) removeQuiet(resolveUnder(cfg.publicDir, p));
  }
  if (dish.cover_public_path) removeQuiet(resolveUnder(cfg.publicDir, dish.cover_public_path));
}

// ---------- Fotos (captura) ----------
r.get('/pratos/:id/foto/:pos', loadDish, (req, res) => {
  const c = get(req.app.locals.db, 'SELECT * FROM captures WHERE dish_id = ? AND position = ?', req.dish.id, req.params.pos);
  const abs = c && resolveUnder(req.app.locals.cfg.privateDir, c.private_path);
  if (!abs || !fs.existsSync(abs)) return res.status(404).send('Sem foto.');
  res.type(c.mime).sendFile(abs, { dotfiles: 'allow', headers: { 'Cache-Control': 'private, max-age=300' } });
});

const photoUpload = memoryUpload(8 * 1024 * 1024, 1).single('photo');
r.post('/pratos/:id/foto', loadDish, (req, res, next) => photoUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: 'Foto grande demais (máx. 8 MB).' });
  next();
}), csrfAfterUpload, (req, res) => {
  const { db, cfg } = req.app.locals;
  const dish = req.dish;
  const pos = String(req.body.position || '');
  if (!POSITIONS.includes(pos)) return res.status(400).json({ error: 'Posição inválida.' });
  if (!canEditPhotos(dish)) return res.status(409).json({ error: 'As fotos deste prato estão travadas (em revisão ou publicado).' });
  const buf = req.file?.buffer;
  const kind = buf && sniffImage(buf);
  if (!kind) return res.status(400).json({ error: 'Envie uma imagem JPEG, PNG ou WebP.' });
  const { width, height } = imageSize(buf, kind.mime);
  if (width && (width < 480 || height < 480)) return res.status(400).json({ error: 'Foto muito pequena (mínimo 480 px).' });

  const rel = path.posix.join('captures', String(dish.restaurant_id), String(dish.id), `${pos}-${randomName(kind.ext)}`);
  writeUnder(cfg.privateDir, rel, buf);
  const old = get(db, 'SELECT * FROM captures WHERE dish_id = ? AND position = ?', dish.id, pos);
  if (old) removeQuiet(resolveUnder(cfg.privateDir, old.private_path));
  run(db, "INSERT INTO captures (dish_id, position, private_path, mime, bytes, width, height) VALUES (?,?,?,?,?,?,?) ON CONFLICT(dish_id, position) DO UPDATE SET private_path = excluded.private_path, mime = excluded.mime, bytes = excluded.bytes, width = excluded.width, height = excluded.height, created_at = datetime('now')",
    dish.id, pos, rel, kind.mime, buf.length, width, height);
  refreshCover(db, cfg, dish.id);
  run(db, "UPDATE dishes SET updated_at = datetime('now') WHERE id = ?", dish.id);
  const cap = get(db, 'SELECT id FROM captures WHERE dish_id = ? AND position = ?', dish.id, pos);
  const complete = REQUIRED.every((p) => get(db, 'SELECT 1 FROM captures WHERE dish_id = ? AND position = ?', dish.id, p));
  res.json({ ok: true, url: `/app/pratos/${dish.id}/foto/${pos}?v=${cap.id}`, position: pos, complete, hasWidth: !!dish.width_cm });
});

r.post('/pratos/:id/foto/:pos/excluir', loadDish, (req, res) => {
  const { db, cfg } = req.app.locals;
  if (!canEditPhotos(req.dish)) return res.status(409).json({ error: 'Fotos travadas.' });
  const c = get(db, 'SELECT * FROM captures WHERE dish_id = ? AND position = ?', req.dish.id, req.params.pos);
  if (c) { removeQuiet(resolveUnder(cfg.privateDir, c.private_path)); run(db, 'DELETE FROM captures WHERE id = ?', c.id); refreshCover(db, cfg, req.dish.id); }
  res.json({ ok: true });
});

// A capa pública é a foto "de cima" ou, na falta dela, a "frente". Copiada para a área pública.
export function refreshCover(db, cfg, dishId) {
  const dish = get(db, 'SELECT * FROM dishes WHERE id = ?', dishId);
  const src = get(db, 'SELECT * FROM captures WHERE dish_id = ? AND position = ?', dishId, 'top') || get(db, 'SELECT * FROM captures WHERE dish_id = ? AND position = ?', dishId, 'front');
  if (dish.cover_public_path) removeQuiet(resolveUnder(cfg.publicDir, dish.cover_public_path));
  let rel = null;
  if (src) {
    const ext = src.mime === 'image/jpeg' ? 'jpg' : src.mime.split('/')[1];
    rel = path.posix.join('photos', randomName(ext));
    writeUnder(cfg.publicDir, rel, fs.readFileSync(resolveUnder(cfg.privateDir, src.private_path)));
  }
  run(db, 'UPDATE dishes SET cover_public_path = ? WHERE id = ?', rel, dishId);
}

// ---------- Enviar para revisão ----------
r.post('/pratos/:id/enviar', loadDish, (req, res) => {
  const { db } = req.app.locals;
  const dish = req.dish;
  const back = `/app/pratos/${dish.id}`;
  if (!canEditPhotos(dish)) return redirectWith(res, back, 'error', 'Este prato já foi enviado.');
  const missing = REQUIRED.filter((p) => !get(db, 'SELECT 1 FROM captures WHERE dish_id = ? AND position = ?', dish.id, p));
  if (missing.length) return redirectWith(res, back, 'error', `Faltam fotos: ${missing.map((p) => POSITION_LABEL[p]).join(', ')}.`);
  if (!dish.width_cm) return redirectWith(res, back, 'error', 'Informe a largura real do prato.');
  const usage = planUsage(db, req.restaurant);
  if (!usage.subscriptionOk) return redirectWith(res, back, 'error', 'Assinatura inativa. Fale com o suporte.');
  if (usage.dishesLeft <= 0) return redirectWith(res, back, 'error', `Limite do plano atingido: ${usage.maxDishes3d} pratos em 3D. Fale com o suporte para ampliar.`);
  run(db, "UPDATE dishes SET status = 'awaiting_review', status_note = '', updated_at = datetime('now') WHERE id = ?", dish.id);
  audit(db, { userId: req.user.id, restaurantId: req.restaurant.id, dishId: dish.id, action: 'dish.submit' });
  redirectWith(res, back, 'ok', 'Enviado! Vamos revisar as fotos e avisar aqui no painel.');
});

// ---------- QR / link ----------
r.get('/qr', (req, res) => {
  const url = menuUrl(req, req.restaurant);
  render(req, res, { title: 'QR code', nav: 'qr', body: html`
    <h1>QR code do cardápio</h1>
    <p>Este endereço é permanente: alterar pratos, preços ou modelos não muda o QR.</p>
    <p class="card"><code>${url}</code></p>
    <p><img src="/app/qr.png" alt="QR code" class="qr"></p>
    <p><a class="button primary" href="/app/qr.png" download="qr-${req.restaurant.slug}.png">Baixar PNG</a> <a class="button" href="/app/qr.svg" download="qr-${req.restaurant.slug}.svg">Baixar SVG</a> <a class="button" href="/app/qr/imprimir" target="_blank">Imprimir</a></p>` });
});
r.get('/qr.png', async (req, res) => { res.type('png').send(await qrPng(menuUrl(req, req.restaurant))); });
r.get('/qr.svg', async (req, res) => { res.type('svg').send(await qrSvg(menuUrl(req, req.restaurant))); });
r.get('/qr/imprimir', async (req, res) => {
  const url = menuUrl(req, req.restaurant);
  const body = html`<h1>${req.restaurant.name}</h1><p>Aponte a câmera para ver o cardápio em 3D</p>${raw(await qrSvg(url))}<p><small>${url}</small></p>`;
  res.send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>QR</title><style>body{font-family:system-ui;text-align:center;padding:2rem}svg{width:70vmin;max-width:600px}h1{margin:0}</style>${body}<script>window.print()</script></html>`);
});

// ---------- Métricas ----------
r.get('/metricas', (req, res) => {
  const { db } = req.app.locals;
  const rid = req.restaurant.id;
  const tot = (kind) => get(db, "SELECT COALESCE(SUM(count),0) AS n FROM usage_daily WHERE restaurant_id = ? AND kind = ? AND day >= date('now', '-30 days')", rid, kind).n;
  const perDish = all(db, `SELECT d.name, d.status,
      COALESCE(SUM(CASE WHEN u.kind='dish_view' THEN u.count END),0) AS views,
      COALESCE(SUM(CASE WHEN u.kind='model_view' THEN u.count END),0) AS views3d,
      COALESCE(SUM(CASE WHEN u.kind='ar_view' THEN u.count END),0) AS ar
    FROM dishes d LEFT JOIN usage_daily u ON u.dish_id = d.id AND u.restaurant_id = d.restaurant_id AND u.day >= date('now','-30 days')
    WHERE d.restaurant_id = ? GROUP BY d.id ORDER BY views DESC, d.name`, rid);
  render(req, res, { title: 'Métricas', nav: 'metricas', body: html`
    <h1>Métricas (últimos 30 dias)</h1>
    <div class="stats">
      <div class="stat"><b>${tot('menu_open')}</b><span>aberturas do cardápio</span></div>
      <div class="stat"><b>${tot('dish_view')}</b><span>pratos vistos</span></div>
      <div class="stat"><b>${tot('model_view')}</b><span>visualizações 3D</span></div>
      <div class="stat"><b>${tot('ar_view')}</b><span>aberturas em AR</span></div>
    </div>
    <table class="table"><thead><tr><th>Prato</th><th>Vistos</th><th>3D</th><th>AR</th></tr></thead>
    <tbody>${perDish.map((d) => html`<tr><td>${d.name} <small class="muted">${STATUS_LABEL[d.status]}</small></td><td>${d.views}</td><td>${d.views3d}</td><td>${d.ar}</td></tr>`)}</tbody></table>
    <p class="muted">Contagens agregadas por dia, sem dados pessoais.</p>` });
});

export default r;
