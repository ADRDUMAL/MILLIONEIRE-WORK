// Forma 3D · Vídeo ao redor do produto.
//
// Diagnóstico que motivou este módulo (captura V2): o vídeo era validado pedindo ao navegador para
// DECODIFICAR o arquivo. MOV do iPhone vem em HEVC, que o Chrome no Windows não abre — o arquivo
// era recusado como "não conseguiu abrir" antes de qualquer outra checagem. Vídeo em 4K (comum no
// iPhone) também era recusado, porque o serviço só aceita até 1920 × 1080, e não há ffmpeg no
// servidor para converter. E tudo terminava numa mensagem genérica.
//
// Agora são dois caminhos, escolhidos automaticamente:
//   1. QUADROS  — se este navegador decodifica o vídeo, extraímos os quadros mais nítidos de cada
//                 trecho da volta (≤ 3840 px) e enviamos como FOTOS. Resolve 4K, HEVC no Safari,
//                 WebM gravado pelo Chrome e vídeos longos; e permite validar a qualidade.
//   2. DIRETO   — se não decodifica, mas o arquivo cabe nos limites do serviço (MP4/MOV, ≤ 3 min,
//                 ≤ 1920 × 1080), o vídeo vai inteiro para o serviço, que extrai os quadros lá.
// Fora disso: erro com a causa real (formato, duração, resolução, codec, tamanho).
//
// A leitura de duração/resolução/codec é feita nos cabeçalhos MP4/MOV (ISO BMFF), sem decodificar.
window.FormaVideo = (function () {
  'use strict';

  var MAX_MOOV = 48 * 1024 * 1024;
  var CODEC_LABEL = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', av01: 'AV1', vp09: 'VP9', mp4v: 'MPEG-4' };

  function readSlice(file, start, end) {
    var blob = file.slice(start, end);
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (resolve, reject) { var fr = new FileReader(); fr.onload = function () { resolve(fr.result); }; fr.onerror = function () { reject(fr.error); }; fr.readAsArrayBuffer(blob); });
  }
  var str4 = function (dv, o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); };
  function u64(dv, o) { return dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4); }

  function walk(dv, start, end, visit) {
    var p = start;
    while (p + 8 <= end) {
      var size = dv.getUint32(p), type = str4(dv, p + 4), hdr = 8;
      if (size === 1) { if (p + 16 > end) break; size = u64(dv, p + 8); hdr = 16; }
      if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      visit(type, p + hdr, p + size);
      p += size;
    }
  }

  // Sonda: { container: 'mp4'|'webm'|'unknown', brand, duration, width, height, codec, codecLabel, confirmed }
  function probe(file) {
    var out = { container: 'unknown', brand: null, duration: null, width: null, height: null, codec: null, codecLabel: '', confirmed: false };
    return readSlice(file, 0, Math.min(file.size, 64)).then(function (buf) {
      var dv = new DataView(buf);
      if (buf.byteLength >= 4 && dv.getUint32(0) === 0x1a45dfa3) { out.container = 'webm'; return out; }
      if (buf.byteLength < 12 || str4(dv, 4) !== 'ftyp') return out;
      out.container = 'mp4';
      out.brand = str4(dv, 8).trim();
      // Percorre as caixas do topo lendo só cabeçalhos, até achar a moov (no iPhone ela fica no fim).
      var off = 0;
      function step() {
        if (off + 8 > file.size) return out;
        return readSlice(file, off, Math.min(file.size, off + 16)).then(function (h) {
          var hv = new DataView(h);
          if (h.byteLength < 8) return out;
          var size = hv.getUint32(0), type = str4(hv, 4), hdr = 8;
          if (size === 1 && h.byteLength >= 16) { size = u64(hv, 8); hdr = 16; }
          if (size === 0) size = file.size - off;
          if (size < hdr) return out;
          if (type !== 'moov') { off += size; return step(); }
          if (size > MAX_MOOV) return out;
          return readSlice(file, off + hdr, off + size).then(function (mb) { parseMoov(new DataView(mb), out); return out; });
        });
      }
      return step();
    }).then(function (o) {
      o.confirmed = o.duration != null && o.width != null;
      o.codecLabel = o.codec ? (CODEC_LABEL[o.codec] || o.codec) : '';
      return o;
    }).catch(function () { return out; });
  }

  function parseMoov(dv, out) {
    walk(dv, 0, dv.byteLength, function (t, s, e) {
      if (t === 'mvhd') {
        var v = dv.getUint8(s);
        var ts = v === 1 ? dv.getUint32(s + 20) : dv.getUint32(s + 12);
        var du = v === 1 ? u64(dv, s + 24) : dv.getUint32(s + 16);
        if (ts) out.duration = du / ts;
      }
      if (t !== 'trak') return;
      var handler = null, codec = null, tw = 0, th = 0;
      var dive = function (a, b) {
        walk(dv, a, b, function (t2, s2, e2) {
          if (t2 === 'tkhd') { var v2 = dv.getUint8(s2); tw = dv.getUint32(s2 + (v2 === 1 ? 88 : 76)) / 65536; th = dv.getUint32(s2 + (v2 === 1 ? 92 : 80)) / 65536; }
          else if (t2 === 'hdlr' && s2 + 12 <= e2) handler = str4(dv, s2 + 8);
          else if (t2 === 'stsd' && s2 + 16 <= e2) codec = str4(dv, s2 + 12);
          else if (t2 === 'mdia' || t2 === 'minf' || t2 === 'stbl') dive(s2, e2);
        });
      };
      dive(s, e);
      var isVideo = handler ? handler === 'vide' : tw > 0 && th > 0;
      if (isVideo && tw > 0 && th > 0 && (out.width == null || tw * th > out.width * out.height)) {
        out.width = Math.round(tw); out.height = Math.round(th); out.codec = codec;
      }
    });
  }

  // ---------- Diagnóstico para o caminho DIRETO ----------
  // Devolve [] quando o arquivo pode ir inteiro ao serviço; senão, a lista de causas.
  function directIssues(file, info, limits) {
    limits = limits || {};
    var maxW = limits.videoMaxWidth || 1920, maxH = limits.videoMaxHeight || 1080;
    var maxSec = limits.videoMaxSeconds || 180, maxBytes = limits.videoMaxBytes || 300 * 1048576;
    var issues = [];
    if (info.container !== 'mp4') issues.push({ code: 'VIDEO_FORMAT', m: info.container === 'webm' ? 'O arquivo é WebM; o serviço aceita só MP4 ou MOV.' : 'O arquivo não é um MP4 ou MOV reconhecível.' });
    if (file.size > maxBytes) issues.push({ code: 'VIDEO_FILE_SIZE', m: 'O arquivo tem ' + Math.round(file.size / 1048576) + ' MB; o envio direto aceita até ' + Math.round(maxBytes / 1048576) + ' MB.' });
    if (info.duration && info.duration > maxSec) issues.push({ code: 'VIDEO_TOO_LONG', m: 'O vídeo tem ' + clock(info.duration) + '; o máximo é ' + clock(maxSec) + '.' });
    if (info.width && info.height) {
      var fits = (info.width <= maxW && info.height <= maxH) || (info.height <= maxW && info.width <= maxH);
      if (!fits) issues.push({ code: 'VIDEO_RESOLUTION', m: 'A resolução é ' + info.width + '×' + info.height + '; o máximo é ' + maxW + '×' + maxH + '.' });
    }
    return issues;
  }
  function clock(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  // ---------- Caminho QUADROS ----------
  function once(el, ok, bad, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, ms || 8000);
      function done() { cleanup(); resolve(); }
      function fail() { cleanup(); reject(new Error('decode')); }
      function cleanup() { clearTimeout(t); el.removeEventListener(ok, done); if (bad) el.removeEventListener(bad, fail); }
      el.addEventListener(ok, done);
      if (bad) el.addEventListener(bad, fail);
    });
  }

  // Abre o vídeo num <video> fora da tela. Rejeita com code DECODE quando o navegador não decodifica.
  function openVideo(file) {
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
    var url = URL.createObjectURL(file);
    v.src = url;
    var release = function () { try { v.removeAttribute('src'); v.load(); } catch (e) { /* ignora */ } URL.revokeObjectURL(url); };
    return once(v, 'loadedmetadata', 'error', 10000).then(function () {
      // iOS só entrega quadros depois de o elemento "tocar" uma vez.
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      return once(v, 'loadeddata', 'error', 8000).catch(function () {});
    }).then(function () {
      try { v.pause(); } catch (e) { /* ignora */ }
      if (!v.videoWidth || !v.videoHeight) throw new Error('decode');
      return { el: v, release: release };
    }).catch(function (e) { release(); var err = new Error('O navegador não decodifica este vídeo.'); err.code = e && e.message === 'timeout' ? 'DECODE_TIMEOUT' : 'DECODE'; throw err; });
  }

  function seek(v, t) {
    if (Math.abs(v.currentTime - t) < 0.001) return Promise.resolve();
    var p = once(v, 'seeked', 'error', 6000);
    v.currentTime = t;
    return p;
  }

  // Extrai os quadros mais nítidos: a volta é dividida em N trechos e, em cada um, 2 candidatos são
  // medidos (variância do laplaciano numa amostra de 160 px). Só o vencedor é desenhado em
  // resolução cheia e codificado em JPEG. Quadros quase idênticos ao anterior (pessoa parada) saem.
  // opts: { maxLong, quality, onProgress(done, total), shouldStop() }
  function extractFrames(file, opts) {
    opts = opts || {};
    var Q = window.FormaScanQuality, PC = window.FormaPhotoCheck;
    return openVideo(file).then(function (h) {
      var v = h.el, dur = isFinite(v.duration) && v.duration > 0 ? v.duration : (opts.duration || 0);
      if (!dur) { h.release(); var e0 = new Error('Não foi possível ler a duração do vídeo.'); e0.code = 'DECODE'; throw e0; }
      var total = Math.max(24, Math.min(opts.maxFrames || 72, Math.round(dur * 1.1)));
      var span = dur / total;
      var vw = v.videoWidth, vh = v.videoHeight, scale = Math.min(1, (opts.maxLong || 3840) / Math.max(vw, vh));
      var fw = Math.round(vw * scale), fh = Math.round(vh * scale);
      var small = document.createElement('canvas'); small.width = 160; small.height = Math.max(24, Math.round(160 * vh / vw));
      var sg = small.getContext('2d', { willReadFrequently: true });
      var best = document.createElement('canvas'); best.width = fw; best.height = fh;
      var bg = best.getContext('2d');
      var roi = { x: 0.2, y: 0.15, w: 0.6, h: 0.7 };
      var out = [], lastHash = null, dropped = 0, i = 0;

      function measureNow() {
        sg.drawImage(v, 0, 0, small.width, small.height);
        var luma = Q.luma(sg.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
        return { sharp: Q.sharpness(luma, small.width, small.height, roi), ex: Q.exposure(luma, small.width, small.height, roi) };
      }
      function slot() {
        if (i >= total || (opts.shouldStop && opts.shouldStop())) return Promise.resolve();
        var t0 = i * span, candidates = [0.3, 0.75].map(function (f) { return Math.min(dur - 0.05, t0 + span * f); });
        var bestScore = -1, bestTime = 0, c = 0;
        function cand() {
          if (c >= candidates.length) return Promise.resolve();
          var t = candidates[c++];
          return seek(v, t).then(function () {
            var m = measureNow();
            if (m.sharp > bestScore) { bestScore = m.sharp; bestTime = t; bg.drawImage(v, 0, 0, fw, fh); }
          }).then(cand);
        }
        return cand().then(function () {
          var hash = PC ? PC.dhash(best, fw, fh) : null;
          if (lastHash && PC && PC.hamming(hash, lastHash) <= 2) { dropped++; return null; }
          lastHash = hash;
          return new Promise(function (resolve) { best.toBlob(resolve, 'image/jpeg', opts.quality || 0.92); }).then(function (blob) {
            if (!blob) return;
            var name = 'quadro-' + String(out.length + 1).padStart(3, '0') + '.jpg', f;
            try { f = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }); } catch (e) { f = blob; f.name = name; }
            out.push({ file: f, time: bestTime, sharp: bestScore, url: URL.createObjectURL(blob), bytes: blob.size });
          });
        }).then(function () {
          i++;
          if (opts.onProgress) opts.onProgress(i, total);
          return slot();
        });
      }
      return slot().then(function () {
        h.release();
        // Nitidez relativa ao próprio vídeo: quadros muito abaixo da mediana são descartados.
        var med = PC ? PC.median(out.map(function (o) { return o.sharp; })) : 0;
        var blurry = out.filter(function (o) { return med && o.sharp < med * 0.35; }).length;
        return { frames: out, width: fw, height: fh, sourceWidth: vw, sourceHeight: vh, duration: dur, requested: total, dropped: dropped, blurry: blurry };
      }, function (err) { h.release(); throw err; });
    });
  }

  return { probe: probe, directIssues: directIssues, extractFrames: extractFrames, openVideo: openVideo, clock: clock, CODEC_LABEL: CODEC_LABEL };
})();
