// Assistente de novo produto (captura V2). Três passos em uma página: produto → captura → revisão.
// Os campos ficam em sessionStorage e os arquivos em memória enquanto o assistente está aberto;
// ao concluir, metadados vão para o localStorage e arquivos para o IndexedDB (FormaStore), e a
// tarefa começa no FormaReconstruction.
//
// Métodos e o que cada um envia ao servidor:
//   camera  fotos guiadas (FormaGuided)                       -> method=photos
//   photos  fotos existentes, normalizadas e checadas          -> method=photos
//   video   quadros extraídos no aparelho (FormaVideo)         -> method=photos
//           ou, se o navegador não decodifica, o vídeo inteiro -> method=video
//   model   GLB/glTF local                                     -> não vai ao servidor
(function () {
  'use strict';
  var form = document.getElementById('wizard');
  if (!form || !window.FormaStore) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var Store = window.FormaStore;
  var DKEY = 'forma3d.draft.v1';

  var LIMITS = {
    photoRawMax: 40 * 1024 * 1024,   // antes da normalização (48 MP do iPhone passa com folga)
    model: { exts: ['.glb', '.gltf'], max: 60 * 1024 * 1024 },
  };
  var state = { step: 1, method: 'camera', photos: [], video: null, model: null, scan: null, real: false, limits: {}, clientKey: '' };
  var Recon = window.FormaReconstruction, Guided = window.FormaGuided, Capture = window.FormaCapture;
  var Video = window.FormaVideo, PC = window.FormaPhotoCheck;
  var human = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
  var toast = function (m) { document.dispatchEvent(new CustomEvent('forma:toast', { detail: m })); };
  var minPhotos = function () { return state.limits.photosMin || 20; };
  var esc = function (t) { var d = document.createElement('div'); d.textContent = String(t == null ? '' : t); return d.innerHTML; };
  var notesHtml = function (notes) {
    return notes.map(function (n) { return '<li class="note note-' + n.t + '">' + Store.icon(n.t === 'ok' ? 'check' : 'alert', 16) + '<span>' + n.m + '</span></li>'; }).join('');
  };
  // Bloco de erro padrão: título humano + causa + ação. Nunca só "Erro".
  function errorCard(title, lines) {
    return '<div class="errcard" role="alert"><span class="errcard-ic">' + Store.icon('alert', 20) + '</span><div><b>' + esc(title) + '</b>' +
      lines.filter(Boolean).map(function (l) { return '<p>' + l + '</p>'; }).join('') + '</div></div>';
  }

  // ---------- Rascunho dos campos (sessionStorage) ----------
  function fields() {
    return {
      name: $('#wz-name').value.trim(), category: $('#wz-category').value, description: $('#wz-description').value.trim(),
      brand: $('#wz-brand').value.trim(), tags: $('#wz-tags-value').value.split(',').filter(Boolean),
      dimensions: { width: Number($('#wz-width').value) || null, height: Number($('#wz-height').value) || null, depth: Number($('#wz-depth').value) || null },
      method: state.method,
    };
  }
  function options() {
    var s = $('input[name="surface"]:checked'), q = $('input[name="quality"]:checked');
    var prefs = Store.prefs ? Store.prefs() : {};
    return { surface: s ? s.value : 'normal', quality: q ? q.value : 'high', isMask: prefs.isMask === 0 ? 0 : 1 };
  }
  function saveDraft() { try { sessionStorage.setItem(DKEY, JSON.stringify(fields())); } catch (e) {} }
  function loadDraft() {
    var d; try { d = JSON.parse(sessionStorage.getItem(DKEY) || 'null'); } catch (e) { d = null; }
    if (!d) return;
    $('#wz-name').value = d.name || ''; $('#wz-category').value = d.category || $('#wz-category').value;
    $('#wz-description').value = d.description || ''; $('#wz-brand').value = d.brand || '';
    if (d.dimensions) { $('#wz-width').value = d.dimensions.width || ''; $('#wz-height').value = d.dimensions.height || ''; $('#wz-depth').value = d.dimensions.depth || ''; }
    (d.tags || []).forEach(addTag);
    if (d.description || d.brand || (d.tags || []).length || (d.dimensions && (d.dimensions.width || d.dimensions.height || d.dimensions.depth))) $('.wz-more').open = true;
  }
  form.addEventListener('input', saveDraft);
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  // ---------- Tags ----------
  var tagBox = $('#wz-tags'), tagInput = $('#wz-tag-input');
  function syncTags() { $('#wz-tags-value').value = $$('.tag', tagBox).map(function (t) { return t.dataset.value; }).join(','); saveDraft(); }
  function addTag(value) {
    value = String(value).trim().replace(/,/g, '');
    if (!value || $$('.tag', tagBox).some(function (t) { return t.dataset.value === value; })) return;
    var span = document.createElement('span');
    span.className = 'tag'; span.dataset.value = value; span.textContent = value;
    var b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-label', 'Remover ' + value); b.innerHTML = Store.icon('x', 12);
    b.addEventListener('click', function () { span.remove(); syncTags(); });
    span.appendChild(b); tagBox.insertBefore(span, tagInput); syncTags();
  }
  tagInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput.value); tagInput.value = ''; }
    else if (e.key === 'Backspace' && !tagInput.value) { var last = $$('.tag', tagBox).pop(); if (last) { last.remove(); syncTags(); } }
  });
  tagInput.addEventListener('blur', function () { if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; } });

  // ---------- Passos ----------
  function setStep(n) {
    state.step = n;
    $$('.wz-step').forEach(function (s) { s.hidden = Number(s.dataset.step) !== n; });
    if (n === 3) renderReview();
    var head = $('.wz-step[data-step="' + n + '"] .h-card');
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    if (head) { head.setAttribute('tabindex', '-1'); head.focus({ preventScroll: true }); }
  }
  $$('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () {
      var to = Number(b.dataset.go);
      if (to > state.step && !validateStep(state.step)) return;
      setStep(to);
    });
  });
  function fieldError(id, message) {
    var el = $('#err-' + id), input = $('#wz-' + id);
    if (el) { el.textContent = message || ''; el.hidden = !message; }
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
  }
  function okPhotos() { return state.photos.filter(function (p) { return p.ok; }); }
  function validateStep(n) {
    if (n === 1) {
      var ok = fieldError('name', $('#wz-name').value.trim() ? '' : 'Informe o nome do produto.');
      ok = fieldError('category', $('#wz-category').value ? '' : 'Escolha uma categoria.') && ok;
      if (!ok) { var bad = $('[aria-invalid="true"]'); if (bad) bad.focus(); }
      return ok;
    }
    if (n === 2) {
      var problem = '', min = state.real ? minPhotos() : 3, max = state.limits.photosMax || 300;
      if (state.method === 'camera' && !(state.scan && state.scan.files.length)) problem = 'Faça a captura guiada para continuar.';
      else if (state.method === 'camera' && state.scan.files.length < min) problem = 'São necessárias pelo menos ' + min + ' fotos.';
      if (state.method === 'photos' && okPhotos().length < min) problem = 'Adicione pelo menos ' + min + ' fotos válidas (agora: ' + okPhotos().length + ').';
      if (state.method === 'photos' && okPhotos().length > max) problem = 'O limite é de ' + max + ' fotos. Remova algumas.';
      if (state.method === 'video' && !(state.video && state.video.ready)) problem = state.video && state.video.busy ? 'Aguarde: ainda estamos preparando o vídeo.' : 'Envie ou grave um vídeo ao redor do produto.';
      if (state.method === 'model' && !(state.model && state.model.ok)) problem = 'Envie um arquivo GLB ou glTF válido.';
      if (problem) { toast(problem); return false; }
      return true;
    }
    return true;
  }

  // ---------- Método ----------
  function setMethod(m) {
    state.method = m;
    $$('[data-method]').forEach(function (c) {
      var on = c.dataset.method === m;
      c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('.wz-panel').forEach(function (p) { p.hidden = p.dataset.panel !== m; });
    saveDraft();
  }
  $$('[data-method]').forEach(function (c) {
    c.addEventListener('click', function () {
      setMethod(c.dataset.method);
      if (c.dataset.method === 'camera') openGuided();
      else { var panel = $('.wz-panel[data-panel="' + c.dataset.method + '"]'); if (panel && window.innerWidth < 768) panel.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    });
  });
  $$('[data-switch-method]').forEach(function (b) {
    b.addEventListener('click', function () { setMethod(b.dataset.switchMethod); var card = $('[data-method="' + b.dataset.switchMethod + '"]'); if (card) card.focus(); });
  });

  // ---------- Dropzones ----------
  function wireZone(zone, input, onFiles) {
    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('is-over'); }); });
    zone.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) onFiles(e.dataTransfer.files); });
    input.addEventListener('change', function () { if (input.files.length) onFiles(input.files); input.value = ''; });
  }

  // ---------- Captura guiada ----------
  var scanBox = $('#scan-box'), scanSupport = $('#scan-support');
  function renderScanSupport() {
    if (!scanSupport) return;
    var sup = Guided ? Guided.support() : { ok: false, reason: 'Módulo de captura não carregado.' };
    if (!sup.ok) {
      scanSupport.className = 'note note-warn';
      scanSupport.innerHTML = Store.icon('alert', 16) + '<span><b>Câmera ao vivo indisponível aqui.</b> ' + esc(sup.reason) + ' Use <b>Enviar fotos</b> com o app de câmera do celular — a qualidade é a mesma.</span>';
    } else {
      scanSupport.className = 'note note-ok';
      scanSupport.innerHTML = Store.icon('check', 16) + '<span>Câmera disponível. Você fotografa, nós guiamos as três voltas e checamos cada foto.</span>';
    }
    scanSupport.hidden = !!state.scan && sup.ok;
  }
  function dropScan() {
    if (state.scan && state.scan.frames) state.scan.frames.forEach(function (f) { try { URL.revokeObjectURL(f.url); } catch (e) {} });
    state.scan = null;
  }
  function openGuided() {
    if (!Guided) return;
    var sup = Guided.support();
    if (!sup.ok) { toast(sup.reason); setMethod('photos'); return; }
    Guided.open({ minPhotos: state.real ? minPhotos() : 20, maxPhotos: state.limits.photosMax || 300 }).then(function (out) {
      if (!out) return;
      if (out.fallback === 'native') {
        setMethod('photos');
        var nat = $('#photo-native');
        toast('Fotografe com o app de câmera: cada toque em "Tirar com a câmera" adiciona uma foto.');
        if (nat) $('label[for="photo-native"]').focus();
        return;
      }
      dropScan();
      state.scan = out;
      renderScan();
      renderScanSupport();
      var cta = $('#scan-open .mhero-cta span'); if (cta) cta.textContent = 'Capturar de novo';
      toast(out.count + ' fotos prontas. Toque em Revisar para continuar.');
      setTimeout(function () { scanBox.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, 150);
    }).catch(function (err) { toast('Não foi possível abrir a câmera: ' + (err && err.message ? err.message : err)); });
  }
  function renderScan() {
    if (!scanBox) return;
    var s = state.scan;
    if (!s) { scanBox.innerHTML = ''; return; }
    var notes = [{ t: 'ok', m: s.count + ' fotos · ' + human(s.bytes) + (s.camera && s.camera.res ? ' · câmera ' + s.camera.res : '') }];
    s.passes.forEach(function (p) { notes.push({ t: p.covered === p.total ? 'ok' : p.shots ? 'warn' : 'muted', m: p.label + ': ' + p.shots + (p.shots === 1 ? ' foto' : ' fotos') + (p.covered === p.total ? ' · volta completa' : '') }); });
    if (!s.complete) notes.push({ t: 'warn', m: 'Parece que ainda falta fotografar um dos lados do produto.' });
    (s.notes || []).forEach(function (n) { notes.push(n); });
    var step = Math.max(1, Math.floor(s.frames.length / 10)), shown = [];
    for (var i = 0; i < s.frames.length && shown.length < 10; i += step) shown.push(s.frames[i]);
    scanBox.innerHTML =
      '<div class="result-head"><span><b>Fotos guiadas</b><small>' + s.count + ' fotos em ' + s.passes.filter(function (p) { return p.shots; }).length + ' voltas</small></span>' +
      '<span class="vid-actions"><button type="button" class="btn btn-secondary btn-sm" data-rescan>' + Store.icon('camera', 16) + '<span>Refazer</span></button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-drop-scan>Remover</button></span></div>' +
      '<ul class="scn-result">' + shown.map(function (f) { return '<li><img src="' + f.url + '" alt="" loading="lazy"></li>'; }).join('') + '</ul>' +
      '<ul class="notes">' + notesHtml(notes) + '</ul>';
    scanBox.querySelector('[data-rescan]').addEventListener('click', openGuided);
    scanBox.querySelector('[data-drop-scan]').addEventListener('click', function () { dropScan(); renderScan(); renderScanSupport(); });
  }

  // ---------- Fotos existentes ----------
  var photoGrid = $('#photo-grid'), photoNotes = $('#photo-notes'), photoCount = $('#photo-count');
  var FLAG = { blur: 'Tremida', dark: 'Escura', bright: 'Estourada', dup: 'Repetida', small: 'Pequena', low: 'Baixa resolução' };
  function analyze(file) {
    var item = { file: file, name: file.name || 'foto.jpg', size: file.size, url: '', ok: false, error: '', width: 0, height: 0, flags: [] };
    var isImage = /^image\//.test(file.type) || /\.(jpe?g|png|webp|hei[cf])$/i.test(file.name || '');
    if (!isImage) { item.error = 'Não é uma imagem'; return Promise.resolve(item); }
    if (!file.size) { item.error = 'Arquivo vazio'; return Promise.resolve(item); }
    if (file.size > LIMITS.photoRawMax) { item.error = 'Maior que 40 MB'; return Promise.resolve(item); }
    return PC.analyzeFile(file).then(function (m) {
      if (!m.ok) { item.error = m.error; return item; }
      item.ok = true; item.file = m.file; item.size = m.file.size; item.resized = m.resized;
      item.width = m.width; item.height = m.height; item.sharp = m.sharp; item.mean = m.mean; item.clipped = m.clipped; item.hash = m.hash;
      item.url = Store.objectUrl(m.file);
      return item;
    });
  }
  // Decodificação de fotos grandes pesa no celular: três por vez.
  function mapLimit(list, n, fn) {
    var out = new Array(list.length), i = 0;
    function worker() { if (i >= list.length) return Promise.resolve(); var k = i++; return fn(list[k]).then(function (v) { out[k] = v; return worker(); }); }
    var ws = []; for (var w = 0; w < Math.min(n, list.length); w++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }
  function addPhotos(fileList) {
    var incoming = Array.prototype.slice.call(fileList);
    var done = 0;
    photoCount.textContent = 'Checando ' + incoming.length + (incoming.length > 1 ? ' fotos…' : ' foto…');
    mapLimit(incoming, 3, function (f) {
      return analyze(f).then(function (it) { done++; photoCount.textContent = 'Checando fotos… ' + done + '/' + incoming.length; return it; });
    }).then(function (items) {
      items.forEach(function (it) {
        var dup = state.photos.some(function (p) { return p.name === it.name && p.size === it.size; });
        if (dup) { if (it.url) Store.revoke(it.url); return; }
        state.photos.push(it);
      });
      renderPhotos();
      var bad = items.filter(function (i) { return !i.ok; }).length;
      if (bad) toast(bad + (bad > 1 ? ' arquivos foram recusados.' : ' arquivo foi recusado.') + ' Veja o motivo na lista.');
    });
  }
  function removePhoto(i) {
    var p = state.photos.splice(i, 1)[0];
    if (p && p.url) Store.revoke(p.url);
    renderPhotos();
  }
  function renderPhotos() {
    var ok = okPhotos();
    var judged = PC ? PC.judge(ok) : { notes: [] };
    photoGrid.innerHTML = '';
    state.photos.forEach(function (p, i) {
      var li = document.createElement('li');
      var flag = ['blur', 'dup', 'dark', 'bright', 'small'].filter(function (f) { return (p.flags || []).indexOf(f) >= 0; })[0];
      li.className = 'shot' + (p.ok ? '' : ' is-bad') + (flag ? ' is-flagged' : '');
      li.innerHTML =
        '<span class="shot-pic">' + (p.url ? '<img src="' + p.url + '" alt="" loading="lazy">' : Store.icon('alert', 22)) + '<span class="shot-n">' + (i + 1) + '</span>' +
        (flag ? '<span class="shot-flag">' + FLAG[flag] + '</span>' : '') + '</span>' +
        '<span class="shot-meta"><b></b><small>' + (p.ok ? human(p.size) + ' · ' + p.width + '×' + p.height + (p.resized ? ' · ajustada' : '') : esc(p.error)) + '</small></span>' +
        '<button type="button" class="btn-icon btn-icon-ghost shot-del" aria-label="Remover foto ' + (i + 1) + '">' + Store.icon('trash', 16) + '</button>';
      li.querySelector('.shot-meta b').textContent = p.name;
      li.querySelector('.shot-del').addEventListener('click', function () { removePhoto(i); });
      photoGrid.appendChild(li);
    });
    var bad = state.photos.length - ok.length, min = minPhotos();
    photoCount.textContent = state.photos.length
      ? ok.length + (ok.length === 1 ? ' foto pronta' : ' fotos prontas') + (bad ? ' · ' + bad + ' recusada' + (bad > 1 ? 's' : '') : '')
      : 'Nenhuma foto adicionada ainda.';
    var notes = [];
    if (ok.length && ok.length < min) notes.push({ t: 'bad', m: 'Faltam ' + (min - ok.length) + ' fotos para o mínimo de ' + min + '.' });
    else if (ok.length && ok.length < 30) notes.push({ t: 'warn', m: 'Pronto para enviar. Acima de 30 fotos o modelo costuma ficar mais fiel.' });
    else if (ok.length) notes.push({ t: 'ok', m: 'Quantidade adequada para reconstrução.' });
    judged.notes.forEach(function (n) { notes.push(n); });
    if (ok.length > 120) notes.push({ t: 'warn', m: ok.length + ' fotos: o envio fica lento, sem ganho perceptível acima de ~120.' });
    photoNotes.innerHTML = notesHtml(notes);
  }
  wireZone($('#photo-zone'), $('#photo-input'), addPhotos);
  var nativeInput = $('#photo-native');
  if (nativeInput) nativeInput.addEventListener('change', function () { if (nativeInput.files.length) addPhotos(nativeInput.files); nativeInput.value = ''; });
  $('#photo-clear').addEventListener('click', function () {
    state.photos.splice(0).forEach(function (p) { if (p.url) Store.revoke(p.url); });
    renderPhotos();
  });

  // ---------- Vídeo ao redor do produto ----------
  var videoBox = $('#video-box');
  function dropVideo() {
    var v = state.video;
    if (v && v.frames) v.frames.forEach(function (f) { try { URL.revokeObjectURL(f.url); } catch (e) {} });
    if (v) v.cancelled = true;
    state.video = null;
  }
  function setVideo(fileList, extra) {
    var file = fileList[0];
    if (!file) return;
    dropVideo();
    var v = state.video = { file: file, name: file.name || 'video', size: file.size, busy: true, ready: false, mode: '', info: null, frames: null, captured: !!(extra && extra.captured) };
    if (!file.size) return videoFail(v, 'VIDEO_FORMAT', ['O arquivo está vazio.']);
    videoBox.innerHTML = '<p class="muted">Lendo o vídeo…</p>';
    Video.probe(file).then(function (info) {
      if (v.cancelled) return;
      v.info = info;
      var meta = describeVideo(file, info);
      videoBox.innerHTML =
        '<div class="result-head"><span><b></b><small>' + meta + '</small></span><span class="vid-actions"><button type="button" class="btn btn-ghost btn-sm" data-drop>Remover</button></span></div>' +
        '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Extração de quadros"><i></i><span>Extraindo os melhores quadros…</span></div>';
      videoBox.querySelector('.result-head b').textContent = v.name;
      videoBox.querySelector('[data-drop]').addEventListener('click', function () { dropVideo(); videoBox.innerHTML = ''; });
      var bar = videoBox.querySelector('.progress');
      return Video.extractFrames(file, {
        maxLong: 3840, duration: info.duration || (extra && extra.duration) || 0,
        shouldStop: function () { return v.cancelled; },
        onProgress: function (d, t) {
          var pct = Math.round(d / t * 100);
          bar.querySelector('i').style.width = pct + '%'; bar.setAttribute('aria-valuenow', String(pct));
          bar.querySelector('span').textContent = 'Extraindo os melhores quadros… ' + d + '/' + t;
        },
      }).then(function (out) {
        if (v.cancelled) return;
        if (out.frames.length < minPhotos()) {
          out.frames.forEach(function (f) { URL.revokeObjectURL(f.url); });
          return videoFail(v, 'VIDEO_FEW_FRAMES', ['Só ' + out.frames.length + ' trechos diferentes foram encontrados; o mínimo é ' + minPhotos() + '.']);
        }
        v.mode = 'frames'; v.frames = out.frames; v.extract = out; v.busy = false; v.ready = true;
        renderVideo();
      }, function (err) {
        if (v.cancelled) return;
        // O navegador não decodifica: resta o envio direto, se o arquivo couber nos limites do serviço.
        var issues = Video.directIssues(file, info, state.limits);
        if (!issues.length) {
          v.mode = 'direct'; v.busy = false; v.ready = true;
          return renderVideo();
        }
        var codecNote = info.codec && /hvc1|hev1/.test(info.codec) ? 'O vídeo está em HEVC (padrão do iPhone), que este navegador não abre.' : (err && err.code === 'DECODE' ? 'Este navegador não consegue abrir o vídeo para extrair os quadros.' : '');
        videoFail(v, issues[0].code, [codecNote].concat(issues.map(function (i) { return i.m; })));
      });
    }).catch(function () { videoFail(v, 'VIDEO_FORMAT', ['Não foi possível ler o arquivo.']); });
  }
  function describeVideo(file, info) {
    var parts = [human(file.size)];
    if (info.duration) parts.push(Video.clock(info.duration));
    if (info.width) parts.push(info.width + '×' + info.height);
    if (info.codecLabel) parts.push(info.codecLabel);
    else if (info.container === 'webm') parts.push('WebM');
    return parts.join(' · ');
  }
  function videoFail(v, code, lines) {
    v.busy = false; v.ready = false; v.error = code;
    var e = Recon && Recon.explain ? Recon.explain(code) : { title: '', cause: '', action: '' };
    videoBox.innerHTML = errorCard('Não conseguimos processar este vídeo.', [esc(e.title) ? '<b>' + esc(e.title) + '.</b> ' + lines.filter(Boolean).map(esc).join(' ') : lines.map(esc).join(' '), e.action ? esc(e.action) : '']) +
      '<div class="err-actions"><button type="button" class="btn btn-secondary btn-sm" data-retry-video>Escolher outro vídeo</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-switch-photos>Usar fotos guiadas</button></div>';
    videoBox.querySelector('[data-retry-video]').addEventListener('click', function () { $('#video-input').click(); });
    videoBox.querySelector('[data-switch-photos]').addEventListener('click', function () { setMethod('camera'); openGuided(); });
  }
  function renderVideo() {
    var v = state.video;
    if (!v) { videoBox.innerHTML = ''; return; }
    var notes = [];
    if (v.mode === 'frames') {
      var x = v.extract;
      notes.push({ t: 'ok', m: v.frames.length + ' quadros nítidos extraídos · ' + x.width + '×' + x.height + (x.sourceWidth > x.width ? ' (reduzidos de ' + x.sourceWidth + '×' + x.sourceHeight + ')' : '') });
      if (x.duration < 20) notes.push({ t: 'warn', m: 'Vídeo curto (' + Video.clock(x.duration) + '). Uma volta completa costuma levar de 30 a 90 segundos.' });
      if (x.blurry) notes.push({ t: 'warn', m: x.blurry + (x.blurry === 1 ? ' trecho está tremido' : ' trechos estão tremidos') + '. Andar mais devagar ajuda.' });
      if (x.dropped) notes.push({ t: 'muted', m: x.dropped + ' trechos repetidos (você parado) foram descartados.' });
      notes.push({ t: 'muted', m: 'Os quadros são enviados como fotos: mais controle de qualidade do que mandar o vídeo inteiro.' });
    } else {
      notes.push({ t: 'warn', m: 'Este navegador não abre o vídeo, então ele vai inteiro para o serviço, que extrai os quadros lá.' });
      if (!v.info.confirmed) notes.push({ t: 'warn', m: 'Não conseguimos confirmar duração e resolução no arquivo. O servidor confere de novo.' });
    }
    var step = v.frames ? Math.max(1, Math.floor(v.frames.length / 10)) : 1, shown = [];
    if (v.frames) for (var i = 0; i < v.frames.length && shown.length < 10; i += step) shown.push(v.frames[i]);
    videoBox.innerHTML =
      '<div class="result-head"><span><b></b><small>' + describeVideo(v.file, v.info) + '</small></span>' +
      '<span class="vid-actions"><button type="button" class="btn btn-secondary btn-sm" data-replace>Trocar vídeo</button><button type="button" class="btn btn-ghost btn-sm" data-drop>Remover</button></span></div>' +
      (shown.length ? '<ul class="scn-result">' + shown.map(function (f) { return '<li><img src="' + f.url + '" alt="" loading="lazy"></li>'; }).join('') + '</ul>' : '') +
      '<ul class="notes">' + notesHtml(notes) + '</ul>';
    videoBox.querySelector('.result-head b').textContent = v.name;
    videoBox.querySelector('[data-replace]').addEventListener('click', function () { $('#video-input').click(); });
    videoBox.querySelector('[data-drop]').addEventListener('click', function () { dropVideo(); renderVideo(); });
  }
  wireZone($('#video-zone'), $('#video-input'), setVideo);

  // Gravar agora: a gravação entra pelo mesmo caminho de um vídeo escolhido.
  var videoRecord = $('#video-record');
  if (videoRecord) {
    var capSup = Capture ? Capture.support() : { ok: false, reason: 'Gravação indisponível.' };
    if (!capSup.ok) { videoRecord.disabled = true; $('#video-record-note').textContent = capSup.reason; }
    videoRecord.addEventListener('click', function () {
      if (!Capture) return;
      Capture.open({ requireMp4: false, maxBytes: 300 * 1048576 }).then(function (rec) {
        if (!rec) return;
        setVideo([rec.file], { captured: true, duration: rec.duration });
      }).catch(function (err) { toast('Não foi possível abrir a câmera: ' + (err && err.message ? err.message : err)); });
    });
  }

  // ---------- Modelo 3D pronto ----------
  var modelBox = $('#model-box');
  function readHead(file, bytes) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsArrayBuffer(file.slice(0, bytes));
    });
  }
  function validateModel(file) {
    var name = file.name.toLowerCase();
    var ext = name.slice(name.lastIndexOf('.'));
    var item = { file: file, name: file.name, size: file.size, url: '', ok: false, error: '', kind: ext === '.gltf' ? 'gltf' : 'glb' };
    if (LIMITS.model.exts.indexOf(ext) < 0) { item.error = 'Formato não suportado. Envie um arquivo .glb ou .gltf.'; return Promise.resolve(item); }
    if (!file.size) { item.error = 'Arquivo vazio.'; return Promise.resolve(item); }
    if (file.size > LIMITS.model.max) { item.error = 'Maior que 60 MB.'; return Promise.resolve(item); }
    if (item.kind === 'glb') {
      return readHead(file, 12).then(function (buf) {
        var dv = new DataView(buf);
        if (buf.byteLength < 12 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'glTF') { item.error = 'Este arquivo não é um GLB válido (assinatura glTF ausente).'; return item; }
        if (dv.getUint32(4, true) !== 2) { item.error = 'Só há suporte para glTF 2.0; este arquivo usa outra versão.'; return item; }
        item.ok = true; item.url = Store.objectUrl(file); return item;
      }).catch(function () { item.error = 'Não foi possível ler o arquivo.'; return item; });
    }
    return file.text().then(function (text) {
      var json;
      try { json = JSON.parse(text); } catch (e) { item.error = 'glTF inválido: o arquivo não é um JSON legível.'; return item; }
      if (!json.asset || String(json.asset.version).charAt(0) !== '2') { item.error = 'Só há suporte para glTF 2.0.'; return item; }
      var external = [].concat(json.buffers || [], json.images || []).filter(function (b) { return b && b.uri && b.uri.indexOf('data:') !== 0; });
      if (external.length) { item.error = 'Este glTF depende de ' + external.length + ' arquivo(s) externo(s). Envie um .glb, que já embute geometria e texturas.'; return item; }
      item.ok = true; item.url = Store.objectUrl(file); return item;
    }).catch(function () { item.error = 'Não foi possível ler o arquivo.'; return item; });
  }
  function setModel(fileList) {
    var file = fileList[0];
    modelBox.innerHTML = '<p class="muted">Validando…</p>';
    validateModel(file).then(function (item) {
      if (state.model && state.model.url) Store.revoke(state.model.url);
      state.model = item;
      renderModel();
      if (!item.ok) toast('Arquivo recusado. Veja o motivo abaixo.');
    });
  }
  function renderModel() {
    var m = state.model;
    if (!m) { modelBox.innerHTML = ''; return; }
    if (!m.ok) { modelBox.innerHTML = errorCard('Não conseguimos abrir este arquivo.', ['<b>' + esc(m.name) + '</b> — ' + esc(m.error)]); state.model = null; return; }
    modelBox.innerHTML =
      '<div class="model-preview"><model-viewer id="wz-mv" camera-controls interaction-prompt="none" shadow-intensity="1.2" shadow-softness="0.7" exposure="1.05" loading="eager" alt="Pré-visualização do modelo enviado">' +
      '<div class="mv-loading" slot="poster"><span class="spinner"></span>Carregando modelo…</div></model-viewer>' +
      '<div class="canvas-controls"><button type="button" class="btn-icon btn-icon-solid" data-mv-reset aria-label="Resetar câmera" title="Resetar câmera">' + Store.icon('reset', 18) + '</button></div></div>' +
      '<div class="result-head"><span><b></b><small>' + human(m.size) + ' · ' + m.kind.toUpperCase() + '</small></span>' +
      '<span class="vid-actions"><button type="button" class="btn btn-secondary btn-sm" data-replace>Trocar</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-drop>Remover</button></span></div>' +
      '<p class="note note-ok" id="model-note">' + Store.icon('check', 16) + '<span>Arquivo válido. Arraste para girar e role para aproximar.</span></p>';
    modelBox.querySelector('.result-head b').textContent = m.name;
    var mv = modelBox.querySelector('#wz-mv');
    mv.src = m.url;
    mv.addEventListener('error', function () {
      modelBox.querySelector('#model-note').outerHTML = errorCard('O visualizador não conseguiu abrir este modelo.', ['Ele pode estar corrompido ou usar extensões não suportadas.']);
      state.model.ok = false;
    });
    modelBox.querySelector('[data-mv-reset]').addEventListener('click', function () { mv.cameraOrbit = '-35deg 70deg 105%'; mv.fieldOfView = 'auto'; mv.cameraTarget = 'auto auto auto'; });
    modelBox.querySelector('[data-replace]').addEventListener('click', function () { $('#model-input').click(); });
    modelBox.querySelector('[data-drop]').addEventListener('click', function () { Store.revoke(m.url); state.model = null; renderModel(); });
  }
  wireZone($('#model-zone'), $('#model-input'), setModel);

  // ---------- O que será enviado ----------
  // Plano único usado pela revisão, pelo diálogo de confirmação e pelo envio.
  function plan() {
    if (state.method === 'camera' && state.scan) return { method: 'photos', files: state.scan.files, count: state.scan.count, bytes: state.scan.bytes, label: 'Fotos guiadas', photoBased: true };
    if (state.method === 'photos') { var ok = okPhotos(); return { method: 'photos', files: ok.map(function (p) { return p.file; }), count: ok.length, bytes: ok.reduce(function (n, p) { return n + p.size; }, 0), label: 'Fotos enviadas', photoBased: true }; }
    if (state.method === 'video' && state.video && state.video.mode === 'frames') {
      var fr = state.video.frames; return { method: 'photos', files: fr.map(function (f) { return f.file; }), count: fr.length, bytes: fr.reduce(function (n, f) { return n + f.bytes; }, 0), label: 'Quadros do vídeo', photoBased: true };
    }
    if (state.method === 'video' && state.video) return { method: 'video', files: [state.video.file], count: 1, bytes: state.video.size, label: 'Vídeo inteiro', photoBased: false };
    if (state.method === 'model' && state.model) return { method: 'model', files: [state.model.file], count: 1, bytes: state.model.size, label: 'Modelo 3D pronto', photoBased: false };
    return { method: state.method, files: [], count: 0, bytes: 0, label: '—', photoBased: false };
  }

  // ---------- Revisão ----------
  function renderReview() {
    var f = fields(), p = plan();
    $('#surface-field').hidden = !p.photoBased;
    $('#quality-field').hidden = state.method === 'model';
    var rows = [
      ['Produto', f.name + (f.category ? ' · ' + f.category : '')],
      ['Captura', p.label + (p.count ? ' · ' + p.count + (p.count === 1 ? ' arquivo' : (p.method === 'photos' ? ' fotos' : ' arquivos')) + ' · ' + human(p.bytes) : '')],
    ];
    if ([f.dimensions.width, f.dimensions.height, f.dimensions.depth].some(Boolean)) rows.push(['Medidas', [f.dimensions.width, f.dimensions.height, f.dimensions.depth].map(function (v) { return v || '—'; }).join(' × ') + ' cm']);
    if (f.description) rows.push(['Descrição', f.description]);
    $('#review-list').innerHTML = rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd></dd></div>'; }).join('');
    $$('#review-list dd').forEach(function (dd, i) { dd.textContent = rows[i][1]; });
    $('#review-next').textContent = state.method === 'model'
      ? 'O modelo abre direto na revisão, pronto para publicar.'
      : state.real ? 'Ao criar, os arquivos vão para o servidor e o modelo leva alguns minutos. Você pode fechar a página.'
        : 'O modelo será criado a partir dos arquivos (simulação). Você acompanha na próxima tela.';
    var note = $('#review-simnote');
    if (note) note.innerHTML = state.real && state.method !== 'model'
      ? Store.icon('check', 14) + '<span><b>Processamento real ativo.</b> Os arquivos vão para o servidor da Forma 3D e dele para o motor de reconstrução.</span>'
      : Store.icon('alert', 14) + '<span><b>Simulação no preview.</b> Os arquivos ficam neste navegador e o modelo de fotos/vídeo é simulado. Um modelo 3D enviado funciona de verdade.</span>';
  }
  $$('input[name="surface"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var v = options().surface;
      $('#surface-help').textContent = v === 'transparent'
        ? 'Transparência é o caso mais difícil para qualquer reconstrução. Usamos o modo para superfícies sem textura; o resultado pode precisar de ajustes.'
        : v === 'normal' ? 'Superfícies lisas, metálicas ou transparentes usam um processamento próprio.'
          : 'Vamos usar o processamento para superfícies lisas e reflexivas.';
      $('#quality-field').hidden = v !== 'normal' || state.method === 'model';
    });
  });

  // ---------- Conclusão ----------
  var submit = $('#wz-submit'), progress = $('#wz-progress');
  function setSubmitting(on, text) {
    submit.classList.toggle('is-loading', on);
    submit.disabled = on;
    submit.querySelector('span').textContent = text || 'Criar modelo 3D';
  }
  function setProgress(pct, text) {
    progress.hidden = false;
    progress.querySelector('i').style.width = Math.round(pct) + '%';
    progress.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (text) progress.querySelector('span').textContent = text;
  }
  function storeFiles(product, p) {
    var role = p.method === 'photos' ? 'photo' : p.method;
    var jobs = p.files.map(function (b, i) { return { key: Store.blobKey(product.id, role, i), blob: b }; });
    var done = 0;
    return jobs.reduce(function (chain, j) {
      return chain.then(function () {
        return Store.putBlob(j.key, j.blob).then(function () {
          done += 1;
          if (p.method === 'model' || !state.real) setProgress(done / jobs.length * 100, 'Guardando arquivos… ' + done + '/' + jobs.length);
        });
      });
    }, Promise.resolve()).then(function () { return jobs.length; });
  }
  function confirmReal(p) {
    var dlg = $('#real-confirm'), o = options();
    var cfg = (Recon && Recon.config) || {};
    var text = p.count + (p.count === 1 ? ' arquivo' : ' arquivos') + ' (' + human(p.bytes) + ') vão para o motor de reconstrução' +
      (p.photoBased && o.surface !== 'normal' ? ', no modo para superfícies lisas/reflexivas' : o.quality === 'high' ? ', em qualidade alta (textura 4K)' : '') +
      '. Isso consome créditos do serviço' + (cfg.realJobsMax ? ' (envio ' + ((cfg.realJobsUsed || 0) + 1) + ' de ' + cfg.realJobsMax + ' permitidos aqui)' : '') + '.';
    if (!dlg || !dlg.showModal) return Promise.resolve(window.confirm(text));
    $('#real-confirm-text').textContent = text;
    return new Promise(function (resolve) { confirmPending = resolve; dlg.showModal(); });
  }
  var confirmPending = null, confirmDlg = $('#real-confirm');
  if (confirmDlg) {
    confirmDlg.querySelector('[data-real-yes]').addEventListener('click', function () { confirmDlg.returnValue = 'yes'; confirmDlg.close(); });
    confirmDlg.querySelector('[data-real-no]').addEventListener('click', function () { confirmDlg.returnValue = 'no'; confirmDlg.close(); });
    confirmDlg.addEventListener('close', function () { var r = confirmPending; confirmPending = null; if (r) r(confirmDlg.returnValue === 'yes'); confirmDlg.returnValue = ''; });
  }
  submit.addEventListener('click', function () {
    if (!validateStep(1)) { setStep(1); return; }
    if (!validateStep(2)) { setStep(2); return; }
    var p = plan();
    if (state.real && p.method !== 'model') { confirmReal(p).then(function (yes) { if (yes) createProduct(p); }); return; }
    createProduct(p);
  });
  function thumbFor(p) {
    var src = state.method === 'camera' && state.scan ? state.scan.frames[0].url
      : state.method === 'photos' && okPhotos()[0] ? okPhotos()[0].url
        : state.method === 'video' && state.video && state.video.frames ? state.video.frames[0].url : '';
    if (!src) return Promise.resolve('');
    return new Promise(function (resolve) { var img = new Image(); img.onload = function () { Store.thumbFromImage(img).then(resolve); }; img.onerror = function () { resolve(''); }; img.src = src; });
  }
  function showSubmitError(err) {
    var e = Recon && Recon.explain ? Recon.explain(err && err.code, err && err.message) : { title: 'Não foi possível concluir', cause: err && err.message, action: '' };
    var box = $('#submit-error');
    if (!box) { box = document.createElement('div'); box.id = 'submit-error'; progress.parentNode.insertBefore(box, progress.nextSibling); }
    box.innerHTML = errorCard(e.title, [esc(e.cause), e.detail && e.detail !== e.cause ? '<small>' + esc(e.detail) + '</small>' : '', esc(e.action)]);
    box.scrollIntoView({ block: 'center' });
  }
  function createProduct(p) {
    var f = fields(), o = options();
    var old = $('#submit-error'); if (old) old.remove();
    var product = Store.create({
      name: f.name, category: f.category, description: f.description, brand: f.brand, tags: f.tags,
      dimensions: f.dimensions, dimensionsSource: [f.dimensions.width, f.dimensions.height, f.dimensions.depth].some(Boolean) ? 'manufacturer' : '',
      method: f.method, status: 'uploading', hasFiles: true, options: o,
      files: { count: p.count, names: p.files.map(function (x) { return x.name || ''; }), bytes: p.bytes, sendAs: p.method },
      model: p.method === 'model' ? { kind: 'session', name: state.model.name, format: state.model.kind } : null,
    });
    setSubmitting(true, 'Preparando…');
    setProgress(2, 'Preparando os arquivos…');
    Promise.all([storeFiles(product, p), thumbFor(p)]).then(function (out) {
      if (out[1]) Store.patch(product.id, { thumb: out[1] });
      if (p.method === 'model') {
        Store.patch(product.id, { status: 'review' });
        location.href = '/studio/produtos/' + product.slug;
        return;
      }
      if (!state.clientKey) state.clientKey = 'ck_' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
      setSubmitting(true, 'Enviando…');
      return Recon.createJob({
        productId: product.id, method: p.method, fileCount: p.count, files: p.files, clientKey: state.clientKey, options: o,
        onProgress: function (loaded, total) {
          var pct = total ? loaded / total * 100 : 0;
          setProgress(Math.max(2, pct), pct >= 99.5 ? 'Arquivos enviados. Abrindo o acompanhamento…' : 'Enviando imagens · ' + Math.round(pct) + '% de ' + human(total));
        },
      }).then(function (job) {
        Store.patch(product.id, { status: 'processing', jobId: job.jobId, real: !job.simulated && /^frj_/.test(job.jobId || ''), jobWarning: job.warning || '', sentAt: Date.now() });
        location.href = '/studio/produtos/' + product.slug + '/processando';
      });
    }).catch(function (err) {
      Store.patch(product.id, { status: 'error', error: String(err && err.message || err), errorCode: err && err.code || '' });
      setSubmitting(false);
      progress.hidden = true;
      showSubmitError(err);
    });
  }

  // ---------- Início ----------
  loadDraft();
  var prefs = Store.prefs ? Store.prefs() : {};
  var q = $('input[name="quality"][value="' + (prefs.quality === 'standard' ? 'standard' : 'high') + '"]'); if (q) q.checked = true;
  var draftMethod = (function () { try { return (JSON.parse(sessionStorage.getItem(DKEY) || 'null') || {}).method; } catch (e) { return null; } })();
  setMethod(draftMethod || (Guided && Guided.support().ok ? 'camera' : 'photos'));
  renderPhotos();
  renderScanSupport();
  setStep(1);
  // Modo real ou simulação, decidido pelo servidor (nunca pelo navegador).
  var banner = $('#mode-banner');
  (Recon && Recon.ready ? Recon.ready : Promise.resolve(null)).then(function (cfg) {
    state.real = !!(cfg && cfg.enabled && cfg.mode === 'kiri');
    state.limits = (cfg && cfg.limits) || {};
    if (banner && !state.real) {
      banner.hidden = false;
      banner.className = 'note note-warn';
      banner.innerHTML = Store.icon('alert', 16) + '<span><b>Modo de demonstração.</b> ' + esc((cfg && cfg.reason) || 'O processamento de fotos e vídeo é simulado.') + '</span>';
    }
    renderPhotos();
    renderScanSupport();
  });
  $('#wz-reset').addEventListener('click', function () {
    try { sessionStorage.removeItem(DKEY); } catch (e) {}
    Store.revokeAll();
    location.href = '/studio/produtos/novo';
  });
})();
