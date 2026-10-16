// Componentes de interface do preview Forma 3D (nome provisório). Reutiliza o template `html`
// do projeto; sem engine externa. Tudo aqui é apresentação — dados vêm de ./data.js.
import { html, raw, esc } from '../html.js';
import { ACCOUNT, STATUS } from './data.js';

// ---------- Ícones (stroke 1.75, 20px) ----------
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cube: '<path d="m12 2 8 4.5v9L12 20l-8-4.5v-9z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
  pencil: '<path d="m4 20 4-1L20 7l-3-3L5 16zM14 6l3 3"/>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M8 7l4-4 4 4"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5M3 17l9 5 9-5"/>',
  pin: '<circle cx="12" cy="10" r="3"/><path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ruler: '<path d="m3 17 14-14 4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ar: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="m12 7 4 2.3v4.6L12 16l-4-2.1V9.3z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevron: '<path d="m6 15 6-6 6 6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
};
export const icon = (name, size = 20) => raw(`<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`);

// ---------- Ilustrações estáticas dos produtos (thumbnails; o 3D completo abre no editor) ----------
// `mode: 'wire'` desenha só contornos (usado no processamento como "parte ainda não renderizada").
const ILLO = {
  mug: (f) => `
    <ellipse cx="100" cy="176" rx="52" ry="8" fill="${f.shadow}"/>
    <path d="M140 92c22 0 30 12 30 26s-8 26-30 26" fill="none" stroke="${f.accent}" stroke-width="14"/>
    <path d="M140 92c22 0 30 12 30 26s-8 26-30 26" fill="none" stroke="${f.line}" stroke-width="1.5"/>
    <path d="M58 70h84v82a12 12 0 0 1-12 12H70a12 12 0 0 1-12-12z" fill="${f.body}" stroke="${f.line}" stroke-width="1.5"/>
    <path d="M58 70h84v82a12 12 0 0 1-12 12H70a12 12 0 0 1-12-12z" fill="url(#shade)" opacity=".35"/>
    <ellipse cx="100" cy="70" rx="42" ry="11" fill="${f.body}" stroke="${f.line}" stroke-width="1.5"/>
    <ellipse cx="100" cy="70" rx="34" ry="7.5" fill="${f.inner}" stroke="${f.line}" stroke-width="1"/>`,
  chair: (f) => `
    <ellipse cx="100" cy="182" rx="62" ry="7" fill="${f.shadow}"/>
    <path d="M62 128l-6 50M138 128l6 50M76 124l-3 42M124 124l3 42" stroke="${f.wood}" stroke-width="6" stroke-linecap="round"/>
    <path d="M62 38h64a10 10 0 0 1 10 10v66H62z" fill="${f.accent}" stroke="${f.line}" stroke-width="1.5"/>
    <path d="M62 38h64a10 10 0 0 1 10 10v66H62z" fill="url(#shade)" opacity=".3"/>
    <path d="M50 108h100l10 22H40z" fill="${f.body}" stroke="${f.line}" stroke-width="1.5"/>
    <path d="M40 130h120v8H40z" fill="${f.accentDark}" stroke="${f.line}" stroke-width="1.5"/>`,
  sneaker: (f) => `
    <ellipse cx="102" cy="172" rx="76" ry="7" fill="${f.shadow}"/>
    <path d="M22 136q0-12 14-14l122-8q30-2 30 14v10q0 10-12 10H34q-12 0-12-12z" fill="${f.body}" stroke="${f.line}" stroke-width="1.5"/>
    <path d="M36 122c6-38 28-62 58-64 14-1 20 10 28 22 10 14 26 26 46 32l4 8z" fill="${f.accent}" stroke="${f.line}" stroke-width="1.5"/>
    <path d="M36 122c6-38 28-62 58-64 14-1 20 10 28 22 10 14 26 26 46 32l4 8z" fill="url(#shade)" opacity=".28"/>
    <path d="M92 78l16 4M88 88l18 6M86 98l20 8M86 108l22 8" stroke="${f.laces}" stroke-width="3" stroke-linecap="round"/>
    <path d="M56 116c6-14 12-28 26-44" fill="none" stroke="${f.line}" stroke-width="1.5" opacity=".5"/>`,
};
const FILL = {
  mug: { body: '#FFFDF8', inner: '#3D2B22', accent: '#B06A4A', line: '#8A6A5A', shadow: 'rgba(11,43,32,.12)' },
  chair: { body: '#D9A26F', accent: '#C88A5A', accentDark: '#B7784C', wood: '#5C3D25', line: '#7A5236', shadow: 'rgba(11,43,32,.12)' },
  sneaker: { body: '#E4DFD3', accent: '#315CFF', laces: '#F4F1E8', line: '#3A4A6E', shadow: 'rgba(11,43,32,.12)' },
};
export function illo(kind, { mode = 'fill', stroke = '#B8F36B' } = {}) {
  const draw = ILLO[kind] || ILLO.mug;
  const f = mode === 'wire'
    ? { body: 'none', inner: 'none', accent: 'none', accentDark: 'none', wood: stroke, laces: stroke, line: stroke, shadow: 'none' }
    : FILL[kind] || FILL.mug;
  return raw(`<svg class="illo illo-${mode}" viewBox="0 0 200 200" role="img" aria-hidden="true">
    <defs><linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#0B352B" stop-opacity=".45"/></linearGradient></defs>
    ${draw(f)}</svg>`);
}

