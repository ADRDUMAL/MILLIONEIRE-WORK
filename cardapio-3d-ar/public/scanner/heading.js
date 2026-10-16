// Forma 3D · Scanner guiado — de onde vem o ângulo da órbita (Fase 6).
//
// A especificação é explícita: o giroscópio sozinho NÃO prova que alguém andou ao redor do produto.
// Girar o telefone parado muda a orientação exatamente como dar uma volta. Por isso este módulo
// trabalha com duas fontes e nunca confia em uma só:
//
//   1. sensor  — DeviceOrientation (bússola/alpha). Dá o ângulo absoluto, mas não distingue órbita
//                de rotação no eixo.
//   2. visual  — fluxo horizontal do fundo, e a divergência entre fundo e ROI (`orbitness` em
//                quality.js). É o que confirma que o produto ficou parado enquanto o mundo varria.
//
// O ângulo só avança quando as duas concordam. Sem sensor (iOS sem permissão, navegador antigo,
// aparelho sem bússola) o módulo cai para o modo `visual`: integra o fluxo do fundo, calibrado pelo
// tamanho da amostra. Nesse modo o ângulo é uma ESTIMATIVA — a interface diz isso ao usuário.
window.FormaScanHeading = (function () {
  'use strict';

  var norm = function (a) { a = a % 360; return a < 0 ? a + 360 : a; };

  function supported() {
    return typeof window.DeviceOrientationEvent !== 'undefined';
  }
  // iOS 13+ exige permissão pedida dentro de um gesto do usuário; os demais não têm esse portão.
  function needsPermission() {
    return supported() && typeof window.DeviceOrientationEvent.requestPermission === 'function';
  }

  function create(opts) {
    opts = opts || {};
    var state = {
      mode: 'visual',        // 'sensor' assim que um evento útil chegar
      raw: null,             // último heading bruto do sensor (0..360)
      base: null,            // heading no instante em que a captura começou
      angle: 0,              // ângulo estimado da órbita, contínuo (pode passar de 360)
      lastSensorAt: 0,
      orbitness: 0,          // média móvel: 1 = orbitando de verdade, 0 = girando no lugar
      flowAccum: 0,          // pixels de fundo integrados (modo visual)
      pxPerTurn: opts.pxPerTurn || 0, // calibração do modo visual (definida em start())
      direction: 0,          // -1 / 0 / +1: sentido dominante da caminhada
      listening: false,
    };

    // Safari dá a bússola pronta em webkitCompassHeading; os demais usam alpha (0 = norte, cresce
    // no sentido anti-horário) — invertemos para que os dois cresçam no mesmo sentido.
    function headingFrom(e) {
      if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) return norm(e.webkitCompassHeading);
      if (typeof e.alpha === 'number' && !isNaN(e.alpha)) return norm(360 - e.alpha);
      return null;
    }

    function onOrientation(e) {
      var hd = headingFrom(e);
      if (hd == null) return;
      state.raw = hd;
      state.lastSensorAt = Date.now();
      if (state.mode !== 'sensor') { state.mode = 'sensor'; state.base = null; }
    }

    function request() {
      if (!supported()) return Promise.resolve(false);
      if (!needsPermission()) return Promise.resolve(true);
      // Precisa acontecer dentro do gesto que abriu a câmera; quem chama garante isso.
      return window.DeviceOrientationEvent.requestPermission()
        .then(function (r) { return r === 'granted'; })
        .catch(function () { return false; });
    }

    function listen() {
      if (state.listening || !supported()) return false;
      window.addEventListener('deviceorientationabsolute', onOrientation, true);
      window.addEventListener('deviceorientation', onOrientation, true);
      state.listening = true;
      return true;
    }
    function stop() {
      if (!state.listening) return;
      window.removeEventListener('deviceorientationabsolute', onOrientation, true);
      window.removeEventListener('deviceorientation', onOrientation, true);
      state.listening = false;
    }

    // Zera o ponto de partida: o setor 0 do anel é sempre "onde o usuário começou".
    function start(sampleWidth) {
      state.base = state.raw;
      state.angle = 0;
      state.flowAccum = 0;
      state.direction = 0;
      // Modo visual: quanto de fundo precisa varrer para uma volta. Com câmera de celular a ~1 m,
      // uma volta completa varre da ordem de 9 larguras de quadro. É uma estimativa declarada.
      state.pxPerTurn = opts.pxPerTurn || (sampleWidth || 160) * 9;
    }

    // Chamado a cada amostra analisada. `flow` vem de FormaScanQuality.flowSplit().
    // `subjectOk` diz se o produto continuava enquadrado — sem isso nada avança.
    function update(flow, subjectOk) {
      var orb = flow ? flow.orbitness : 0;
      state.orbitness = state.orbitness * 0.7 + orb * 0.3;

      var sensorFresh = state.mode === 'sensor' && Date.now() - state.lastSensorAt < 1500;
      if (sensorFresh && state.raw != null) {
        if (state.base == null) state.base = state.raw;
        var target = norm(state.raw - state.base);
        // Desenrola para um ângulo contínuo (evita o salto 359 → 0 no meio da volta).
        var turns = Math.round((state.angle - target) / 360);
        var unwrapped = target + turns * 360;
        // O ângulo do sensor só é adotado quando o visual confirma órbita e o produto está enquadrado.
        if (subjectOk && state.orbitness > 0.25) state.angle = unwrapped;
        else state.angle = state.angle; // congela: girar o telefone parado não preenche o anel
      } else {
        state.mode = 'visual';
        if (subjectOk && flow && flow.confidence > 0.12 && state.orbitness > 0.25) {
          state.flowAccum += flow.outside.dx;
          state.angle = (state.flowAccum / state.pxPerTurn) * 360;
        }
      }
      if (flow && Math.abs(flow.outside.dx) > 1) state.direction = flow.outside.dx > 0 ? 1 : -1;
      return state.angle;
    }

    return {
      request: request, listen: listen, stop: stop, start: start, update: update,
      supported: supported, needsPermission: needsPermission,
      get mode() { return state.mode; },
      get angle() { return state.angle; },
      get orbitness() { return state.orbitness; },
      get direction() { return state.direction; },
      get hasSensor() { return state.mode === 'sensor' && Date.now() - state.lastSensorAt < 3000; },
      // Só para a tela de revisão e para os testes.
      debug: function () { return { mode: state.mode, angle: state.angle, orbitness: state.orbitness, raw: state.raw, base: state.base, flowAccum: state.flowAccum }; },
    };
  }

  return { create: create, supported: supported, needsPermission: needsPermission, norm: norm };
})();
