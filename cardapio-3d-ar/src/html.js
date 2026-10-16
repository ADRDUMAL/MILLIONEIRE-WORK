// Template HTML mínimo com escape automático. Valores interpolados são escapados,
// exceto quando marcados com raw(). Sem engine externa.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return new Raw(out);
}
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export const STATUS_LABEL = {
  draft: 'Rascunho',
  awaiting_review: 'Aguardando revisão',
  needs_photos: 'Pedir novas fotos',
  approved_for_generation: 'Aprovado para geração',
  generating: 'Gerando 3D',
  model_review: 'Modelo em revisão',
  published: 'Publicado em 3D',
  rejected: 'Rejeitado',
  failed: 'Falha na geração',
};
export const STATUSES = Object.keys(STATUS_LABEL);
export const POSITIONS = ['front', 'left', 'back', 'right', 'top'];
export const POSITION_LABEL = { front: 'Frente', left: 'Esquerda', back: 'Trás', right: 'Direita', top: 'De cima (capa, opcional)' };
export const SUBSCRIPTION_LABEL = { trial: 'Teste', active: 'Ativa', past_due: 'Em atraso', cancelled: 'Cancelada' };

export const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const badge = (status) => html`<span class="badge s-${status}">${STATUS_LABEL[status] || status}</span>`;

export function page({ title, body, user = null, nav = [], flash = null, scripts = [], wide = false, head = '' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)} · Cardápio 3D</title>
<link rel="stylesheet" href="/static/app.css">
${head}
</head>
<body>
<header class="top">
  <a class="brand" href="${user ? (user.is_admin ? '/admin' : '/app') : '/'}">Cardápio 3D</a>
  <nav>${nav.map((n) => `<a href="${esc(n.href)}"${n.active ? ' class="active"' : ''}>${esc(n.label)}</a>`).join('')}
  ${user ? `<form method="post" action="/sair" class="inline"><input type="hidden" name="_csrf" value="${esc(user.csrf)}"><button class="link">Sair</button></form>` : ''}</nav>
</header>
<main class="${wide ? 'wide' : ''}">
${flash ? `<div class="flash ${esc(flash.type)}">${esc(flash.text)}</div>` : ''}
${render(body)}
</main>
${scripts.map((s) => `<script src="${esc(s)}"></script>`).join('\n')}
</body>
</html>`;
}
