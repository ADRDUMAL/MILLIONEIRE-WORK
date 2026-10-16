// Forma 3D · Câmera traseira com a melhor resolução que o aparelho entrega de verdade.
//
// Por que existe: a captura antiga pedia `width/height` com `max: 1920 × 1080`. Com o iPhone em
// pé o lado maior do quadro é a ALTURA, então o teto de 1080 derrubava o stream para uma
// resolução pequena; e o fallback de OverconstrainedError abria a câmera sem resolução nenhuma
// (640 × 480 na maioria dos navegadores). Aqui:
//   · só `ideal` (nunca `exact`/`max` em resolução) — o navegador escolhe o mais próximo que suporta;
//   · escada 4K → 1080p → padrão, parando no primeiro que abrir;
//   · a resolução REAL vem de track.getSettings(), nunca da que foi pedida;
//   · depois da permissão, enumerateDevices() lista as traseiras. Em iPhone, a câmera "Dupla/Tripla"
//     é virtual e troca de lente sozinha ao aproximar — péssimo para fotogrametria, que precisa de
//     uma lente só do começo ao fim. Quando dá para identificar pelo nome, preferimos a principal.
//
// Contrato:
//   FormaCamera.open({ maxLong, deviceId })  -> Promise<session>
//   session = { stream, track, settings, width, height, label, deviceId, rear: [{deviceId,label}],
//               canSwitch, canTakePhoto, switchTo(deviceId) -> Promise<session>, stop(), describe() }
//   FormaCamera.errorMessage(err) -> texto para o usuário
window.FormaCamera = (function () {
  'use strict';

  var LADDER = [
    { width: { ideal: 3840 }, height: { ideal: 2160 } },
    { width: { ideal: 1920 }, height: { ideal: 1080 } },
    {},
  ];
  var REAR_RE = /back|rear|traseir|environment|tr[aá]s|facing back|arri[eè]re|hinten/i;
  var FRONT_RE = /front|frontal|user|facetime|selfie|facing front/i;
  var VIRTUAL_RE = /dual|triple|dupla|tripla|doble/i;              // câmeras virtuais multi-lente (iPhone)
  var SECONDARY_RE = /ultra|tele|macro|depth|profundidade|wide angle|grande angular/i;

  var log = function () { try { console.info.apply(console, ['[FormaCamera]'].concat([].slice.call(arguments))); } catch (e) { /* ignora */ } };

  function constraintsFor(step, deviceId) {
    var v = { frameRate: { ideal: 30 } };
    for (var k in step) v[k] = step[k];
    if (deviceId) v.deviceId = { exact: deviceId };
    else v.facingMode = { ideal: 'environment' };
    return { audio: false, video: v };
  }

  // Tenta cada degrau da escada. Permissão negada interrompe na hora (tentar de novo não resolve).
  function openLadder(deviceId, ladder) {
    var i = 0, lastErr = null;
    function next() {
      if (i >= ladder.length) return Promise.reject(lastErr || new Error('Nenhuma câmera respondeu.'));
      var c = constraintsFor(ladder[i++], deviceId);
      return navigator.mediaDevices.getUserMedia(c).catch(function (err) {
        lastErr = err;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err;
        return next();
      });
    }
    return next();
  }

  function listRear() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      var cams = list.filter(function (d) { return d.kind === 'videoinput' && d.deviceId; });
      var rear = cams.filter(function (d) { return REAR_RE.test(d.label) && !FRONT_RE.test(d.label); });
      // Sem rótulos úteis (alguns Androids), qualquer câmera que não seja claramente frontal vale.
      if (!rear.length) rear = cams.filter(function (d) { return !FRONT_RE.test(d.label); });
      return rear.map(function (d, i) { return { deviceId: d.deviceId, label: d.label || ('Câmera ' + (i + 1)) }; });
    }).catch(function () { return []; });
  }

  // Lente principal: traseira que não é virtual nem secundária. Só é usada quando o nome permite
  // ter certeza — em aparelhos com rótulos genéricos fica a escolha do próprio navegador.
  function preferredRear(rear) {
    return rear.filter(function (d) { return !VIRTUAL_RE.test(d.label) && !SECONDARY_RE.test(d.label); })[0] || null;
  }

  // Foco e exposição contínuos quando o navegador expõe isso (Chrome Android). No iOS é o padrão.
  function tune(track) {
    try {
      var caps = track.getCapabilities ? track.getCapabilities() : {};
      var adv = {};
      if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) adv.focusMode = 'continuous';
      if (caps.exposureMode && caps.exposureMode.indexOf('continuous') >= 0) adv.exposureMode = 'continuous';
      if (caps.whiteBalanceMode && caps.whiteBalanceMode.indexOf('continuous') >= 0) adv.whiteBalanceMode = 'continuous';
      if (Object.keys(adv).length && track.applyConstraints) return track.applyConstraints({ advanced: [adv] }).catch(function () {});
    } catch (e) { /* ignora */ }
    return Promise.resolve();
  }

  // Limita o lado maior (ex.: gravação de vídeo, que o serviço aceita até 1920 × 1080) sem
  // exigir `exact`: se o aparelho recusar, segue com o que tem e a validação avisa.
  function capLong(track, maxLong) {
    if (!maxLong || !track.applyConstraints) return Promise.resolve();
    var s = track.getSettings ? track.getSettings() : {};
    var w = s.width || 0, h = s.height || 0;
    if (Math.max(w, h) <= maxLong) return Promise.resolve();
    var landscape = w >= h;
    var c = landscape ? { width: { ideal: maxLong }, height: { ideal: Math.round(maxLong * 9 / 16) } } : { width: { ideal: Math.round(maxLong * 9 / 16) }, height: { ideal: maxLong } };
    return track.applyConstraints(c).catch(function () {});
  }

  function open(opts) {
    opts = opts || {};
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('getUserMedia indisponível'));
    var ladder = opts.maxLong && opts.maxLong <= 1920 ? LADDER.slice(1) : LADDER;
    return openLadder(opts.deviceId || null, ladder).then(function (stream) {
      return build(stream, opts);
    }).then(function (session) {
      // Primeira abertura sem deviceId: se caímos numa câmera virtual e existe a principal, troca.
      if (opts.deviceId || opts.keepDefault) return session;
      var best = preferredRear(session.rear);
      if (best && best.deviceId !== session.deviceId && VIRTUAL_RE.test(session.label)) {
        log('trocando de "' + session.label + '" para a lente principal "' + best.label + '"');
        return session.switchTo(best.deviceId).catch(function () { return session; });
      }
      return session;
    });
  }

  function build(stream, opts) {
    var track = stream.getVideoTracks()[0];
    if (!track) throw new Error('O stream não tem vídeo.');
    return tune(track).then(function () { return capLong(track, opts.maxLong); }).then(listRear).then(function (rear) {
      var s = track.getSettings ? track.getSettings() : {};
      var session = {
        stream: stream, track: track, settings: s,
        width: s.width || 0, height: s.height || 0,
        deviceId: s.deviceId || '', label: track.label || '',
        facing: s.facingMode || '',
        rear: rear,
        canSwitch: rear.length > 1,
        canTakePhoto: typeof window.ImageCapture === 'function',
        stop: function () { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignora */ } }); },
        describe: function () { return describe(session.width, session.height); },
        switchTo: function (deviceId) {
          session.stop();
          return openLadder(deviceId, opts.maxLong && opts.maxLong <= 1920 ? LADDER.slice(1) : LADDER).then(function (st) { return build(st, opts); });
        },
      };
      log('aberta', session.label || '(sem nome)', session.width + '×' + session.height, 'traseiras:', rear.map(function (d) { return d.label; }).join(' | ') || '—');
      return session;
    });
  }

  // "4K", "1080p", "720p" — pelo lado MENOR, que é o que o mercado chama de resolução.
  function describe(w, h) {
    var short = Math.min(w, h), long = Math.max(w, h);
    if (!short) return '';
    if (short >= 2100) return '4K';
    if (short >= 1400) return '1440p';
    if (short >= 1000) return '1080p';
    if (short >= 700) return '720p';
    return long + '×' + short;
  }

  function errorMessage(err) {
    var n = err && err.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador e tente de novo.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'Nenhuma câmera foi encontrada neste aparelho.';
    if (n === 'NotReadableError' || n === 'TrackStartError') return 'A câmera está em uso por outro aplicativo. Feche-o e tente de novo.';
    if (n === 'OverconstrainedError') return 'A câmera não aceitou nenhuma das configurações testadas.';
    return 'Não foi possível abrir a câmera' + (err && err.message ? ': ' + err.message : '.');
  }

  // Foto em resolução do SENSOR quando o navegador permite (ImageCapture, Chrome Android).
  // Sem isso (iOS/Safari), quem chama recorta o quadro do <video> na resolução do stream.
  function takePhoto(track, timeoutMs) {
    if (typeof window.ImageCapture !== 'function') return Promise.resolve(null);
    var ic;
    try { ic = new window.ImageCapture(track); } catch (e) { return Promise.resolve(null); }
    var shot = ic.getPhotoCapabilities().then(function (caps) {
      var ps = {};
      if (caps && caps.fillLightMode && caps.fillLightMode.indexOf('off') >= 0) ps.fillLightMode = 'off';
      if (caps && caps.imageWidth && caps.imageWidth.max) ps.imageWidth = caps.imageWidth.max;
      return ic.takePhoto(ps);
    }).catch(function () { return ic.takePhoto(); });
    var timer = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, timeoutMs || 3500); });
    return Promise.race([shot, timer]).catch(function () { return null; });
  }

  return { open: open, errorMessage: errorMessage, describe: describe, takePhoto: takePhoto, listRear: listRear, preferredRear: preferredRear, _constraintsFor: constraintsFor, LADDER: LADDER };
})();
