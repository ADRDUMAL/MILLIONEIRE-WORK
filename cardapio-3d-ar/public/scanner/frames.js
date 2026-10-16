// Forma 3D · Scanner guiado — amostragem e keyframes (Fase 4).
//
// Duas coisas distintas moram aqui:
//
//   Sampler  lê o <video> em uma amostra minúscula (160 px de largura) várias vezes por segundo.
//            É o que alimenta as métricas. Nunca toca em resolução cheia, por isso não engasga
//            o preview: o preview continua nos 30 fps do próprio elemento de vídeo.
//
//   Store    guarda o melhor quadro de cada setor em resolução de envio (JPEG, lado maior ≤ 1920).
//            A captura em resolução cheia só acontece quando um quadro passa nos filtros — não a
//            cada amostra. Trocar o quadro de um setor libera o anterior na hora.
window.FormaScanFrames = (function () {
  'use strict';

  var Q = window.FormaScanQuality;

  // ---------- Amostragem para análise ----------
  function createSampler(video, sampleWidth) {
    var w = sampleWidth || 160, h = 0;
    var canvas = document.createElement('canvas');
    var g = canvas.getContext('2d', { willReadFrequently: true });
    var blocked = false;   // canvas "sujo" (cross-origin) — sem pixels, sem análise

    return {
      get width() { return w; },
      get height() { return h; },
      get blocked() { return blocked; },
      // Devolve { luma, w, h } ou null quando ainda não há quadro (ou os pixels não são legíveis).
      sample: function () {
        if (blocked || !g || !video.videoWidth) return null;
        var ratio = video.videoHeight / video.videoWidth;
        var nh = Math.max(24, Math.round(w * ratio));
        if (nh !== h) { h = nh; canvas.width = w; canvas.height = h; }
        try {
          g.drawImage(video, 0, 0, w, h);
          var data = g.getImageData(0, 0, w, h).data;
          return { luma: Q.luma(data, w, h), w: w, h: h };
        } catch (e) {
          blocked = true;
          return null;
        }
      },
    };
  }

  // ---------- Guarda dos keyframes ----------
  function createStore(opts) {
    opts = opts || {};
    var maxSide = opts.maxSide || 1920;
    var quality = opts.quality == null ? 0.9 : opts.quality;
    var type = opts.type || 'image/jpeg';
    var frames = {};      // id -> frame
    var seq = 0;
    var canvas = document.createElement('canvas');
    var g = canvas.getContext('2d');

    function release(frame) {
      if (frame && frame.url) { try { URL.revokeObjectURL(frame.url); } catch (e) { /* ignora */ } }
    }

    // Captura o quadro atual em resolução de envio. Assíncrono de propósito: `toBlob` não trava
    // o thread como `toDataURL` faria.
    function capture(video, meta) {
      if (!g || !video.videoWidth) return Promise.resolve(null);
      var vw = video.videoWidth, vh = video.videoHeight;
      var scale = Math.min(1, maxSide / Math.max(vw, vh));
      var w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      try { g.drawImage(video, 0, 0, w, h); } catch (e) { return Promise.resolve(null); }
      return new Promise(function (resolve) {
        var done = function (blob) {
          if (!blob || !blob.size) return resolve(null);
          seq += 1;
          var id = 'kf' + seq;
          var frame = {
            id: id, blob: blob, url: URL.createObjectURL(blob), bytes: blob.size,
            width: w, height: h, at: Date.now(),
            angle: (meta && meta.angle) || 0, sector: meta ? meta.sector : -1,
            score: (meta && meta.score) || 0, pass: (meta && meta.pass) || 'main',
          };
          frames[id] = frame;
          resolve(frame);
        };
        if (canvas.toBlob) canvas.toBlob(done, type, quality);
        else done(null);
      });
    }

    function drop(id) {
      var f = frames[id];
      if (!f) return false;
      release(f);
      delete frames[id];
      return true;
    }

    function get(id) { return frames[id] || null; }
    function count() { return Object.keys(frames).length; }
    function bytes() { return Object.keys(frames).reduce(function (n, k) { return n + frames[k].bytes; }, 0); }

    // Lista ordenada por ângulo — a ordem em que o serviço de reconstrução espera ver a volta.
    function ordered(ids) {
      var list = (ids || Object.keys(frames)).map(function (id) { return frames[id]; }).filter(Boolean);
      return list.sort(function (a, b) { return a.pass === b.pass ? a.angle - b.angle : (a.pass === 'main' ? -1 : 1); });
    }

    // Arquivos prontos para o mesmo POST que o envio manual de fotos já usa.
    function files(ids) {
      var ext = type === 'image/webp' ? 'webp' : 'jpg';
      return ordered(ids).map(function (f, i) {
        var name = 'scan-' + String(i + 1).padStart(3, '0') + '.' + ext;
        try { return new File([f.blob], name, { type: f.blob.type || type, lastModified: f.at }); }
        catch (e) { var b = f.blob; b.name = name; return b; }
      });
    }

    function clear() {
      Object.keys(frames).forEach(function (k) { release(frames[k]); delete frames[k]; });
    }

    return { capture: capture, drop: drop, get: get, count: count, bytes: bytes, ordered: ordered, files: files, clear: clear };
  }

  return { createSampler: createSampler, createStore: createStore };
})();
