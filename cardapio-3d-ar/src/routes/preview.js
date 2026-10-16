// Preview desktop do Forma 3D (Fase 1): landing, dashboard, novo produto, processamento, editor e
// página pública com dados de demonstração. Nenhuma rota grava dados; estados são simulados no
// navegador e marcados como tal. O painel real do restaurante continua em /app e /admin.
import { Router } from 'express';
import { html, raw } from '../html.js';
import { ACCOUNT, PRODUCTS, ACTIVITY, PROCESSING_STEPS, CAPTURE_TIPS, STATUS, findProduct } from '../preview/data.js';
import { qrSvg } from '../lib/util.js';
import { ASSET_V, DEFAULT_SCRIPTS, doc, shell, brand, icon, illo, statusPill, button, iconButton, productCard, productRow, metric, stepper, emptyState, simNote } from '../preview/ui.js';

const r = Router();
const fmt = (n) => Number(n).toLocaleString('pt-BR');
const dateBR = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—');

// Produtos criados pelo usuário vivem no navegador (localStorage + IndexedDB). O servidor não os
// conhece: devolve a mesma tela com `data-local` e o cliente preenche os dados a partir do store.
const localStub = (slug) => ({
  slug, local: true, name: 'Carregando produto…', category: '', brand: 'Sua marca', status: 'draft', illo: 'mug',
  model: '', cameraOrbit: '-35deg 70deg 105%', description: '', tags: [], materials: [],
  dimensions: { width: '', height: '', depth: '' }, hotspots: [], views: 0, arViews: 0, publishedAt: null, progress: 0,
});

function loadProduct(req, res, next) {
  if (/^local-/.test(String(req.params.slug))) { req.product = localStub(String(req.params.slug)); return next(); }
  const p = findProduct(String(req.params.slug));
  if (!p) return res.status(404).send(shell({ title: 'Produto não encontrado', active: 'produtos', heading: 'Produto não encontrado', body: emptyState({ title: 'Esse produto não existe no preview', text: 'Os produtos de demonstração são Caneca Origens, Cadeira Horizonte e Tênis Fluxo.', cta: button({ label: 'Voltar aos produtos', href: '/studio/produtos', kind: 'primary' }) }) }));
  req.product = p; next();
}

// ---------- Landing (só para visitante anônimo; usuário logado segue para /app ou /admin) ----------
r.get('/', (req, res, next) => {
  if (req.user) return next();
  const hero = PRODUCTS[0];
  res.send(doc({ title: 'Transforme produtos reais em experiências 3D', viewer: true, cls: 'landing', body: html`
    <header class="lp-nav">
      ${brand()}
      <nav class="lp-links" aria-label="Seções"><a href="#como-funciona">Como funciona</a><a href="#setores">Setores</a><a href="/p/${hero.slug}">Exemplo público</a></nav>
      <div class="lp-nav-actions"><a class="btn btn-ghost" href="/entrar">Entrar</a>${button({ label: 'Criar modelo 3D', href: '/studio/produtos/novo', kind: 'primary' })}</div>
    </header>
    <main>
      <section class="lp-hero">
        <div class="lp-copy">
          <p class="eyebrow">Plataforma 3D para empresas</p>
          <h1><span>Transforme produtos</span> <span>reais em</span> <span class="lp-h1-accent">experiências&nbsp;3D</span></h1>
          <p class="lead">Fotografe com o celular. A Forma 3D cria o modelo, você publica com um link.</p>
          <div class="lp-cta">${button({ label: 'Criar modelo 3D', href: '/studio/produtos/novo', kind: 'primary', size: 'lg', iconName: 'arrow' })}${button({ label: 'Ver demonstração', href: '/studio', kind: 'secondary', size: 'lg' })}</div>
          <ul class="lp-proofs">
            <li>${icon('eye', 18)}<span>Mais compreensão</span></li>
            <li>${icon('sparkle', 18)}<span>Experiência premium</span></li>
            <li>${icon('share', 18)}<span>Pronto para compartilhar</span></li>
          </ul>
        </div>
        <div class="lp-stage">
          <div class="lp-stage-bg" aria-hidden="true"></div>
          <model-viewer class="lp-viewer" src="${hero.model}?v=${ASSET_V}" alt="${hero.name} em 3D" camera-controls disable-zoom auto-rotate auto-rotate-delay="800" rotation-per-second="18deg" interaction-prompt="none" camera-orbit="${hero.cameraOrbit}" shadow-intensity="1.3" shadow-softness="0.8" exposure="1.05" loading="eager"></model-viewer>
          <div class="lp-note" aria-hidden="true"><svg width="72" height="46" viewBox="0 0 72 46" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 42c18-6 34-22 60-30"/><path d="m56 6 10 4-6 9"/></svg><span>arraste para girar</span></div>
          <div class="lp-chip">${icon('cube', 16)}<span>${hero.name}</span><em>3D · AR · Web</em></div>
        </div>
      </section>

      <section class="lp-steps" id="como-funciona">
        <div class="section-head"><p class="eyebrow">Como funciona</p><h2>Três passos, sem conhecimento técnico</h2></div>
        <ol class="steps3">
          <li><span class="step-big">1</span><h3>Adicione fotos ou um vídeo</h3><p>Fotografe o produto de diferentes ângulos com o celular ou envie arquivos que já tem.</p></li>
          <li><span class="step-big">2</span><h3>Acompanhe a construção do modelo</h3><p>O modelo 3D é construído a partir das imagens; você acompanha cada etapa.</p></li>
          <li><span class="step-big">3</span><h3>Publique e compartilhe</h3><p>Revise, adicione informações e compartilhe por link ou incorpore no seu site.</p></li>
        </ol>
      </section>

      <section class="lp-sectors" id="setores">
        <div class="section-head"><p class="eyebrow">Para qualquer produto físico</p><h2>Móveis, calçados, equipamentos, embalagens e mais</h2></div>
        <ul class="sector-feature">
          ${[['chair', 'Mobiliário', 'Acabamento, tecido e proporção à vista.'], ['sneaker', 'Calçados', 'Cada costura, de qualquer ângulo.'], ['mug', 'Utilidades e decoração', 'Textura e esmalte como são.'], ['', 'Produtos industriais', 'Peças e conexões para catálogo técnico.']]
            .map(([il, t, d]) => html`<li><span class="sector-art" aria-hidden="true">${il ? illo(il) : icon('cube', 40)}</span><b>${t}</b><small>${d}</small></li>`)}
        </ul>
        <details class="sector-more"><summary>Ver mais setores</summary><ul class="sector-list">${['Embalagens', 'Equipamentos', 'Objetos de consumo', 'Alimentos', 'Brinquedos', 'Ferramentas'].map((x) => html`<li>${x}</li>`)}</ul></details>
      </section>

      <section class="lp-final">
        <div class="lp-final-copy"><h2>Seu primeiro produto em 3D ainda hoje.</h2><p>Trinta fotos com o celular. Nós cuidamos do resto.</p></div>
        <model-viewer class="lp-final-mv" src="${PRODUCTS[2].model}?v=${ASSET_V}" alt="${PRODUCTS[2].name} em 3D" camera-orbit="${PRODUCTS[2].cameraOrbit}" auto-rotate rotation-per-second="20deg" disable-zoom interaction-prompt="none" camera-controls loading="lazy" shadow-intensity="1" exposure="1.1" aria-hidden="true" tabindex="-1"></model-viewer>
        ${button({ label: 'Criar modelo 3D', href: '/studio/produtos/novo', kind: 'primary', size: 'lg', iconName: 'arrow' })}
      </section>
    </main>
    <footer class="lp-foot"><span>Forma 3D · preview</span><a href="/entrar">Acesso ao painel de restaurantes (beta)</a></footer>` }));
});

