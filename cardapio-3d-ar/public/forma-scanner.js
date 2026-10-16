// Forma 3D · Captura orbital guiada (Fases 3 a 6).
//
// Substitui a antiga "grave um vídeo de 45 a 90 s" por um escaneamento: o usuário enquadra o
// produto, começa, caminha ao redor dele e o sistema tira as fotos sozinho. O anel só avança
// quando existe um quadro VÁLIDO daquela perspectiva — nunca por tempo.
//
// Contrato:
//   FormaScanner.support()   -> { ok, secure, getUserMedia, canvas, sensors, reason }
//   FormaScanner.open(opts)  -> Promise<null | {
//        files, frames, sectors, upperSectors, accepted, upperAccepted, complete,
//        upperDone, mode, orbitness, elapsed, bytes
//   }>
//     opts.stream     (MediaStream) usa este stream em vez da câmera — só para teste/demonstração
//     opts.sectors    (number) setores da volta principal (padrão 24, ~15° cada)
//     opts.upper      (number) setores da volta alta (padrão 10); 0 desliga a segunda passagem
//     opts.minPhotos  (number) mínimo exigido pelo serviço de reconstrução (padrão 20)
//     opts.maxPhotos  (number) máximo aceito pelo serviço (padrão 300)
//
// O que este módulo NÃO faz: falar com o servidor. Ele devolve arquivos; quem envia é o assistente.
window.FormaScanner = (function () {
  'use strict';

  var Q = window.FormaScanQuality, Cov = window.FormaScanCoverage;
  var Frames = window.FormaScanFrames, Heading = window.FormaScanHeading;

  var SAMPLE_MS = 200;            // 5 análises por segundo (§13: 3 a 6/s)
  var SLOW_SAMPLE_MS = 320;       // se a análise pesar, desacelera em vez de travar o preview
  var CAPTURE_COOLDOWN = 240;     // intervalo mínimo entre duas capturas em resolução de envio
  var LAP_DEGREES = 330;          // a partir daqui consideramos que a volta principal foi dada
  var ROI_MIN = 0.30, ROI_MAX = 0.92;

  var ICONS = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    play: '<path d="M7 4.5v15l13-7.5z"/>',
    pause: '<path d="M8 4h3v16H8zM13 4h3v16h-3z"/>',
    left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    up: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  };
  function icon(name, size) {
    return '<svg class="ic" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  var human = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
  var buzz = function (pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignora */ } };

  // ---------- Suporte ----------
  function support() {
    var secure = !!window.isSecureContext;
    var gum = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var canvas = !!(document.createElement('canvas').getContext && document.createElement('canvas').toBlob);
    var mods = !!(Q && Cov && Frames && Heading);
    var out = { ok: secure && gum && canvas && mods, secure: secure, getUserMedia: gum, canvas: canvas, sensors: Heading ? Heading.supported() : false, reason: '' };
    if (!secure) out.reason = 'O escaneamento só funciona em HTTPS (ou em localhost). No celular, abra este endereço começando com https://.';
    else if (!gum) out.reason = 'Este navegador não permite acesso à câmera (getUserMedia indisponível).';
    else if (!canvas) out.reason = 'Este navegador não consegue extrair imagens da câmera (canvas.toBlob indisponível).';
    else if (!mods) out.reason = 'Os módulos do scanner não foram carregados.';
    return out;
  }

  // ---------- Câmera ----------
  function openCamera() {
    var full = { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 }, frameRate: { ideal: 30, max: 30 } } };
    return navigator.mediaDevices.getUserMedia(full).catch(function (err) {
      if (err && (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError')) {
        return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } })
          .catch(function () { return navigator.mediaDevices.getUserMedia({ audio: false, video: true }); });
      }
      throw err;
    });
  }
  function cameraError(err) {
    var n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador e tente de novo.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'Nenhuma câmera foi encontrada neste aparelho.';
    if (n === 'NotReadableError' || n === 'TrackStartError') return 'A câmera está em uso por outro aplicativo. Feche-o e tente de novo.';
    return 'Não foi possível abrir a câmera' + (err && err.message ? ': ' + err.message : '.');
  }

  // ---------- Geometria do anel ----------
  var RING = { size: 240, cx: 120, cy: 120, main: 100, upper: 72 };
  function polar(r, deg) {
    var a = (deg - 90) * Math.PI / 180;
    return [RING.cx + r * Math.cos(a), RING.cy + r * Math.sin(a)];
  }
  function arcPath(r, a0, a1) {
    var p0 = polar(r, a0), p1 = polar(r, a1);
    var large = ((a1 - a0) % 360 + 360) % 360 > 180 ? 1 : 0;
    return 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }
  // Um grupo por setor: o arco + um marcador interno. O marcador é o que diferencia os estados
  // sem depender de cor (§3 e §28: "o scanner não pode depender de cor para indicar status").
  function ringMarkup(cls, radius, total, label) {
    var step = 360 / total, gap = Math.min(5, step * 0.22), out = '';
    for (var i = 0; i < total; i++) {
      var c = i * step, a0 = c - step / 2 + gap / 2, a1 = c + step / 2 - gap / 2;
      var m = polar(radius - 13, c);
      out += '<g class="scn-sec is-pending" data-sector="' + i + '">' +
        '<path class="scn-sec-arc" d="' + arcPath(radius, a0, a1) + '"/>' +
        '<circle class="scn-sec-dot" cx="' + m[0].toFixed(2) + '" cy="' + m[1].toFixed(2) + '" r="2.1"/>' +
        '<path class="scn-sec-warn" d="' + arcPath(radius, c - 1.2, c + 1.2) + '"/>' +
        '</g>';
    }
    return '<g class="' + cls + '" role="img" aria-label="' + label + '">' + out + '</g>';
  }

  // ---------- Template ----------
  // `main`/`upper` vêm das opções: o anel desenhado precisa ter exatamente os setores que o mapa
  // de cobertura tem, senão os índices de setor apontam para arcos errados.
  function template(sup, main, upper) {
    return '' +
      '<video class="scn-video" autoplay muted playsinline></video>' +
      '<div class="scn-dim" aria-hidden="true"></div>' +

      // Estado 1 — permissões
      '<section class="scn-sheet scn-perm" aria-label="Permissões">' +
        '<span class="scn-sheet-ic">' + icon('camera', 28) + '</span>' +
        '<h2>Vamos escanear seu produto</h2>' +
        '<p>Vamos usar a câmera e os sensores de movimento para guiar a captura. As fotos são tiradas automaticamente enquanto você anda ao redor do produto.</p>' +
        '<div class="scn-sheet-actions">' +
          '<button type="button" class="btn btn-ghost" data-scn-cancel><span>Agora não</span></button>' +
          '<button type="button" class="btn btn-primary" data-scn-allow>' + icon('camera', 18) + '<span>Abrir câmera</span></button>' +
        '</div>' +
        (sup.sensors ? '' : '<p class="scn-sheet-note">' + icon('alert', 15) + '<span>Este aparelho não expõe sensores de orientação. A captura continua funcionando: a cobertura é estimada pela própria imagem.</span></p>') +
      '</section>' +

      // ROI ajustável (calibração) + anel (captura)
      '<div class="scn-roi" hidden><i class="tl" data-handle="tl"></i><i class="tr" data-handle="tr"></i><i class="bl" data-handle="bl"></i><i class="br" data-handle="br"></i><span class="scn-reticle"></span></div>' +
      '<div class="scn-ring" hidden>' +
        '<svg viewBox="0 0 ' + RING.size + ' ' + RING.size + '" aria-hidden="true">' +
          ringMarkup('scn-ring-main', RING.main, main, 'Cobertura da volta principal') +
          (upper ? ringMarkup('scn-ring-upper', RING.upper, upper, 'Cobertura da volta alta') : '') +
        '</svg>' +
        '<div class="scn-ring-center"><b class="scn-count">0</b><small class="scn-count-of">de ' + main + '</small></div>' +
        '<div class="scn-arrow" hidden>' + icon('right', 26) + '</div>' +
      '</div>' +

      // Topo: cancelar · contador · origem do ângulo
      '<div class="scn-top">' +
        '<button type="button" class="scn-btn" data-scn-cancel aria-label="Cancelar escaneamento">' + icon('x', 22) + '</button>' +
        '<span class="scn-chip scn-progress" hidden><i></i><b>0</b> de <b class="scn-total">' + main + '</b></span>' +
        '<span class="scn-chip scn-mode" hidden></span>' +
      '</div>' +

      // HUD
      '<div class="scn-hud" hidden>' +
        '<h2 class="scn-title">Encaixe o produto dentro da área</h2>' +
        '<p class="scn-status" role="status" aria-live="polite">Deixe espaço ao redor e mantenha o objeto inteiro visível.</p>' +
      '</div>' +

      // Ações
      '<div class="scn-actions" hidden>' +
        '<button type="button" class="btn btn-ghost scn-secondary" data-scn-secondary hidden><span>Cancelar</span></button>' +
        '<button type="button" class="btn btn-primary scn-primary" data-scn-primary><span>Objeto enquadrado</span></button>' +
      '</div>' +

      // Revisão
      '<section class="scn-sheet scn-review" aria-label="Revisar captura" hidden>' +
        '<span class="scn-sheet-ic">' + icon('check', 28) + '</span>' +
        '<h2>Captura concluída</h2>' +
        '<ul class="scn-summary"></ul>' +
        '<ul class="scn-samples" aria-label="Amostras da captura"></ul>' +
        '<div class="scn-sheet-actions">' +
          '<button type="button" class="btn btn-secondary" data-scn-redo>' + icon('reset', 18) + '<span>Refazer captura</span></button>' +
          '<button type="button" class="btn btn-primary" data-scn-use>' + icon('check', 18) + '<span>Criar modelo 3D</span></button>' +
        '</div>' +
      '</section>' +

      // Erro
      '<section class="scn-sheet scn-error" role="alert" hidden>' +
        '<span class="scn-sheet-ic scn-sheet-ic-warn">' + icon('alert', 28) + '</span>' +
        '<h2>Não deu para escanear aqui</h2>' +
        '<p class="scn-error-text"></p>' +
        '<div class="scn-sheet-actions">' +
          '<button type="button" class="btn btn-secondary" data-scn-fallback><span>Enviar fotos manualmente</span></button>' +
          '<button type="button" class="btn btn-primary" data-scn-retry>' + icon('reset', 18) + '<span>Tentar de novo</span></button>' +
        '</div>' +
      '</section>';
  }

  // ---------- Abertura ----------
  function open(opts) {
    opts = opts || {};
    var sup = support();
    if (!sup.ok && !opts.stream) return Promise.reject(new Error(sup.reason));

    var MAIN_SECTORS = Math.max(8, opts.sectors || 24);
    var UPPER_SECTORS = opts.upper === 0 ? 0 : Math.max(0, opts.upper || 10);
    var MIN_PHOTOS = opts.minPhotos || 20;
    var MAX_PHOTOS = opts.maxPhotos || 300;

    return new Promise(function (resolve) {
      var root = document.createElement('div');
      root.className = 'scn';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Escaneamento guiado do produto');
      root.innerHTML = template(sup, MAIN_SECTORS, UPPER_SECTORS);

      var $ = function (s) { return root.querySelector(s); };
      var video = $('.scn-video'), dim = $('.scn-dim'), roiEl = $('.scn-roi'), ringEl = $('.scn-ring');
      var hud = $('.scn-hud'), titleEl = $('.scn-title'), statusEl = $('.scn-status');
      var actions = $('.scn-actions'), primary = $('[data-scn-primary]'), secondary = $('[data-scn-secondary]');
      var permEl = $('.scn-perm'), reviewEl = $('.scn-review'), errorEl = $('.scn-error');
      var progressChip = $('.scn-progress'), modeChip = $('.scn-mode'), arrowEl = $('.scn-arrow');
      var countEl = $('.scn-count'), countOfEl = $('.scn-count-of');
      var mainSecs = root.querySelectorAll('.scn-ring-main .scn-sec');
      var upperSecs = root.querySelectorAll('.scn-ring-upper .scn-sec');
      var previous = document.activeElement;

      // ---- estado ----
      var state = 'permission';
      var stream = null, sampler = null, store = null, heading = null, wake = null;
      var mainCov = null, upperCov = null;
      var roi = { x: 0.16, y: 0.18, w: 0.68, h: 0.58 };
      var prevLuma = null, lastKeyLuma = null, baseline = null, sharpRef = 0;
      var timer = null, sampleMs = SAMPLE_MS, busy = false, lastCaptureAt = 0;
      var startedAt = 0, traveled = 0, closed = false, lastHint = '', hintUntil = 0;
      var result = null, pendingCaptures = 0;

      document.body.appendChild(root);
      document.body.classList.add('scn-open');

      // ---- encerramento ----
      function stopStream() { if (stream && !opts.stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignora */ } }); } stream = null; }
      function releaseWake() { if (wake) { try { wake.release(); } catch (e) { /* ignora */ } wake = null; } }
      function stopLoop() { if (timer) { clearInterval(timer); timer = null; } }
      function close(value) {
        if (closed) return;
        closed = true;
        stopLoop(); releaseWake(); stopStream();
        if (heading) heading.stop();
        if (store && !value) store.clear();
        document.removeEventListener('keydown', onKey, true);
        document.body.classList.remove('scn-open');
        root.remove();
        if (previous && previous.focus) { try { previous.focus(); } catch (e) { /* ignora */ } }
        resolve(value);
      }
      function fail(message, opts2) {
        stopLoop(); releaseWake();
        setState('error');
        $('.scn-error-text').textContent = message;
        $('[data-scn-fallback]').hidden = !!(opts2 && opts2.noFallback);
        $('[data-scn-retry]').focus();
      }

      // ---- teclado ----
      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (state === 'scanning-main' || state === 'scanning-upper' || state === 'gap-fix') pause();
          else close(null);
          return;
        }
        if (e.key !== 'Tab') return;
        var focusables = Array.prototype.filter.call(root.querySelectorAll('button:not([hidden])'), function (el) { return !el.closest('[hidden]'); });
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey, true);

      // ---- ROI: posiciona o recorte e o anel sobre ele ----
      function applyRoi() {
        var pct = function (v) { return (v * 100).toFixed(2) + '%'; };
        roiEl.style.left = pct(roi.x); roiEl.style.top = pct(roi.y);
        roiEl.style.width = pct(roi.w); roiEl.style.height = pct(roi.h);
        dim.style.clipPath = 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ' +
          pct(roi.x) + ' ' + pct(roi.y) + ', ' + pct(roi.x) + ' ' + pct(roi.y + roi.h) + ', ' +
          pct(roi.x + roi.w) + ' ' + pct(roi.y + roi.h) + ', ' + pct(roi.x + roi.w) + ' ' + pct(roi.y) + ', ' +
          pct(roi.x) + ' ' + pct(roi.y) + ')';
        // O anel circunda a ROI, com folga, sem cobrir o produto.
        var rect = root.getBoundingClientRect();
        var w = roi.w * rect.width, h = roi.h * rect.height;
        var size = Math.min(Math.max(w, h) * 1.34, Math.min(rect.width, rect.height) * 0.96);
        ringEl.style.width = ringEl.style.height = size + 'px';
        ringEl.style.left = ((roi.x + roi.w / 2) * 100).toFixed(2) + '%';
        ringEl.style.top = ((roi.y + roi.h / 2) * 100).toFixed(2) + '%';
      }

      // Arrastar os cantos. Ponteiro unificado (mouse, toque, caneta).
      Array.prototype.forEach.call(roiEl.querySelectorAll('[data-handle]'), function (el) {
        el.addEventListener('pointerdown', function (e) {
          if (state !== 'calibration') return;
          e.preventDefault(); e.stopPropagation();
          el.setPointerCapture(e.pointerId);
          var corner = el.dataset.handle, rect = root.getBoundingClientRect();
          var move = function (ev) {
            var nx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
            var ny = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
            var x0 = corner[1] === 'l' ? nx : roi.x, x1 = corner[1] === 'r' ? nx : roi.x + roi.w;
            var y0 = corner[0] === 't' ? ny : roi.y, y1 = corner[0] === 'b' ? ny : roi.y + roi.h;
            var nw = Math.min(ROI_MAX, Math.max(ROI_MIN, x1 - x0)), nh = Math.min(ROI_MAX, Math.max(ROI_MIN * 0.8, y1 - y0));
            roi = {
              x: Math.min(Math.max(0.02, corner[1] === 'l' ? x1 - nw : x0), 0.98 - nw),
              y: Math.min(Math.max(0.02, corner[0] === 't' ? y1 - nh : y0), 0.98 - nh),
              w: nw, h: nh,
            };
            applyRoi();
          };
          var up = function () { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
          el.addEventListener('pointercancel', up);
        });
      });
      window.addEventListener('resize', applyRoi);

      // ---- anel ----
      function paintSector(nodes, sector) {
        var g = nodes[sector.id];
        if (!g) return;
        g.setAttribute('class', 'scn-sec is-' + sector.status);
      }
      function paintRing(cov, nodes) {
        for (var i = 0; i < cov.sectors.length; i++) paintSector(nodes, cov.sectors[i]);
      }
      function markCurrent(cov, nodes, angle) {
        var idx = cov.indexFor(angle);
        for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('is-current', i === idx);
      }

      function setStatus(text, tone) {
        if (statusEl.textContent !== text) statusEl.textContent = text;
        statusEl.className = 'scn-status' + (tone ? ' is-' + tone : '');
      }
      function setCounts(cov) {
        var st = cov.stats();
        countEl.textContent = String(st.accepted);
        countOfEl.textContent = 'de ' + st.total;
        progressChip.hidden = false;
        progressChip.querySelector('b').textContent = String(st.accepted);
        progressChip.querySelector('.scn-total').textContent = String(st.total);
        progressChip.querySelector('i').style.width = Math.round(st.progress * 100) + '%';
      }

      // ---- máquina de estados ----
      function setState(next) {
        state = next;
        root.dataset.state = next;
        permEl.hidden = next !== 'permission';
        reviewEl.hidden = next !== 'review';
        errorEl.hidden = next !== 'error';
        var live = ['calibration', 'ready', 'scanning-main', 'paused', 'gap-fix', 'upper-intro', 'scanning-upper'].indexOf(next) >= 0;
        roiEl.hidden = !live;
        roiEl.classList.toggle('is-locked', next !== 'calibration');
        ringEl.hidden = ['ready', 'scanning-main', 'paused', 'gap-fix', 'upper-intro', 'scanning-upper'].indexOf(next) < 0;
        hud.hidden = !live;
        actions.hidden = !live;
        dim.hidden = !live;
        progressChip.hidden = ['scanning-main', 'paused', 'gap-fix', 'upper-intro', 'scanning-upper', 'ready'].indexOf(next) < 0;
        ringEl.classList.toggle('is-upper', next === 'upper-intro' || next === 'scanning-upper');
        arrowEl.hidden = next !== 'gap-fix';
        renderChrome();
      }

      // Título, botões e textos de cada estado. Um lugar só, para a copy não se espalhar.
      function renderChrome() {
        var label = { primary: '', secondary: '', secondaryShown: true };
        if (state === 'calibration') {
          titleEl.textContent = 'Encaixe o produto dentro da área';
          setStatus('Deixe espaço ao redor e mantenha o objeto inteiro visível. Arraste os cantos para ajustar.');
          label.primary = 'Objeto enquadrado'; label.secondary = 'Cancelar';
        } else if (state === 'ready') {
          titleEl.textContent = 'Dê uma volta ao redor do produto';
          setStatus('Comece pela frente. Ande devagar mantendo o produto no centro — as fotos saem sozinhas.');
          label.primary = 'Iniciar captura'; label.secondary = 'Reenquadrar';
        } else if (state === 'scanning-main') {
          titleEl.textContent = 'Dê uma volta ao redor do produto';
          label.primary = 'Pausar'; label.secondary = 'Cancelar';
        } else if (state === 'paused') {
          titleEl.textContent = 'Captura pausada';
          setStatus('Nada foi perdido. Continue de onde parou quando quiser.');
          label.primary = 'Continuar'; label.secondary = 'Encerrar aqui';
        } else if (state === 'gap-fix') {
          titleEl.textContent = 'Complete os pontos que faltaram';
          label.primary = 'Pausar'; label.secondary = 'Encerrar aqui';
        } else if (state === 'upper-intro') {
          titleEl.textContent = 'Mais uma volta, um pouco acima';
          setStatus('Incline levemente a câmera para baixo e repita a volta para completar o topo do produto.');
          label.primary = 'Começar volta alta'; label.secondary = 'Pular esta etapa';
        } else if (state === 'scanning-upper') {
          titleEl.textContent = 'Volta alta';
          label.primary = 'Pausar'; label.secondary = 'Concluir';
        }
        primary.querySelector('span').textContent = label.primary;
        secondary.querySelector('span').textContent = label.secondary;
        secondary.hidden = !label.secondary;
        var pi = state === 'scanning-main' || state === 'scanning-upper' || state === 'gap-fix' ? 'pause'
          : state === 'paused' ? 'play' : state === 'ready' || state === 'upper-intro' ? 'camera' : 'check';
        primary.innerHTML = icon(pi, 18) + '<span>' + label.primary + '</span>';
      }

      // ---- ciclo de análise ----
      function activeCov() { return state === 'scanning-upper' || state === 'upper-intro' ? upperCov : mainCov; }
      function activeNodes() { return state === 'scanning-upper' || state === 'upper-intro' ? upperSecs : mainSecs; }
      var currentPass = 'main';

      function startLoop() {
        stopLoop();
        timer = setInterval(tick, sampleMs);
      }

      function tick() {
        if (busy || closed) return;
        busy = true;
        var t0 = performance.now();
        try { analyze(); } catch (e) { /* uma amostra ruim não derruba a captura */ }
        var cost = performance.now() - t0;
        // §13: se a análise começar a pesar, reduz a frequência em vez de travar o preview.
        if (cost > 110 && sampleMs === SAMPLE_MS) { sampleMs = SLOW_SAMPLE_MS; startLoop(); }
        busy = false;
      }

      function analyze() {
        var s = sampler.sample();
        if (!s) {
          if (sampler.blocked) fail('Este navegador não deixa ler os quadros da câmera, então não dá para validar a captura. Envie as fotos manualmente.', { noFallback: false });
          return;
        }
        var flow = prevLuma ? Q.flowSplit(prevLuma, s.luma, s.w, s.h, roi) : null;
        var ev = Q.evaluate(s.luma, s.w, s.h, { roi: roi, flow: flow, baseline: baseline, sharpRef: sharpRef, prevKey: lastKeyLuma });
        // Referência de nitidez da sessão: sobe na hora, desce devagar. Assim uma foto muito boa
        // não condena todas as seguintes se a luz piorar de verdade no meio da volta.
        sharpRef = Math.max(sharpRef * 0.995, ev.sharpness);
        var subjectOk = ev.reasons.indexOf('subject') < 0 && ev.reasons.indexOf('offset') < 0;
        var angle = heading.update(flow, subjectOk);
        prevLuma = s.luma;
        traveled = Math.max(traveled, Math.abs(angle));

        var cov = activeCov(), nodes = activeNodes();
        markCurrent(cov, nodes, angle);
        modeChip.hidden = false;
        modeChip.innerHTML = heading.hasSensor
          ? icon('compass', 14) + '<span>sensores</span>'
          : icon('eye', 14) + '<span>pela imagem</span>';

        // Quadro reprovado: conta a tentativa (o setor pode virar "repetir") e mostra a dica.
        if (!ev.ok) {
          cov.offer(angle, { ok: false });
          paintSector(nodes, cov.sectors[cov.indexFor(angle)]);
          showHint(ev.hint || 'Ajuste o enquadramento', 'warn');
          updateGuidance(cov, angle);
          return;
        }
        // Produto enquadrado e nítido, mas o movimento ainda não é uma órbita de verdade.
        if (heading.orbitness < 0.25) {
          showHint('Caminhe ao redor do produto — girar o telefone no lugar não conta', 'warn');
          updateGuidance(cov, angle);
          return;
        }
        var sec = cov.sectors[cov.indexFor(angle)];
        // Já aceito e melhor do que este quadro: nem gasta uma captura em resolução cheia.
        if (sec.status === 'accepted' && ev.score <= sec.qualityScore + 0.08) {
          updateGuidance(cov, angle);
          return;
        }
        if (Date.now() - lastCaptureAt < CAPTURE_COOLDOWN || pendingCaptures > 1) { updateGuidance(cov, angle); return; }
        if (store.count() >= MAX_PHOTOS) { updateGuidance(cov, angle); return; }

        lastCaptureAt = Date.now();
        pendingCaptures += 1;
        var keyLuma = s.luma;
        store.capture(video, { angle: angle, sector: sec.id, score: ev.score, pass: currentPass }).then(function (frame) {
          pendingCaptures -= 1;
          if (!frame || closed) return;
          var out = cov.offer(angle, { id: frame.id, ok: true, score: ev.score });
          if (out.accepted) {
            lastKeyLuma = keyLuma;
            buzz(12);
            paintSector(nodes, out.sector);
            setCounts(cov);
            showHint('Boa captura', 'ok');
          } else if (out.upgraded) {
            lastKeyLuma = keyLuma;
            if (out.dropped) store.drop(out.dropped);
            paintSector(nodes, out.sector);
          } else {
            store.drop(frame.id); // nada mudou: não guarda peso morto
          }
          checkCompletion(cov);
        }).catch(function () { pendingCaptures -= 1; });

        updateGuidance(cov, angle);
      }

      // Dica curta com histerese: sem isso o texto pisca a cada amostra.
      function showHint(text, tone) {
        var now = Date.now();
        if (text === lastHint && now < hintUntil) return;
        if (tone !== 'ok' && now < hintUntil && lastHint && text !== lastHint) return;
        lastHint = text; hintUntil = now + (tone === 'ok' ? 900 : 1400);
        setStatus(text, tone);
      }

      // Texto de orientação quando não há problema imediato a relatar.
      function updateGuidance(cov, angle) {
        if (Date.now() < hintUntil) return;
        var st = cov.stats();
        if (state === 'gap-fix') {
          var gap = cov.nearestGap(angle);
          if (gap) {
            arrowEl.hidden = false;
            arrowEl.classList.toggle('is-left', gap.direction === 'left');
            arrowEl.innerHTML = icon(gap.direction === 'left' ? 'left' : 'right', 26);
            setStatus((st.remaining === 1 ? 'Falta 1 ponto' : 'Faltam ' + st.remaining + ' pontos') + ' — volte ' + (gap.direction === 'left' ? 'para a esquerda' : 'para a direita') + ' até o marcador acender.');
          }
          return;
        }
        if (state === 'scanning-upper') { setStatus('Mantenha a câmera um pouco mais alta e repita a volta.'); return; }
        if (st.accepted === 0) setStatus('Comece pela frente do produto e ande devagar.');
        else if (st.progress < 0.35) setStatus('Continue devagar, no mesmo raio.');
        else if (st.progress < 0.7) setStatus('Metade do caminho — siga até a parte de trás.');
        else setStatus('Quase lá — complete a volta.');
      }

      function checkCompletion(cov) {
        var st = cov.stats();
        if (state === 'scanning-main' || state === 'gap-fix') {
          if (st.complete) { buzz([18, 60, 18]); titleEl.textContent = 'Cobertura completa'; return finishMain(); }
          if (traveled >= LAP_DEGREES && state === 'scanning-main') { setState('gap-fix'); }
        } else if (state === 'scanning-upper') {
          if (st.complete) { buzz([18, 60, 18]); return finishUpper(); }
        }
      }

      function finishMain() {
        stopLoop();
        if (UPPER_SECTORS > 0) {
          currentPass = 'upper';
          upperCov = Cov.create({ sectors: UPPER_SECTORS, minScore: 0.40 });
          paintRing(upperCov, upperSecs);
          setState('upper-intro');
          setCounts(upperCov);
        } else {
          showReview();
        }
      }
      function finishUpper() { stopLoop(); showReview(); }

      // ---- revisão ----
      function showReview() {
        stopLoop(); releaseWake();
        var mainSt = mainCov.stats(), upSt = upperCov ? upperCov.stats() : null;
        var ids = mainSt.frameIds.concat(upSt ? upSt.frameIds : []);
        var frames = store.ordered(ids);
        var elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
        result = {
          files: store.files(ids), frames: frames,
          sectors: mainSt.total, accepted: mainSt.accepted, complete: mainSt.complete,
          upperSectors: upSt ? upSt.total : 0, upperAccepted: upSt ? upSt.accepted : 0, upperDone: !!(upSt && upSt.complete),
          mode: heading.hasSensor ? 'sensores' : 'imagem', orbitness: heading.orbitness,
          elapsed: elapsed, bytes: frames.reduce(function (n, f) { return n + f.bytes; }, 0),
        };
        var enough = result.files.length >= MIN_PHOTOS;
        var rows = [
          ['ok', result.files.length + (result.files.length === 1 ? ' imagem aprovada' : ' imagens aprovadas') + ' · ' + human(result.bytes)],
          [mainSt.complete ? 'ok' : 'warn', mainSt.complete ? 'Cobertura 360° completa (' + mainSt.total + ' setores)' : 'Cobertura parcial: ' + mainSt.accepted + ' de ' + mainSt.total + ' setores'],
        ];
        if (upSt) rows.push([upSt.complete ? 'ok' : 'warn', upSt.complete ? 'Volta alta concluída (' + upSt.total + ' setores)' : 'Volta alta parcial: ' + upSt.accepted + ' de ' + upSt.total + ' setores']);
        else rows.push(['muted', 'Sem volta alta. O topo do produto pode ficar menos detalhado.']);
        rows.push([heading.hasSensor ? 'ok' : 'muted', heading.hasSensor
          ? 'Ângulo medido pelos sensores do aparelho e confirmado pela imagem.'
          : 'Sem sensores de orientação: o ângulo foi estimado pela própria imagem. A cobertura é aproximada.']);
        if (!enough) rows.push(['bad', 'O serviço de reconstrução exige pelo menos ' + MIN_PHOTOS + ' imagens. Faltam ' + (MIN_PHOTOS - result.files.length) + '.']);

        $('.scn-summary').innerHTML = rows.map(function (r) {
          return '<li class="note note-' + r[0] + '">' + icon(r[0] === 'ok' ? 'check' : 'alert', 16) + '<span>' + r[1] + '</span></li>';
        }).join('');
        // Amostra de 6 a 8 fotos bem distribuídas — não a grade inteira.
        var step = Math.max(1, Math.floor(frames.length / 8)), samples = [];
        for (var i = 0; i < frames.length && samples.length < 8; i += step) samples.push(frames[i]);
        $('.scn-samples').innerHTML = samples.map(function (f) {
          return '<li><img src="' + f.url + '" alt="" loading="lazy"><span>' + Math.round(((f.angle % 360) + 360) % 360) + '°</span></li>';
        }).join('');
        var use = $('[data-scn-use]');
        use.disabled = !enough;
        use.title = enough ? '' : 'São necessárias pelo menos ' + MIN_PHOTOS + ' imagens.';
        setState('review');
        (enough ? use : $('[data-scn-redo]')).focus();
      }

      // ---- controles ----
      function begin() {
        startedAt = startedAt || Date.now();
        heading.start(sampler.width);
        traveled = 0;
        setState(currentPass === 'upper' ? 'scanning-upper' : 'scanning-main');
        setCounts(activeCov());
        if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {});
        startLoop();
      }
      function pause() {
        stopLoop(); releaseWake();
        root.dataset.resume = state;
        setState('paused');
        setCounts(activeCov());
      }
      function resume() {
        var back = root.dataset.resume || 'scanning-main';
        setState(back);
        if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {});
        startLoop();
      }

      // Congela como o produto estava no momento em que o usuário disse "está enquadrado".
      // Todo julgamento de enquadramento depois disso é relativo a esta medida.
      function takeBaseline() {
        var s = sampler && sampler.sample();
        if (!s) return false;
        baseline = Q.subject(s.luma, s.w, s.h, roi);
        sharpRef = Q.sharpness(s.luma, s.w, s.h, roi);
        prevLuma = s.luma;
        return true;
      }

      primary.addEventListener('click', function () {
        if (state === 'calibration') {
          if (!takeBaseline() && sampler && sampler.blocked) {
            fail('Este navegador não deixa ler os quadros da câmera, então não dá para validar a captura. Envie as fotos manualmente.');
            return;
          }
          setState('ready'); paintRing(mainCov, mainSecs); setCounts(mainCov);
        }
        else if (state === 'ready' || state === 'upper-intro') begin();
        else if (state === 'scanning-main' || state === 'scanning-upper' || state === 'gap-fix') pause();
        else if (state === 'paused') resume();
      });
      secondary.addEventListener('click', function () {
        if (state === 'calibration') close(null);
        else if (state === 'ready') setState('calibration');
        else if (state === 'scanning-main') close(null);
        else if (state === 'upper-intro') showReview();
        else if (state === 'paused' || state === 'gap-fix' || state === 'scanning-upper') { stopLoop(); showReview(); }
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-scn-cancel]'), function (b) {
        b.addEventListener('click', function () { close(null); });
      });
      $('[data-scn-redo]').addEventListener('click', function () {
        store.clear();
        mainCov = Cov.create({ sectors: MAIN_SECTORS });
        upperCov = null; currentPass = 'main';
        prevLuma = null; lastKeyLuma = null; baseline = null; sharpRef = 0; traveled = 0; startedAt = 0; result = null;
        paintRing(mainCov, mainSecs);
        Array.prototype.forEach.call(upperSecs, function (g) { g.setAttribute('class', 'scn-sec is-pending'); });
        setState('calibration');
      });
      $('[data-scn-use]').addEventListener('click', function () {
        var out = result; result = null;
        close(out);
      });
      $('[data-scn-fallback]').addEventListener('click', function () { close({ fallback: 'photos' }); });
      $('[data-scn-retry]').addEventListener('click', function () { setState('permission'); boot(); });
      $('[data-scn-allow]').addEventListener('click', function () { grant(); });

      // ---- permissões e inicialização ----
      // Sensores só são pedidos DENTRO deste clique (exigência do iOS) e nunca antes dele (§2).
      function grant() {
        var btn = $('[data-scn-allow]');
        btn.disabled = true;
        heading = Heading.create({});
        heading.request().then(function (ok) {
          if (ok) heading.listen();
          return boot();
        }).catch(function () { return boot(); });
      }

      function boot() {
        var get = opts.stream ? Promise.resolve(opts.stream) : openCamera();
        return get.then(function (s) {
          if (closed) { if (!opts.stream) s.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = s;
          var track = s.getVideoTracks()[0];
          if (!track) throw new Error('O stream não tem vídeo.');
          track.addEventListener('ended', function () {
            if (!closed && state !== 'review') fail('A câmera foi desligada pelo sistema. Toque em "Tentar de novo".');
          });
          video.srcObject = s;
          return video.play().catch(function () {});
        }).then(function () {
          if (closed) return;
          if (!heading) heading = Heading.create({});
          sampler = Frames.createSampler(video, 160);
          store = store || Frames.createStore({ maxSide: 1920, quality: 0.9 });
          mainCov = mainCov || Cov.create({ sectors: MAIN_SECTORS });
          paintRing(mainCov, mainSecs);
          applyRoi();
          setState('calibration');
          primary.focus();
        }).catch(function (err) { fail(cameraError(err)); });
      }

      // A tela de permissão é o primeiro estado; nada é pedido antes de o usuário tocar.
      setState('permission');
      $('[data-scn-allow]').focus();
      applyRoi();
    });
  }

  return { support: support, open: open, RING: RING, SAMPLE_MS: SAMPLE_MS, LAP_DEGREES: LAP_DEGREES };
})();
