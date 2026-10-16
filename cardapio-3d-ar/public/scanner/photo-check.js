// Forma 3D · Validação do conjunto de fotos antes do envio (captura guiada e fotos enviadas).
//
// Heurísticas simples e declaradas — não é visão computacional:
//   · resolução   lado maior da imagem;
//   · nitidez     variância do laplaciano numa amostra de 256 px, comparada à MEDIANA do próprio
//                 conjunto (um limiar absoluto não sobrevive a troca de lente ou de luz);
//   · exposição   luminância média e fração de pixels estourados/pretos;
//   · repetidas   hash de diferença (dHash 64 bits): fotos quase idênticas não somam ângulo.
// O mesmo módulo também normaliza fotos grandes demais (ex.: 48 MP do iPhone) em vez de recusá-las.
window.FormaPhotoCheck = (function () {
  'use strict';

  var Q = window.FormaScanQuality;
  var SAMPLE = 256;
  var T = {
    minLongBad: 800,      // abaixo disso a foto quase não contribui
    minLongWarn: 1600,    // abaixo disso o detalhe da textura cai
    blurRatio: 0.38,      // nitidez < 38% da mediana do conjunto = provavelmente tremida/fora de foco
    darkMean: 48, brightMean: 225, clippedMax: 0.25,
    dupDistance: 4,       // distância de Hamming do dHash (0–64) para considerar "quase igual"
    normalizeLong: 4096,  // resolução enviada quando a original é grande demais
    normalizeBytes: 7.5 * 1024 * 1024,
  };

  function lumaOf(source, sw, sh) {
    var w = SAMPLE, h = Math.max(24, Math.round(SAMPLE * sh / sw));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, w, h);
    return { luma: Q.luma(g.getImageData(0, 0, w, h).data, w, h), w: w, h: h };
  }

  // dHash: 9×8 em cinza, um bit por comparação horizontal. Resistente a pequenas mudanças de luz.
  function dhash(source, sw, sh) {
    var c = document.createElement('canvas'); c.width = 9; c.height = 8;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, sw, sh, 0, 0, 9, 8);
    var d = g.getImageData(0, 0, 9, 8).data, bits = [];
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
      var i = (y * 9 + x) * 4, j = i + 4;
      var a = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      var b = d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114;
      bits.push(a > b ? 1 : 0);
    }
    return bits;
  }
  function hamming(a, b) { if (!a || !b) return 64; var n = 0; for (var i = 0; i < 64; i++) if (a[i] !== b[i]) n++; return n; }

  // Métricas de uma fonte já decodificada (img, canvas, ImageBitmap ou <video>).
  function measure(source, sw, sh) {
    var s = lumaOf(source, sw, sh);
    var full = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
    var ex = Q.exposure(s.luma, s.w, s.h, full);
    return {
      width: sw, height: sh,
      sharp: Q.sharpness(s.luma, s.w, s.h, { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }), // centro: onde o produto está
      mean: ex.mean, clipped: ex.clipped, hash: dhash(source, sw, sh),
    };
  }

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
        .then(function (bmp) { return { src: bmp, w: bmp.width, h: bmp.height, close: function () { try { bmp.close(); } catch (e) { /* ignora */ } } }; })
        .catch(function () { return decodeImg(file); });
    }
    return decodeImg(file);
  }
  function decodeImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  // Reduz para T.normalizeLong quando a foto passa do tamanho aceito, em JPEG 0,92.
  function normalize(file, dec) {
    var long = Math.max(dec.w, dec.h);
    if (file.size <= T.normalizeBytes && long <= 6000) return Promise.resolve({ file: file, resized: false });
    var scale = Math.min(1, T.normalizeLong / long);
    var c = document.createElement('canvas');
    c.width = Math.round(dec.w * scale); c.height = Math.round(dec.h * scale);
    c.getContext('2d').drawImage(dec.src, 0, 0, c.width, c.height);
    return new Promise(function (resolve) {
      c.toBlob(function (blob) {
        if (!blob) return resolve({ file: file, resized: false });
        var name = String(file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg';
        var out;
        try { out = new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() }); } catch (e) { out = blob; out.name = name; }
        resolve({ file: out, resized: true, width: c.width, height: c.height });
      }, 'image/jpeg', 0.92);
    });
  }

  // Analisa um arquivo: decodifica, normaliza se preciso e mede. Nunca rejeita a Promise.
  function analyzeFile(file) {
    var isHeic = /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
    return decode(file).then(function (dec) {
      return normalize(file, dec).then(function (norm) {
        var m = measure(dec.src, dec.w, dec.h);
        dec.close();
        m.file = norm.file; m.resized = norm.resized;
        if (norm.resized) { m.width = norm.width; m.height = norm.height; }
        m.ok = true;
        return m;
      });
    }).catch(function () {
      return { ok: false, file: file, error: isHeic
        ? 'Foto HEIC que este navegador não abre. No iPhone, envie pela galeria (ela converte para JPG) ou exporte em JPG.'
        : 'Imagem inválida ou corrompida' };
    });
  }

  function median(values) {
    var v = values.slice().sort(function (a, b) { return a - b; });
    if (!v.length) return 0;
    var m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  // Avalia o conjunto: marca cada item (item.flags) e devolve o resumo em frases curtas.
  // items: [{ width, height, sharp, mean, clipped, hash, ok }]
  function judge(items) {
    var ok = items.filter(function (i) { return i.ok; });
    var med = median(ok.map(function (i) { return i.sharp; }));
    var counts = { small: 0, low: 0, blur: 0, dark: 0, bright: 0, dup: 0 };
    ok.forEach(function (it, idx) {
      var f = [];
      var long = Math.max(it.width, it.height);
      if (long < T.minLongBad) { f.push('small'); counts.small++; }
      else if (long < T.minLongWarn) { f.push('low'); counts.low++; }
      if (ok.length >= 5 && med > 0 && it.sharp < med * T.blurRatio) { f.push('blur'); counts.blur++; }
      if (it.mean < T.darkMean) { f.push('dark'); counts.dark++; }
      else if (it.mean > T.brightMean || it.clipped > T.clippedMax) { f.push('bright'); counts.bright++; }
      for (var j = 0; j < idx; j++) {
        if (hamming(it.hash, ok[j].hash) <= T.dupDistance) { f.push('dup'); counts.dup++; break; }
      }
      it.flags = f;
    });
    var n = function (k, one, many) { return counts[k] + ' ' + (counts[k] === 1 ? one : many); };
    var notes = [];
    if (counts.small) notes.push({ t: 'bad', m: n('small', 'foto está pequena demais', 'fotos estão pequenas demais') + ' (menos de ' + T.minLongBad + ' px).' });
    if (counts.low) notes.push({ t: 'warn', m: n('low', 'foto tem', 'fotos têm') + ' resolução baixa. A textura pode perder detalhe.' });
    if (counts.blur) notes.push({ t: 'warn', m: n('blur', 'foto parece tremida', 'fotos parecem tremidas') + ' ou fora de foco.' });
    if (counts.dark) notes.push({ t: 'warn', m: n('dark', 'foto está escura', 'fotos estão escuras') + '. Mais luz ajuda a reconstrução.' });
    if (counts.bright) notes.push({ t: 'warn', m: n('bright', 'foto tem', 'fotos têm') + ' partes estouradas pela luz.' });
    if (counts.dup) notes.push({ t: 'warn', m: n('dup', 'foto é quase igual', 'fotos são quase iguais') + ' a outra. Elas não somam ângulo novo.' });
    var usable = ok.filter(function (i) { return i.flags.indexOf('small') < 0 && i.flags.indexOf('dup') < 0; }).length;
    return { counts: counts, notes: notes, usable: usable, medianSharp: med };
  }

  return { T: T, measure: measure, analyzeFile: analyzeFile, judge: judge, hamming: hamming, dhash: dhash, median: median };
})();
