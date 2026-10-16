// Captura guiada pela câmera (Fase 4). Módulo autônomo: abre a câmera traseira em tela cheia
// (getUserMedia), grava com MediaRecorder no formato que o navegador realmente suporta e devolve
// um File pronto para o mesmo fluxo de vídeo do assistente. Nada aqui fala com o servidor.
//
// Contrato:
//   FormaCapture.support()            -> { ok, secure, getUserMedia, mediaRecorder, mimeType, container, reason }
//   FormaCapture.open(opts)           -> Promise<null | { file, blob, mimeType, container, duration, width, height, bytes, warnings }>
//     opts.requireMp4  (bool)   avisa quando o navegador só grava WebM (o serviço de reconstrução exige MP4/MOV)
//     opts.maxBytes    (number) encerra a gravação ao se aproximar deste tamanho
//     opts.stream      (MediaStream) usa este stream em vez da câmera — só para testes e demonstração
//
// A progressão da guia é POR TEMPO: indica o ritmo sugerido (frente → lateral → traseira → ângulo
// superior em ~60 s) e não detecta a cobertura real do produto. Isso está escrito na própria tela.
window.FormaCapture = (function () {
  'use strict';
  var MAX_SECONDS = 180;          // limite do serviço de reconstrução (3 minutos)
  var GUIDE_SECONDS = 60;         // duração da guia (4 etapas de 15 s)
  var MIN_RECOMMENDED = 45, MAX_RECOMMENDED = 90;
  var BITRATE = 6000000;          // ~6 Mbps: 1080p com textura legível, ~45 MB por minuto
  var STAGES = [
    { label: 'Frente', hint: 'Comece de frente para o produto, a cerca de um metro.' },
    { label: 'Lateral', hint: 'Continue girando devagar para o lado, sem parar.' },
    { label: 'Traseira', hint: 'Siga até a parte de trás, mantendo o produto no centro.' },
    { label: 'Ângulo superior', hint: 'Suba a câmera e incline para baixo em uma volta mais alta.' },
  ];
  // Candidatos em ordem de preferência. MP4 (H.264) primeiro: é o que o serviço de reconstrução aceita.
  var MIME_CANDIDATES = [
    'video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.4D401E', 'video/mp4;codecs=avc1', 'video/mp4',
    'video/webm;codecs=h264', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
  ];
  var ICONS = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    move: '<path d="M5 12h14M13 6l6 6-6 6M11 6l-6 6 6 6"/>',
  };
  function icon(name, size) {
    return '<svg class="ic" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }
  var human = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; };
  var clock = function (s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ---------- Suporte ----------
  function pickMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < MIME_CANDIDATES.length; i++) { try { if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i]; } catch (e) { /* segue */ } }
    return '';
  }
  var containerOf = function (mime) { return /^video\/mp4/.test(String(mime)) ? 'mp4' : (/webm/.test(String(mime)) ? 'webm' : ''); };
  function support() {
    var secure = !!window.isSecureContext;
    var gum = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    var mr = typeof MediaRecorder !== 'undefined';
    var mime = mr ? pickMime() : '';
    var out = { ok: secure && gum && mr && !!mime, secure: secure, getUserMedia: gum, mediaRecorder: mr, mimeType: mime, container: containerOf(mime), reason: '' };
    if (!secure) out.reason = 'A câmera ao vivo só funciona em HTTPS (ou em localhost). No celular, abra este endereço começando com https://.';
    else if (!gum) out.reason = 'Este navegador não permite acesso à câmera (getUserMedia indisponível).';
    else if (!mr) out.reason = 'Este navegador não grava vídeo pela câmera (MediaRecorder indisponível).';
    else if (!mime) out.reason = 'Este navegador não oferece nenhum formato de gravação de vídeo suportado.';
    return out;
  }

  // ---------- Câmera ----------
  // Traseira, no máximo 1080p. Se o aparelho recusar as restrições, tenta de novo sem elas.
  function openCamera() {
    // Mesma seleção de câmera da captura guiada (lente principal, resolução real). O teto de 1080p
    // continua valendo para o vídeo: é o limite do serviço quando o arquivo vai inteiro.
    if (window.FormaCamera) return window.FormaCamera.open({ maxLong: 1920 }).then(function (s) { return s.stream; });
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
  // Garante o teto de 1080p mesmo quando a câmera entregou mais (em qualquer orientação).
  function capTrack(track) {
    var s = track.getSettings ? track.getSettings() : {};
    var w = s.width || 0, h = s.height || 0;
    var tooBig = (w > 1920 || h > 1080) && (h > 1920 || w > 1080);
    if (!tooBig || !track.applyConstraints) return Promise.resolve(s);
    return track.applyConstraints({ width: { max: 1920 }, height: { max: 1080 } }).then(function () { return track.getSettings(); }).catch(function () { return s; });
  }

  // ---------- Interface ----------
  var RING_R = 52, RING_C = 2 * Math.PI * RING_R;
  function template(sup) {
    var ticks = STAGES.map(function (s, i) {
      var a = (i / STAGES.length) * 2 * Math.PI - Math.PI / 2;
      return '<circle class="cap-tick" cx="' + (60 + RING_R * Math.cos(a)).toFixed(2) + '" cy="' + (60 + RING_R * Math.sin(a)).toFixed(2) + '" r="3.2"/>';
    }).join('');
    return '' +
      '<video class="cap-video" autoplay muted playsinline></video>' +
      '<div class="cap-frame" aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="cap-crosshair"></span></div>' +
      '<div class="cap-top">' +
        '<button type="button" class="cap-btn" data-cap-cancel aria-label="Cancelar captura">' + icon('x', 22) + '</button>' +
        '<div class="cap-status"><span class="cap-rec" hidden><i></i>REC</span><span class="cap-time" aria-live="off">0:00</span></div>' +
        '<span class="cap-fmt">' + (sup.container ? sup.container.toUpperCase() : '') + '</span>' +
      '</div>' +
      '<div class="cap-warn" role="status" aria-live="polite" hidden></div>' +
      '<div class="cap-guide">' +
        '<div class="cap-ring" role="img" aria-label="Guia de tempo da captura">' +
          '<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="cap-ring-bg" cx="60" cy="60" r="' + RING_R + '"/>' +
          '<circle class="cap-ring-fg" cx="60" cy="60" r="' + RING_R + '" stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="' + RING_C.toFixed(2) + '"/>' + ticks + '</svg>' +
          '<div class="cap-ring-label"><b>Pronto</b><small>guia por tempo</small></div>' +
        '</div>' +
        '<ol class="cap-stages" aria-label="Etapas da captura">' + STAGES.map(function (s) { return '<li><span>' + s.label + '</span></li>'; }).join('') + '</ol>' +
        '<p class="cap-instr">Centralize o produto no contorno</p>' +
        '<p class="cap-hint">Toque no botão para começar. Mova-se lentamente ao redor do produto: frente, lateral, traseira e uma volta mais alta.</p>' +
        '<p class="cap-note">A guia avança por tempo: ela sugere o ritmo, não detecta a cobertura real do produto. Recomendado: 45 a 90 s.</p>' +
      '</div>' +
      '<div class="cap-actions">' +
        '<button type="button" class="cap-shutter" data-cap-start aria-label="Iniciar gravação"><i></i></button>' +
        '<button type="button" class="cap-shutter is-rec" data-cap-stop aria-label="Concluir gravação" hidden><i></i></button>' +
        '<span class="cap-actions-label">Iniciar</span>' +
      '</div>' +
      '<section class="cap-review" aria-label="Revisar gravação" hidden>' +
        '<div class="cap-review-head"><h2>Revise a gravação</h2><p class="cap-review-meta"></p></div>' +
        '<div class="cap-review-video"><video controls playsinline preload="metadata"></video></div>' +
        '<ul class="cap-review-notes"></ul>' +
        '<div class="cap-review-actions">' +
          '<button type="button" class="btn btn-secondary" data-cap-redo>' + icon('reset', 18) + '<span>Regravar</span></button>' +
          '<button type="button" class="btn btn-primary" data-cap-use>' + icon('check', 18) + '<span>Usar este vídeo</span></button>' +
        '</div>' +
      '</section>' +
      '<div class="cap-error" role="alert" hidden><span class="cap-error-ic">' + icon('alert', 26) + '</span><p></p><div class="cap-review-actions"><button type="button" class="btn btn-secondary" data-cap-cancel><span>Fechar</span></button><button type="button" class="btn btn-primary" data-cap-retry><span>Tentar de novo</span></button></div></div>';
  }

  function open(opts) {
    opts = opts || {};
    var sup = support();
    if (!sup.ok && !opts.stream) return Promise.reject(new Error(sup.reason));
    var mime = sup.mimeType || pickMime();
    if (!mime) return Promise.reject(new Error('Nenhum formato de gravação suportado.'));

    return new Promise(function (resolve) {
      var root = document.createElement('div');
      root.className = 'cap';
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Captura guiada pela câmera');
      root.innerHTML = template({ container: containerOf(mime) });
      var $ = function (s) { return root.querySelector(s); };
      var live = $('.cap-video'), timeEl = $('.cap-time'), recEl = $('.cap-rec'), fmtEl = $('.cap-fmt'), warnEl = $('.cap-warn');
      var ringFg = $('.cap-ring-fg'), ringLabel = $('.cap-ring-label'), stagesEl = root.querySelectorAll('.cap-stages li');
      var instrEl = $('.cap-instr'), hintEl = $('.cap-hint'), noteEl = $('.cap-note');
      var startBtn = $('[data-cap-start]'), stopBtn = $('[data-cap-stop]'), actionsLabel = $('.cap-actions-label');
      var guide = $('.cap-guide'), actions = $('.cap-actions'), review = $('.cap-review'), errorBox = $('.cap-error');
      var previous = document.activeElement;
      var stream = null, recorder = null, chunks = [], bytes = 0, startedAt = 0, ticker = null, analyzer = null, wake = null;
      var settings = { width: 0, height: 0 }, result = null, reviewUrl = '', stopReason = '', closed = false;

      document.body.appendChild(root);
      document.body.classList.add('cap-open');

      // ---- encerramento ----
      function stopStream() { if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignora */ } }); stream = null; } }
      function releaseWake() { if (wake) { try { wake.release(); } catch (e) { /* ignora */ } wake = null; } }
      function close(value) {
        if (closed) return; closed = true;
        clearInterval(ticker); clearInterval(analyzer); releaseWake();
        if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (e) { /* ignora */ } }
        stopStream();
        if (reviewUrl) { try { URL.revokeObjectURL(reviewUrl); } catch (e) { /* ignora */ } }
        document.removeEventListener('keydown', onKey, true);
        document.body.classList.remove('cap-open');
        root.remove();
        if (previous && previous.focus) { try { previous.focus(); } catch (e) { /* ignora */ } }
        resolve(value);
      }
      function showError(message) {
        clearInterval(ticker); clearInterval(analyzer); releaseWake();
        guide.hidden = true; actions.hidden = true; review.hidden = true;
        errorBox.hidden = false; errorBox.querySelector('p').textContent = message;
        errorBox.querySelector('[data-cap-retry]').focus();
      }

      // ---- teclado: Esc cancela (ou conclui a gravação); Tab fica dentro do diálogo ----
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); if (recorder && recorder.state === 'recording') stopRecording('manual'); else close(null); return; }
        if (e.key !== 'Tab') return;
        var focusables = Array.prototype.filter.call(root.querySelectorAll('button:not([hidden]), video[controls]'), function (el) { return !el.closest('[hidden]'); });
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey, true);

      // ---- guia por tempo ----
      function paint(elapsed) {
        timeEl.textContent = clock(elapsed);
        var p = Math.min(1, elapsed / GUIDE_SECONDS);
        ringFg.setAttribute('stroke-dashoffset', (RING_C * (1 - p)).toFixed(2));
        var idx = Math.min(STAGES.length - 1, Math.floor(elapsed / (GUIDE_SECONDS / STAGES.length)));
        var complete = elapsed >= GUIDE_SECONDS;
        Array.prototype.forEach.call(stagesEl, function (li, i) {
          li.classList.toggle('is-done', complete || i < idx);
          li.classList.toggle('is-current', !complete && i === idx);
        });
        if (complete) {
          root.classList.add('is-complete');
          ringLabel.innerHTML = '<b>' + icon('check', 22) + '</b><small>guia concluída</small>';
          if (elapsed >= MAX_SECONDS - 10) { instrEl.textContent = 'Limite de 3 minutos em ' + Math.max(0, Math.ceil(MAX_SECONDS - elapsed)) + ' s'; hintEl.textContent = 'A gravação será concluída automaticamente.'; }
          else if (elapsed > MAX_RECOMMENDED) { instrEl.textContent = 'Já é suficiente — toque em Concluir'; hintEl.textContent = 'Acima de 90 s não há ganho perceptível; o serviço aceita até 3 minutos.'; }
          else { instrEl.textContent = 'Guia concluída — pode concluir'; hintEl.textContent = 'Se quiser, faça mais uma volta lenta para reforçar detalhes (até 90 s).'; }
        } else {
          ringLabel.innerHTML = '<b>' + STAGES[idx].label + '</b><small>' + (idx + 1) + ' de ' + STAGES.length + '</small>';
          instrEl.textContent = 'Mova-se lentamente ao redor do produto';
          hintEl.textContent = STAGES[idx].hint;
        }
      }

      // ---- avisos técnicos: movimento rápido e pouca luz, a partir de uma amostra reduzida do quadro ----
      function startAnalyzer() {
        var canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 27;
        var g = canvas.getContext('2d', { willReadFrequently: true });
        if (!g) return;
        var prev = null, fastRuns = 0, darkRuns = 0, state = { fast: false, dark: false };
        analyzer = setInterval(function () {
          if (!live.videoWidth) return;
          var data;
          try { g.drawImage(live, 0, 0, 48, 27); data = g.getImageData(0, 0, 48, 27).data; } catch (e) { clearInterval(analyzer); return; } // sem acesso aos pixels: sem avisos
          // Movimento: fração de pixels cujo brilho mudou bastante entre duas amostras (250 ms).
          // Um giro lento muda poucos pixels da amostra reduzida; um solavanco muda quase todos.
          var n = 48 * 27, luma = new Float32Array(n), sum = 0, changed = 0;
          for (var i = 0; i < n; i++) { var l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; luma[i] = l; sum += l; if (prev && Math.abs(l - prev[i]) > 20) changed += 1; }
          var mean = sum / n, motion = prev ? changed / n : 0;
          prev = luma;
          fastRuns = motion > 0.28 ? fastRuns + 1 : 0;
          darkRuns = mean < 58 ? darkRuns + 1 : 0;
          var fast = fastRuns >= 2, dark = darkRuns >= 4;
          if (fast !== state.fast || dark !== state.dark) {
            state = { fast: fast, dark: dark };
            var msgs = [];
            if (fast) msgs.push('<span>' + icon('move', 16) + 'Movimento rápido — vá mais devagar</span>');
            if (dark) msgs.push('<span>' + icon('sun', 16) + 'Pouca luz — ilumine o produto</span>');
            warnEl.innerHTML = msgs.join(''); warnEl.hidden = !msgs.length;
          }
        }, 250);
      }

      // ---- gravação ----
      function makeRecorder() {
        var attempts = [{ mimeType: mime, videoBitsPerSecond: BITRATE }, { mimeType: mime }, {}];
        for (var i = 0; i < attempts.length; i++) { try { return new MediaRecorder(stream, attempts[i]); } catch (e) { /* tenta a próxima */ } }
        return null;
      }
      function startRecording() {
        if (!stream) return;
        recorder = makeRecorder();
        if (!recorder) { showError('Este navegador não conseguiu iniciar a gravação de vídeo.'); return; }
        chunks = []; bytes = 0; stopReason = ''; result = null;
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) { chunks.push(e.data); bytes += e.data.size; } };
        recorder.onerror = function (e) { showError('Falha durante a gravação' + (e && e.error && e.error.message ? ': ' + e.error.message : '.')); };
        recorder.onstop = finishRecording;
        try { recorder.start(1000); } catch (e) { showError('Não foi possível iniciar a gravação: ' + (e.message || e)); return; }
        startedAt = performance.now();
        root.classList.add('is-recording'); root.classList.remove('is-complete');
        recEl.hidden = false; startBtn.hidden = true; stopBtn.hidden = false; actionsLabel.textContent = 'Concluir';
        noteEl.textContent = 'A guia avança por tempo e sugere o ritmo — não detecta a cobertura real do produto.';
        stopBtn.focus();
        if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () {});
        paint(0);
        ticker = setInterval(function () {
          var elapsed = (performance.now() - startedAt) / 1000;
          paint(elapsed);
          if (elapsed >= MAX_SECONDS) stopRecording('max-time');
          else if (opts.maxBytes && bytes >= opts.maxBytes - 2 * 1024 * 1024) stopRecording('max-bytes');
        }, 100);
        startAnalyzer();
      }
      function stopRecording(reason) {
        if (!recorder || recorder.state === 'inactive') return;
        stopReason = reason || 'manual';
        clearInterval(ticker); clearInterval(analyzer); releaseWake();
        result = { duration: (performance.now() - startedAt) / 1000 };
        try { recorder.stop(); } catch (e) { finishRecording(); }
      }
      function finishRecording() {
        if (!errorBox.hidden) return; // a falha já foi mostrada; não sobrepor com a revisão
        var actual = (recorder && recorder.mimeType) || mime;
        var container = containerOf(actual) || containerOf(mime) || 'webm';
        var blob = new Blob(chunks, { type: 'video/' + container });
        root.classList.remove('is-recording');
        recEl.hidden = true; stopBtn.hidden = true; startBtn.hidden = false; actionsLabel.textContent = 'Iniciar';
        warnEl.hidden = true;
        if (!blob.size) { showError('A gravação ficou vazia. Verifique se a câmera está funcionando e tente de novo.'); return; }
        var stamp = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
        var name = 'scan-camera-' + stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds()) + '.' + container;
        var file;
        try { file = new File([blob], name, { type: blob.type, lastModified: Date.now() }); } catch (e) { file = blob; file.name = name; }
        result = {
          file: file, blob: blob, mimeType: actual, container: container, duration: (result && result.duration) || 0,
          width: settings.width || 0, height: settings.height || 0, bytes: blob.size, warnings: [], stopReason: stopReason,
        };
        showReview();
      }

      // ---- revisão ----
      function showReview() {
        guide.hidden = true; actions.hidden = true; review.hidden = false;
        var v = review.querySelector('video');
        if (reviewUrl) { try { URL.revokeObjectURL(reviewUrl); } catch (e) { /* ignora */ } }
        reviewUrl = URL.createObjectURL(result.blob);
        v.src = reviewUrl;
        // WebM do MediaRecorder não traz duração nos metadados: força o navegador a calculá-la para a barra de tempo.
        v.addEventListener('loadedmetadata', function () {
          if (!isFinite(v.duration)) { v.currentTime = 1e101; v.addEventListener('timeupdate', function once() { v.removeEventListener('timeupdate', once); v.currentTime = 0; }); }
          else if (v.duration > 0) result.duration = v.duration;
          if (v.videoWidth) { result.width = v.videoWidth; result.height = v.videoHeight; }
          renderReviewMeta();
        });
        renderReviewMeta();
        review.querySelector('[data-cap-use]').focus();
      }
      function renderReviewMeta() {
        var d = result.duration, res = result.width ? result.width + '×' + result.height : 'resolução a confirmar';
        review.querySelector('.cap-review-meta').textContent = clock(d) + ' · ' + human(result.bytes) + ' · ' + res + ' · ' + result.container.toUpperCase();
        var notes = [];
        if (result.stopReason === 'max-time') notes.push(['warn', 'A gravação parou no limite de 3 minutos.']);
        if (result.stopReason === 'max-bytes') notes.push(['warn', 'A gravação parou ao atingir o tamanho máximo permitido.']);
        if (d < 10) notes.push(['bad', 'Muito curta (' + clock(d) + '). Uma volta completa leva pelo menos 45 s.']);
        else if (d < MIN_RECOMMENDED) notes.push(['warn', 'Curta (' + clock(d) + '). Recomendamos entre 45 e 90 s para cobrir todos os ângulos.']);
        else if (d <= MAX_RECOMMENDED) notes.push(['ok', 'Duração dentro do recomendado (45 a 90 s).']);
        else notes.push(['warn', 'Longa (' + clock(d) + '). Acima de 90 s não há ganho perceptível; o limite do serviço é 3 minutos.']);
        if (result.container !== 'mp4' && opts.requireMp4) notes.push(['bad', 'Este navegador gravou em WebM, que o serviço de reconstrução não aceita. Você pode baixar o vídeo e convertê-lo para MP4, ou gravar em Chrome ou Safari atualizados.']);
        else if (result.container !== 'mp4') notes.push(['muted', 'Gravado em WebM: os melhores quadros são extraídos aqui mesmo e enviados como fotos.']);
        notes.push(['muted', 'Confira se o produto ficou inteiro e nítido em todos os ângulos antes de usar.']);
        result.warnings = notes.filter(function (n) { return n[0] !== 'ok' && n[0] !== 'muted'; }).map(function (n) { return n[1]; });
        review.querySelector('.cap-review-notes').innerHTML = notes.map(function (n) {
          return '<li class="note note-' + n[0] + '">' + icon(n[0] === 'ok' ? 'check' : 'alert', 16) + '<span>' + n[1] + '</span></li>';
        }).join('');
      }
      function redo() {
        review.hidden = true; guide.hidden = false; actions.hidden = false;
        root.classList.remove('is-complete');
        if (reviewUrl) { try { URL.revokeObjectURL(reviewUrl); } catch (e) { /* ignora */ } reviewUrl = ''; }
        review.querySelector('video').removeAttribute('src');
        result = null; chunks = []; bytes = 0;
        ringFg.setAttribute('stroke-dashoffset', RING_C.toFixed(2));
        Array.prototype.forEach.call(stagesEl, function (li) { li.classList.remove('is-done', 'is-current'); });
        ringLabel.innerHTML = '<b>Pronto</b><small>guia por tempo</small>';
        timeEl.textContent = '0:00'; instrEl.textContent = 'Centralize o produto no contorno';
        hintEl.textContent = 'Toque no botão para começar. Mova-se lentamente ao redor do produto: frente, lateral, traseira e uma volta mais alta.';
        if (!stream || !stream.active) boot(); else startBtn.focus();
      }

      // ---- eventos ----
      Array.prototype.forEach.call(root.querySelectorAll('[data-cap-cancel]'), function (b) { b.addEventListener('click', function () { close(null); }); });
      startBtn.addEventListener('click', startRecording);
      stopBtn.addEventListener('click', function () { stopRecording('manual'); });
      review.querySelector('[data-cap-redo]').addEventListener('click', redo);
      review.querySelector('[data-cap-use]').addEventListener('click', function () { var out = result; result = null; close(out); });
      errorBox.querySelector('[data-cap-retry]').addEventListener('click', function () { errorBox.hidden = true; guide.hidden = false; actions.hidden = false; boot(); });

      // ---- inicialização: abre a câmera (ou usa o stream injetado) ----
      function boot() {
        stopStream();
        var get = opts.stream ? Promise.resolve(opts.stream) : openCamera();
        get.then(function (s) {
          if (closed) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = s;
          var track = s.getVideoTracks()[0];
          if (!track) throw new Error('O stream não tem vídeo.');
          // Só dispara quando o sistema encerra a câmera (track.stop() programático não gera 'ended').
          track.addEventListener('ended', function () { if (!closed && review.hidden) showError('A câmera foi desligada pelo sistema. Toque em "Tentar de novo".'); });
          return capTrack(track).then(function (st) {
            settings = { width: st.width || 0, height: st.height || 0 };
            fmtEl.textContent = containerOf(mime).toUpperCase() + (settings.width ? ' · ' + settings.width + '×' + settings.height : '');
            live.srcObject = s;
            return live.play().catch(function () {});
          }).then(function () { startBtn.focus(); });
        }).catch(function (err) { showError(cameraError(err)); });
      }
      boot();
    });
  }

  return { support: support, open: open, pickMime: pickMime, STAGES: STAGES, MAX_SECONDS: MAX_SECONDS, GUIDE_SECONDS: GUIDE_SECONDS, MIN_RECOMMENDED: MIN_RECOMMENDED, MAX_RECOMMENDED: MAX_RECOMMENDED };
})();