// ---------- Dashboard ----------
// §7: a home responde "o que está acontecendo com meus produtos e o que preciso fazer agora?".
// Métricas primeiro, retomada quando houver trabalho pendente, depois produtos e atividade.
// Todos os números saem de PRODUCTS — nenhum é inventado. O que falta no dado vira rótulo honesto.
const ROW_ACTION = {
  published: (p) => ({ href: `/p/${p.slug}`, label: 'Ver página' }),
  processing: (p) => ({ href: `/studio/produtos/${p.slug}/processando`, label: 'Acompanhar' }),
  error: (p) => ({ href: `/studio/produtos/${p.slug}`, label: 'Tentar de novo' }),
};
const rowAction = (p) => (ROW_ACTION[p.status] || ((x) => ({ href: `/studio/produtos/${x.slug}`, label: 'Continuar' })))(p);
const PENDING = ['processing', 'review', 'ready', 'draft', 'files_added', 'error'];

r.get('/studio', (req, res) => {
  const published = PRODUCTS.filter((p) => p.status === 'published');
  const processing = PRODUCTS.filter((p) => p.status === 'processing');
  const views = PRODUCTS.reduce((sum, p) => sum + (p.views || 0), 0);
  const recent = [...PRODUCTS].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 4);
  // "Continue de onde parou" só existe quando há trabalho pendente de verdade.
  const pending = PRODUCTS.find((p) => PENDING.includes(p.status)) || null;

  res.send(shell({
    title: 'Início', active: 'inicio', heading: `Olá, ${ACCOUNT.firstName}`, subheading: 'Aqui está o que mudou nos seus produtos.',
    actions: button({ label: 'Novo produto', href: '/studio/produtos/novo', kind: 'primary', iconName: 'plus' }),
    body: html`
      <section class="block" aria-labelledby="h-resumo">
        <h2 class="sr-only" id="h-resumo">Resumo da operação</h2>
        <dl class="metrics">
          ${metric({ label: 'Produtos', value: PRODUCTS.length, hint: 'no seu catálogo', key: 'total' })}
          ${metric({ label: 'Publicados', value: published.length, hint: 'com página pública', key: 'published' })}
          ${metric({ label: 'Em processamento', value: processing.length, hint: processing.length ? 'gerando modelo 3D' : 'nada na fila agora', key: 'processing', tone: processing.length ? 'warn' : '' })}
          ${metric({ label: 'Visualizações', value: fmt(views), hint: 'total desde a publicação', key: 'views' })}
        </dl>
        ${simNote('Os números vêm dos produtos de demonstração. A janela de 30 dias e as tendências dependem de um histórico de acessos no backend, que ainda não existe.')}
      </section>

      ${pending ? html`
      <section class="resume" id="resume" aria-labelledby="h-retomar">
        <span class="resume-media" aria-hidden="true">${illo(pending.illo)}</span>
        <div class="resume-text">
          <p class="eyebrow" id="h-retomar">Continue de onde parou</p>
          <b>${pending.name}</b>
          <small>${pending.status === 'processing' ? `${pending.progress}% concluído · você pode fechar esta tela.` : 'Aguardando você finalizar antes de publicar.'}</small>
        </div>
        ${statusPill(pending.status)}
        ${button({ label: rowAction(pending).label, href: rowAction(pending).href, kind: 'primary', iconName: 'arrow' })}
        <div class="resume-bar" id="resume-bar" ${pending.status === 'processing' ? '' : raw('hidden')}><i style="width:${pending.progress || 0}%"></i></div>
      </section>` : ''}

      <section class="block" aria-labelledby="h-recentes">
        <div class="section-head"><h2 id="h-recentes">Produtos recentes</h2><a class="link" href="/studio/produtos">Ver todos ${icon('arrow', 16)}</a></div>
        <ul class="plist" id="recent-list">
          ${recent.map((p) => productRow({
            slug: p.slug, name: p.name, media: illo(p.illo), status: p.status, progress: p.progress || 0,
            meta: `${p.category} · atualizado em ${dateBR(p.updatedAt)}`,
            views: p.views ? `${fmt(p.views)} visualizações` : '',
            action: rowAction(p),
          }))}
        </ul>
      </section>

      <section class="card" aria-labelledby="h-atividade">
        <div class="section-head"><h2 id="h-atividade">Atividade</h2></div>
        <div class="activity">${ACTIVITY.map((a) => html`<a class="activity-link" href="/studio/produtos/${a.product}"><span class="act-ic">${icon(a.icon, 16)}</span><div><p>${a.text}</p><small>${a.when}</small></div><span class="ic-go">${icon('arrow', 16)}</span></a>`)}</div>
      </section>` }));
});

// ---------- Lista de produtos ----------
r.get('/studio/produtos', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const st = String(req.query.s || '');
  const list = PRODUCTS.filter((p) => (!st || p.status === st) && (!q || [p.name, p.category, ...p.tags].join(' ').toLowerCase().includes(q)));
  const chips = Object.entries(STATUS).filter(([k]) => PRODUCTS.some((p) => p.status === k));
  res.send(shell({
    title: 'Meus produtos', active: 'produtos', heading: 'Meus produtos', subheading: `${list.length} de ${PRODUCTS.length} produtos${q ? ` para “${q}”` : ''}`,
    actions: button({ label: 'Novo produto', href: '/studio/produtos/novo', kind: 'primary', iconName: 'plus' }),
    body: html`
      <div class="filters-row" role="group" aria-label="Filtrar por status">
        <a class="chip${!st ? ' is-on' : ''}" href="/studio/produtos">Todos</a>
        ${chips.map(([k, s]) => html`<a class="chip${st === k ? ' is-on' : ''}" href="/studio/produtos?s=${k}">${icon(s.icon, 14)}<span>${s.label}</span></a>`)}
      </div>
      ${list.length ? html`<div class="pgrid"><span class="contents" id="local-products" data-status="${st}" data-query="${q}"></span>${list.map(productCard)}</div>` : emptyState({ title: 'Nenhum produto encontrado', text: 'Tente outra palavra ou cadastre um novo produto.', cta: button({ label: 'Novo produto', href: '/studio/produtos/novo', kind: 'primary', iconName: 'plus' }) })}` }));
});

// ---------- Novo produto: assistente em três etapas (dados → arquivos → revisão) ----------
const CATEGORIES = ['Mobiliário', 'Calçados', 'Utilidades domésticas', 'Decoração', 'Produtos industriais', 'Embalagens', 'Equipamentos', 'Alimentos'];

