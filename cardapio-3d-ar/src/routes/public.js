import { Router } from 'express';
import { get, all, run } from '../db.js';
import { html, raw, esc, money } from '../html.js';
import { rateLimit } from '../auth.js';
import { today } from '../lib/util.js';

const r = Router();
const KINDS = ['menu_open', 'dish_view', 'model_view', 'ar_view'];

export function track(db, restaurantId, dishId, kind) {
  run(db, 'INSERT INTO usage_daily (restaurant_id, dish_id, kind, day, count) VALUES (?,?,?,?,1) ON CONFLICT(restaurant_id, dish_id, kind, day) DO UPDATE SET count = count + 1', restaurantId, dishId || 0, kind, today());
}

function loadRestaurant(req, res, next) {
  const rest = get(req.app.locals.db, 'SELECT * FROM restaurants WHERE slug = ?', String(req.params.slug));
  if (!rest) return res.status(404).send(publicPage({ title: 'Cardápio', body: html`<h1>Cardápio não encontrado</h1>` }));
  req.rest = rest; next();
}

function publicPage({ title, body, viewer = false }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/static/menu.css">
${viewer ? '<script type="module" src="/static/vendor/model-viewer.min.js"></script>' : ''}
</head>
<body>
${body}
<footer class="foot">Imagens e modelos 3D são ilustrativos; porções reais podem variar.</footer>
</body>
</html>`;
}

// Cardápio: lista por categoria com foto, preço, pessoas e esgotado.
r.get('/m/:slug', loadRestaurant, (req, res) => {
  const { db } = req.app.locals;
  const rest = req.rest;
  const cats = all(db, 'SELECT * FROM categories WHERE restaurant_id = ? ORDER BY sort_order, name', rest.id);
  const dishes = all(db, 'SELECT * FROM dishes WHERE restaurant_id = ? AND is_visible = 1 ORDER BY sort_order, name', rest.id);
  track(db, rest.id, 0, 'menu_open');
  const card = (d) => html`
    <a class="dish ${d.is_sold_out ? 'sold-out' : ''}" href="/m/${rest.slug}/p/${d.id}">
      <span class="pic">${d.cover_public_path ? html`<img src="/files/${d.cover_public_path}" alt="${d.name}" loading="lazy">` : html`<span class="nopic">sem foto</span>`}${d.status === 'published' ? html`<span class="tag3d">3D</span>` : ''}</span>
      <span class="info"><strong>${d.name}</strong>${d.description ? html`<small>${d.description}</small>` : ''}
        <span class="meta"><b>${money(d.price_cents)}</b> · serve ${d.serves} ${d.serves > 1 ? 'pessoas' : 'pessoa'}${d.is_sold_out ? html` · <em>esgotado</em>` : ''}</span></span>
    </a>`;
  const groups = cats.map((c) => ({ c, items: dishes.filter((d) => d.category_id === c.id) })).filter((g) => g.items.length);
  const orphans = dishes.filter((d) => !cats.some((c) => c.id === d.category_id));
  res.setHeader('Cache-Control', 'no-cache');
  res.send(publicPage({ title: rest.name, body: html`
    <header class="head"><h1>${rest.name}</h1>${rest.tagline ? html`<p>${rest.tagline}</p>` : ''}</header>
    <main>
      ${groups.map((g) => html`<h2>${g.c.name}</h2><div class="list">${g.items.map(card)}</div>`)}
      ${orphans.length ? html`<h2>Outros</h2><div class="list">${orphans.map(card)}</div>` : ''}
      ${dishes.length === 0 ? html`<p class="empty">Cardápio em preparação.</p>` : ''}
    </main>` }));
});

// Prato: foto sempre; visualizador 3D/AR quando publicado.
r.get('/m/:slug/p/:id', loadRestaurant, (req, res) => {
  const { db } = req.app.locals;
  const rest = req.rest;
  const d = get(db, 'SELECT * FROM dishes WHERE id = ? AND restaurant_id = ? AND is_visible = 1', Number(req.params.id), rest.id);
  if (!d) return res.status(404).send(publicPage({ title: rest.name, body: html`<h1>Prato não encontrado</h1><p><a href="/m/${rest.slug}">Voltar ao cardápio</a></p>` }));
  const model = d.status === 'published' && d.published_model_id ? get(db, "SELECT * FROM models WHERE id = ? AND dish_id = ? AND status = 'published'", d.published_model_id, d.id) : null;
  track(db, rest.id, d.id, 'dish_view');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(publicPage({ title: `${d.name} · ${rest.name}`, viewer: !!model, body: html`
    <header class="head small"><a class="back" href="/m/${rest.slug}">← ${rest.name}</a></header>
    <main class="dish-page" data-restaurant="${rest.id}" data-dish="${d.id}">
      ${model ? html`
        <model-viewer id="mv" src="/files/${model.glb_public_path}" ${model.usdz_public_path ? html`ios-src="/files/${model.usdz_public_path}"` : ''}
          alt="${d.name} em 3D" poster="${d.cover_public_path ? `/files/${d.cover_public_path}` : ''}"
          ar ar-modes="scene-viewer webxr quick-look" ar-scale="fixed" ar-placement="floor"
          camera-controls touch-action="pan-y" auto-rotate shadow-intensity="1" exposure="1" loading="eager" reveal="auto">
          <button slot="ar-button" class="ar-btn">Ver na minha mesa</button>
          <div class="ar-hint" id="ar-hint" hidden>Realidade aumentada não disponível neste aparelho/navegador — gire o prato em 3D acima.</div>
        </model-viewer>
        <p class="tiny">Toque e arraste para girar; pince para aproximar. Tamanho em AR baseado na largura informada (${model.target_width_cm} cm). Visualização ilustrativa.</p>`
      : html`<div class="hero">${d.cover_public_path ? html`<img src="/files/${d.cover_public_path}" alt="${d.name}">` : html`<span class="nopic">sem foto</span>`}</div>`}
      <h1>${d.name}</h1>
      ${d.description ? html`<p class="desc">${d.description}</p>` : ''}
      <p class="meta"><b>${money(d.price_cents)}</b> · serve ${d.serves} ${d.serves > 1 ? 'pessoas' : 'pessoa'}${d.is_sold_out ? html` · <em class="sold">esgotado hoje</em>` : ''}</p>
    </main>
    ${model ? raw('<script src="/static/menu.js"></script>') : ''}` }));
});

// Contagem anônima de eventos vindos da página pública.
r.post('/api/track', (req, res) => {
  const { db } = req.app.locals;
  if (!rateLimit(`track:${req.ip}`, 120, 60e3)) return res.status(429).end();
  const kind = String(req.body?.kind || '');
  const restaurantId = Number(req.body?.restaurant); const dishId = Number(req.body?.dish) || 0;
  if (!['model_view', 'ar_view'].includes(kind) || !restaurantId) return res.status(400).end();
  if (dishId && !get(db, 'SELECT 1 FROM dishes WHERE id = ? AND restaurant_id = ?', dishId, restaurantId)) return res.status(400).end();
  track(db, restaurantId, dishId, kind);
  res.status(204).end();
});

export default r;
export { KINDS };
