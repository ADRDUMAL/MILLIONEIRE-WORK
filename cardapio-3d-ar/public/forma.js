// Interações do preview Forma 3D. Tudo aqui é local ao navegador: nenhum dado é enviado ao servidor.
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Toast ----------
  var toastTimer;
  function toast(msg) {
    var el = $('#toast'); if (!el) return;
    el.textContent = msg; el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('is-on'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); setTimeout(function () { el.hidden = true; }, 260); }, 2800);
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-toast]'); if (t) { ev.preventDefault(); toast(t.getAttribute('data-toast')); }
  });


  // ---------- Drawer da navegação (tablet/celular) ----------
  // Dois gatilhos abrem a mesma gaveta: o menu do topbar (tablet) e o destino "Mais" (celular).
  var drawer = $('#snav'), backdrop = $('#drawer-backdrop'), menuBtns = $$('[data-drawer-open]');
  var lastTrigger = null;
  var compact = window.matchMedia ? window.matchMedia('(max-width: 1099px)') : { matches: false };
  function setDrawer(open) {
    if (!drawer) return;
    drawer.classList.toggle('is-open', open);
    if (backdrop) backdrop.hidden = !open;
    document.body.classList.toggle('drawer-open', open);
    menuBtns.forEach(function (b) { b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    if (open) { var first = drawer.querySelector('.snav-item.is-active') || drawer.querySelector('.snav-item'); if (first) first.focus(); }
    else if (lastTrigger && document.activeElement && drawer.contains(document.activeElement)) lastTrigger.focus();
  }
  if (drawer && menuBtns.length) {
    menuBtns.forEach(function (b) {
      b.addEventListener('click', function () { lastTrigger = b; setDrawer(!drawer.classList.contains('is-open')); });
    });
    $$('[data-drawer-close]').forEach(function (el) { el.addEventListener('click', function () { setDrawer(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.classList.contains('is-open')) setDrawer(false); });
    if (compact.addEventListener) compact.addEventListener('change', function (e) { if (!e.matches) setDrawer(false); });
  }

  // ---------- Sidebar: o indicador desliza até a seção aberta ----------
  // Cada página é um documento novo, então o "de onde veio" fica na sessão: o indicador nasce no
  // item da seção anterior e desliza até o atual. Sem seção anterior, assenta direto, sem animação.
  var ind = $('#snav-ind');
  if (ind && drawer) {
    var NAV_KEY = 'f3d:nav';
    var here = ind.getAttribute('data-active') || '';
    var itemOf = function (k) { return k ? drawer.querySelector('.snav-item[data-key="' + k + '"]') : null; };
    var target = itemOf(here) || drawer.querySelector('.snav-item.is-active');
    if (target) {
      var base = ind.offsetTop; // o indicador e os itens medem a partir da mesma borda da sidebar
      var place = function (el) {
        ind.style.height = el.offsetHeight + 'px';
        ind.style.transform = 'translateY(' + (el.offsetTop - base) + 'px)';
      };
      var snap = function (el) {
        ind.style.transition = 'none'; place(el);
        void ind.offsetWidth; ind.style.transition = '';
      };
      var from = null;
      try { from = itemOf(sessionStorage.getItem(NAV_KEY)); } catch (e) { from = null; }
      drawer.classList.add('has-ind');
      ind.hidden = false;
      if (from && from !== target && !reduced) {
        snap(from);
        ind.classList.add('is-moving');
        requestAnimationFrame(function () { place(target); });
      } else snap(target);
      try { sessionStorage.setItem(NAV_KEY, here); } catch (e) { /* sessão indisponível: sem deslize */ }
      window.addEventListener('resize', function () { snap(target); });
    }
  }

  // ---------- Links absolutos e cópia ----------
  $$('[data-abs-url]').forEach(function (i) { i.value = location.origin + i.value; });
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { toast('Link copiado.'); }, function () { toast('Não foi possível copiar. Selecione o texto e copie manualmente.'); });
    toast('Selecione o texto e copie manualmente.');
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-copy]'); if (!b) return;
    var sel = b.getAttribute('data-copy');
    var input = sel === 'prev' ? b.previousElementSibling : $(sel);
    if (input) copyText(input.value);
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-share]'); if (!b) return;
    var ed = $('.editor'); var url = location.origin + (ed ? ed.getAttribute('data-public-url') : location.pathname);
    if (navigator.share) navigator.share({ title: document.title, url: url }).catch(function () {});
    else copyText(url);
  });

  // ---------- Novo produto: dropzone e lista de arquivos (simulado) ----------
  var capture = $('#capture');
  if (capture) {
    var zone = $('#dropzone'), input = $('#file-input'), list = $('#filelist'), count = $('#file-count'), build = $('#build-btn');
    var files = [];
    var human = function (n) { return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB'; };
    function render() {
      list.hidden = files.length === 0;
      list.innerHTML = files.map(function (f) {
        return '<li><svg class="ic ok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span></span><small>' + human(f.size) + '</small></li>';
      }).join('');
      $$('li span', list).forEach(function (s, i) { s.textContent = files[i].name; });
      var photos = files.filter(function (f) { return f.type.indexOf('image/') === 0; }).length, videos = files.length - photos;
      count.textContent = files.length ? (photos ? photos + (photos > 1 ? ' fotos' : ' foto') : '') + (photos && videos ? ' e ' : '') + (videos ? videos + (videos > 1 ? ' vídeos' : ' vídeo') : '') + ' adicionados.' : 'Nenhum arquivo adicionado ainda.';
      build.disabled = files.length === 0;
    }
    function add(fileList) {
      Array.prototype.forEach.call(fileList, function (f) { if (/^(image\/(jpeg|png|webp)|video\/mp4)$/.test(f.type)) files.push(f); });
      render();
      if (fileList.length && !files.length) toast('Use fotos JPG, PNG, WebP ou vídeo MP4.');
    }
    zone.addEventListener('click', function () { input.removeAttribute('accept'); input.setAttribute('accept', 'image/jpeg,image/png,image/webp,video/mp4'); input.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('is-over'); }); });
    zone.addEventListener('drop', function (e) { if (e.dataTransfer) add(e.dataTransfer.files); });
    input.addEventListener('change', function () { add(input.files); input.value = ''; });
    $$('[data-pick]').forEach(function (b) { b.addEventListener('click', function () { input.setAttribute('accept', b.getAttribute('data-pick')); input.click(); }); });
    build.addEventListener('click', function () {
      build.classList.add('is-loading'); build.querySelector('span').textContent = 'Enviando…';
      setTimeout(function () { location.href = capture.getAttribute('data-next'); }, reduced ? 0 : 700);
    });
  }

  // ---------- "Seu modelo está pronto": conferência antes de publicar ----------
  // O resultado nunca é publicado sozinho: a pessoa gira o modelo, marca os cinco itens e só então
  // "Publicar" libera. Peso do arquivo e escala são preenchidos automaticamente.
  function showReady(opts) {
    var sec = $('#ready');
    if (!sec || !opts.url) return;
    var mv = $('#ready-mv'), publish = $('#ready-publish'), help = $('#ready-help');
    sec.hidden = false;
    mv.src = opts.url;
    var reset = sec.querySelector('[data-ready-reset]');
    if (reset) reset.onclick = function () { mv.cameraOrbit = 'auto auto auto'; mv.cameraTarget = 'auto auto auto'; mv.fieldOfView = 'auto'; };
    var w = $('#ready-weight small');
    fetch(opts.url).then(function (r) { return r.blob(); }).then(function (b) {
      var mb = b.size / 1048576;
      w.textContent = (mb < 1 ? Math.max(1, Math.round(b.size / 1024)) + ' KB' : mb.toFixed(1) + ' MB') + ' · ' + (mb <= 12 ? 'leve o bastante para celular' : mb <= 30 ? 'médio: abre mais devagar no 4G' : 'pesado: pode demorar no celular');
      $('#ready-weight').classList.toggle('is-warn', mb > 12);
    }).catch(function () { w.textContent = 'Não foi possível medir.'; });
    var p = opts.product;
    if (p) {
      var d = p.dimensions || {};
      $('#ready-scale small').textContent = (d.width || d.height || d.depth)
        ? 'Medidas do fabricante: ' + [d.width, d.height, d.depth].map(function (v) { return v || '—'; }).join(' × ') + ' cm'
        : 'Sem medidas do fabricante: a página pública não mostra dimensões.';
      $('#ready-adjust').setAttribute('href', '/studio/produtos/' + p.slug);
    }
    var checks = $$('[data-ready-check]', sec);
    var sync = function () {
      var n = checks.filter(function (c) { return c.checked; }).length;
      publish.disabled = n < checks.length;
      help.textContent = n < checks.length ? 'Falta' + (checks.length - n > 1 ? 'm ' : ' ') + (checks.length - n) + (checks.length - n > 1 ? ' itens' : ' item') + ' para liberar a publicação.' : 'Tudo conferido. Pode publicar.';
    };
    checks.forEach(function (c) { c.addEventListener('change', sync); });
    sync();
    publish.onclick = function () {
      if (p && window.FormaStore) { window.FormaStore.patch(p.id, { status: 'published', publishedAt: Date.now() }); location.href = '/p/' + p.slug; }
      else location.href = '/p/' + (location.pathname.split('/')[3] || '');
    };
    setTimeout(function () { sec.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }, 300);
  }
  var procDone = $('#proc-done');
  if (procDone) procDone.addEventListener('click', function (e) { var r = $('#ready'); if (r && !r.hidden) { e.preventDefault(); r.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); } });

  // ---------- Processamento: progresso simulado ----------
  // Só para os produtos de demonstração; produtos criados pelo usuário são conduzidos pelo provider.
  var proc = $('#proc');
  if (proc && !proc.hasAttribute('data-local')) {
    var pct = $('#pct'), steps = $$('#proc-steps li'), done = $('#proc-done');
    var value = Number(proc.getAttribute('data-start')) || 0;
    function paint() {
      pct.textContent = Math.round(value);
      proc.style.setProperty('--reveal', value + '%');
      var activeSet = false;
      steps.forEach(function (li) {
        var at = Number(li.getAttribute('data-done'));
        li.classList.toggle('is-done', value >= at);
        var active = value < at && !activeSet; if (active) activeSet = true;
        li.classList.toggle('is-active', active);
      });
      if (value >= 100 && !proc.classList.contains('is-done')) {
        proc.classList.add('is-done'); done.hidden = false;
        $('#proc-title').textContent = 'Seu modelo está pronto.';
        $('#proc-lead').textContent = 'Confira o resultado antes de publicar.';
        showReady({ url: proc.getAttribute('data-model') });
      }
    }
    paint();
    var tick = setInterval(function () {
      value = Math.min(100, value + (reduced ? 25 : 0.6 + Math.random() * 1.1));
      paint();
      if (value >= 100) clearInterval(tick);
    }, reduced ? 400 : 260);
  }

  // ---------- Editor ----------
  var ed = $('.editor');
  if (ed) {
    var mv = $('#mv');
    var notice = $('#tool-notice');
    var LABELS = { materials: 'Materiais', hotspots: 'Hotspots', env: 'Ambiente', measure: 'Medidas' };
    $$('[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('[data-tool]').forEach(function (o) { o.classList.remove('is-active'); o.setAttribute('aria-pressed', 'false'); });
        b.classList.add('is-active'); b.setAttribute('aria-pressed', 'true');
        var k = b.getAttribute('data-tool');
        if (k === 'view') { notice.hidden = true; return; }
        if (k === 'hotspots') { selectTab('interacoes', true); notice.hidden = true; return; }
        if (k === 'env') { selectTab('aparencia', true); notice.hidden = true; return; }
        notice.querySelector('b').textContent = LABELS[k]; notice.hidden = false;
      });
    });
    var sheet = $('#ed-props'), sheetBar = $('[data-sheet-toggle]');
    function setSheet(open) {
      if (!sheet) return;
      sheet.classList.toggle('is-open', open);
      if (sheetBar) sheetBar.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (sheetBar) sheetBar.addEventListener('click', function () { setSheet(!sheet.classList.contains('is-open')); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet && sheet.classList.contains('is-open') && compact.matches) setSheet(false); });
    function selectTab(key, fromTool) {
      if (fromTool && compact.matches) setSheet(true);
      $$('[role="tab"]').forEach(function (t) { var on = t.id === 'tab-' + key; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
      $$('[role="tabpanel"]').forEach(function (p) { p.hidden = p.id !== 'panel-' + key; });
    }
    $$('[role="tab"]').forEach(function (t) { t.addEventListener('click', function () { selectTab(t.id.replace('tab-', '')); }); });

    // Aparência → visualizador (model-viewer expõe estes atributos diretamente).
    $$('[data-bg]').forEach(function (s) {
      s.addEventListener('click', function () {
        $$('[data-bg]').forEach(function (o) { o.classList.remove('is-on'); o.setAttribute('aria-pressed', 'false'); });
        s.classList.add('is-on'); s.setAttribute('aria-pressed', 'true');
        mv.style.setProperty('--mv-bg', s.getAttribute('data-bg'));
        saved();
      });
    });
    var exp = $('[data-exposure]'); if (exp) exp.addEventListener('input', function () { mv.setAttribute('exposure', exp.value); });
    var sh = $('[data-shadow]'); if (sh) sh.addEventListener('input', function () { mv.setAttribute('shadow-intensity', sh.value); });
    var ar = $('[data-autorotate]'); if (ar) ar.addEventListener('change', function () { if (ar.checked) mv.setAttribute('auto-rotate', ''); else mv.removeAttribute('auto-rotate'); });
    var reset = $('[data-reset]'); if (reset) reset.addEventListener('click', function () { mv.cameraOrbit = mv.getAttribute('camera-orbit'); mv.cameraTarget = 'auto auto auto'; mv.fieldOfView = 'auto'; toast('Câmera reposicionada.'); });
    var fs = $('[data-fullscreen]'); if (fs) fs.addEventListener('click', function () {
      var el = $('.ed-canvas');
      if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); else toast('Tela cheia não disponível neste navegador.');
    });

    // Nome refletido no cabeçalho + indicador de salvamento (local, simulado).
    var savedTimer, savedEl = $('#ed-saved');
    function saved() { savedEl.classList.add('is-on'); clearTimeout(savedTimer); savedTimer = setTimeout(function () { savedEl.classList.remove('is-on'); }, 2200); }
    var form = $('[data-autosave]');
    if (form) {
      form.addEventListener('input', function (e) { if (e.target.id === 'nome') $('#ed-name').textContent = e.target.value || 'Produto sem nome'; saved(); });
      form.addEventListener('submit', function (e) { e.preventDefault(); });
    }
    var tagsBox = $('#tags');
    if (tagsBox) {
      var tagInput = tagsBox.querySelector('input');
      tagInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !tagInput.value.trim()) return;
        e.preventDefault();
        var span = document.createElement('span'); span.className = 'tag'; span.textContent = tagInput.value.trim();
        var btn = document.createElement('button'); btn.type = 'button'; btn.setAttribute('aria-label', 'Remover ' + span.textContent); btn.setAttribute('data-remove-tag', ''); btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        span.appendChild(btn); tagsBox.insertBefore(span, tagInput); tagInput.value = ''; saved();
      });
      tagsBox.addEventListener('click', function (e) { var b = e.target.closest('[data-remove-tag]'); if (b) { b.parentNode.remove(); saved(); } });
    }

    // Publicar (simulado): diálogo com link e cópia.
    var dlg = $('#publish-dialog');
    $$('[data-publish]').forEach(function (b) {
      b.addEventListener('click', function () {
        b.classList.add('is-loading');
        setTimeout(function () {
          b.classList.remove('is-loading');
          var pill = $('#ed-status');
          if (pill && !/pill-success/.test(pill.className)) { pill.className = 'pill pill-success'; pill.innerHTML = '<svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span>Publicado</span>'; }
          if (dlg && dlg.showModal) dlg.showModal(); else toast('Publicado (simulação).');
        }, reduced ? 0 : 900);
      });
    });
  }

  // ---------- Hotspots (editor e página pública) ----------
  document.addEventListener('click', function (ev) {
    var h = ev.target.closest('.hotspot');
    $$('.hotspot.is-open').forEach(function (o) { if (o !== h) o.classList.remove('is-open'); });
    if (h) h.classList.toggle('is-open');
  });


  // ================= Produtos criados pelo usuário (Fase 3A) =================
  // Metadados vêm do FormaStore (localStorage) e os arquivos do IndexedDB da sessão.
  var Store = window.FormaStore, Recon = window.FormaReconstruction;
  if (Store) {
    document.addEventListener('forma:toast', function (e) { toast(e.detail); });

    var slugOf = function (p) { return p.slug; };
    var editorUrl = function (p) { return '/studio/produtos/' + slugOf(p); };
    var procUrl = function (p) { return '/studio/produtos/' + slugOf(p) + '/processando'; };
    var placeholder = '<svg class="illo" viewBox="0 0 200 200" aria-hidden="true"><path d="M100 36l56 32v64l-56 32-56-32V68z" fill="#E7E3D8" stroke="#C9C7BB" stroke-width="2" stroke-linejoin="round"/><path d="M44 68l56 32 56-32M100 100v64" fill="none" stroke="#C9C7BB" stroke-width="2" stroke-linejoin="round"/></svg>';

    // Resolve o modelo de um produto: arquivo da sessão (IndexedDB) ou GLB devolvido pela tarefa.
    function resolveModel(p) {
      if (p.method === 'model') {
        return Store.getBlob(Store.blobKey(p.id, 'model', 0)).then(function (blob) {
          return blob ? { url: Store.objectUrl(blob), fromFile: true } : { url: '', missing: true };
        }).catch(function () { return { url: '', missing: true }; });
      }
      return Promise.resolve(p.modelUrl ? { url: p.modelUrl, simulated: p.simulatedModel !== false, real: p.simulatedModel === false } : { url: '', missing: !p.modelUrl });
    }

    // ---------- Diálogo de confirmação (exclusão) ----------
    function confirmDialog(opts) {
      return new Promise(function (resolve) {
        var dlg = document.createElement('dialog');
        dlg.className = 'dialog';
        dlg.innerHTML = '<span class="dialog-ic dialog-ic-danger">' + Store.icon('alert', 24) + '</span><h2></h2><p></p>' +
          '<div class="dialog-actions"><button type="button" class="btn btn-danger" data-yes></button>' +
          '<button type="button" class="btn btn-secondary" data-no>Cancelar</button></div>';
        dlg.querySelector('h2').textContent = opts.title;
        dlg.querySelector('p').textContent = opts.text;
        dlg.querySelector('[data-yes]').textContent = opts.confirm || 'Excluir';
        document.body.appendChild(dlg);
        var done = function (v) { dlg.close(); dlg.remove(); resolve(v); };
        dlg.querySelector('[data-yes]').addEventListener('click', function () { done(true); });
        dlg.querySelector('[data-no]').addEventListener('click', function () { done(false); });
        dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
        if (dlg.showModal) dlg.showModal(); else done(window.confirm(opts.text));
      });
    }

    // ---------- Home: métricas, retomada e produtos recentes (Sprint B) ----------
    // O servidor renderiza os números dos produtos de demonstração; aqui somamos o que existe neste
    // navegador. Nenhum número é estimado: só contagem real do que está guardado.
    var recentList = $('#recent-list');
    if (recentList) {
      var PENDING = ['processing', 'review', 'ready', 'draft', 'files_added', 'error'];
      var dateShort = function (ms) {
        try { return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }); } catch (e) { return '—'; }
      };
      var resumeHtml = null;

      // Count-up: uma vez por sessão, só em número que tem escala (três dígitos ou mais). Contar
      // "3 produtos" de 0 a 3 não informa nada e atrasa a leitura. `data-counted` impede que um
      // rerender (excluir um produto, por exemplo) recomece a contagem.
      var countUp = function (el) {
        var end = parseInt(String(el.textContent).replace(/\D/g, ''), 10);
        el.setAttribute('data-counted', '1');
        if (reduced || !(end >= 100)) return;
        var t0 = 0, dur = 560;
        var step = function (now) {
          if (!t0) t0 = now;
          var k = Math.min(1, (now - t0) / dur);
          var eased = 1 - Math.pow(1 - k, 3); // desacelera ao chegar
          el.textContent = Math.round(end * eased).toLocaleString('pt-BR');
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };
      var countOnce = function () {
        var done = false;
        try { done = sessionStorage.getItem('f3d:counted') === '1'; } catch (e) { done = false; }
        $$('[data-metric]').forEach(function (el) {
          if (el.getAttribute('data-counted') === '1') return;
          if (done) { el.setAttribute('data-counted', '1'); return; }
          countUp(el);
        });
        try { sessionStorage.setItem('f3d:counted', '1'); } catch (e) { /* sem sessão: conta de novo */ }
      };

      var localAction = function (p) {
        if (p.status === 'published') return { href: '/p/' + slugOf(p), label: 'Ver página' };
        if (p.status === 'processing') return { href: procUrl(p), label: 'Acompanhar' };
        if (p.status === 'error') return { href: editorUrl(p), label: 'Tentar de novo' };
        return { href: editorUrl(p), label: 'Continuar' };
      };
      var paintHome = function () {
        var locals = Store.list();
        // Métricas: base do servidor + o que foi criado neste navegador.
        var add = { total: locals.length, published: 0, processing: 0, views: 0 };
        locals.forEach(function (p) { if (p.status === 'published') add.published++; if (p.status === 'processing') add.processing++; });
        $$('[data-metric]').forEach(function (el) {
          var k = el.getAttribute('data-metric');
          if (!(k in add) || k === 'views') return; // views locais não existem: não há contador de acessos.
          var base = Number(el.getAttribute('data-base')) || 0;
          el.textContent = String(base + add[k]);
          var hint = $('[data-metric-hint="' + k + '"]');
          if (k === 'processing' && hint) hint.textContent = (base + add.processing) ? 'gerando modelo 3D' : 'nada na fila agora';
        });
        countOnce();

        // Retomada: o produto local pendente mais recente tem prioridade sobre o de demonstração.
        // Sem pendência local, a versão do servidor volta (por isso guardamos o HTML original).
        var pend = locals.filter(function (p) { return PENDING.indexOf(p.status) >= 0; })[0];
        var resume = $('#resume');
        if (resume) {
          if (resumeHtml === null) resumeHtml = resume.innerHTML;
          else resume.innerHTML = resumeHtml;
        }
        if (pend && resume) {
          var media = resume.querySelector('.resume-media');
          if (media) media.innerHTML = pend.thumb ? '<img src="' + pend.thumb + '" alt="">' : placeholder;
          resume.querySelector('.resume-text b').textContent = pend.name;
          resume.querySelector('.resume-text small').textContent = pend.status === 'processing'
            ? 'Processando · você pode fechar esta tela.'
            : pend.hasFiles === false ? 'Os arquivos precisam ser reenviados neste navegador.' : 'Aguardando você finalizar antes de publicar.';
          var oldPill = resume.querySelector('.pill');
          if (oldPill) oldPill.outerHTML = Store.statusPill(pend.status);
          var act = localAction(pend), cta = resume.querySelector('.btn');
          if (cta) { cta.setAttribute('href', act.href); cta.querySelector('span').textContent = act.label; }
          // Progresso: o produto criado aqui não tem percentual do provider, então a barra vira
          // hachura contínua — movimento que comunica atividade sem inventar um número.
          var bar = resume.querySelector('.resume-bar');
          if (bar) {
            bar.hidden = pend.status !== 'processing';
            bar.classList.toggle('is-indeterminate', pend.status === 'processing');
          }
        }

        // Linhas dos produtos criados, no topo da lista de recentes.
        $$('.prow-local', recentList).forEach(function (el) { el.remove(); });
        locals.slice(0, 4).reverse().forEach(function (p) {
          var act = localAction(p);
          var li = document.createElement('li');
          li.className = 'prow prow-local';
          li.innerHTML =
            '<a class="prow-media" href="' + act.href + '" tabindex="-1" aria-hidden="true">' + (p.thumb ? '<img src="' + p.thumb + '" alt="">' : placeholder) + '</a>' +
            '<div class="prow-main"><h3><a href="' + act.href + '"></a></h3><p class="prow-meta"><span class="prow-cat"></span> · atualizado em ' + dateShort(p.updatedAt) + '</p></div>' +
            '<div class="prow-foot">' + Store.statusPill(p.status) +
            (p.hasFiles === false ? '<span class="prow-warn">' + Store.icon('alert', 14) + 'Reenviar arquivos</span>' : '') +
            '<a class="prow-action" href="' + act.href + '">' + act.label + '</a></div>' +
            '<button type="button" class="btn-icon btn-icon-ghost" data-del aria-label="Excluir ' + p.name + '">' + Store.icon('trash', 18) + '</button>';
          li.querySelector('h3 a').textContent = p.name;
          li.querySelector('.prow-cat').textContent = p.category || 'Sem categoria';
          li.querySelector('[data-del]').addEventListener('click', function () {
            confirmDialog({ title: 'Excluir ' + p.name + '?', text: 'O produto e os arquivos guardados neste navegador serão apagados. Não é possível desfazer.' })
              .then(function (yes) { if (yes) { Store.remove(p.id); paintHome(); toast('Produto excluído.'); } });
          });
          recentList.insertBefore(li, recentList.firstChild);
        });
      };
      paintHome();

      // Profundidade funcional (§8): a miniatura do bloco operacional inclina de leve com o ponteiro.
      // Um único elemento por tela, só em ponteiro fino, desligado com prefers-reduced-motion.
      var fine = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)').matches : false;
      var stage = $('#resume');
      if (stage && fine && !reduced) {
        var cap = function (v) { return Math.max(-5, Math.min(5, v)); };
        stage.addEventListener('pointermove', function (ev) {
          var el = stage.querySelector('.resume-media'); if (!el) return;
          var r = el.getBoundingClientRect();
          el.classList.add('is-tilting');
          el.style.transform = 'perspective(600px) rotateY(' + cap((ev.clientX - r.left - r.width / 2) / 46) +
            'deg) rotateX(' + cap((r.top + r.height / 2 - ev.clientY) / 46) + 'deg)';
        });
        stage.addEventListener('pointerleave', function () {
          var el = stage.querySelector('.resume-media'); if (!el) return;
          el.classList.remove('is-tilting'); el.style.transform = '';
        });
      }
    }

    // ---------- Dashboard e lista: cartões dos produtos criados ----------
    var mount = $('#local-products');
    if (mount) {
      var filterStatus = mount.dataset.status || '';
      var query = (mount.dataset.query || '').toLowerCase();
      var render = function () {
        var items = Store.list().filter(function (p) {
          if (filterStatus && p.status !== filterStatus) return false;
          if (query && [p.name, p.category].concat(p.tags || []).join(' ').toLowerCase().indexOf(query) < 0) return false;
          return true;
        });
        mount.innerHTML = '';
        items.forEach(function (p) {
          var art = document.createElement('article');
          art.className = 'pcard pcard-local';
          art.dataset.status = p.status;
          var href = p.status === 'processing' ? procUrl(p) : editorUrl(p);
          var action = p.status === 'published' ? '<a class="pcard-link" href="/p/' + p.slug + '">Ver página</a>'
            : p.status === 'processing' ? '<a class="pcard-link" href="' + procUrl(p) + '">Acompanhar</a>'
            : p.status === 'error' ? '<a class="pcard-link" href="' + editorUrl(p) + '">Tentar de novo</a>'
            : '<a class="pcard-link" href="' + editorUrl(p) + '">Continuar revisão</a>';
          art.innerHTML =
            '<a class="pcard-media" href="' + href + '">' + (p.thumb ? '<img src="' + p.thumb + '" alt="">' : placeholder) + '<span class="pcard-flag">Criado por você</span></a>' +
            '<div class="pcard-body"><div class="pcard-title"><div><h3><a href="' + href + '"></a></h3>' +
            '<p class="pcard-meta"><span class="pcard-cat"></span> · <span class="formats">3D · Web</span></p></div>' +
            '<button type="button" class="btn-icon btn-icon-ghost" data-del aria-label="Excluir produto">' + Store.icon('trash', 18) + '</button></div>' +
            '<div class="pcard-foot">' + Store.statusPill(p.status) + action +
            (p.hasFiles === false ? '<span class="pcard-warn">' + Store.icon('alert', 14) + 'Arquivo precisa ser reenviado</span>' : '') +
            '</div></div>';
          art.querySelector('h3 a').textContent = p.name;
          art.querySelector('.pcard-cat').textContent = p.category || 'Sem categoria';
          art.querySelector('[data-del]').addEventListener('click', function () {
            confirmDialog({ title: 'Excluir ' + p.name + '?', text: 'O produto e os arquivos guardados neste navegador serão apagados. Não é possível desfazer.' })
              .then(function (yes) { if (yes) { Store.remove(p.id); render(); toast('Produto excluído.'); } });
          });
          mount.appendChild(art);
        });
      };
      render();
    }

    // ---------- Editor de um produto criado pelo usuário ----------
    var edLocal = $('.editor[data-local]');
    if (edLocal) {
      var product = Store.get(edLocal.dataset.slug);
      var mvL = $('#mv');
      var notice = $('#local-notice');
      var showNotice = function (kindClass, html) { notice.className = 'panel-notice ' + kindClass; notice.innerHTML = html; notice.hidden = false; };

      if (!product) {
        document.title = 'Produto não encontrado · Forma 3D';
        $('#ed-name').textContent = 'Produto não encontrado';
        showNotice('is-bad', Store.icon('alert', 16) + '<span>Este produto não existe neste navegador. Ele pode ter sido excluído ou criado em outro aparelho.</span><a class="btn btn-secondary btn-sm" href="/studio">Voltar ao início</a>');
      } else if (product.status === 'processing') {
        location.replace(procUrl(product));
      } else {
        document.title = product.name + ' · Forma 3D';
        $('#ed-name').textContent = product.name;
        $('#ed-status').outerHTML = Store.statusPill(product.status).replace('<span class="pill', '<span id="ed-status" class="pill');
        var setVal = function (sel, v) { var el = $(sel); if (el) el.value = v == null ? '' : v; };
        setVal('#nome', product.name); setVal('#descricao', product.description);
        setVal('#largura', product.dimensions && product.dimensions.width); setVal('#altura', product.dimensions && product.dimensions.height);
        setVal('#profundidade', product.dimensions && product.dimensions.depth);
        var cat = $('#categoria');
        if (cat && product.category) { if (!Array.prototype.some.call(cat.options, function (o) { return o.value === product.category || o.text === product.category; })) cat.add(new Option(product.category, product.category)); cat.value = product.category; }
        var tagsBoxL = $('#tags');
        if (tagsBoxL) {
          $$('.tag', tagsBoxL).forEach(function (t) { t.remove(); });
          (product.tags || []).forEach(function (t) {
            var span = document.createElement('span'); span.className = 'tag'; span.textContent = t;
            var b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Remover ' + t); b.setAttribute('data-remove-tag', ''); b.innerHTML = Store.icon('x', 12);
            span.appendChild(b); tagsBoxL.insertBefore(span, tagsBoxL.querySelector('input'));
          });
        }
        // Salvamento real dos metadados editados no painel.
        var persist = function () {
          Store.patch(product.id, {
            name: ($('#nome') || {}).value || product.name,
            category: ($('#categoria') || {}).value || product.category,
            description: ($('#descricao') || {}).value || '',
            tags: $$('#tags .tag').map(function (t) { return t.textContent.trim(); }),
            dimensions: { width: Number(($('#largura') || {}).value) || null, height: Number(($('#altura') || {}).value) || null, depth: Number(($('#profundidade') || {}).value) || null },
          });
        };
        var persistTimer;
        document.addEventListener('input', function () { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 400); });
        document.addEventListener('click', function (e) { if (e.target.closest('[data-remove-tag]')) setTimeout(persist, 0); });

        // Publicação local (sem servidor): muda o estado e libera a página pública.
        $$('[data-publish]').forEach(function (b) {
          b.addEventListener('click', function () {
            Store.patch(product.id, { status: 'published', publishedAt: Date.now() });
            persist();
          });
        });

        // Modelo: arquivo da sessão ou resultado simulado da tarefa.
        var reupload = function () {
          var inp = document.createElement('input');
          inp.type = 'file'; inp.accept = '.glb,.gltf';
          inp.addEventListener('change', function () {
            var f = inp.files[0]; if (!f) return;
            Store.putBlob(Store.blobKey(product.id, 'model', 0), f).then(function () {
              Store.patch(product.id, { hasFiles: true, model: { kind: 'session', name: f.name } });
              location.reload();
            });
          });
          inp.click();
        };
        resolveModel(product).then(function (m) {
          if (m.url) {
            mvL.src = m.url;
            if (m.simulated) showNotice('is-warn', Store.icon('alert', 16) + '<span>Modelo de demonstração gerado pelo processamento simulado — não corresponde às suas fotos.</span>');
            else if (m.real) showNotice('is-ok', Store.icon('check', 16) + '<span>Modelo reconstruído pelo KIRI Engine a partir dos seus arquivos (processamento real).</span>');
            // Miniatura a partir do próprio visualizador. `toBlob` força um novo render, o que
            // `toDataURL` nem sempre garante; uma captura vazia é descartada (fica o placeholder).
            mvL.addEventListener('load', function () {
              if (product.thumb) return;
              setTimeout(function () {
                var shot = mvL.toBlob ? mvL.toBlob({ mimeType: 'image/png', idealAspect: true }) : Promise.reject();
                shot.then(function (blob) {
                  var url = Store.objectUrl(blob), img = new Image();
                  img.onload = function () {
                    Store.thumbFromImage(img).then(function (t) {
                      Store.revoke(url);
                      if (t && t.length > 3000) Store.patch(product.id, { thumb: t });
                    });
                  };
                  img.onerror = function () { Store.revoke(url); };
                  img.src = url;
                }).catch(function () {});
              }, 700);
            });
            mvL.addEventListener('error', function () {
              showNotice('is-bad', Store.icon('alert', 16) + '<span>O visualizador não conseguiu abrir este modelo. Recarregue a página; se persistir, envie os arquivos novamente.</span><a class="btn btn-secondary btn-sm" href="javascript:location.reload()">Recarregar</a>');
            });
          } else if (product.method === 'model') {
            var poster = $('.mv-loading');
            if (poster) poster.innerHTML = Store.icon('alert', 18) + '<span>Modelo indisponível nesta sessão</span>';
            showNotice('is-warn', Store.icon('alert', 16) + '<span><b>Arquivo não disponível nesta sessão.</b> Arquivos ficam só no navegador enquanto ele está aberto; envie o modelo de novo para visualizar.</span><button type="button" class="btn btn-secondary btn-sm" data-reupload>Reenviar modelo</button>');
            notice.querySelector('[data-reupload]').addEventListener('click', reupload);
          } else {
            var poster2 = $('.mv-loading');
            if (poster2) poster2.innerHTML = Store.icon('alert', 18) + '<span>Sem modelo ainda</span>';
            showNotice('is-warn', Store.icon('alert', 16) + '<span>Este produto ainda não tem um modelo. Volte ao processamento para concluir.</span><a class="btn btn-secondary btn-sm" href="' + procUrl(product) + '">Ver processamento</a>');
          }
        });
      }
    }

    // ---------- Processamento de um produto criado pelo usuário ----------
    // Simulado (job_...): percentual local. Real (frj_...): etapas do servidor, sem percentual inventado.
    var procLocal = $('.proc[data-local]');
    if (procLocal && Recon) {
      var pProd = Store.get(location.pathname.split('/')[3] || '');
      var pctEl = $('#pct'), pctWrap = $('.proc-pct'), stepsEl = $$('#proc-steps li'), doneBtn = $('#proc-done');
      var infoTitle = $('#proc-title'), infoLead = $('#proc-lead'), badge = $('#proc-badge'), stageEl = $('#proc-stage'), noteEl = $('.proc .simnote');
      var elapsedEl = $('#proc-elapsed'), errBox = $('#proc-error'), live = $('#proc-live');
      var isRemote = !!(pProd && /^frj_/.test(pProd.jobId || ''));
      var poll = null, lastAnnounced = -1, startedAt = pProd && (pProd.sentAt || pProd.createdAt) || Date.now();
      if (!pProd || !pProd.jobId) {
        infoTitle.textContent = 'Tarefa não encontrada';
        infoLead.textContent = 'Este processamento não existe neste navegador. Crie o produto novamente.';
      } else {
        $('.topbar-title h1').textContent = pProd.name;
        // A foto do próprio produto no lugar da ilustração de demonstração.
        if (pProd.thumb) $('.proc-wire, .proc-fill').forEach(function (el) { el.innerHTML = '<img class="proc-photo" src="' + pProd.thumb + '" alt="">'; });
        if (isRemote) {
          procLocal.classList.add('is-indeterminate');
          pctWrap.hidden = true;
          badge.hidden = false; badge.innerHTML = Store.icon('sparkle', 14) + '<span>Processamento real</span>';
          if (noteEl) noteEl.innerHTML = Store.icon('check', 14) + '<span><b>Processamento real.</b> O serviço não informa percentual: mostramos a etapa em que ele está. O servidor continua acompanhando se você fechar a página.</span>';
          Recon.REMOTE_STEPS.forEach(function (st, i) { if (stepsEl[i]) { stepsEl[i].querySelector('span:last-child').textContent = st.label; stepsEl[i].removeAttribute('data-done'); } });
        }
        if (pProd.jobWarning) { stageEl.hidden = false; stageEl.textContent = pProd.jobWarning; }
        var paintElapsed = function () {
          var min = Math.floor((Date.now() - startedAt) / 60000);
          elapsedEl.hidden = !isRemote;
          elapsedEl.textContent = (min < 1 ? 'Começou agora' : 'Há ' + min + ' min') + ' · costuma levar de 10 a 40 minutos.';
        };
        var announce = function (i) {
          if (i === lastAnnounced || !stepsEl[i]) return;
          lastAnnounced = i;
          live.textContent = 'Etapa atual: ' + stepsEl[i].querySelector('span:last-child').textContent + '.';
        };
        var paintLocal = function (st) {
          if (st.progress != null) {
            pctEl.textContent = Math.round(st.progress);
            procLocal.style.setProperty('--reveal', st.progress + '%');
            var cur = -1;
            stepsEl.forEach(function (li) {
              var at = Number(li.getAttribute('data-done'));
              li.classList.toggle('is-done', st.progress >= at);
              var active = st.status === 'processing' && st.progress < at && cur < 0;
              if (active) cur = stepsEl.indexOf(li);
              li.classList.toggle('is-active', active);
            });
            if (cur >= 0) announce(cur);
          } else {
            var to = st.activeTo != null ? st.activeTo : st.stepIndex;
            stepsEl.forEach(function (li, i) {
              li.classList.toggle('is-done', st.status === 'done' || i < st.stepIndex);
              li.classList.toggle('is-active', st.status !== 'done' && st.status !== 'error' && i >= st.stepIndex && i <= to);
            });
            announce(st.stepIndex);
            paintElapsed();
          }
        };
        var finishError = function (st) {
          clearInterval(poll);
          var e = Recon.explain(st.errorCode, st.message);
          procLocal.classList.add('is-error'); procLocal.classList.remove('is-indeterminate');
          pctWrap.hidden = true;
          infoTitle.textContent = st.rawStatus === 'expired' ? 'O resultado expirou' : 'Não conseguimos criar o modelo';
          infoLead.textContent = e.cause;
          stageEl.hidden = true; elapsedEl.hidden = true;
          errBox.hidden = false;
          errBox.innerHTML = '<div class="errcard" role="alert"><span class="errcard-ic">' + Store.icon('alert', 20) + '</span><div><b></b><p class="errcard-action"></p>' +
            (st.message && st.message !== e.cause ? '<details><summary>Detalhe técnico</summary><p class="errcard-detail"></p></details>' : '') + '</div></div>' +
            '<div class="err-actions">' + (st.retryable ? '<button type="button" class="btn btn-primary" data-retry>' + Store.icon('reset', 18) + '<span>Tentar novamente</span></button>' : '') +
            '<a class="btn btn-secondary" href="/studio/produtos/novo">' + Store.icon('camera', 18) + '<span>Refazer captura</span></a></div>';
          errBox.querySelector('b').textContent = e.title;
          errBox.querySelector('.errcard-action').textContent = e.action + (st.retryable ? ' Os arquivos continuam no servidor: dá para tentar de novo sem reenviar.' : '');
          var det = errBox.querySelector('.errcard-detail'); if (det) det.textContent = st.message + (st.errorCode ? ' (' + st.errorCode + (st.errorStage ? ', etapa ' + st.errorStage : '') + ')' : '');
          var retry = errBox.querySelector('[data-retry]');
          if (retry) retry.addEventListener('click', function () {
            retry.disabled = true;
            Recon.retryJob(pProd.jobId).then(function (v) {
              errBox.hidden = true; errBox.innerHTML = '';
              procLocal.classList.remove('is-error'); procLocal.classList.add('is-indeterminate');
              infoTitle.textContent = 'Estamos criando seu modelo 3D.';
              infoLead.textContent = 'Nova tentativa com os mesmos arquivos.';
              startedAt = Date.now(); Store.patch(pProd.id, { status: 'processing', error: '', sentAt: startedAt });
              lastAnnounced = -1; paintLocal(v); startPoll();
            }).catch(function (err) {
              retry.disabled = false;
              var e2 = Recon.explain(err && err.code, err && err.message);
              errBox.querySelector('b').textContent = e2.title;
              errBox.querySelector('.errcard-action').textContent = e2.cause + ' ' + e2.action;
            });
          });
          Store.patch(pProd.id, { status: 'error', error: st.message || e.cause, errorCode: st.errorCode || '' });
          live.textContent = e.title + '. ' + e.cause;
        };
        var finishDone = function (result) {
          Store.patch(pProd.id, { status: 'review', modelUrl: result.modelUrl, simulatedModel: !!result.simulated, real: !result.simulated });
          procLocal.classList.add('is-done'); procLocal.classList.remove('is-indeterminate');
          procLocal.style.setProperty('--reveal', '100%');
          stepsEl.forEach(function (li) { li.classList.add('is-done'); li.classList.remove('is-active'); });
          if (isRemote) { pctWrap.hidden = false; pctEl.textContent = '100'; }
          infoTitle.textContent = 'Seu modelo está pronto.';
          infoLead.textContent = result.simulated ? 'Modelo de demonstração (simulação): confira a tela e o fluxo de publicação.' : 'Baixado e validado pelo servidor. Confira antes de publicar.';
          stageEl.hidden = true; elapsedEl.hidden = true;
          doneBtn.hidden = false;
          live.textContent = 'Seu modelo está pronto para conferir.';
          showReady({ url: result.modelUrl, product: pProd });
        };
        var tickPoll = function () {
          Recon.getJobStatus(pProd.jobId).then(function (st) {
            paintLocal(st);
            if (st.status === 'error') return finishError(st);
            if (st.status !== 'done') return;
            clearInterval(poll);
            Recon.getResult(pProd.jobId).then(finishDone).catch(function (e) { finishError({ message: e && e.message, errorCode: 'RESULT_INVALID' }); });
          }).catch(function (err) {
            clearInterval(poll);
            finishError({ message: err && err.message ? err.message : 'Não foi possível consultar o processamento.', errorCode: err && err.status === 404 ? 'NOT_FOUND' : 'SERVER_UNAVAILABLE' });
          });
        };
        var startPoll = function () { clearInterval(poll); poll = setInterval(tickPoll, isRemote ? 3000 : 400); };
        startPoll();
        Recon.getJobStatus(pProd.jobId).then(paintLocal).catch(function () {});
      }
    }

    // ---------- Estúdio: conta, marca e preferências 3D (salvas neste navegador) ----------
    var stAccount = $('#st-account');
    if (stAccount && Store.prefs) {
      var pr = Store.prefs();
      var savedEl = $('#st-saved'), savedTimer = null;
      var saved = function (msg) { savedEl.textContent = msg || 'Salvo neste navegador'; savedEl.classList.add('is-on'); clearTimeout(savedTimer); savedTimer = setTimeout(function () { savedEl.classList.remove('is-on'); }, 2200); };
      var initial = function (name) { return String(name || '?').trim().charAt(0).toUpperCase() || '?'; };
      var paintIdentity = function () {
        var p2 = Store.prefs();
        var name = p2.studioName || $('#st-studio').getAttribute('placeholder');
        var owner = p2.owner || $('#st-resp').getAttribute('placeholder');
        $('#st-name').textContent = name; $('#st-owner').textContent = owner; $('#st-prev-name').textContent = name;
        [$('#st-avatar'), $('#st-logo-prev'), $('#st-prev-mark')].forEach(function (el) {
          el.innerHTML = p2.logo ? '<img src="' + p2.logo + '" alt="">' : initial(name);
          el.classList.toggle('has-img', !!p2.logo);
        });
        $('#st-logo-clear').hidden = !p2.logo;
        $('.st-preview-stage').style.background = p2.viewerBg;
        $('#st-prev-sig').hidden = !p2.signature;
        $$('[data-viewer-bg]').forEach(function (b) { var on = b.getAttribute('data-viewer-bg') === p2.viewerBg; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      };
      $('#st-studio').value = pr.studioName; $('#st-resp').value = pr.owner;
      $('#st-signature').checked = !!pr.signature; $('#st-mask').checked = pr.isMask !== 0;
      var qr = $('input[name="st-quality"][value="' + (pr.quality === 'standard' ? 'standard' : 'high') + '"]'); if (qr) qr.checked = true;
      paintIdentity();
      stAccount.addEventListener('submit', function (e) {
        e.preventDefault();
        Store.setPrefs({ studioName: $('#st-studio').value.trim(), owner: $('#st-resp').value.trim() });
        paintIdentity(); saved('Conta salva');
      });
      $('#st-logo-input').addEventListener('change', function () {
        var f = this.files[0]; this.value = '';
        if (!f) return;
        var url = URL.createObjectURL(f), img = new Image();
        img.onload = function () {
          var s = Math.min(1, 256 / Math.max(img.naturalWidth || 256, img.naturalHeight || 256));
          var c = document.createElement('canvas'); c.width = Math.round((img.naturalWidth || 256) * s); c.height = Math.round((img.naturalHeight || 256) * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          if (!Store.setPrefs({ logo: c.toDataURL('image/png') })) { toast('Não coube no armazenamento do navegador. Tente uma imagem menor.'); return; }
          paintIdentity(); saved('Logo salvo');
        };
        img.onerror = function () { URL.revokeObjectURL(url); toast('Não foi possível abrir essa imagem.'); };
        img.src = url;
      });
      $('#st-logo-clear').addEventListener('click', function () { Store.setPrefs({ logo: '' }); paintIdentity(); saved('Logo removido'); });
      $$('[data-viewer-bg]').forEach(function (b) { b.addEventListener('click', function () { Store.setPrefs({ viewerBg: b.getAttribute('data-viewer-bg') }); paintIdentity(); saved(); }); });
      $('#st-signature').addEventListener('change', function () { Store.setPrefs({ signature: this.checked }); paintIdentity(); saved(); });
      $('#st-mask').addEventListener('change', function () { Store.setPrefs({ isMask: this.checked ? 1 : 0 }); saved(); });
      $$('input[name="st-quality"]').forEach(function (r) { r.addEventListener('change', function () { Store.setPrefs({ quality: r.value }); saved(); }); });
      // Plano: números reais — produtos deste navegador somados aos de demonstração e o contador do servidor.
      var locals = Store.list();
      $('#st-products').textContent = String(Number($('#st-products').textContent) + locals.length);
      $('#st-processing').textContent = String(Number($('#st-processing').textContent) + locals.filter(function (p) { return p.status === 'processing'; }).length);
      if (Recon && Recon.ready) Recon.ready.then(function (cfg) {
        $('#st-real').textContent = cfg && cfg.enabled ? (cfg.realJobsUsed || 0) + ' de ' + cfg.realJobsMax : 'Desligado aqui';
      });
      // Links de produtos locais publicados entram na lista de compartilhamento.
      var linkList = $('#st-links');
      locals.filter(function (p) { return p.status === 'published'; }).forEach(function (p) {
        var li = document.createElement('li');
        li.innerHTML = '<span class="st-link-name"><b></b><small>/p/' + p.slug + '</small></span><span class="st-link-actions">' +
          '<button type="button" class="btn-icon btn-icon-ghost" data-copy-link="/p/' + p.slug + '" aria-label="Copiar link">' + Store.icon('copy', 18) + '</button>' +
          '<a class="btn-icon btn-icon-ghost" href="/p/' + p.slug + '" target="_blank" rel="noopener" aria-label="Abrir página">' + Store.icon('arrow', 18) + '</a></span>';
        li.querySelector('b').textContent = p.name;
        linkList.appendChild(li);
      });
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy-link]');
      if (!b) return;
      var url = location.origin + b.getAttribute('data-copy-link');
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Link copiado'); }, function () { window.prompt('Copie o link:', url); });
    });

    // ---------- Página pública de um produto criado pelo usuário ----------
    var pubLocal = $('.pub[data-local]');
    if (pubLocal) {
      var pubProd = Store.get(location.pathname.split('/')[2] || '');
      var mvP = $('#mv');
      if (!pubProd) {
        $('.pub-info h1').textContent = 'Produto não encontrado';
        $('.pub-info .lead-sm').textContent = 'Este produto não existe neste navegador. Links de produtos criados no preview só funcionam no aparelho onde foram criados.';
        $('.pub-stage').remove();
      } else {
        document.title = pubProd.name + ' · Forma 3D';
        $('.pub-info h1').textContent = pubProd.name;
        $('.pub-info .eyebrow').textContent = pubProd.category || 'Produto';
        if (pubProd.description) $('.pub-info .lead-sm').textContent = pubProd.description; else $('.pub-info .lead-sm').hidden = true;
        var studio = Store.prefs ? Store.prefs().studioName : '';
        if (!pubProd.brand && studio) pubProd.brand = studio;
        if (pubProd.brand) { $('.pub-brand-name').textContent = pubProd.brand; $('.pub-brand-mark').textContent = pubProd.brand.charAt(0).toUpperCase(); }
        // Medidas só quando informadas pelo fabricante — nunca estimadas pela fotogrametria.
        var d = pubProd.dimensions || {};
        if (d.width || d.height || d.depth) {
          var dims = document.createElement('div');
          dims.className = 'pub-dims';
          var fmt = function (v) { return v ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' cm' : '—'; };
          dims.innerHTML = '<p class="pub-dims-label">Medidas do fabricante</p><p class="pub-dims-row"><span><abbr title="Largura">L</abbr> ' + fmt(d.width) + '</span><span><abbr title="Altura">A</abbr> ' + fmt(d.height) + '</span><span><abbr title="Profundidade">P</abbr> ' + fmt(d.depth) + '</span></p>';
          $('.pub-info').insertBefore(dims, $('.pub-actions'));
        }
        if (pubProd.status !== 'published') {
          var warn = document.createElement('p');
          warn.className = 'note note-warn';
          warn.innerHTML = Store.icon('alert', 16) + '<span>Este produto ainda não foi publicado. Esta é uma pré-visualização.</span>';
          $('.pub-info').insertBefore(warn, $('.pub-info .eyebrow'));
        }
        resolveModel(pubProd).then(function (m) {
          if (m.url) { mvP.src = m.url; return; }
          $('.pub-stage').innerHTML = '<div class="pub-missing">' + Store.icon('alert', 22) + '<p><b>Modelo indisponível nesta sessão.</b><br>Os arquivos enviados ficam apenas no navegador em que foram criados.</p></div>';
        });
      }
    }
  }

  // ---------- Página pública: viewer, AR e hotspots ligados à lista ----------
  var pubMv = document.body.classList.contains('public') && $('#mv');
  if (pubMv) {
    // AR incompatível: o botão some (model-viewer) e fica uma explicação, nunca um botão quebrado.
    pubMv.addEventListener('load', function () { var hint = $('#ar-hint'); if (hint && !pubMv.canActivateAR) hint.hidden = false; });
    // Progresso real do download do GLB (o texto da página não espera o 3D).
    pubMv.addEventListener('progress', function (e) {
      var bar = pubMv.querySelector('.pub-progress'); if (!bar) return;
      var t = e.detail && e.detail.totalProgress || 0;
      bar.querySelector('i').style.transform = 'scaleX(' + t + ')';
      bar.classList.toggle('is-done', t >= 1);
    });
    // Preferências de marca do estúdio (fundo do viewer, assinatura).
    var sp = window.FormaStore && window.FormaStore.prefs ? window.FormaStore.prefs() : null;
    if (sp) {
      var stage = $('.pub-stage'); if (stage && sp.viewerBg) { stage.style.setProperty('--viewer-bg', sp.viewerBg); stage.classList.toggle('is-dark', sp.viewerBg === '#0B352B'); }
      var sig = $('.pub-foot'); if (sig && sp.signature === false) sig.hidden = true;
    }
    var initialOrbit = pubMv.getAttribute('camera-orbit') || 'auto auto auto';
    var resetView = function () { pubMv.cameraTarget = 'auto auto auto'; pubMv.cameraOrbit = initialOrbit; pubMv.fieldOfView = 'auto'; setHotspot(-1); };
    var resetBtn = $('[data-pub-reset]'); if (resetBtn) resetBtn.addEventListener('click', resetView);
    var fullBtn = $('[data-pub-full]');
    if (fullBtn) {
      var stageEl = $('.pub-stage');
      if (!stageEl.requestFullscreen && !stageEl.webkitRequestFullscreen) fullBtn.hidden = true;
      fullBtn.addEventListener('click', function () {
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else (stageEl.requestFullscreen || stageEl.webkitRequestFullscreen).call(stageEl);
      });
    }
    // Um toque no número do modelo destaca o detalhe na lista; um toque no detalhe leva a câmera até o ponto.
    var hsCards = $$('[data-hs-card]'), hsDots = $$('.pub-stage .hotspot');
    function setHotspot(i, moveCamera) {
      hsCards.forEach(function (c) { var on = Number(c.getAttribute('data-hs-card')) === i; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      hsDots.forEach(function (h) { h.classList.toggle('is-active', Number(h.getAttribute('data-hs')) === i); });
      if (i < 0 || !moveCamera) return;
      var dot = hsDots[i]; if (!dot) return;
      pubMv.autoRotate = false;
      pubMv.cameraTarget = dot.getAttribute('data-position');
      var o = pubMv.getCameraOrbit ? pubMv.getCameraOrbit() : null;
      if (o) pubMv.cameraOrbit = o.theta + 'rad ' + o.phi + 'rad 90%';
    }
    hsDots.forEach(function (h) {
      h.addEventListener('click', function () {
        var i = Number(h.getAttribute('data-hs'));
        setHotspot(i, true);
        var card = hsCards[i];
        if (card && window.innerWidth < 1100) card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
      });
    });
    hsCards.forEach(function (c) {
      c.addEventListener('click', function () {
        var i = Number(c.getAttribute('data-hs-card'));
        if (c.classList.contains('is-active')) { resetView(); return; }
        setHotspot(i, true);
        if (window.innerWidth < 1100) $('.pub-stage').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      });
    });
  }

  // ---------- Landing: visor de captura ----------
  // As leituras são a câmera real do <model-viewer>; o estado só vira "Modelo pronto" no evento load.
  var finder = $('[data-finder]');
  if (finder) {
    var fmv = $('model-viewer', finder), az = $('[data-ro="az"]', finder), el = $('[data-ro="el"]', finder), fstate = $('[data-finder-state]', finder);
    var deg = function (rad) { return Math.round(((rad * 180 / Math.PI) % 360 + 360) % 360); };
    var readout = function () {
      var o = fmv.getCameraOrbit ? fmv.getCameraOrbit() : null; if (!o) return;
      az.textContent = String(deg(o.theta)).padStart(3, '0') + '°';
      el.textContent = String(deg(o.phi)).padStart(2, '0') + '°';
    };
    fmv.addEventListener('camera-change', readout);
    fmv.addEventListener('load', function () { readout(); fstate.textContent = 'Modelo pronto'; finder.classList.add('is-ready'); });
    fmv.addEventListener('error', function () { fstate.textContent = 'Não foi possível abrir o modelo'; });
  }

  // ---------- Landing: frase que acende conforme a leitura ----------
  // Sem JS ou com movimento reduzido a frase aparece inteira; o efeito só liga quando pode rodar.
  var statement = $('[data-reveal]');
  if (statement && !reduced && 'requestAnimationFrame' in window) {
    var ws = $$('.w', statement), ticking = false;
    statement.classList.add('is-armed');
    var paint = function () {
      ticking = false;
      var r = statement.getBoundingClientRect(), vh = window.innerHeight;
      var p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      var on = Math.round(p * ws.length);
      ws.forEach(function (w, i) { w.classList.toggle('is-on', i < on); });
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(paint); } }, { passive: true });
    paint();
  }

  // ---------- Landing: setores trocam o modelo do visor ----------
  var tabs = $('[data-sector-tabs]');
  if (tabs) {
    var smv = $('[data-sector-mv]'), slabel = $('[data-sector-label]'), panel = $('#lx-sector-view');
    var rows = $$('[role="tab"]', tabs);
    var select = function (row, focus) {
      rows.forEach(function (x) { var on = x === row; x.setAttribute('aria-selected', on ? 'true' : 'false'); x.tabIndex = on ? 0 : -1; });
      if (smv.getAttribute('src') !== row.getAttribute('data-model')) {
        smv.setAttribute('camera-orbit', row.getAttribute('data-orbit'));
        smv.setAttribute('src', row.getAttribute('data-model'));
      }
      slabel.textContent = row.getAttribute('data-label');
      smv.setAttribute('alt', row.getAttribute('data-label') + ' em 3D. Arraste para girar.');
      panel.setAttribute('aria-labelledby', row.id);
      if (focus) row.focus();
    };
    rows.forEach(function (row, i) {
      row.addEventListener('click', function () { select(row, false); });
      row.addEventListener('keydown', function (e) {
        var k = e.key, n = rows.length, to = null;
        if (k === 'ArrowDown' || k === 'ArrowRight') to = rows[(i + 1) % n];
        else if (k === 'ArrowUp' || k === 'ArrowLeft') to = rows[(i - 1 + n) % n];
        else if (k === 'Home') to = rows[0];
        else if (k === 'End') to = rows[n - 1];
        if (to) { e.preventDefault(); select(to, true); }
      });
    });
  }
})();