// ---------- Pequenos componentes ----------
export const statusPill = (key, extra = '') => {
  const s = STATUS[key] || STATUS.draft;
  return html`<span class="pill pill-${s.tone}" ${raw(extra)}>${icon(s.icon, 14)}<span>${s.label}</span></span>`;
};

export const button = ({ label, href, kind = 'secondary', iconName, attrs = '', type = 'button', size = '' }) => {
  const cls = `btn btn-${kind}${size ? ` btn-${size}` : ''}`;
  const inner = html`${iconName ? icon(iconName, 18) : ''}<span>${label}</span>`;
  return href ? html`<a class="${cls}" href="${href}" ${raw(attrs)}>${inner}</a>` : html`<button class="${cls}" type="${type}" ${raw(attrs)}>${inner}</button>`;
};

export const iconButton = ({ label, iconName, attrs = '', kind = 'ghost', cls = '' }) => html`<button class="btn-icon btn-icon-${kind} ${raw(cls)}" type="button" aria-label="${label}" title="${label}" ${raw(attrs)}>${icon(iconName, 18)}</button>`;

export const productCard = (p) => html`
  <article class="pcard" data-status="${p.status}">
    <a class="pcard-media" href="/studio/produtos/${p.slug}${p.status === 'processing' ? '/processando' : ''}" aria-label="Abrir ${p.name}">
      ${illo(p.illo)}
      ${p.status === 'processing' ? html`<span class="pcard-progress" aria-hidden="true"><i style="width:${p.progress}%"></i></span>` : ''}
    </a>
    <div class="pcard-body">
      <div class="pcard-title">
        <div><h3><a href="/studio/produtos/${p.slug}">${p.name}</a></h3><p class="pcard-meta">${p.category} · <span class="formats">3D · AR · Web</span></p></div>
        ${iconButton({ label: `Mais opções de ${p.name}`, iconName: 'more', attrs: 'data-toast="Renomear, duplicar e excluir chegam em uma próxima fase do preview."' })}
      </div>
      <div class="pcard-foot">
        ${statusPill(p.status)}
        ${p.status === 'published' ? html`<a class="pcard-link" href="/p/${p.slug}">Ver página ${icon('arrow', 14)}</a>` : p.status === 'processing' ? html`<span class="pcard-link muted">${p.progress}% concluído</span>` : ''}
      </div>
    </div>
  </article>`;

// Métrica compacta da home (§7): número forte, rótulo curto e uma linha de contexto verdadeira.
// `hint` descreve o que o número é — nunca uma tendência inventada.
export const metric = ({ label, value, hint, key = '', tone = '' }) => html`
  <div class="metric${tone ? ` metric-${tone}` : ''}">
    <dt>${label}</dt>
    <dd><b ${key ? raw(`data-metric="${key}" data-base="${value}"`) : ''}>${value}</b><small ${key ? raw(`data-metric-hint="${key}"`) : ''}>${hint}</small></dd>
  </div>`;

// Item de lista reutilizável (método de criação, atalhos, opções). Título e descrição nunca
// disputam colunas: `.mcard-text` empilha os dois em qualquer largura.
export const listItem = ({ title, text, iconName = 'cube', href, attrs = '', badge = '' }) => {
  const inner = html`<span class="mcard-ic">${icon(iconName, 22)}</span>
    <span class="mcard-text"><b>${title}${badge ? html`<span class="mcard-badge">${badge}</span>` : ''}</b>${text ? html`<small>${text}</small>` : ''}</span>
    <span class="mcard-go">${icon('arrow', 18)}</span>`;
  return href ? html`<a class="mcard" href="${href}" ${raw(attrs)}>${inner}</a>` : html`<button class="mcard" type="button" ${raw(attrs)}>${inner}</button>`;
};