r.get('/studio/produtos/novo', (req, res) => {
  const field = (id, label, { type = 'text', textarea = false, unit = '', placeholder = '', hint = '', required = false, inputmode = '' } = {}) => html`
    <div class="field">
      <label for="wz-${id}">${label}${required ? html`<span class="req" aria-hidden="true">*</span>` : ''}</label>
      ${textarea
        ? html`<textarea id="wz-${id}" rows="3" placeholder="${placeholder}"></textarea>`
        : html`<div class="input-wrap"><input id="wz-${id}" type="${type}" placeholder="${placeholder}" ${inputmode ? raw(`inputmode="${inputmode}"`) : ''} ${required ? raw('required aria-describedby="err-' + id + '"') : ''}>${unit ? html`<span class="unit">${unit}</span>` : ''}</div>`}
      ${hint ? html`<p class="field-help">${hint}</p>` : ''}
      <p class="field-error" id="err-${id}" role="alert" hidden></p>
    </div>`;
  const zone = (kind, { title, sub, formats, accept, multiple = false, iconName = 'upload' }) => html`
    <div class="dropzone" id="${kind}-zone" tabindex="0" role="button" aria-label="${title}">
      <span class="drop-ic">${icon(iconName, 26)}</span>
      <p class="drop-title">${title}</p>
      <p class="drop-sub">${sub}</p>
      <p class="drop-formats">${formats}</p>
      <input id="${kind}-input" type="file" accept="${accept}" ${multiple ? raw('multiple') : ''} hidden>
    </div>`;
  const SURFACES = [['normal', 'Normal ou texturizada'], ['smooth', 'Lisa ou sem detalhes'], ['metallic', 'Metálica ou reflexiva'], ['transparent', 'Transparente']];

  res.send(shell({
    title: 'Novo modelo 3D', active: 'capturar', heading: 'Novo modelo 3D', subheading: 'Identifique o produto, capture e revise antes de criar.',
    viewer: true, // o modelo 3D enviado abre no visualizador aqui mesmo
    scripts: [...DEFAULT_SCRIPTS, '/static/scanner/quality.js', '/static/scanner/coverage.js', '/static/scanner/heading.js',
      '/static/scanner/frames.js', '/static/scanner/camera.js', '/static/scanner/photo-check.js', '/static/forma-scanner.js',
      '/static/forma-guided.js', '/static/forma-capture.js', '/static/forma-video.js', '/static/forma-new-product.js'],
    body: html`
      ${stepper(1)}
      <div class="flow-grid">
        <form class="card card-lg wizard" id="wizard" novalidate>

          <section class="wz-step" data-step="1" aria-labelledby="h-step1">
            <p class="wz-kicker">Passo 1 de 3</p>
            <h2 class="h-card" id="h-step1">Qual é o produto?</h2>
            ${field('name', 'Nome do produto', { placeholder: 'Ex.: Caneca Origens', required: true })}
            <div class="field">
              <label for="wz-category">Categoria<span class="req" aria-hidden="true">*</span></label>
              <select id="wz-category" required aria-describedby="err-category"><option value="">Escolha uma categoria</option>${CATEGORIES.map((c) => html`<option>${c}</option>`)}</select>
              <p class="field-error" id="err-category" role="alert" hidden></p>
            </div>
            <details class="wz-more">
              <summary>${icon('plus', 16)}<span>Descrição, marca, medidas e tags</span><small>opcional</small></summary>
              ${field('description', 'Descrição', { textarea: true, placeholder: 'Materiais, acabamento e o que diferencia o produto.' })}
              ${field('brand', 'Marca ou coleção', { placeholder: 'Ex.: Estúdio Norte · Coleção Origens' })}
              <fieldset class="field">
                <legend>Medidas do fabricante</legend>
                <div class="dims">
                  ${field('width', 'Largura', { type: 'number', unit: 'cm', inputmode: 'decimal' })}
                  ${field('height', 'Altura', { type: 'number', unit: 'cm', inputmode: 'decimal' })}
                  ${field('depth', 'Profundidade', { type: 'number', unit: 'cm', inputmode: 'decimal' })}
                </div>
                <p class="field-help">Medidas reais do produto. Sem elas, a página pública não mostra dimensões — a fotografia sozinha não dá escala confiável.</p>
              </fieldset>
              <div class="field">
                <label for="wz-tag-input">Tags</label>
                <div class="tags" id="wz-tags"><input id="wz-tag-input" placeholder="Digite e pressione Enter"></div>
                <input type="hidden" id="wz-tags-value">
              </div>
            </details>
            <div class="flow-foot">
              <a class="btn btn-ghost" href="/studio">Cancelar</a>
              ${button({ label: 'Continuar', kind: 'primary', iconName: 'arrow', attrs: 'data-go="2"' })}
            </div>
          </section>

          <section class="wz-step" data-step="2" aria-labelledby="h-method" hidden>
            <p class="wz-kicker">Passo 2 de 3</p>
            <h2 class="h-card" id="h-method">Como você quer criar o modelo?</h2>
            <p class="note note-warn" id="mode-banner" aria-live="polite" hidden></p>
            <div class="methods2" role="group" aria-label="Método de criação">
              <button type="button" class="mhero" data-method="camera" aria-pressed="true" id="scan-open">
                <span class="mhero-badges"><span class="badge badge-lime">Recomendado</span><span class="badge badge-dark">Melhor resultado</span></span>
                <span class="mhero-ic">${icon('camera', 30)}</span>
                <span class="mhero-title">Capturar fotos guiadas</span>
                <span class="mhero-desc">Fotografe o produto enquanto guiamos cada ângulo.</span>
                <span class="mhero-cta"><span>Começar</span>${icon('arrow', 18)}</span>
              </button>
              <div class="mrow">
                <button type="button" class="mopt" data-method="photos" aria-pressed="false">
                  <span class="mopt-ic">${icon('photo', 22)}</span>
                  <span class="mopt-text"><b>Enviar fotos</b><small>Use imagens que você já possui.</small></span>
                </button>
                <button type="button" class="mopt" data-method="video" aria-pressed="false">
                  <span class="mopt-ic">${icon('video', 22)}</span>
                  <span class="mopt-text"><b>Vídeo ao redor <span class="badge">Mais rápido</span></b><small>Grave uma volta contínua.</small></span>
                </button>
              </div>
              <button type="button" class="mline" data-method="model" aria-pressed="false"><span>Já possui um arquivo 3D?</span><b>Enviar modelo ${icon('arrow', 16)}</b></button>
            </div>

            <div class="wz-panel" data-panel="camera">
              <p class="note note-muted" id="scan-support" aria-live="polite">${icon('alert', 16)}<span>Verificando o suporte deste navegador…</span></p>
              <div id="scan-box"></div>
              <p class="field-help">No celular, a câmera ao vivo só funciona em páginas <b>HTTPS</b>. Sem isso, use <button type="button" class="link-btn" data-switch-method="photos">Enviar fotos</button> com o app de câmera do celular.</p>
            </div>

            <div class="wz-panel" data-panel="photos" hidden>
              ${zone('photo', { title: 'Escolha as fotos', sub: 'Arraste aqui ou toque para abrir a galeria', formats: 'JPG, PNG, WebP ou HEIC · fotos grandes são ajustadas automaticamente', accept: 'image/*', multiple: true, iconName: 'photo' })}
              <div class="native-row">
                <label class="btn btn-secondary btn-sm" for="photo-native">${icon('camera', 18)}<span>Tirar com a câmera do celular</span></label>
                <input id="photo-native" type="file" accept="image/*" capture="environment" class="sr-only" tabindex="-1">
                <span class="muted">Cada toque adiciona uma foto na qualidade máxima do aparelho.</span>
              </div>
              <div class="flow-foot flow-foot-tight">
                <span class="muted" id="photo-count" aria-live="polite">Nenhuma foto adicionada ainda.</span>
                <button type="button" class="btn btn-ghost btn-sm" id="photo-clear">Limpar tudo</button>
              </div>
              <ul class="notes" id="photo-notes" aria-live="polite"></ul>
              <ul class="shots" id="photo-grid"></ul>
            </div>

            <div class="wz-panel" data-panel="video" hidden>
              ${zone('video', { title: 'Vídeo ao redor do produto', sub: 'Faça uma volta lenta, mantendo o produto inteiro na tela.', formats: 'MP4 ou MOV · os melhores quadros são extraídos aqui mesmo', accept: 'video/*', iconName: 'video' })}
              <div class="native-row">
                ${button({ label: 'Gravar agora', kind: 'secondary', iconName: 'camera', size: 'sm', attrs: 'id="video-record"' })}
                <span class="muted" id="video-record-note">Uma volta de 30 a 90 segundos, devagar.</span>
              </div>
              <div id="video-box" aria-live="polite"></div>
            </div>

            <div class="wz-panel" data-panel="model" hidden>
              ${zone('model', { title: 'Arraste seu modelo 3D aqui', sub: 'ou toque para selecionar', formats: 'GLB (recomendado) ou glTF 2.0 autossuficiente, até 60 MB', accept: '.glb,.gltf,model/gltf-binary,model/gltf+json', iconName: 'cube' })}
              <div id="model-box"></div>
              <p class="field-help">O arquivo abre no visualizador direto do seu aparelho.</p>
            </div>

            <div class="flow-foot">
              ${button({ label: 'Voltar', kind: 'secondary', attrs: 'data-go="1"' })}
              ${button({ label: 'Revisar', kind: 'primary', iconName: 'arrow', attrs: 'data-go="3"' })}
            </div>
          </section>

          <section class="wz-step" data-step="3" aria-labelledby="h-review" hidden>
            <p class="wz-kicker">Passo 3 de 3</p>
            <h2 class="h-card" id="h-review">Revise antes de criar</h2>
            <fieldset class="field seg-field" id="surface-field">
              <legend>Como é a superfície do produto?</legend>
              <div class="seg" role="radiogroup" aria-label="Superfície do produto">
                ${SURFACES.map(([v, l], i) => html`<label class="seg-opt"><input type="radio" name="surface" value="${v}" ${i === 0 ? raw('checked') : ''}><span>${l}</span></label>`)}
              </div>
              <p class="field-help" id="surface-help">Superfícies lisas, metálicas ou transparentes usam um processamento próprio.</p>
            </fieldset>
            <fieldset class="field seg-field" id="quality-field">
              <legend>Qualidade do modelo</legend>
              <div class="seg seg-2" role="radiogroup" aria-label="Qualidade do modelo">
                <label class="seg-opt"><input type="radio" name="quality" value="high" checked><span>Alta<small>textura 4K · leva mais tempo</small></span></label>
                <label class="seg-opt"><input type="radio" name="quality" value="standard"><span>Padrão<small>mais rápido</small></span></label>
              </div>
            </fieldset>
            <dl class="review" id="review-list"></dl>
            <p class="hint-row">${icon('sparkle', 16)}<span id="review-next"></span></p>
            <div class="progress" id="wz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Envio dos arquivos" hidden><i></i><span>Enviando imagens…</span></div>
            <div class="flow-foot">
              ${button({ label: 'Voltar', kind: 'secondary', attrs: 'data-go="2"' })}
              <span class="flow-foot-end">
                ${button({ label: 'Recomeçar', kind: 'ghost', attrs: 'id="wz-reset"' })}
                ${button({ label: 'Criar modelo 3D', kind: 'primary', iconName: 'check', attrs: 'id="wz-submit"' })}
              </span>
            </div>
            <p class="simnote" id="review-simnote">${icon('alert', 14)}<span><b>Simulação no preview.</b> Os arquivos ficam neste navegador (sessão atual) e o modelo de fotos/vídeo é simulado. Um modelo 3D enviado por você funciona de verdade no visualizador.</span></p>
          </section>
        </form>

        <dialog class="dialog" id="real-confirm" aria-labelledby="real-confirm-title">
          <span class="dialog-ic dialog-ic-warn">${icon('alert', 24)}</span>
          <h2 id="real-confirm-title">Iniciar o processamento real?</h2>
          <p id="real-confirm-text"></p>
          <div class="dialog-actions">
            ${button({ label: 'Cancelar', kind: 'secondary', attrs: 'data-real-no' })}
            ${button({ label: 'Sim, enviar e processar', kind: 'primary', iconName: 'check', attrs: 'data-real-yes' })}
          </div>
        </dialog>

        <aside class="card wz-aside" id="requisitos">
          <h2 class="h-card">Para um bom resultado</h2>
          <ul class="checklist">${CAPTURE_TIPS.map((t) => html`<li>${icon('check', 16)}<span>${t}</span></li>`)}</ul>
          <div class="card-inset">
            <p class="eyebrow">Depois</p>
            <p>Você acompanha a criação do modelo e confere o resultado antes de publicar.</p>
          </div>
        </aside>
      </div>` }));
});

