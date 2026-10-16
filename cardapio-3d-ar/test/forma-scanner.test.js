// Forma 3D · Fases 5 e 6 — o que sustenta a promessa do scanner, testado sem navegador.
//
// Os módulos quality.js, coverage.js e heading.js são funções puras sobre arrays: carregamos cada
// um em um contexto de VM com um `window` falso e exercitamos as decisões que a interface mostra.
// O critério de aceite da especificação ("o progresso não pode ser por tempo", "girar o telefone
// parado não conta", "o usuário corrige só os gaps") vira asserção aqui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const PUB = path.resolve(import.meta.dirname, '../public/scanner');

function loadScanner() {
  const sandbox = { window: {}, performance, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['quality.js', 'coverage.js', 'heading.js']) {
    vm.runInContext(fs.readFileSync(path.join(PUB, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.window;
}
const { FormaScanQuality: Q, FormaScanCoverage: Cov, FormaScanHeading: Heading } = loadScanner();

// ---------- Cenas sintéticas ----------
// Fundo com textura não periódica (para o casamento por SAD ter um mínimo único) e um objeto
// texturizado no centro. `bgShift` e `objShift` movem cada um independentemente.
const W = 160, H = 90;
const ROI = { x: 0.3, y: 0.2, w: 0.4, h: 0.6 };

function prng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) % 100000) / 100000; }
const BG = (() => { const r = prng(7), a = new Float32Array(W * 3); for (let i = 0; i < a.length; i++) a[i] = 30 + r() * 170; return a; })();
const OBJ = (() => { const r = prng(91), a = new Float32Array(W * 3); for (let i = 0; i < a.length; i++) a[i] = 40 + r() * 180; return a; })();

function scene({ bgShift = 0, objShift = 0, level = 1, blur = 0, flat = false } = {}) {
  const g = new Float32Array(W * H);
  const b = Q.roiBox(W, H, ROI);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inRoi = x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
      let v;
      if (flat) v = 128;
      else if (inRoi) v = OBJ[(x - objShift + W) % OBJ.length] * 0.6 + OBJ[(y * 3 + 11) % OBJ.length] * 0.4;
      else v = BG[(x - bgShift + W) % BG.length] * 0.6 + BG[(y * 5 + 3) % BG.length] * 0.4;
      g[y * W + x] = Math.max(0, Math.min(255, v * level));
    }
  }
  if (blur > 0) {
    for (let pass = 0; pass < blur; pass++) {
      const c = Float32Array.from(g);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        g[i] = (c[i] + c[i - 1] + c[i + 1] + c[i - W] + c[i + W]) / 5;
      }
    }
  }
  return g;
}

// ---------- Qualidade ----------
test('nitidez: a variância do laplaciano cai quando o quadro borra, e o corte é relativo à sessão', () => {
  const nitido = Q.sharpness(scene(), W, H, ROI);
  const borrado = Q.sharpness(scene({ blur: 6 }), W, H, ROI);
  assert.ok(borrado < nitido / 3, `borrado (${borrado.toFixed(1)}) deveria ser bem menor que nítido (${nitido.toFixed(1)})`);
  // O critério não é um número absoluto (que muda com lente, luz e resolução) e sim uma fração da
  // melhor nitidez já vista na captura.
  assert.ok(borrado < nitido * Q.T.sharpRatio, 'o quadro borrado tem de cair abaixo do piso relativo');
  assert.ok(nitido >= nitido * Q.T.sharpRatio, 'o próprio quadro de referência tem de passar');
});

test('exposição: escuro e estourado são detectados dentro da ROI', () => {
  assert.equal(Q.exposure(scene({ level: 0.25 }), W, H, ROI).dark, true);
  assert.equal(Q.exposure(scene({ level: 2.4 }), W, H, ROI).bright, true);
  const bom = Q.exposure(scene(), W, H, ROI);
  assert.equal(bom.dark, false);
  assert.equal(bom.bright, false);
});

test('velocidade: movimento rápido demais derruba a sobreposição e é recusado', () => {
  const a = scene();
  const base = Q.subject(a, W, H, ROI), ref = Q.sharpness(a, W, H, ROI);
  const evalAt = (d) => {
    const g = scene({ bgShift: d });
    return Q.evaluate(g, W, H, { roi: ROI, baseline: base, sharpRef: ref, flow: Q.flowSplit(a, g, W, H, ROI) });
  };
  const lento = evalAt(5);
  assert.ok(lento.speed < Q.T.speedMax, `passo lento marcado como rápido (${lento.speed.toFixed(3)})`);
  assert.ok(!lento.reasons.includes('motion'));
  // 19 px em 160 = 12% da largura por amostra; acima de speedMax a sobreposição cai demais.
  const rapido = evalAt(19);
  assert.ok(rapido.speed > lento.speed, 'a velocidade medida tem de crescer com o deslocamento');
});

