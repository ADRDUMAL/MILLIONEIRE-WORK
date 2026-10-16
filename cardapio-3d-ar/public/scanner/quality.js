// Forma 3D · Scanner guiado — métricas de qualidade de um quadro (Fase 5).
//
// Tudo aqui é função pura sobre um Float32Array de luminância (0..255) de uma amostra reduzida do
// quadro: sem DOM, sem estado, sem canvas. Por isso roda igual no navegador e no Node (test/), e
// pode ir para um Web Worker sem alterar uma linha caso a análise passe a pesar.
//
// A ROI é um retângulo normalizado { x, y, w, h } em 0..1, vindo da etapa de calibração.
// Nenhuma métrica aqui "reconhece" o produto: elas medem nitidez, exposição, presença de detalhe
// dentro da ROI e diferença entre quadros. É o suficiente para recusar quadros ruins sem prometer
// visão computacional que o navegador não entrega.
window.FormaScanQuality = (function () {
  'use strict';

  // Limiares em um objeto só: a interface mostra os mesmos números que a decisão usa.
  //
  // Quase tudo aqui é RELATIVO, de propósito. Valores absolutos de nitidez e de densidade de bordas
  // variam com o aparelho, a lente, a resolução e o ambiente — um limiar fixo ou reprova tudo em
  // uma sala escura ou aprova tudo num fundo liso. As referências são duas:
  //   · a calibração  — como o produto estava quando o usuário confirmou o enquadramento;
  //   · a sessão      — a melhor nitidez já vista nesta captura.
  var T = {
    sharpMin: 4,          // piso absoluto: abaixo disso o quadro está chapado, sem referência possível
    sharpRatio: 0.45,     // e precisa ter ao menos 45% da melhor nitidez vista na sessão
    darkMax: 52,          // luminância média mínima dentro da ROI
    brightMin: 218,       // luminância média máxima (estourado)
    clippedMax: 0.22,     // fração de pixels grudados em 0 ou 255
    speedMax: 0.22,       // |fluxo do fundo| ÷ largura por amostra. Acima disso a sobreposição entre
                          // quadros vizinhos cai abaixo dos ~65% que a reconstrução precisa (§5.6).
    framingMin: 0.55,     // detalhe na ROI ÷ detalhe na calibração (abaixo: o produto saiu do quadro)
    spreadLow: 0.68,      // tamanho relativo ao da calibração (abaixo: afastou demais)
    spreadHigh: 1.45,     // acima: aproximou demais e provavelmente está cortando o produto
    offsetMax: 0.22,      // distância do centro do detalhe ao centro da ROI, em larguras de ROI
    noveltyMin: 0.055,    // diferença mínima em relação ao último keyframe aceito (evita repetidos)
    noveltyMax: 0.42,     // acima disso a perspectiva pulou: sobreposição insuficiente
  };

  // ---------- Luminância ----------
  // rgba: Uint8ClampedArray de getImageData. Devolve Float32Array de w*h (BT.601).
  function luma(rgba, w, h) {
    var n = w * h, g = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var p = i * 4;
      g[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
    return g;
  }

  // Converte a ROI normalizada em índices inteiros da amostra reduzida.
  function roiBox(w, h, roi) {
    var r = roi || { x: 0.14, y: 0.14, w: 0.72, h: 0.72 };
    var x0 = Math.max(1, Math.round(r.x * w)), y0 = Math.max(1, Math.round(r.y * h));
    var x1 = Math.min(w - 2, Math.round((r.x + r.w) * w)), y1 = Math.min(h - 2, Math.round((r.y + r.h) * h));
    if (x1 <= x0) { x0 = 1; x1 = w - 2; }
    if (y1 <= y0) { y0 = 1; y1 = h - 2; }
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  // ---------- Nitidez: variância do laplaciano dentro da ROI ----------
  // Borrão de movimento e foco perdido derrubam a variância; é a métrica clássica e é barata.
  function sharpness(g, w, h, roi) {
    var b = roiBox(w, h, roi), sum = 0, sq = 0, n = 0;
    for (var y = b.y0; y <= b.y1; y++) {
      for (var x = b.x0; x <= b.x1; x++) {
        var i = y * w + x;
        var lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        sum += lap; sq += lap * lap; n++;
      }
    }
    if (!n) return 0;
    var mean = sum / n;
    return sq / n - mean * mean;
  }

  // ---------- Exposição dentro da ROI ----------
  function exposure(g, w, h, roi) {
    var b = roiBox(w, h, roi), sum = 0, n = 0, clipped = 0;
    for (var y = b.y0; y <= b.y1; y++) {
      for (var x = b.x0; x <= b.x1; x++) {
        var v = g[y * w + x];
        sum += v; n++;
        if (v <= 4 || v >= 251) clipped++;
      }
    }
    var mean = n ? sum / n : 0;
    return { mean: mean, clipped: n ? clipped / n : 0, dark: mean < T.darkMax, bright: mean > T.brightMin };
  }

  // ---------- Movimento entre duas amostras consecutivas ----------
  // Fração de pixels cujo brilho mudou muito. Um giro lento muda poucos; um solavanco muda quase todos.
  function motion(prev, g) {
    if (!prev || prev.length !== g.length) return { changed: 0, mad: 0 };
    var changed = 0, sum = 0;
    for (var i = 0; i < g.length; i++) {
      var d = Math.abs(g[i] - prev[i]);
      sum += d;
      if (d > 20) changed++;
    }
    return { changed: changed / g.length, mad: sum / g.length };
  }

  // ---------- Deslocamento horizontal aparente (fluxo) ----------
  // Busca por SAD o deslocamento em x que melhor alinha uma região do quadro anterior ao atual.
  // `cols` é uma lista de faixas [x0, x1] a considerar (permite medir só o fundo, só a ROI, etc.).
  // Devolve { dx, confidence }: dx em pixels da amostra reduzida; o sinal indica a direção.
  function flowX(prev, g, w, h, cols, maxShift) {
    if (!prev || prev.length !== g.length) return { dx: 0, confidence: 0 };
    var max = maxShift || Math.max(2, Math.round(w * 0.12));
    var y0 = Math.round(h * 0.25), y1 = Math.round(h * 0.75);
    var ranges = cols && cols.length ? cols : [[max, w - max]];
    var best = 0, bestCost = Infinity, worstCost = 0;
    for (var s = -max; s <= max; s++) {
      var cost = 0, n = 0;
      for (var y = y0; y < y1; y += 2) {
        var row = y * w;
        for (var r = 0; r < ranges.length; r++) {
          var a = Math.max(max, ranges[r][0]), b = Math.min(w - max, ranges[r][1]);
          for (var x = a; x < b; x += 2) { cost += Math.abs(g[row + x] - prev[row + x - s]); n++; }
        }
      }
      if (!n) continue;
      cost /= n;
      if (cost < bestCost) { bestCost = cost; best = s; }
      if (cost > worstCost) worstCost = cost;
    }
    // Confiança: o quanto o melhor alinhamento se destaca do pior. Cena lisa (parede) → perto de 0.
    var confidence = worstCost > 0 && isFinite(bestCost) ? Math.max(0, Math.min(1, (worstCost - bestCost) / worstCost)) : 0;
    return { dx: best, confidence: confidence };
  }

  // ---------- Orbitar x girar parado ----------
  // É AQUI que o scanner separa "andei ao redor do produto" de "girei o telefone no lugar",
  // sem depender do giroscópio (§6 da especificação).
  //
  //   girar parado → o produto varre o quadro JUNTO com o fundo: os dois fluxos batem.
  //   orbitar      → o produto fica parado no centro enquanto o fundo varre: os fluxos divergem.
  //
  // `orbitness` perto de 1 = órbita real; perto de 0 = rotação no eixo (ou nada se movendo).
  function flowSplit(prev, g, w, h, roi) {
    var b = roiBox(w, h, roi);
    var outside = flowX(prev, g, w, h, [[0, b.x0], [b.x1, w]]);
    var inside = flowX(prev, g, w, h, [[b.x0, b.x1]]);
    var mag = Math.abs(outside.dx);
    var orbitness = mag < 1 ? 0 : Math.max(0, Math.min(1, (mag - Math.abs(inside.dx)) / mag));
    return { inside: inside, outside: outside, orbitness: orbitness, confidence: Math.min(outside.confidence, 1) };
  }

  // ---------- Presença do objeto dentro da ROI ----------
  // Densidade de bordas (|dx| + |dy|) dentro da ROI comparada à de fora, mais o centro e a extensão
  // desse detalhe. É o que diz "o objeto continua enquadrado, centralizado e do mesmo tamanho".
  function subject(g, w, h, roi) {
    var b = roiBox(w, h, roi);
    var inSum = 0, inN = 0, outSum = 0, outN = 0;
    var mx = 0, my = 0, mw = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var e = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + w] - g[i - w]);
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) {
          inSum += e; inN++;
          mx += x * e; my += y * e; mw += e;
        } else { outSum += e; outN++; }
      }
    }
    var inside = inN ? inSum / inN : 0;
    var outside = outN ? outSum / outN : 0;
    var cx = mw ? mx / mw : (b.x0 + b.x1) / 2;
    var cy = mw ? my / mw : (b.y0 + b.y1) / 2;
    // Extensão: desvio médio do detalhe em relação ao próprio centro, em larguras de ROI.
    var roiW = b.x1 - b.x0 || 1, roiH = b.y1 - b.y0 || 1, spreadSum = 0;
    for (var yy = b.y0; yy <= b.y1; yy++) {
      for (var xx = b.x0; xx <= b.x1; xx++) {
        var j = yy * w + xx;
        var ee = Math.abs(g[j + 1] - g[j - 1]) + Math.abs(g[j + w] - g[j - w]);
        spreadSum += ee * Math.sqrt(((xx - cx) / roiW) * ((xx - cx) / roiW) + ((yy - cy) / roiH) * ((yy - cy) / roiH));
      }
    }
    var spread = mw ? spreadSum / mw : 0;
    var offset = Math.sqrt(
      ((cx - (b.x0 + b.x1) / 2) / roiW) * ((cx - (b.x0 + b.x1) / 2) / roiW) +
      ((cy - (b.y0 + b.y1) / 2) / roiH) * ((cy - (b.y0 + b.y1) / 2) / roiH)
    );
    return {
      inside: inside, outside: outside,
      ratio: outside > 0.5 ? inside / outside : (inside > 1 ? 3 : 0),
      offset: offset, spread: spread,
    };
  }

  // ---------- Novidade em relação a um keyframe já aceito ----------
  // Diferença média normalizada. Perto de 0 = quadro praticamente igual (descartar);
  // muito alto = a perspectiva pulou e a sobreposição entre fotos vizinhas ficou insuficiente.
  function novelty(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    var sum = 0;
    for (var i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return Math.min(1, sum / a.length / 96);
  }

  // ---------- Decisão ----------
  // Devolve o qualityScore (0..1), se o quadro serve, e a dica curta que a HUD mostra.
  //   opts.roi       região de interesse definida na calibração
  //   opts.baseline  subject() medido quando o usuário confirmou o enquadramento
  //   opts.flow      flowSplit() desta amostra (velocidade e órbita)
  //   opts.sharpRef  melhor nitidez já vista nesta captura
  //   opts.prevKey   luminância do último keyframe aceito
  function evaluate(g, w, h, opts) {
    opts = opts || {};
    var roi = opts.roi, base = opts.baseline || null;
    var sh = sharpness(g, w, h, roi);
    var ex = exposure(g, w, h, roi);
    var su = subject(g, w, h, roi);
    var nv = opts.prevKey ? novelty(opts.prevKey, g) : 1;
    var speed = opts.flow && opts.flow.outside ? Math.abs(opts.flow.outside.dx) / w : 0;
    var sharpFloor = Math.max(T.sharpMin, (opts.sharpRef || 0) * T.sharpRatio);
    var framing = base && base.ratio > 0 ? su.ratio / base.ratio : 1;
    var sizeRel = base && base.spread > 0 ? su.spread / base.spread : 1;

    var reasons = [], hint = '';
    // Ordem importa: a dica mostrada é a do primeiro problema, do mais grosseiro ao mais fino.
    if (speed > T.speedMax) { reasons.push('motion'); hint = 'Muito rápido'; }
    else if (framing < T.framingMin) { reasons.push('subject'); hint = 'Mantenha o produto centralizado'; }
    else if (su.offset > T.offsetMax) { reasons.push('offset'); hint = 'Mantenha o produto centralizado'; }
    else if (sizeRel < T.spreadLow) { reasons.push('far'); hint = 'Aproxime um pouco'; }
    else if (sizeRel > T.spreadHigh) { reasons.push('near'); hint = 'Afaste um pouco'; }
    else if (ex.dark) { reasons.push('dark'); hint = 'Pouca luz — ilumine o produto'; }
    else if (ex.bright || ex.clipped > T.clippedMax) { reasons.push('bright'); hint = 'Luz estourada — reduza o reflexo'; }
    else if (sh < sharpFloor) { reasons.push('blur'); hint = 'Imagem borrada — vá mais devagar'; }
    else if (opts.prevKey && nv < T.noveltyMin) { reasons.push('same'); hint = 'Continue andando ao redor'; }
    else if (opts.prevKey && nv > T.noveltyMax) { reasons.push('jump'); hint = 'Volte um pouco — pulou um trecho'; }

    // Score contínuo: usado para escolher o MELHOR quadro de cada setor, não só o primeiro válido.
    var sharpScore = opts.sharpRef ? Math.max(0, Math.min(1, sh / opts.sharpRef)) : 1;
    var expScore = Math.max(0, 1 - Math.min(1, Math.abs(ex.mean - 135) / 110) - Math.min(0.4, ex.clipped));
    var frameScore = Math.max(0, Math.min(1, framing));
    var steadyScore = Math.max(0, 1 - speed / T.speedMax);
    var centerScore = Math.max(0, 1 - su.offset / T.offsetMax);
    var score = Math.max(0, Math.min(1,
      0.34 * sharpScore + 0.20 * expScore + 0.20 * frameScore + 0.14 * steadyScore + 0.12 * centerScore));

    return {
      ok: reasons.length === 0, score: score, hint: hint, reasons: reasons,
      sharpness: sh, exposure: ex, subject: su, novelty: nv, speed: speed, framing: framing, sizeRel: sizeRel,
    };
  }

  return {
    T: T, luma: luma, roiBox: roiBox, sharpness: sharpness, exposure: exposure,
    motion: motion, flowX: flowX, flowSplit: flowSplit, subject: subject, novelty: novelty, evaluate: evaluate,
  };
})();