// ---------- Processamento: etapas, erro explicado e checagem antes de publicar ----------
r.get('/studio/produtos/:slug/processando', loadProduct, (req, res) => {
  const p = req.product;
  const start = p.status === 'processing' ? p.progress : 0;
  const CHECKS = [
    ['Cobertura', 'Todos os lados aparecem, sem partes faltando.'],
    ['Textura', 'Nítida e com as cores do produto.'],
    ['Sem buracos', 'Sem furos nem pedaços soltos.'],
    ['Orientação', 'Produto em pé, na posição certa.'],
    ['Fundo limpo', 'Sem restos da mesa ou do fundo.'],
  ];
  res.send(shell({
    title: 'Criando seu modelo 3D', active: 'capturar', heading: p.name, subheading: 'Criando seu modelo 3D',
    viewer: true,
    body: html`
      ${stepper(2)}
      <section class="proc" id="proc" data-start="${start}" data-next="/studio/produtos/${p.slug}" data-model="${p.model || ''}" ${p.local ? raw('data-local="1"') : ''} style="--reveal:${start}%">
        <div class="proc-stage" aria-hidden="true">
          <svg class="proc-orbits" viewBox="0 0 400 400"><ellipse cx="200" cy="200" rx="180" ry="60" class="orb orb-1"/><ellipse cx="200" cy="200" rx="150" ry="150" class="orb orb-2"/><ellipse cx="200" cy="200" rx="60" ry="180" class="orb orb-3"/><circle cx="380" cy="200" r="4" class="dot dot-1"/><circle cx="200" cy="50" r="4" class="dot dot-2"/><circle cx="60" cy="200" r="3" class="dot dot-3"/></svg>
          <div class="proc-object">
            <div class="proc-wire">${illo(p.illo, { mode: 'wire' })}</div>
            <div class="proc-fill">${illo(p.illo)}</div>
            <div class="proc-scan"></div>
          </div>
        </div>
        <div class="proc-info">
          <p class="proc-badge" id="proc-badge" hidden></p>
          <p class="proc-pct"><b id="pct">${start}</b><span>%</span></p>
          <h2 id="proc-title">Estamos criando seu modelo 3D.</h2>
          <p class="lead-sm" id="proc-lead">Você pode fechar esta página. O andamento continua e aparece aqui quando voltar.</p>
          <ol class="proc-steps" id="proc-steps" aria-label="Etapas">${PROCESSING_STEPS.map((s) => html`<li data-done="${s.done}"><span class="pstep-ic"><i class="pstep-spin"></i>${icon('check', 14)}</span><span>${s.label}</span></li>`)}</ol>
          <p class="proc-stage-text" id="proc-stage" aria-live="polite" hidden></p>
          <p class="proc-elapsed" id="proc-elapsed" hidden></p>
          <div id="proc-error" hidden></div>
          <div class="proc-actions">
            ${button({ label: 'Conferir o modelo', href: '#ready', kind: 'primary', iconName: 'arrow', attrs: 'id="proc-done" hidden' })}
            <a class="btn btn-ghost btn-ghost-light" href="/studio">Voltar ao início</a>
          </div>
          <p class="sr-only" id="proc-live" aria-live="polite"></p>
          ${simNote('O progresso avança sozinho no navegador; não há reconstrução real nesta fase.')}
        </div>
      </section>

      <section class="ready" id="ready" aria-labelledby="ready-title" hidden>
        <div class="ready-viewer">
          <model-viewer id="ready-mv" alt="Modelo 3D gerado para ${p.name}" camera-controls interaction-prompt="auto" shadow-intensity="1.1" shadow-softness="0.8" exposure="1.05" loading="lazy">
            <div class="mv-loading" slot="poster"><span class="spinner"></span>Carregando modelo…</div>
          </model-viewer>
          <div class="canvas-controls">${iconButton({ label: 'Resetar câmera', iconName: 'reset', kind: 'solid', attrs: 'data-ready-reset' })}</div>
        </div>
        <div class="ready-panel">
          <p class="eyebrow">Antes de publicar</p>
          <h2 id="ready-title">Seu modelo está pronto</h2>
          <p class="lead-sm">Gire o modelo e confira. Nada é publicado sem você.</p>
          <ul class="ready-checks">
            ${CHECKS.map(([t, d]) => html`<li><label class="check"><input type="checkbox" data-ready-check><span><b>${t}</b><small>${d}</small></span></label></li>`)}
            <li class="ready-auto" id="ready-weight">${icon('file', 16)}<span><b>Peso do arquivo</b><small>Calculando…</small></span></li>
            <li class="ready-auto" id="ready-scale">${icon('ruler', 16)}<span><b>Escala</b><small>${[p.dimensions.width, p.dimensions.height, p.dimensions.depth].some(Boolean) ? `Medidas do fabricante: ${p.dimensions.width} × ${p.dimensions.height} × ${p.dimensions.depth} cm` : 'Sem medidas do fabricante: a página pública não mostra dimensões.'}</small></span></li>
          </ul>
          <div class="ready-actions">
            ${button({ label: 'Publicar', kind: 'primary', iconName: 'globe', attrs: 'id="ready-publish" disabled' })}
            ${button({ label: 'Ajustar modelo', href: `/studio/produtos/${p.slug}`, kind: 'secondary', iconName: 'pencil', attrs: 'id="ready-adjust"' })}
            ${button({ label: 'Refazer captura', href: '/studio/produtos/novo', kind: 'ghost', iconName: 'camera' })}
          </div>
          <p class="field-help" id="ready-help" aria-live="polite">Marque os cinco itens para liberar a publicação.</p>
        </div>
      </section>` }));
});