test('fluxo: o deslocamento horizontal medido bate com o real', () => {
  const a = scene();
  for (const d of [3, -5, 8]) {
    const f = Q.flowX(a, scene({ bgShift: d, objShift: d }), W, H, null);
    assert.equal(f.dx, d, `deslocamento ${d} medido como ${f.dx}`);
    assert.ok(f.confidence > 0.2, `confiança baixa demais (${f.confidence.toFixed(2)})`);
  }
});

test('orbitar x girar parado: só a órbita real faz o ângulo andar (§6)', () => {
  const a = scene();
  // Andar ao redor: o fundo varre, o produto fica no lugar.
  const orbita = Q.flowSplit(a, scene({ bgShift: 6, objShift: 0 }), W, H, ROI);
  // Girar o telefone no eixo: produto e fundo varrem juntos.
  const giro = Q.flowSplit(a, scene({ bgShift: 6, objShift: 6 }), W, H, ROI);
  assert.ok(orbita.orbitness > 0.6, `órbita deveria pontuar alto, deu ${orbita.orbitness.toFixed(2)}`);
  assert.ok(giro.orbitness < 0.25, `giro no eixo deveria pontuar baixo, deu ${giro.orbitness.toFixed(2)}`);
});

test('avaliação: quadro bom passa; borrado, escuro e repetido não', () => {
  const cal = scene();                                  // quadro da calibração
  const baseline = Q.subject(cal, W, H, ROI);
  const sharpRef = Q.sharpness(cal, W, H, ROI);
  const check = (g) => Q.evaluate(g, W, H, { roi: ROI, baseline, sharpRef, prevKey: cal, flow: Q.flowSplit(cal, g, W, H, ROI) });

  const bom = check(scene({ bgShift: 5 }));
  assert.equal(bom.ok, true, 'quadro válido recusado: ' + bom.reasons.join(','));
  assert.ok(bom.score > 0, 'score precisa ser contínuo para escolher o melhor de cada setor');

  const borrado = check(scene({ bgShift: 5, blur: 6 }));
  assert.equal(borrado.ok, false);
  assert.ok(borrado.reasons.includes('blur'), borrado.reasons.join(','));

  const escuro = check(scene({ bgShift: 5, level: 0.22 }));
  assert.equal(escuro.ok, false);
  assert.ok(escuro.reasons.includes('dark'), escuro.reasons.join(','));

  const estourado = check(scene({ bgShift: 5, level: 2.4 }));
  assert.equal(estourado.ok, false);
  assert.ok(estourado.reasons.includes('bright'), estourado.reasons.join(','));

  const igual = check(cal);
  assert.equal(igual.ok, false, 'um quadro idêntico ao keyframe anterior não pode ser aceito');
  assert.ok(igual.reasons.includes('same'), igual.reasons.join(','));
});

test('enquadramento é julgado contra a calibração, não contra um número fixo', () => {
  const cal = scene();
  const baseline = Q.subject(cal, W, H, ROI);
  const sharpRef = Q.sharpness(cal, W, H, ROI);
  // O produto sai da ROI: sobra só fundo liso dentro dela.
  const vazio = new Float32Array(W * H);
  const b = Q.roiBox(W, H, ROI);
  const cheio = scene();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inR = x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
    vazio[y * W + x] = inR ? 128 : cheio[y * W + x];
  }
  const ev = Q.evaluate(vazio, W, H, { roi: ROI, baseline, sharpRef });
  assert.equal(ev.ok, false);
  assert.ok(ev.framing < Q.T.framingMin, `framing relativo deveria despencar, deu ${ev.framing.toFixed(2)}`);
  assert.ok(ev.reasons.includes('subject'), ev.reasons.join(','));
});

// ---------- Cobertura ----------
test('o progresso é setores aceitos ÷ total — nunca tempo decorrido (§3, §28)', () => {
  const cov = Cov.create({ sectors: 24 });
  assert.equal(cov.stats().progress, 0);
  // Meia volta coberta: 12 de 24, independentemente de quanto tempo levou.
  for (let i = 0; i < 12; i++) cov.offer(i * 15, { id: 'f' + i, ok: true, score: 0.8 });
  const st = cov.stats();
  assert.equal(st.accepted, 12);
  assert.equal(st.progress, 0.5);
  assert.equal(st.complete, false);
  assert.deepEqual([...st.frameIds], Array.from({ length: 12 }, (_, i) => 'f' + i));
});

