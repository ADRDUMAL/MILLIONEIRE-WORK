// Forma 3D · Scanner guiado — mapa de cobertura (Fase 6).
//
// O anel NÃO é um cronômetro. Ele é a projeção deste mapa: cada setor representa uma faixa de
// perspectiva ao redor do produto e só fica verde quando existe um quadro válido daquela faixa.
// O progresso é `accepted / total` — nunca `elapsed / target`.
//
// Estados de um setor (espelham a especificação):
//   pending   nada foi oferecido ainda
//   candidate algo foi oferecido e recusado; ainda dá para melhorar passando de novo
//   accepted  existe um quadro válido guardado (o melhor visto até agora)
//   retry     tentativas demais sem nada aproveitável — precisa voltar e repetir com atenção
window.FormaScanCoverage = (function () {
  'use strict';

  var RETRY_AFTER = 5;      // tentativas recusadas no mesmo setor antes de marcá-lo como "repetir"
  var UPGRADE_MARGIN = 0.08; // só troca o quadro guardado de um setor por um sensivelmente melhor

  var norm = function (a) { a = a % 360; return a < 0 ? a + 360 : a; };

  // Menor diferença entre dois ângulos, com sinal (-180..180]. Positivo = b está à frente de a.
  function delta(a, b) {
    var d = norm(b - a);
    return d > 180 ? d - 360 : d;
  }

  function create(opts) {
    opts = opts || {};
    var total = Math.max(4, opts.sectors || 24);
    var step = 360 / total;
    var offset = opts.offset || 0;          // ângulo inicial: o setor 0 é onde a captura começou
    var minScore = opts.minScore == null ? 0.42 : opts.minScore;
    var sectors = [];
    for (var i = 0; i < total; i++) {
      sectors.push({ id: i, targetAngle: norm(offset + i * step), status: 'pending', bestFrameId: null, qualityScore: 0, attempts: 0 });
    }

    // Índice do setor que contém um ângulo absoluto.
    function indexFor(angle) {
      return Math.floor(norm(angle - offset + step / 2) / step) % total;
    }

    // Oferece um quadro analisado a um ângulo. `frame` = { id, ok, score }.
    // Devolve o que mudou, para a interface animar só o necessário.
    function offer(angle, frame) {
      var s = sectors[indexFor(angle)];
      var before = s.status;
      if (!frame || !frame.ok || frame.score < minScore) {
        s.attempts += 1;
        if (s.status === 'pending') s.status = 'candidate';
        if (s.status === 'candidate' && s.attempts >= RETRY_AFTER) s.status = 'retry';
        return { sector: s, changed: s.status !== before, accepted: false, upgraded: false };
      }
      if (s.status === 'accepted') {
        if (frame.score > s.qualityScore + UPGRADE_MARGIN) {
          var dropped = s.bestFrameId;
          s.bestFrameId = frame.id; s.qualityScore = frame.score;
          return { sector: s, changed: false, accepted: false, upgraded: true, dropped: dropped };
        }
        return { sector: s, changed: false, accepted: false, upgraded: false };
      }
      s.status = 'accepted'; s.bestFrameId = frame.id; s.qualityScore = frame.score; s.attempts = 0;
      return { sector: s, changed: true, accepted: true, upgraded: false };
    }

    function accepted() { return sectors.filter(function (s) { return s.status === 'accepted'; }); }
    function gaps() { return sectors.filter(function (s) { return s.status !== 'accepted'; }); }

    // Setor faltante mais próximo do ângulo atual, com a direção para chegar nele.
    function nearestGap(angle) {
      var open = gaps();
      if (!open.length) return null;
      var best = null, bestAbs = 999;
      for (var i = 0; i < open.length; i++) {
        var d = delta(angle, open[i].targetAngle);
        if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = { sector: open[i], delta: d }; }
      }
      best.direction = best.delta >= 0 ? 'right' : 'left';
      return best;
    }

    function stats() {
      var ok = accepted().length;
      return {
        total: total, accepted: ok, remaining: total - ok,
        progress: ok / total,
        complete: ok === total,
        retry: sectors.filter(function (s) { return s.status === 'retry'; }).length,
        frameIds: accepted().map(function (s) { return s.bestFrameId; }),
      };
    }

    return {
      sectors: sectors, total: total, step: step, offset: offset,
      indexFor: indexFor, offer: offer, accepted: accepted, gaps: gaps,
      nearestGap: nearestGap, stats: stats,
      // Quantos setores seguidos a partir do início já foram aceitos — só para a copy
      // ("Comece pela frente" → "Continue devagar") na primeira volta.
      streak: function () {
        var n = 0;
        for (var i = 0; i < total; i++) { if (sectors[i].status === 'accepted') n++; else break; }
        return n;
      },
    };
  }

  return { create: create, delta: delta, norm: norm, RETRY_AFTER: RETRY_AFTER };
})();