// ---------- Editor / visualizador 3D ----------
function renderEditor(p) {
  const publicUrl = `/p/${p.slug}`;
  const field = (id, label, value, { type = 'text', textarea = false, unit = '' } = {}) => html`
    <div class="field"><label for="${id}">${label}</label>${textarea ? html`<textarea id="${id}" name="${id}" rows="4">${value}</textarea>` : html`<div class="input-wrap"><input id="${id}" name="${id}" type="${type}" value="${value}">${unit ? html`<span class="unit">${unit}</span>` : ''}</div>`}</div>`;
  return doc({ title: p.name, viewer: true, cls: 'has-editor', body: html`
    <div class="editor" data-slug="${p.slug}" data-public-url="${publicUrl}" ${p.local ? raw('data-local="1"') : ''}>
      <header class="ed-head">
        <a class="btn-icon btn-icon-ghost" href="/studio" aria-label="Voltar ao início" title="Voltar">${icon('back', 20)}</a>
        <div class="ed-title"><h1 id="ed-name">${p.name}</h1>${statusPill(p.status, 'id="ed-status"')}<span class="ed-saved" id="ed-saved">${icon('check', 14)}Salvo automaticamente</span></div>
        <div class="ed-actions">
          ${button({ label: 'Compartilhar', kind: 'secondary', iconName: 'share', attrs: 'data-share' })}
          ${p.status === 'published' ? html`${button({ label: 'Ver página', href: publicUrl, kind: 'secondary', iconName: 'globe', attrs: 'target="_blank" rel="noopener"' })}${button({ label: 'Atualizar publicação', kind: 'primary', iconName: 'check', attrs: 'data-publish' })}` : button({ label: 'Publicar', kind: 'primary', iconName: 'globe', attrs: 'data-publish' })}
        </div>
      </header>
      <div class="ed-body">
        <nav class="ed-tools" aria-label="Ferramentas">
          ${[['view', 'eye', 'Visualizar'], ['materials', 'layers', 'Materiais'], ['hotspots', 'pin', 'Hotspots'], ['env', 'sun', 'Ambiente'], ['measure', 'ruler', 'Medidas']].map(([k, ic, l]) => html`<button type="button" class="tool${k === 'view' ? ' is-active' : ''}" data-tool="${k}" aria-pressed="${k === 'view'}" aria-label="${l}" title="${l}">${icon(ic, 20)}<span>${l}</span></button>`)}
        </nav>
        <section class="ed-canvas" aria-label="Visualizador 3D">
          <model-viewer id="mv" ${p.model ? raw(`src="${p.model}?v=${ASSET_V}"`) : ''} alt="${p.name} em 3D" camera-controls interaction-prompt="none" camera-orbit="${p.cameraOrbit}" min-camera-orbit="auto auto auto" shadow-intensity="1.2" shadow-softness="0.7" exposure="1.05" loading="eager">
            ${p.hotspots.map((h, i) => html`<button type="button" class="hotspot" slot="hotspot-${i}" data-position="${h.position}" data-normal="0 1 0" data-visibility-attribute="visible" aria-label="${h.title}"><span class="hotspot-dot">${i + 1}</span><span class="hotspot-card"><b>${h.title}</b>${h.text}</span></button>`)}
            <div class="mv-loading" slot="poster"><span class="spinner"></span>Carregando modelo…</div>
          </model-viewer>
          <div class="canvas-controls">
            ${iconButton({ label: 'Resetar câmera', iconName: 'reset', kind: 'solid', attrs: 'data-reset' })}
            ${iconButton({ label: 'Tela cheia', iconName: 'expand', kind: 'solid', attrs: 'data-fullscreen' })}
            ${iconButton({ label: 'Ajuda de navegação', iconName: 'help', kind: 'solid', attrs: 'data-toast="Arraste para girar, role para aproximar e segure Shift para deslocar."' })}
          </div>
          <p class="canvas-hint">Arraste para girar · Role para aproximar · Clique nos pontos numerados</p>
          <div class="tool-notice" id="tool-notice" hidden><b></b><span>Disponível em uma próxima fase do preview.</span></div>
        </section>
        <aside class="ed-props" id="ed-props" aria-label="Propriedades">
          <button class="sheet-bar" type="button" aria-expanded="false" aria-controls="ed-props" data-sheet-toggle><span class="sheet-handle" aria-hidden="true"></span><span class="sheet-label">Propriedades</span>${icon('chevron', 20)}</button>
          <div class="tabs" role="tablist" aria-label="Painel de propriedades">
            ${[['produto', 'Produto'], ['aparencia', 'Aparência'], ['interacoes', 'Interações']].map(([k, l], i) => html`<button type="button" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${i === 0}" class="${i === 0 ? 'is-active' : ''}">${l}</button>`)}
          </div>
          <form class="panel" id="panel-produto" role="tabpanel" aria-labelledby="tab-produto" data-autosave>
            ${field('nome', 'Nome do produto', p.name)}
            <div class="field"><label for="categoria">Categoria</label><select id="categoria" name="categoria">${['Mobiliário', 'Calçados', 'Utilidades domésticas', 'Decoração', 'Produtos industriais', 'Embalagens', 'Equipamentos', 'Alimentos'].map((c) => html`<option ${c === p.category ? 'selected' : ''}>${c}</option>`)}</select></div>
            ${field('descricao', 'Descrição', p.description, { textarea: true })}
            <div class="field"><label for="tags">Tags</label><div class="tags" id="tags">${p.tags.map((t) => html`<span class="tag">${t}<button type="button" aria-label="Remover ${t}" data-remove-tag>${icon('x', 12)}</button></span>`)}<input id="tags" placeholder="Adicionar tag e Enter"></div></div>
            <fieldset class="field"><legend>Dimensões reais</legend><div class="dims">${field('largura', 'Largura', p.dimensions.width, { type: 'number', unit: 'cm' })}${field('altura', 'Altura', p.dimensions.height, { type: 'number', unit: 'cm' })}${field('profundidade', 'Profundidade', p.dimensions.depth, { type: 'number', unit: 'cm' })}</div><p class="field-help">Usadas para o tamanho real em realidade aumentada.</p></fieldset>
          </form>
          <div class="panel" id="panel-aparencia" role="tabpanel" aria-labelledby="tab-aparencia" hidden>
            <div class="field"><span class="label">Fundo do visualizador</span><div class="swatches" role="group" aria-label="Fundo">${[['#F4F1E8', 'Creme'], ['#FFFDF8', 'Branco quente'], ['#E9EEE9', 'Cinza esverdeado'], ['#0B2B20', 'Verde profundo']].map(([c, l], i) => html`<button type="button" class="swatch${i === 0 ? ' is-on' : ''}" style="--c:${c}" data-bg="${c}" aria-label="${l}" aria-pressed="${i === 0}" title="${l}"></button>`)}</div></div>
            <div class="field"><label for="exposure">Iluminação</label><input id="exposure" type="range" min="0.5" max="1.6" step="0.05" value="1.05" data-exposure></div>
            <div class="field"><label for="shadow">Sombra de contato</label><input id="shadow" type="range" min="0" max="2" step="0.1" value="1.2" data-shadow></div>
            <div class="field"><label class="switch"><input type="checkbox" data-autorotate><span>Girar automaticamente</span></label></div>
            <p class="field-help">Materiais e texturas: edição disponível em uma próxima fase.</p>
          </div>
          <div class="panel" id="panel-interacoes" role="tabpanel" aria-labelledby="tab-interacoes" hidden>
            <p class="field-help">Pontos interativos aparecem sobre o modelo e na página pública.</p>
            <ol class="hotspot-list">${p.hotspots.map((h, i) => html`<li><span class="hs-n">${i + 1}</span><div><b>${h.title}</b><small>${h.text}</small></div></li>`)}</ol>
            ${button({ label: 'Adicionar ponto', kind: 'secondary', iconName: 'plus', attrs: 'data-toast="Criação de novos pontos interativos chega em uma próxima fase."' })}
          </div>
          <div class="panel-notice" id="local-notice" hidden></div>
          <footer class="ed-props-foot"><span class="muted">${icon('check', 14)} Salvamento automático</span>${simNote('As alterações ficam só neste navegador durante o preview.')}</footer>
        </aside>
      </div>
      <dialog class="dialog" id="publish-dialog" aria-labelledby="pd-title">
        <form method="dialog">
          <span class="dialog-ic">${icon('check', 24)}</span>
          <h2 id="pd-title">${p.status === 'published' ? 'Publicação atualizada' : 'Produto publicado'}</h2>
          <p>${p.name} está disponível para qualquer pessoa com o link. Você pode compartilhar ou incorporar em outro site.</p>
          <label class="label" for="pd-link">Link público</label>
          <div class="copy-row"><input id="pd-link" type="text" readonly value="${publicUrl}" data-abs-url>${button({ label: 'Copiar', kind: 'secondary', iconName: 'copy', attrs: 'data-copy="#pd-link"' })}</div>
          <div class="dialog-actions">${button({ label: 'Abrir página pública', href: publicUrl, kind: 'primary', iconName: 'globe', attrs: 'target="_blank" rel="noopener"' })}<button class="btn btn-ghost" type="submit">Fechar</button></div>
          ${simNote('A publicação real, com persistência, chega na Fase 3.')}
        </form>
      </dialog>
      <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
    </div>` });
}
r.get('/studio/produtos/:slug', loadProduct, (req, res) => res.send(renderEditor(req.product)));

// Fase 3B: abre o GLB de uma tarefa real no visualizador (usado pelo teste de terminal `npm run kiri:live`).
r.get('/studio/tarefas/:jobId', (req, res) => {
  const forma = req.app.locals.forma;
  const row = forma && /^frj_[\w-]{6,40}$/.test(String(req.params.jobId)) ? forma.jobs.getJob(String(req.params.jobId)) : null;
  const view = row ? forma.jobs.publicView(row) : null;
  if (!view || !view.modelUrl) return res.status(404).send(shell({ title: 'Tarefa', active: 'produtos', heading: 'Tarefa não encontrada', body: emptyState({ title: view ? `Tarefa ${view.status}` : 'Tarefa não encontrada', text: view ? (view.message || view.stage || 'O modelo ainda não está disponível.') : 'Confira o identificador.', cta: button({ label: 'Voltar ao início', href: '/studio', kind: 'primary' }) }) }));
  res.send(renderEditor({ ...localStub('tarefa-' + view.jobId), local: false, name: `Tarefa ${view.jobId}`, category: 'Reconstrução real (KIRI Engine)', status: 'review', model: view.modelUrl, cameraOrbit: '-35deg 70deg 105%' }));
});

// ---------- Publicações ----------
r.get('/studio/publicacoes', (req, res) => {
  const pub = PRODUCTS.filter((p) => p.status === 'published');
  res.send(shell({
    title: 'Publicações', active: 'publicacoes', heading: 'Publicações', subheading: `${pub.length} ${pub.length === 1 ? 'produto publicado' : 'produtos publicados'} · links e incorporação`,
    body: html`
      <div class="table-card card">
        <table class="table">
          <thead><tr><th>Produto</th><th>Status</th><th>Publicado em</th><th class="num">Visualizações</th><th class="num">Em AR</th><th>Link</th></tr></thead>
          <tbody>${pub.map((p) => html`<tr>
            <td><a class="row-product" href="/studio/produtos/${p.slug}"><span class="row-thumb">${illo(p.illo)}</span><span><b>${p.name}</b><small>${p.category}</small></span></a></td>
            <td>${statusPill(p.status)}</td><td>${dateBR(p.publishedAt)}</td><td class="num">${fmt(p.views)}</td><td class="num">${fmt(p.arViews)}</td>
            <td><div class="copy-row copy-row-sm"><input type="text" readonly value="/p/${p.slug}" data-abs-url aria-label="Link de ${p.name}">${iconButton({ label: `Copiar link de ${p.name}`, iconName: 'copy', attrs: 'data-copy="prev"' })}<a class="btn-icon btn-icon-ghost" href="/p/${p.slug}" target="_blank" rel="noopener" aria-label="Abrir página de ${p.name}">${icon('arrow', 18)}</a></div></td>
          </tr>`)}</tbody>
        </table>
      </div>
      <section class="card">
        <h2 class="h-card">Incorporar em outro site</h2>
        <p class="muted">Copie o trecho abaixo para exibir o produto em uma página sua. Substitua o endereço pelo domínio definitivo quando ele existir.</p>
        <pre class="code" tabindex="0"><code>&lt;iframe src="https://SEU-DOMINIO/p/${pub[0]?.slug || 'produto'}" width="100%" height="560" loading="lazy" title="${pub[0]?.name || 'Produto'} em 3D" allow="xr-spatial-tracking"&gt;&lt;/iframe&gt;</code></pre>
      </section>` }));
});

// ---------- Estúdio (antes "Configurações"): só o que funciona de verdade ----------
// Conta, marca e preferências 3D ficam neste navegador (FormaStore.prefs), como os produtos do
// preview; a página diz isso. Nada de controle falso: o que ainda não existe simplesmente não aparece.
const VIEWER_BG = [['#F3F2EF', 'Névoa'], ['#FFFEFA', 'Branco quente'], ['#E4E9E4', 'Sálvia'], ['#0B352B', 'Floresta']];
r.get('/studio/configuracoes', (req, res) => {
  const published = PRODUCTS.filter((p) => p.status === 'published');
  const section = (id, title, sub, body) => html`<section class="st-card" aria-labelledby="st-${id}"><header class="st-head"><h2 id="st-${id}">${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</header>${body}</section>`;
  res.send(shell({
    title: 'Estúdio', active: 'config', heading: 'Estúdio', subheading: 'Conta, marca e como seus modelos são criados.',
    body: html`
      <section class="st-hero" aria-label="Resumo do estúdio">
        <span class="st-avatar" id="st-avatar" aria-hidden="true">${ACCOUNT.company.slice(0, 1)}</span>
        <div><p class="st-name" id="st-name">${ACCOUNT.company}</p><p class="st-meta"><span id="st-owner">${ACCOUNT.name}</span> · <span class="badge">${ACCOUNT.plan}</span></p></div>
        <p class="st-saved" id="st-saved" role="status" aria-live="polite"></p>
      </section>

      <div class="st-grid">
        ${section('conta', 'Conta', 'Aparece no painel e na página pública dos produtos.', html`
          <form class="st-form" id="st-account" novalidate>
            <div class="field"><label for="st-studio">Nome do estúdio</label><div class="input-wrap"><input id="st-studio" name="studioName" autocomplete="organization" placeholder="${ACCOUNT.company}"></div></div>
            <div class="field"><label for="st-resp">Responsável</label><div class="input-wrap"><input id="st-resp" name="owner" autocomplete="name" placeholder="${ACCOUNT.name}"></div></div>
            <div class="field"><span class="label">Logo</span>
              <div class="st-logo"><span class="st-logo-prev" id="st-logo-prev" aria-hidden="true">${ACCOUNT.company.slice(0, 1)}</span>
                <label class="btn btn-secondary btn-sm" for="st-logo-input">${icon('upload', 16)}<span>Enviar logo</span></label><input id="st-logo-input" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="sr-only">
                <button type="button" class="btn btn-ghost btn-sm" id="st-logo-clear" hidden>Remover</button></div>
              <p class="field-help">PNG ou SVG com fundo transparente fica melhor. Reduzimos para 256 px.</p>
            </div>
            <div class="st-actions">${button({ label: 'Salvar conta', kind: 'primary', attrs: 'type="submit"' })}</div>
          </form>`)}

        ${section('marca', 'Marca na página pública', 'Como o cliente final vê seus produtos.', html`
          <div class="field"><span class="label" id="st-bg-l">Fundo do visualizador</span>
            <div class="swatches" role="radiogroup" aria-labelledby="st-bg-l">${VIEWER_BG.map(([c, l]) => html`<button type="button" class="swatch" role="radio" aria-checked="false" style="--c:${c}" data-viewer-bg="${c}" aria-label="${l}" title="${l}"></button>`)}</div>
          </div>
          <label class="st-toggle"><input type="checkbox" id="st-signature"><span><b>Assinatura “Criado com Forma 3D”</b><small>Rodapé discreto na página pública.</small></span></label>
          <div class="st-preview" id="st-preview" aria-hidden="true"><span class="st-preview-brand"><i id="st-prev-mark">${ACCOUNT.company.slice(0, 1)}</i><b id="st-prev-name">${ACCOUNT.company}</b></span><span class="st-preview-stage"></span><span class="st-preview-sig" id="st-prev-sig">Criado com Forma 3D</span></div>`)}

        ${section('prefs', 'Preferências 3D', 'Valem para os próximos modelos. Dá para mudar em cada envio.', html`
          <fieldset class="seg-field"><legend>Qualidade padrão</legend>
            <div class="seg seg-2">
              <label class="seg-opt"><input type="radio" name="st-quality" value="high"><span>Alta<small>textura 4K · leva mais tempo</small></span></label>
              <label class="seg-opt"><input type="radio" name="st-quality" value="standard"><span>Padrão<small>mais rápido</small></span></label>
            </div>
          </fieldset>
          <label class="st-toggle"><input type="checkbox" id="st-mask"><span><b>Separar o produto do fundo</b><small>Recorte automático do objeto antes da reconstrução.</small></span></label>
          <p class="st-fact">${icon('cube', 16)}<span>Saída: <b>GLB</b>, pronto para web e realidade aumentada.</span></p>`)}

        ${section('plano', 'Plano', '', html`
          <dl class="st-plan">
            <div><dt>Plano</dt><dd>${ACCOUNT.plan}</dd></div>
            <div><dt>Produtos</dt><dd><b id="st-products">${PRODUCTS.length}</b></dd></div>
            <div><dt>Em processamento</dt><dd><b id="st-processing">${PRODUCTS.filter((p) => p.status === 'processing').length}</b></dd></div>
            <div><dt>Processamentos reais</dt><dd><b id="st-real">—</b></dd></div>
          </dl>`)}

        ${section('links', 'Compartilhamento', 'Link público e QR code de cada produto publicado.', html`
          <ul class="st-links" id="st-links">${published.map((p) => html`<li>
            <span class="st-link-name"><b>${p.name}</b><small>/p/${p.slug}</small></span>
            <span class="st-link-actions">
              ${iconButton({ label: `Copiar link de ${p.name}`, iconName: 'copy', attrs: `data-copy-link="/p/${p.slug}"` })}
              <a class="btn-icon btn-icon-ghost" href="/studio/qr/${p.slug}" target="_blank" rel="noopener" aria-label="QR code de ${p.name}" title="QR code">${icon('qr', 18)}</a>
              <a class="btn-icon btn-icon-ghost" href="/p/${p.slug}" target="_blank" rel="noopener" aria-label="Abrir página de ${p.name}" title="Abrir">${icon('arrow', 18)}</a>
            </span></li>`)}</ul>`)}

        ${section('atalhos', 'Mais', '', html`
          <nav class="st-shortcuts" aria-label="Outras áreas">
            ${[['/studio/publicacoes', 'globe', 'Publicações', 'Links e incorporação'], ['/studio/estatisticas', 'chart', 'Estatísticas', 'Visualizações por produto'], ['/studio/integracoes', 'plug', 'Integrações', 'Incorporar em outro site'], ['/studio/ajuda', 'help', 'Ajuda', 'Captura e publicação']]
              .map(([href, ic, t, d]) => html`<a href="${href}"><span class="st-sc-ic">${icon(ic, 18)}</span><span><b>${t}</b><small>${d}</small></span>${icon('arrow', 16)}</a>`)}
          </nav>`)}
      </div>
      <p class="st-note">${icon('alert', 14)}<span>No preview, conta, marca e preferências ficam salvas neste navegador.</span></p>` }));
});

// QR code do link público (SVG). Só produtos existentes; a URL é montada a partir do host da requisição.
r.get('/studio/qr/:slug', async (req, res) => {
  const slug = String(req.params.slug);
  if (!/^[a-z0-9-]{2,80}$/i.test(slug)) return res.status(404).end();
  const base = req.app.locals.cfg?.baseUrl || `${req.protocol}://${req.get('host')}`;
  const svg = await qrSvg(`${base.replace(/\/$/, '')}/p/${slug}`);
  res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(svg);
});

// ---------- Páginas de apoio (honestas: conteúdo mínimo, sem simular métricas inexistentes) ----------
const SUPPORT = {
  estatisticas: { title: 'Estatísticas', text: 'Visualizações por produto, aberturas em AR e origem dos acessos serão consolidadas quando a publicação real existir.', extra: () => html`<div class="stats-row">${PRODUCTS.filter((p) => p.status === 'published').map((p) => html`<div class="stat"><small>${p.name}</small><b>${fmt(p.views)}</b><span>visualizações · ${fmt(p.arViews)} em AR</span></div>`)}</div>` },
  integracoes: { title: 'Integrações', text: 'Incorporação por iframe já está disponível em Publicações. Conectores para lojas e catálogos ficam para uma fase posterior.' },
  ajuda: { title: 'Ajuda', text: 'Dúvidas sobre captura, processamento e publicação. No preview, use os requisitos de captura na tela “Capturar”.' },
};
for (const [key, s] of Object.entries(SUPPORT)) {
  r.get(`/studio/${key}`, (req, res) => res.send(shell({ title: s.title, active: key, heading: s.title, body: html`<section class="card"><p class="lead-sm">${s.text}</p>${s.extra ? s.extra() : ''}</section>` })));
}

// ---------- Página pública ----------
// O modelo é o protagonista; a marca é a do cliente. Medidas só aparecem quando vêm do fabricante
// (a fotogrametria sozinha não dá escala confiável). Hotspots do modelo e da lista são o mesmo item.
const fmtCm = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
r.get('/p/:slug', loadProduct, (req, res) => {
  const p = req.product;
  const d = p.dimensions;
  const hasDims = [d.width, d.height, d.depth].some((v) => v !== '' && v != null);
  res.send(doc({ title: p.name, viewer: true, cls: 'public', body: html`
    <header class="pub-nav">
      <span class="pub-brand"><span class="pub-brand-mark" aria-hidden="true">${p.brand.slice(0, 1)}</span><span class="pub-brand-name">${p.brand}</span></span>
      ${button({ label: 'Compartilhar', kind: 'secondary', iconName: 'share', size: 'sm', attrs: 'data-share' })}
    </header>
    <main class="pub" ${p.local ? raw('data-local="1"') : ''}>
      <section class="pub-stage" aria-label="Visualizador 3D de ${p.name}">
        <model-viewer id="mv" ${p.model ? raw(`src="${p.model}?v=${ASSET_V}"`) : ''} alt="${p.name} em 3D. ${p.description}" camera-controls touch-action="pan-y" interaction-prompt="auto" auto-rotate auto-rotate-delay="2500" rotation-per-second="14deg" camera-orbit="${p.cameraOrbit}" shadow-intensity="1.2" shadow-softness="0.7" exposure="1.05" loading="eager" ar ar-modes="scene-viewer webxr quick-look" ar-scale="${hasDims ? 'fixed' : 'auto'}" ar-placement="floor" interpolation-decay="120">
          ${p.hotspots.map((h, i) => html`<button type="button" class="hotspot" slot="hotspot-${i}" data-hs="${i}" data-position="${h.position}" data-normal="0 1 0" data-visibility-attribute="visible" aria-label="Detalhe ${i + 1}: ${h.title}"><span class="hotspot-dot">${i + 1}</span></button>`)}
          <button slot="ar-button" class="btn btn-primary pub-ar" type="button">${icon('ar', 18)}<span>Ver em AR</span></button>
          <div class="pub-progress" slot="progress-bar" aria-hidden="true"><i></i></div>
          <div class="mv-loading" slot="poster"><span class="spinner"></span>Carregando modelo 3D…</div>
        </model-viewer>
        <div class="pub-tools">
          ${iconButton({ label: 'Voltar à vista inicial', iconName: 'reset', kind: 'solid', attrs: 'data-pub-reset' })}
          ${iconButton({ label: 'Tela cheia', iconName: 'expand', kind: 'solid', attrs: 'data-pub-full' })}
        </div>
        <div class="pub-arhint" id="ar-hint" hidden>${icon('ar', 16)}<span>Realidade aumentada abre em celulares compatíveis. Aqui, gire e aproxime.</span></div>
        <p class="pub-hint">Arraste para girar · Pinça para aproximar</p>
      </section>
      <section class="pub-info">
        <p class="eyebrow">${p.category}</p>
        <h1>${p.name}</h1>
        <p class="lead-sm">${p.description}</p>
        ${hasDims ? html`<div class="pub-dims"><p class="pub-dims-label">Medidas do fabricante</p><p class="pub-dims-row"><span><abbr title="Largura">L</abbr> ${fmtCm(d.width)} cm</span><span><abbr title="Altura">A</abbr> ${fmtCm(d.height)} cm</span><span><abbr title="Profundidade">P</abbr> ${fmtCm(d.depth)} cm</span></p></div>` : ''}
        ${p.materials.length ? html`<ul class="pub-chips" aria-label="Materiais">${p.materials.map((m) => html`<li>${m}</li>`)}</ul>` : ''}
        ${p.hotspots.length ? html`<h2 class="pub-h2">Detalhes</h2><ol class="pub-hs" id="pub-hs">${p.hotspots.map((h, i) => html`<li><button type="button" data-hs-card="${i}" aria-controls="mv"><span class="hs-n">${i + 1}</span><span><b>${h.title}</b><small>${h.text}</small></span></button></li>`)}</ol>` : ''}
        <div class="pub-actions">${button({ label: 'Compartilhar', kind: 'secondary', iconName: 'link', attrs: 'data-share' })}</div>
      </section>
    </main>
    <footer class="pub-foot"><span class="pub-sig" id="pub-sig">Criado com</span>${brand('brand-xs')}</footer>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>` }));
});

export default r;
