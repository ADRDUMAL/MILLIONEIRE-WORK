// Forma 3D · Captura de fotos guiadas (captura V2 — método recomendado).
//
// A pessoa fotografa; a interface guia. Três voltas curtas ao redor do produto (altura do centro,
// de cima, de baixo), um disparador grande, miniaturas das últimas fotos e um contador. Cada foto
// passa por uma checagem na hora (tremida, escura, quase igual à anterior) — a recusada não entra
// e a dica diz o que fazer. Não há número fixo: o mínimo técnico é 20 fotos, a meta é ~36 e dá
// para passar disso em objetos complexos.
//
// Cobertura: com bússola (DeviceOrientation), cada foto preenche o setor do anel correspondente à
// direção em que a pessoa está; sem bússola, o anel avança pela contagem de fotos da volta — e a
// tela diz isso. É uma heurística declarada, não visão computacional.
//
// Qualidade: câmera traseira principal na maior resolução real (FormaCamera); a foto sai do sensor
// via ImageCapture quando o navegador permite (Chrome Android) e, senão, do quadro do stream.
//
// Contrato:
//   FormaGuided.support() -> { ok, secure, reason, sensors }
//   FormaGuided.open(opts) -> Promise<null | { fallback: 'native' } | result>
//     result = { files, frames, count, bytes, passes, sensors, camera, notes, complete }
//     opts.minPhotos (20) · opts.maxPhotos (300) · opts.stream (MediaStream de teste)
window.FormaGuided = (function () {
  'use strict';

  var Q = window.FormaScanQuality, Frames = window.FormaScanFrames, Heading = window.FormaScanHeading;
  var Cam = window.FormaCamera, PC = window.FormaPhotoCheck;

  var PASSES = [
    { key: 'mid', label: 'Altura do produto', short: 'Volta 1', sectors: 16,
      start: 'Comece pela frente, na altura do centro do produto.', go: 'Continue andando devagar ao redor do produto.' },
    { key: 'high', label: 'Um pouco de cima', short: 'Volta 2', sectors: 12,
      start: 'Agora incline um pouco a câmera para baixo.', go: 'Mesma volta, com a câmera mais alta.' },
    { key: 'low', label: 'Um pouco de baixo', short: 'Volta 3', sectors: 8,
      start: 'Última volta. Capture as partes que ainda faltam.', go: 'Câmera mais baixa, quando der.' },
  ];
  var TARGET = PASSES.reduce(function (n, p) { return n + p.sectors; }, 0); // 36
  var SAMPLE_MS = 250;
  var CENTER = { x: 0.2, y: 0.15, w: 0.6, h: 0.7 };

  var ICONS = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    square: '<rect x="4" y="4" width="16" height="16" rx="3"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5v-5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.7-2.3L3.5 15a1.5 1.5 0 0 1 2.3-1.9L8 15"/>',
    orbit: '<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 5v10M9 7.5 12 5l3 2.5"/>',
    cube: '<path d="m12 2 8 4.5v9L12 20l-8-4.5v-9z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  };
  function icon(name, size) {
    return '<svg class="ic" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  var human = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
  // Vibração só depois de um toque real (o navegador recusa antes disso e polui o console).
  var buzz = function (p) { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(p); } catch (e) { /* ignora */ } };
  var norm = function (a) { a = a % 360; return a < 0 ? a + 360 : a; };
  var reduced = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; };

  function support() {
    var secure = !!window.isSecureContext;
    var gum = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var mods = !!(Q && Frames && Cam && PC);
    var out = { ok: secure && gum && mods, secure: secure, getUserMedia: gum, sensors: Heading ? Heading.supported() : false, reason: '' };
    if (!secure) out.reason = 'A câmera ao vivo só funciona em HTTPS (ou em localhost). No celular, abra este endereço começando com https://.';
    else if (!gum) out.reason = 'Este navegador não permite acesso à câmera.';
    else if (!mods) out.reason = 'Os módulos de captura não foram carregados.';
    return out;
  }

  // ---------- Anel de três voltas ----------
  var RING = { size: 120, c: 60, r: [52, 40, 28] };
  function arc(r, a0, a1) {
    var p = function (a) { var t = (a - 90) * Math.PI / 180; return [RING.c + r * Math.cos(t), RING.c + r * Math.sin(t)]; };
    var s = p(a0), e = p(a1), large = a1 - a0 > 180 ? 1 : 0;
    return 'M' + s[0].toFixed(2) + ' ' + s[1].toFixed(2) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e[0].toFixed(2) + ' ' + e[1].toFixed(2);
  }
  function ringSvg() {
    var out = '';
    PASSES.forEach(function (p, pi) {
      var step = 360 / p.sectors, gap = Math.min(6, step * 0.24);
      out += '<g class="gd-pass" data-pass="' + pi + '">';
      for (var i = 0; i < p.sectors; i++) out += '<path class="gd-sec" data-sec="' + i + '" d="' + arc(RING.r[pi], i * step + gap / 2, (i + 1) * step - gap / 2) + '"/>';
      out += '</g>';
    });
    out += '<circle class="gd-here" r="4" cx="' + RING.c + '" cy="' + (RING.c - RING.r[0]) + '" hidden/>';
    return '<svg viewBox="0 0 ' + RING.size + ' ' + RING.size + '" aria-hidden="true">' + out + '</svg>';
  }

  function template(sup) {
    return '' +
      '<video class="gd-video" autoplay muted playsinline></video>' +
      '<div class="gd-flash" aria-hidden="true"></div>' +

      // Tela 1 — preparar o objeto
      '<section class="gd-sheet gd-prep" aria-labelledby="gd-prep-t">' +
        '<p class="gd-kicker">Fotos guiadas</p>' +
        '<h2 id="gd-prep-t">Prepare o produto</h2>' +
        '<ul class="gd-check">' +
          '<li>' + icon('sun', 22) + '<span>Boa iluminação</span></li>' +
          '<li>' + icon('square', 22) + '<span>Fundo simples</span></li>' +
          '<li>' + icon('hand', 22) + '<span>Produto parado</span></li>' +
          '<li>' + icon('orbit', 22) + '<span>Espaço para dar uma volta completa</span></li>' +
        '</ul>' +
        '<details class="gd-tips"><summary>Ver dicas para objetos brilhantes ou transparentes</summary>' +
          '<ul><li>Use luz difusa: sem sol direto e sem lâmpada refletida no produto.</li>' +
          '<li>Afaste janelas e telas que aparecem refletidas.</li>' +
          '<li>Na revisão, marque a superfície como metálica ou transparente — usamos o modo certo para ela.</li></ul></details>' +
        '<div class="gd-actions">' +
          '<button type="button" class="btn btn-primary btn-lg gd-cta" data-gd-start>' + icon('camera', 20) + '<span>Começar captura</span></button>' +
          '<button type="button" class="gd-link" data-gd-native>' + icon('phone', 18) + '<span>Prefere o app de câmera do celular?</span></button>' +
        '</div>' +
        '<button type="button" class="gd-close gd-close-sheet" data-gd-cancel aria-label="Fechar">' + icon('x', 22) + '</button>' +
      '</section>' +

      // Tela 2 — captura
      '<div class="gd-live" hidden>' +
        '<div class="gd-top">' +
          '<button type="button" class="gd-close" data-gd-cancel aria-label="Sair da captura">' + icon('x', 22) + '</button>' +
          '<p class="gd-count" aria-live="polite"><b>0</b> de <span class="gd-target">' + TARGET + '</span> fotos</p>' +
          '<div class="gd-top-r">' +
            '<span class="gd-res" title="Resolução real da câmera"></span>' +
            '<button type="button" class="gd-icon-btn" data-gd-switch aria-label="Trocar câmera" hidden>' + icon('swap', 20) + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="gd-frame" aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>' +
        '<div class="gd-guide">' +
          '<div class="gd-ring" role="img" aria-label="Cobertura das três voltas">' + ringSvg() + '<span class="gd-ring-ic">' + icon('cube', 18) + '</span></div>' +
          '<div class="gd-guide-text">' +
            '<p class="gd-pass-label"></p>' +
            '<p class="gd-instr" aria-live="polite"></p>' +
            '<p class="gd-hint" role="status" aria-live="assertive"></p>' +
            '<button type="button" class="gd-next" data-gd-next hidden>Próxima volta</button>' +
          '</div>' +
        '</div>' +
        '<div class="gd-bottom">' +
          '<ul class="gd-tray" aria-label="Últimas fotos"></ul>' +
          '<button type="button" class="gd-shutter" data-gd-shot aria-label="Tirar foto"><span></span></button>' +
          '<button type="button" class="gd-done" data-gd-done disabled><span>Concluir</span><small></small></button>' +
        '</div>' +
      '</div>' +

      // Revisão
      '<section class="gd-sheet gd-review" aria-labelledby="gd-rev-t" hidden>' +
        '<p class="gd-kicker">Revisão</p>' +
        '<h2 id="gd-rev-t">Confira as fotos</h2>' +
        '<ul class="gd-summary notes"></ul>' +
        '<ul class="gd-grid" aria-label="Fotos capturadas"></ul>' +
        '<div class="gd-actions gd-actions-row">' +
          '<button type="button" class="btn btn-secondary" data-gd-more>' + icon('camera', 18) + '<span>Fotografar mais</span></button>' +
          '<button type="button" class="btn btn-primary" data-gd-use>' + icon('check', 18) + '<span>Usar fotos</span></button>' +
        '</div>' +
      '</section>' +

      // Erro
      '<section class="gd-sheet gd-error" role="alert" hidden>' +
        '<h2>Não conseguimos abrir a câmera</h2>' +
        '<p class="gd-error-text"></p>' +
        '<div class="gd-actions">' +
          '<button type="button" class="btn btn-primary" data-gd-retry>' + icon('reset', 18) + '<span>Tentar de novo</span></button>' +
          '<button type="button" class="gd-link" data-gd-native>' + icon('phone', 18) + '<span>Usar o app de câmera do celular</span></button>' +
        '</div>' +
      '</section>';
  }

  function open(opts) {
    opts = opts || {};
    var sup = support();
    if (!sup.ok && !opts.stream) return Promise.reject(new Error(sup.reason));
    var MIN = opts.minPhotos || 20, MAX = opts.maxPhotos || 300;

    return new Promise(function (resolve) {
      var root = document.createElement('div');
      root.className = 'gd';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Captura de fotos guiadas');
      root.innerHTML = template(sup);
      var $ = function (s) { return root.querySelector(s); };
      var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
      var video = $('.gd-video'), live = $('.gd-live'), prep = $('.gd-prep'), review = $('.gd-review'), errorEl = $('.gd-error');
      var countEl = $('.gd-count b'), instrEl = $('.gd-instr'), hintEl = $('.gd-hint'), passLabel = $('.gd-pass-label');
      var tray = $('.gd-tray'), doneBtn = $('[data-gd-done]'), shutter = $('[data-gd-shot]'), nextBtn = $('[data-gd-next]');
      var previous = document.activeElement;

      var session = null, sampler = null, heading = null, wake = null, timer = null, closed = false;
      var shots = [], passIdx = 0, passBase = [null, null, null], filled = PASSES.map(function (p) { return new Array(p.sectors).fill(0); });
      var lastLuma = null, lastKeyLuma = null, sharpRef = 0, busy = false, hintTimer = null, seq = 0;

      document.body.appendChild(root);
      document.body.classList.add('gd-open');

      // ---------- ciclo de vida ----------
      function stopLoop() { if (timer) { clearInterval(timer); timer = null; } }
      function releaseWake() { if (wake) { try { wake.release(); } catch (e) { /* ignora */ } wake = null; } }
      function stopCamera() { if (session && !opts.stream) session.stop(); session = null; }
      function close(value) {
        if (closed) return;
        closed = true;
        stopLoop(); releaseWake(); stopCamera();
        if (heading) heading.stop();
        if (!value || value.fallback) shots.forEach(function (s) { URL.revokeObjectURL(s.url); });
        document.removeEventListener('keydown', onKey, true);
        document.body.classList.remove('gd-open');
        root.remove();
        if (previous && previous.focus) { try { previous.focus(); } catch (e) { /* ignora */ } }
        resolve(value);
      }
      function show(which) {
        prep.hidden = which !== 'prep'; review.hidden = which !== 'review'; errorEl.hidden = which !== 'error';
        live.hidden = which !== 'live';
        root.dataset.view = which;
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); if (root.dataset.view === 'live' && shots.length) showReview(); else close(null); return; }
        if (root.dataset.view === 'live' && (e.key === ' ' || e.key === 'Enter') && document.activeElement === shutter) { e.preventDefault(); shoot(); return; }
        if (e.key !== 'Tab') return;
        var f = $$('button, summary, [href]').filter(function (el) { return !el.disabled && !el.closest('[hidden]') && el.offsetParent !== null; });
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
      document.addEventListener('keydown', onKey, true);

      // ---------- câmera ----------
      function startCamera(deviceId) {
        var get = opts.stream
          ? Promise.resolve({ stream: opts.stream, track: opts.stream.getVideoTracks()[0], width: 0, height: 0, label: 'stream de teste', rear: [], canSwitch: false, canTakePhoto: false, stop: function () {}, describe: function () { return ''; } })
          : Cam.open({ deviceId: deviceId });
        return get.then(function (s) {
          if (closed) { if (!opts.stream) s.stop(); return; }
          session = s;
          video.srcObject = s.stream;
          s.track.addEventListener('ended', function () { if (!closed && root.dataset.view === 'live') fail('A câmera foi desligada pelo sistema.'); });
          return video.play().catch(function () {});
        }).then(function () {
          if (closed || !session) return;
          if (!session.width) { session.width = video.videoWidth; session.height = video.videoHeight; }
          var res = Cam.describe(video.videoWidth || session.width, video.videoHeight || session.height);
          $('.gd-res').textContent = res;
          $('.gd-res').hidden = !res;
          $('[data-gd-switch]').hidden = !session.canSwitch;
          sampler = sampler || Frames.createSampler(video, 160);
        });
      }
      function fail(msg) { stopLoop(); releaseWake(); $('.gd-error-text').textContent = msg; show('error'); $('[data-gd-retry]').focus(); }

      function begin() {
        var btn = $('[data-gd-start]'); btn.disabled = true;
        // Sensores só dentro do toque (exigência do iOS).
        heading = heading || (Heading ? Heading.create({}) : null);
        var perm = heading ? heading.request().then(function (ok) { if (ok) heading.listen(); }).catch(function () {}) : Promise.resolve();
        perm.then(function () { return startCamera(); }).then(function () {
          if (closed) return;
          show('live'); paint(); startLoop();
          if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {});
          shutter.focus();
        }).catch(function (err) { btn.disabled = false; fail(Cam.errorMessage(err)); });
      }

      // ---------- leitura contínua (dicas de luz e posição na bússola) ----------
      function startLoop() { stopLoop(); timer = setInterval(tick, SAMPLE_MS); }
      var darkStreak = 0;
      function tick() {
        if (!sampler) return;
        var s = sampler.sample();
        if (s) {
          var ex = Q.exposure(s.luma, s.w, s.h, CENTER);
          darkStreak = ex.mean < 50 ? darkStreak + 1 : 0;
          if (darkStreak === 8) hint('Pouca luz. Acenda uma luz ou aproxime o produto de uma janela.', 'warn');
          lastLuma = s.luma;
        }
        paintHere();
      }
      function sensorHeading() {
        if (!heading) return null;
        var d = heading.debug();
        return heading.hasSensor && d.raw != null ? d.raw : null;
      }
      function paintHere() {
        var here = $('.gd-here'), h = sensorHeading();
        if (h == null || passBase[passIdx] == null) { here.setAttribute('hidden', ''); return; }
        var a = (norm(h - passBase[passIdx]) - 90) * Math.PI / 180, r = RING.r[passIdx];
        here.setAttribute('cx', (RING.c + r * Math.cos(a)).toFixed(2));
        here.setAttribute('cy', (RING.c + r * Math.sin(a)).toFixed(2));
        here.removeAttribute('hidden');
      }

      // ---------- disparo ----------
      function hint(text, tone) {
        hintEl.textContent = text;
        hintEl.className = 'gd-hint' + (tone ? ' is-' + tone : '');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(function () { hintEl.textContent = ''; hintEl.className = 'gd-hint'; }, tone === 'ok' ? 1400 : 3200);
      }

      function shoot() {
        if (busy || !sampler || shots.length >= MAX) return;
        var s = sampler.sample();
        if (!s) { hint('A câmera ainda está abrindo.', 'warn'); return; }
        var sharp = Q.sharpness(s.luma, s.w, s.h, CENTER);
        var ex = Q.exposure(s.luma, s.w, s.h, CENTER);
        var mv = lastLuma ? Q.motion(lastLuma, s.luma).mad : 0;
        var nov = lastKeyLuma ? Q.novelty(lastKeyLuma, s.luma) : 1;
        // Recusas na hora — a foto não entra e a dica diz o que fazer.
        var reject = '';
        if (ex.mean < 32) reject = 'Escuro demais. Acenda uma luz e tente de novo.';
        else if (mv > 16) reject = 'Você estava se movendo. Pare um instante e toque de novo.';
        else if (shots.length >= 3 && sharpRef > 0 && sharp < sharpRef * 0.35) reject = 'Foto tremida ou fora de foco. Segure firme e toque de novo.';
        else if (nov < 0.028) reject = 'Quase igual à anterior. Dê um passo ao lado e fotografe de novo.';
        if (reject) { hint(reject, 'bad'); buzz([8, 50, 8]); root.classList.remove('is-rejected'); void root.offsetWidth; root.classList.add('is-rejected'); return; }

        // Foto do sensor (ImageCapture) ocupa a câmera; o quadro do stream é copiado na hora e só a
        // codificação JPEG fica assíncrona — então o disparador responde a toques seguidos.
        var sensor = !!(session && session.canTakePhoto && !opts.stream);
        if (sensor) { busy = true; shutter.classList.add('is-busy'); }
        else { shutter.classList.remove('is-shot'); void shutter.offsetWidth; shutter.classList.add('is-shot'); }
        sharpRef = Math.max(sharpRef * 0.97, sharp);
        var hdg = sensorHeading();
        var hash = PC.dhash(video, video.videoWidth, video.videoHeight);
        flash();
        lastKeyLuma = s.luma;
        capture(sensor).then(function (blob) {
          if (!blob || closed) return;
          var sector = place(hdg);
          seq += 1;
          var shot = {
            id: 'g' + seq, blob: blob, url: URL.createObjectURL(blob), bytes: blob.size,
            width: blob._w || video.videoWidth, height: blob._h || video.videoHeight,
            pass: passIdx, sector: sector, heading: hdg, sharp: sharp, mean: ex.mean, clipped: ex.clipped, hash: hash, ok: true,
          };
          shots.push(shot);
          buzz(12);
          addThumb(shot);
          hint('Boa foto', 'ok');
          paint();
          checkPass();
        }).catch(function () { hint('Não foi possível salvar a foto. Tente de novo.', 'bad'); })
          .then(function () { if (sensor) { busy = false; shutter.classList.remove('is-busy'); } });
      }

      // Foto do sensor (ImageCapture) quando existe; senão, o quadro do stream em resolução cheia.
      // O quadro do stream é desenhado AGORA num canvas próprio (síncrono); o toBlob vem depois.
      function capture(sensor) {
        var fromStream = function () {
          var vw = video.videoWidth, vh = video.videoHeight;
          var scale = Math.min(1, 4096 / Math.max(vw, vh));
          var cv = document.createElement('canvas');
          cv.width = Math.round(vw * scale); cv.height = Math.round(vh * scale);
          cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
          return new Promise(function (resolve) {
            cv.toBlob(function (b) { if (b) { b._w = cv.width; b._h = cv.height; } cv.width = cv.height = 0; resolve(b); }, 'image/jpeg', 0.92);
          });
        };
        if (!sensor) return fromStream();
        return Cam.takePhoto(session.track).then(function (b) {
          if (!b || !b.size) return fromStream();
          // Foto do sensor grande demais para o envio: reduz sem perder a proporção.
          if (b.size <= PC.T.normalizeBytes) return b;
          return PC.analyzeFile(new File([b], 'sensor.jpg', { type: b.type || 'image/jpeg' })).then(function (m) { var f = m.file; f._w = m.width; f._h = m.height; return f; });
        }).catch(fromStream);
      }

      // Setor preenchido: pela bússola quando há; senão, o próximo livre da volta (estimativa).
      function place(hdg) {
        var p = PASSES[passIdx], row = filled[passIdx], step = 360 / p.sectors, idx;
        if (hdg != null) {
          if (passBase[passIdx] == null) passBase[passIdx] = hdg - step / 2;
          idx = Math.floor(norm(hdg - passBase[passIdx]) / step) % p.sectors;
        } else {
          idx = row.indexOf(0);
          if (idx < 0) idx = (shotsIn(passIdx)) % p.sectors;
        }
        row[idx] += 1;
        return idx;
      }
      function shotsIn(pi) { return shots.filter(function (s) { return s.pass === pi; }).length; }
      function covered(pi) { return filled[pi].filter(function (n) { return n > 0; }).length; }

      function checkPass() {
        var p = PASSES[passIdx];
        if (covered(passIdx) < p.sectors) return;
        buzz([18, 60, 18]);
        if (passIdx < PASSES.length - 1) { advance(); return; }
        instrEl.textContent = 'Cobertura completa. Toque em Concluir para revisar.';
        nextBtn.hidden = true;
      }
      function advance() {
        if (passIdx >= PASSES.length - 1) return;
        passIdx += 1;
        root.classList.remove('is-pass-change'); void root.offsetWidth; root.classList.add('is-pass-change');
        paint();
        instrEl.textContent = PASSES[passIdx].start;
      }

      function flash() {
        if (reduced()) return;
        var f = $('.gd-flash'); f.classList.remove('is-on'); void f.offsetWidth; f.classList.add('is-on');
      }
      function addThumb(shot) {
        var li = document.createElement('li');
        li.innerHTML = '<img src="' + shot.url + '" alt="">';
        tray.insertBefore(li, tray.firstChild);
        while (tray.children.length > 4) tray.removeChild(tray.lastChild);
      }

      function paint() {
        var n = shots.length;
        countEl.textContent = String(n);
        var p = PASSES[passIdx];
        passLabel.textContent = p.short + ' de 3 · ' + p.label;
        if (!instrEl.textContent || n === 0) instrEl.textContent = shotsIn(passIdx) ? p.go : p.start;
        else if (shotsIn(passIdx) === 1) instrEl.textContent = p.go;
        PASSES.forEach(function (pp, pi) {
          var g = root.querySelector('.gd-pass[data-pass="' + pi + '"]');
          g.classList.toggle('is-current', pi === passIdx);
          g.classList.toggle('is-done', covered(pi) === pp.sectors);
          Array.prototype.forEach.call(g.querySelectorAll('.gd-sec'), function (el, si) { el.classList.toggle('is-on', filled[pi][si] > 0); });
        });
        // Trocar de lente no meio muda a distância focal entre fotos: só antes da primeira.
        $('[data-gd-switch]').hidden = !(session && session.canSwitch) || n > 0;
        doneBtn.disabled = n < MIN;
        doneBtn.querySelector('small').textContent = n < MIN ? 'faltam ' + (MIN - n) : n + ' fotos';
        doneBtn.setAttribute('aria-label', n < MIN ? 'Concluir — faltam ' + (MIN - n) + ' fotos para o mínimo' : 'Concluir com ' + n + ' fotos');
        // "Próxima volta" aparece quando metade da volta atual já tem foto.
        nextBtn.hidden = passIdx >= PASSES.length - 1 || covered(passIdx) < Math.ceil(p.sectors / 2);
      }

      // ---------- revisão ----------
      function showReview() {
        stopLoop(); releaseWake();
        var j = PC.judge(shots);
        var sensors = shots.some(function (s) { return s.heading != null; });
        var rows = [];
        rows.push({ t: shots.length >= MIN ? 'ok' : 'bad', m: shots.length + ' fotos · ' + human(shots.reduce(function (a, s) { return a + s.bytes; }, 0)) + (shots.length < MIN ? ' — faltam ' + (MIN - shots.length) + ' para o mínimo de ' + MIN + '.' : shots.length < 30 ? ' — acima de 30 o resultado costuma ser melhor.' : '') });
        var c1 = covered(0);
        if (c1 < PASSES[0].sectors) rows.push({ t: 'warn', m: 'Parece que ainda falta fotografar um dos lados do produto.' });
        PASSES.forEach(function (p, pi) { if (pi && shotsIn(pi) === 0) rows.push({ t: 'muted', m: p.short + ' (' + p.label.toLowerCase() + ') não foi feita. O ' + (pi === 1 ? 'topo' : 'fundo') + ' pode sair com menos detalhe.' }); });
        j.notes.forEach(function (n) { rows.push(n); });
        if (!sensors) rows.push({ t: 'muted', m: 'Sem bússola neste aparelho: a cobertura foi estimada pela quantidade de fotos.' });
        var cam = session ? Cam.describe(session.width, session.height) : '';
        if (cam) rows.push({ t: 'muted', m: 'Câmera: ' + (session.label || 'traseira') + ' · ' + cam + (session.canTakePhoto && !opts.stream ? ' · foto do sensor' : '') });
        $('.gd-summary').innerHTML = rows.map(function (r) {
          return '<li class="note note-' + r.t + '">' + icon(r.t === 'ok' ? 'check' : 'alert', 16) + '<span>' + r.m + '</span></li>';
        }).join('');
        var FLAG = { blur: 'Tremida', dark: 'Escura', bright: 'Estourada', dup: 'Repetida', small: 'Pequena', low: 'Baixa resolução' };
        $('.gd-grid').innerHTML = shots.map(function (s, i) {
          var flag = ['blur', 'dup', 'dark', 'bright', 'small'].filter(function (f) { return (s.flags || []).indexOf(f) >= 0; })[0];
          return '<li class="' + (flag ? 'is-flagged' : '') + '"><img src="' + s.url + '" alt="Foto ' + (i + 1) + '" loading="lazy">' +
            (flag ? '<span class="gd-flag">' + FLAG[flag] + '</span>' : '') +
            '<button type="button" class="gd-del" data-del="' + s.id + '" aria-label="Remover foto ' + (i + 1) + '">' + icon('trash', 16) + '</button></li>';
        }).join('');
        var use = $('[data-gd-use]');
        use.disabled = shots.length < MIN;
        use.querySelector('span').textContent = shots.length < MIN ? 'Mínimo de ' + MIN + ' fotos' : 'Usar ' + shots.length + ' fotos';
        show('review');
        review.scrollTop = 0;
        (use.disabled ? $('[data-gd-more]') : use).focus({ preventScroll: true });
      }
      root.addEventListener('click', function (e) {
        var del = e.target.closest('[data-del]');
        if (!del) return;
        var i = shots.findIndex(function (s) { return s.id === del.dataset.del; });
        if (i < 0) return;
        var s = shots.splice(i, 1)[0];
        URL.revokeObjectURL(s.url);
        filled[s.pass][s.sector] = Math.max(0, filled[s.pass][s.sector] - 1);
        showReview();
      });

      function result() {
        var files = shots.map(function (s, i) {
          var name = 'foto-' + String(i + 1).padStart(3, '0') + '.jpg';
          try { return new File([s.blob], name, { type: 'image/jpeg', lastModified: Date.now() }); } catch (e) { var b = s.blob; b.name = name; return b; }
        });
        return {
          files: files,
          frames: shots.map(function (s) { return { url: s.url, pass: s.pass, angle: s.sector * (360 / PASSES[s.pass].sectors), bytes: s.bytes, flags: s.flags || [] }; }),
          count: shots.length, bytes: shots.reduce(function (a, s) { return a + s.bytes; }, 0),
          passes: PASSES.map(function (p, pi) { return { key: p.key, label: p.label, covered: covered(pi), total: p.sectors, shots: shotsIn(pi) }; }),
          complete: covered(0) === PASSES[0].sectors,
          sensors: shots.some(function (s) { return s.heading != null; }),
          camera: session ? { label: session.label, width: session.width, height: session.height, res: Cam.describe(session.width, session.height), sensorPhoto: !!(session.canTakePhoto && !opts.stream) } : null,
          notes: PC.judge(shots).notes,
        };
      }

      // ---------- controles ----------
      $$('[data-gd-cancel]').forEach(function (b) { b.addEventListener('click', function () { if (root.dataset.view === 'live' && shots.length) showReview(); else close(null); }); });
      $$('[data-gd-native]').forEach(function (b) { b.addEventListener('click', function () { close({ fallback: 'native' }); }); });
      $('[data-gd-start]').addEventListener('click', begin);
      shutter.addEventListener('click', shoot);
      doneBtn.addEventListener('click', showReview);
      nextBtn.addEventListener('click', advance);
      $('[data-gd-more]').addEventListener('click', function () {
        show('live'); startLoop();
        if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {});
        paint(); shutter.focus();
      });
      $('[data-gd-use]').addEventListener('click', function () { if (shots.length >= MIN) close(result()); });
      $('[data-gd-retry]').addEventListener('click', function () { stopCamera(); show('prep'); $('[data-gd-start]').disabled = false; begin(); });
      $('[data-gd-switch]').addEventListener('click', function () {
        if (!session || !session.canSwitch) return;
        var list = session.rear, i = list.findIndex(function (d) { return d.deviceId === session.deviceId; });
        var next = list[(i + 1) % list.length];
        session.switchTo(next.deviceId).then(function (s) {
          session = s; video.srcObject = s.stream; return video.play().catch(function () {});
        }).then(function () {
          $('.gd-res').textContent = Cam.describe(video.videoWidth, video.videoHeight);
          hint('Câmera: ' + (session.label || 'traseira') + '. Use a mesma lente em todas as fotos.', 'ok');
        }).catch(function (err) { fail(Cam.errorMessage(err)); });
      });

      show('prep');
      $('[data-gd-start]').focus();
    });
  }

  return { support: support, open: open, PASSES: PASSES, TARGET: TARGET };
})();