// Linha de produto da home (§7): miniatura, nome, estado, data, views, ação rápida e menu.
// Em vez de três cartões grandes, a lista deixa a operação inteira acima da dobra.
export const productRow = ({ slug, name, meta, media, status, views = '', action = null, progress = 0 }) => {
  const href = status === 'processing' ? `/studio/produtos/${slug}/processando` : `/studio/produtos/${slug}`;
  return html`<li class="prow">
    <a class="prow-media" href="${href}" tabindex="-1" aria-hidden="true">${media}${status === 'processing' ? html`<span class="pcard-progress"><i style="width:${progress}%"></i></span>` : ''}</a>
    <div class="prow-main"><h3><a href="${href}">${name}</a></h3><p class="prow-meta">${meta}</p></div>
    <div class="prow-foot">
      ${views ? html`<span class="prow-views">${views}</span>` : ''}
      ${statusPill(status)}
      ${action ? html`<a class="prow-action" href="${action.href}">${action.label}${icon('arrow', 14)}</a>` : ''}
    </div>
    ${iconButton({ label: `Mais opções de ${name}`, iconName: 'more', attrs: 'data-toast="Renomear, duplicar e arquivar chegam na Sprint de lista de produtos."' })}
  </li>`;
};

// ---------- Layouts ----------
const NAV_MAIN = [
  { key: 'inicio', href: '/studio', label: 'Início', icon: 'home' },
  { key: 'produtos', href: '/studio/produtos', label: 'Meus produtos', icon: 'cube' },
  { key: 'capturar', href: '/studio/produtos/novo', label: 'Criar modelo', icon: 'camera' },
  { key: 'publicacoes', href: '/studio/publicacoes', label: 'Publicações', icon: 'globe' },
  { key: 'estatisticas', href: '/studio/estatisticas', label: 'Estatísticas', icon: 'chart' },
  { key: 'integracoes', href: '/studio/integracoes', label: 'Integrações', icon: 'plug' },
];
const NAV_FOOT = [
  { key: 'ajuda', href: '/studio/ajuda', label: 'Ajuda', icon: 'help' },
  { key: 'config', href: '/studio/configuracoes', label: 'Estúdio', icon: 'settings' },
];
// `data-key` é o que permite ao indicador deslizar: o JS acha o item da seção anterior por ele.
const navItem = (n, active) => html`<a class="snav-item${n.key === active ? ' is-active' : ''}" data-key="${n.key}" href="${n.href}" ${n.key === active ? raw('aria-current="page"') : ''}>${icon(n.icon)}<span>${n.label}</span></a>`;

// Celular (§6): a sidebar não é comprimida — some e dá lugar a quatro destinos fixos. "Criar" é a
// ação principal e ganha o lime; "Mais" reabre a mesma gaveta, então nada fica inacessível.
// Captura V2: "Mais" saiu — levava a páginas sem função. "Estúdio" reúne conta, marca, compartilhamento,
// preferências 3D e os atalhos que antes só existiam na gaveta (publicações, estatísticas, ajuda).
const NAV_BOTTOM = [
  { key: 'inicio', href: '/studio', label: 'Início', icon: 'home' },
  { key: 'produtos', href: '/studio/produtos', label: 'Produtos', icon: 'cube' },
  { key: 'capturar', href: '/studio/produtos/novo', label: 'Criar', icon: 'plus', cta: true },
  { key: 'config', href: '/studio/configuracoes', label: 'Estúdio', icon: 'settings', also: ['publicacoes', 'estatisticas', 'integracoes', 'ajuda'] },
];
const bottomNav = (active) => html`<nav class="bnav" aria-label="Navegação principal (celular)">
  ${NAV_BOTTOM.map((n) => { const on = n.key === active || (n.also || []).includes(active); return html`<a class="bnav-item${n.cta ? ' bnav-cta' : ''}${on ? ' is-active' : ''}" href="${n.href}" ${on ? raw('aria-current="page"') : ''}><span class="bnav-ic">${icon(n.icon, 20)}</span><span>${n.label}</span></a>`; })}
</nav>`;

// Marca (Sprint A.5). O arquivo oficial entregue é um só: lockup horizontal em tinta quase preta
// sobre fundo transparente (`public/brand/README.md` registra o recorte e o que ainda falta).
// Como não existe versão clara, em superfície escura o lockup vai dentro de uma placa clara
// (`.brand-dark`, `.mhead .brand`) — nenhum filtro, nenhuma recriação em CSS.
export const brand = (cls = '') => html`<a class="brand ${raw(cls)}" href="/" aria-label="Forma 3D — início">
  <img class="brand-img" src="/static/brand/forma3d-lockup.png?v=${ASSET_V}" width="720" height="185" alt="Forma 3D" decoding="async"></a>`;

// Versão dos assets: muda a cada reinício do servidor para evitar CSS/JS antigos em cache (maxAge 1h).
export const ASSET_V = Date.now().toString(36);