test('o anel não fica verde sem quadro válido: recusas viram candidate e depois retry', () => {
  const cov = Cov.create({ sectors: 24 });
  for (let i = 0; i < Cov.RETRY_AFTER - 1; i++) cov.offer(0, { ok: false });
  assert.equal(cov.sectors[0].status, 'candidate');
  cov.offer(0, { ok: false });
  assert.equal(cov.sectors[0].status, 'retry', 'tentativas demais precisam pedir repetição');
  assert.equal(cov.stats().accepted, 0);
  // Um quadro bom resolve o setor marcado para repetir.
  cov.offer(0, { id: 'bom', ok: true, score: 0.9 });
  assert.equal(cov.sectors[0].status, 'accepted');
  assert.equal(cov.sectors[0].bestFrameId, 'bom');
});

test('score baixo não é aceito e um quadro melhor substitui o guardado', () => {
  const cov = Cov.create({ sectors: 12, minScore: 0.5 });
  assert.equal(cov.offer(0, { id: 'fraco', ok: true, score: 0.3 }).accepted, false);
  assert.equal(cov.offer(0, { id: 'ok', ok: true, score: 0.6 }).accepted, true);
  const igual = cov.offer(0, { id: 'parecido', ok: true, score: 0.62 });
  assert.equal(igual.upgraded, false, 'diferença irrelevante não deve trocar o quadro');
  const melhor = cov.offer(0, { id: 'otimo', ok: true, score: 0.95 });
  assert.equal(melhor.upgraded, true);
  assert.equal(melhor.dropped, 'ok', 'o quadro substituído precisa ser liberado da memória');
  assert.equal(cov.sectors[0].bestFrameId, 'otimo');
});

test('correção de gaps: aponta o setor faltante mais próximo e a direção de volta (§8)', () => {
  const cov = Cov.create({ sectors: 24 });
  for (let i = 0; i < 24; i++) if (i !== 5 && i !== 6) cov.offer(i * 15, { id: 'f' + i, ok: true, score: 0.8 });
  const st = cov.stats();
  assert.equal(st.remaining, 2);
  assert.equal(st.complete, false);
  // Estando em 120°, o gap em 75°/90° está para trás.
  const gap = cov.nearestGap(120);
  assert.equal(gap.sector.id, 6);
  assert.equal(gap.direction, 'left');
  // Estando em 30°, está à frente.
  assert.equal(cov.nearestGap(30).direction, 'right');
  // Fechar só os gaps completa a cobertura: nada é reiniciado.
  cov.offer(75, { id: 'f5', ok: true, score: 0.8 });
  cov.offer(90, { id: 'f6', ok: true, score: 0.8 });
  assert.equal(cov.stats().complete, true);
  assert.equal(cov.stats().accepted, 24);
});

// ---------- Ângulo ----------
test('sem sensores o ângulo é estimado pela imagem, e só quando há órbita de verdade', () => {
  const h = Heading.create({});
  h.start(W);
  assert.equal(h.mode, 'visual', 'sem DeviceOrientationEvent o modo tem de ser visual');

  // Girar o telefone parado: fundo varre, produto varre junto → nada avança.
  const giro = { outside: { dx: 8, confidence: 0.8 }, inside: { dx: 8, confidence: 0.8 }, orbitness: 0.02, confidence: 0.8 };
  for (let i = 0; i < 10; i++) h.update(giro, true);
  assert.equal(h.angle, 0, 'rotação no eixo não pode preencher o anel');

  // Andar ao redor: o ângulo passa a crescer.
  const orbita = { outside: { dx: 8, confidence: 0.8 }, inside: { dx: 0, confidence: 0.8 }, orbitness: 1, confidence: 0.8 };
  for (let i = 0; i < 10; i++) h.update(orbita, true);
  assert.ok(h.angle > 0, 'órbita real precisa avançar o ângulo');
  assert.equal(h.direction, 1);
});

test('produto fora do enquadramento congela o ângulo', () => {
  const h = Heading.create({});
  h.start(W);
  const orbita = { outside: { dx: 8, confidence: 0.8 }, inside: { dx: 0, confidence: 0.8 }, orbitness: 1, confidence: 0.8 };
  for (let i = 0; i < 5; i++) h.update(orbita, false); // subjectOk = false
  assert.equal(h.angle, 0);
  h.update(orbita, true);
  assert.ok(h.angle > 0);
});

test('uma volta inteira de órbita cobre os 360° estimados', () => {
  const h = Heading.create({});
  h.start(W);
  const passo = { outside: { dx: 10, confidence: 0.8 }, inside: { dx: 0, confidence: 0.8 }, orbitness: 1, confidence: 0.8 };
  // pxPerTurn = 160 * 9 = 1440 → 144 passos de 10 px fecham a volta.
  for (let i = 0; i < 144; i++) h.update(passo, true);
  assert.ok(h.angle >= 355 && h.angle <= 365, `volta estimada em ${h.angle.toFixed(1)}°`);
});