// Documento base compartilhado por landing, app shell e página pública.
// Ordem importa: store e provider antes das telas que os consomem.
export const DEFAULT_SCRIPTS = ['/static/forma-store.js', '/static/forma-reconstruction.js', '/static/forma.js'];

export function doc({ title, body, viewer = false, cls = '', scripts = DEFAULT_SCRIPTS }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<title>${esc(title)} · Forma 3D</title>
<link rel="icon" type="image/png" sizes="64x64" href="/static/brand/forma3d-symbol-64.png?v=${ASSET_V}">
<link rel="apple-touch-icon" href="/static/brand/forma3d-symbol.png?v=${ASSET_V}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/static/forma.css?v=${ASSET_V}">
${viewer ? '<script type="module" src="/static/vendor/model-viewer.min.js"></script>' : ''}
</head>
<body class="${esc(cls)}">
${body}
${scripts.map((s) => `<script src="${esc(s)}?v=${ASSET_V}" defer></script>`).join('\n')}
</body>
</html>`;
}

// App shell: sidebar + header + conteúdo. `active` marca o item da navegação.
export function shell({ title, active, heading, subheading, actions = '', body, viewer = false, wide = false, scripts = DEFAULT_SCRIPTS }) {
  // Título contextual do header mobile: nome da seção ativa (o h1 da página fica no topbar).
  const section = [...NAV_MAIN, ...NAV_FOOT].find((n) => n.key === active)?.label || heading;
  return doc({ title, viewer, cls: 'has-shell', scripts, body: html`
    <header class="mhead">
      <button class="btn-icon mhead-menu" type="button" aria-label="Abrir menu" aria-controls="snav" aria-expanded="false" data-drawer-open>${icon('menu', 22)}</button>
      ${brand('brand-sm')}
      <span class="mhead-title">${section}</span>
    </header>
    <div class="shell">
      <div class="drawer-backdrop" id="drawer-backdrop" data-drawer-close hidden></div>
      <aside class="snav" id="snav" aria-label="Navegação principal">
        <div class="snav-top">${brand('brand-dark')}<button class="btn-icon snav-close" type="button" aria-label="Fechar menu" data-drawer-close>${icon('x', 20)}</button></div>
        <span class="snav-ind" id="snav-ind" data-active="${active}" hidden aria-hidden="true"></span>
        <nav class="snav-main">${NAV_MAIN.map((n) => navItem(n, active))}</nav>
        <nav class="snav-foot" aria-label="Ajuda e configurações">${NAV_FOOT.map((n) => navItem(n, active))}</nav>
        <a class="snav-user" href="/studio/configuracoes"><span class="avatar">${ACCOUNT.initials}</span><span><b>${ACCOUNT.company}</b><small>${ACCOUNT.name} · ${ACCOUNT.plan}</small></span></a>
      </aside>
      <div class="shell-main">
        <header class="topbar topbar-${active}">
          <div class="topbar-title"><h1>${heading}</h1>${subheading ? html`<p>${subheading}</p>` : ''}</div>
          <form class="topbar-search" role="search" action="/studio/produtos" method="get"><label class="sr-only" for="q">Buscar produtos</label>${icon('search', 18)}<input id="q" name="q" type="search" placeholder="Buscar produtos, tags ou categorias"></form>
          <div class="topbar-actions">
            ${iconButton({ label: 'Notificações', iconName: 'bell', attrs: 'data-toast="Nenhuma notificação nova."', cls: 'has-dot' })}
            <a class="avatar avatar-sm" href="/studio/configuracoes" aria-label="Perfil de ${ACCOUNT.name}">${ACCOUNT.initials}</a>
            ${actions}
          </div>
        </header>
        <main class="content${wide ? ' content-wide' : ''}">${body}</main>
      </div>
    </div>
    ${bottomNav(active)}
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>` });
}

// Passos do fluxo de novo produto (Captura → Processamento → Publicação).
export const stepper = (current) => {
  const steps = ['Captura', 'Processamento', 'Publicação'];
  return html`<ol class="stepper" aria-label="Etapas">${steps.map((s, i) => html`<li class="${i + 1 < current ? 'is-done' : i + 1 === current ? 'is-current' : ''}" ${i + 1 === current ? raw('aria-current="step"') : ''}><span class="step-n">${i + 1 < current ? icon('check', 14) : i + 1}</span><span>${s}</span></li>`)}</ol>`;
};

export const emptyState = ({ title, text, cta }) => html`<div class="empty"><div class="empty-art">${icon('cube', 32)}</div><h2>${title}</h2><p>${text}</p>${cta || ''}</div>`;

// Marca visível de simulação — separa claramente estados fictícios de integrações reais.
export const simNote = (text) => html`<p class="simnote">${icon('alert', 14)}<span><b>Simulação no preview.</b> ${text}</span></p>`;
