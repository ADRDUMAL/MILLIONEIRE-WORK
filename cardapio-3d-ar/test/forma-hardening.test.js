// Forma 3D · correções da auditoria de 16/10/2026 (scanner e pipeline de reconstrução).
// Cada teste aqui reproduz um defeito que existia antes da correção.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parseGlb, serializeGlb, analyzeGlb } from '../src/lib/glb.js';
import { kiriProvider, ProviderError } from '../src/forma/providers/kiri.js';
import { originOk } from '../src/auth.js';
import { fakeGlb } from './helpers.js';

const PUB = path.join(import.meta.dirname, '..', 'public');
function loadBrowser(files) {
  const sandbox = { window: {}, performance, console, WeakMap, Promise, Date, Math };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(PUB, file), 'utf8'), sandbox, { filename: file });
  return sandbox;
}

// ---------- Bússola: dois referenciais no Android (B1) ----------
test('bússola: eventos relativos são ignorados assim que chega um absoluto', () => {
  const w = loadBrowser(['scanner/quality.js', 'scanner/heading.js']);
  const h = w.FormaScanHeading.create({});
  h._feed({ type: 'deviceorientation', alpha: 100, beta: 80, absolute: false });
  assert.equal(h.debug().raw, 260, 'sem absoluto ainda, o relativo vale');
  h._feed({ type: 'deviceorientationabsolute', alpha: 10, beta: 80, absolute: true });
  assert.equal(h.debug().raw, 350);
  h._feed({ type: 'deviceorientation', alpha: 200, beta: 80, absolute: false }); // referencial arbitrário
  assert.equal(h.debug().raw, 350, 'o relativo não pode sobrescrever a bússola');
  assert.equal(h.absolute, true);
  assert.equal(h.pitch, 80, 'a inclinação (beta) é guardada para validar as voltas alta e baixa');
});

test('bússola do iOS sem calibração (accuracy < 0) é descartada', () => {
  const w = loadBrowser(['scanner/quality.js', 'scanner/heading.js']);
  const h = w.FormaScanHeading.create({});
  h._feed({ type: 'deviceorientation', webkitCompassHeading: 90, webkitCompassAccuracy: -1 });
  assert.equal(h.debug().raw, null);
  h._feed({ type: 'deviceorientation', webkitCompassHeading: 90, webkitCompassAccuracy: 10 });
  assert.equal(h.debug().raw, 90);
});

// ---------- Câmera: trava de exposição e troca de lente (B2) ----------
test('câmera: lockSupport só anuncia o que o aparelho expõe; lock fixa os valores atuais', async () => {
  const w = loadBrowser(['scanner/camera.js']);
  const Cam = w.FormaCamera;
  const applied = [];
  const track = {
    getCapabilities: () => ({ exposureMode: ['continuous', 'manual'], whiteBalanceMode: ['continuous'], focusMode: ['manual'] }),
    getSettings: () => ({ exposureTime: 250, colorTemperature: 5600, focusDistance: 0.8 }),
    applyConstraints: (c) => { applied.push(c); return Promise.resolve(); },
  };
  const plain = (v) => JSON.parse(JSON.stringify(v)); // objetos criados dentro da VM têm outro protótipo
  assert.deepEqual(plain(Cam.lockSupport(track)), { exposure: true, whiteBalance: false, focus: true, any: true });
  const st = await Cam.lock(track);
  assert.deepEqual(plain(st), { exposure: true, whiteBalance: false, focus: true });
  assert.deepEqual(plain(applied[0]), { advanced: [{ exposureMode: 'manual', exposureTime: 250, focusMode: 'manual', focusDistance: 0.8 }] });
  assert.deepEqual(plain(Cam.lockSupport({})), { exposure: false, whiteBalance: false, focus: false, any: false }, 'iOS: sem capabilities, sem trava');
});

test('câmera: trocar de lente abre a nova ANTES de fechar a atual; se falhar, a atual continua viva', async () => {
  const w = loadBrowser(['scanner/camera.js']);
  const stops = [];
  const mkTrack = (id) => ({ id, readyState: 'live', label: 'Back Camera', getSettings: () => ({ width: 1920, height: 1080, deviceId: id }), getCapabilities: () => ({}), applyConstraints: () => Promise.resolve(), stop() { this.readyState = 'ended'; stops.push(id); } });
  const mkStream = (id) => { const t = mkTrack(id); return { getVideoTracks: () => [t], getTracks: () => [t] }; };
  let calls = 0;
  w.navigator = { mediaDevices: {
    getUserMedia: (c) => { calls += 1; const id = c.video.deviceId ? c.video.deviceId.exact : 'cam-a'; if (id === 'broken') return Promise.reject(Object.assign(new Error('x'), { name: 'NotReadableError' })); return Promise.resolve(mkStream(id)); },
    enumerateDevices: () => Promise.resolve([{ kind: 'videoinput', deviceId: 'cam-a', label: 'Back Camera' }, { kind: 'videoinput', deviceId: 'broken', label: 'Back Telephoto Camera' }]),
  } };
  const s1 = await w.FormaCamera.open({ keepDefault: true });
  assert.equal(s1.deviceId, 'cam-a');
  await assert.rejects(s1.switchTo('broken'));
  assert.equal(s1.track.readyState, 'live', 'a sessão atual não pode ser fechada quando a nova falha');
  assert.deepEqual(stops, []);
  const s2 = await s1.switchTo('cam-a');
  assert.equal(s2.deviceId, 'cam-a');
  assert.deepEqual(stops, ['cam-a'], 'a antiga só fecha depois que a nova abriu');
  assert.ok(calls >= 3);
});

// ---------- GLB: cabeçalho e BIN coerentes ----------
test('GLB: cabeçalho truncado, BIN menor que o declarado e modelo sem malha são recusados', () => {
  const ok = fakeGlb();
  assert.equal(analyzeGlb(ok).meshes, 1);
  const truncated = Buffer.from(ok); truncated.writeUInt32LE(ok.length + 100, 8);
  assert.throws(() => parseGlb(truncated), /truncado/);
  const json = { asset: { version: '2.0' }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36 }] };
  assert.throws(() => parseGlb(serializeGlb(json, Buffer.alloc(4))), /BIN truncado/);
  assert.throws(() => parseGlb(serializeGlb({ asset: { version: '1.0' } }, null)), /Versão/);
  const empty = serializeGlb({ asset: { version: '2.0' }, meshes: [] }, null);
  assert.equal(analyzeGlb(empty).meshes, 0, 'o serviço de tarefas recusa meshes = 0');
});

// ---------- KIRI: status fora da tabela não é "processando" ----------
test('KIRI: status desconhecido ou ausente vira resposta inválida (transitória), nunca processing eterno', async () => {
  const mk = (data) => kiriProvider({ apiKey: 'k', baseUrl: 'http://x', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: 200, ok: true, data }) }) });
  for (const data of [{ status: 7 }, { status: 'abc' }, {}, { status: null }]) {
    await assert.rejects(mk(data).getJobStatus('ser'), (e) => e instanceof ProviderError && e.kind === 'invalid_response' && e.temporary === true);
  }
  assert.equal((await mk({ status: 2 }).getJobStatus('ser')).status, 'done');
});

test('KIRI: o download não segue redirecionamentos para hosts arbitrários', async () => {
  const p = kiriProvider({ apiKey: 'k', baseUrl: 'http://x', fetchImpl: async (url, init) => { assert.equal(init.redirect, 'manual'); return { ok: false, status: 302, headers: new Map() }; } });
  await assert.rejects(p.download('http://cdn/zip'), /redirecionou/);
});

// ---------- CSRF: a API JSON da Forma 3D exige o cabeçalho próprio ----------
test('originOk: Origin diferente do host é recusada; ausente é aceita', () => {
  assert.equal(originOk({ headers: { host: 'forma.local', origin: 'https://forma.local' } }), true);
  assert.equal(originOk({ headers: { host: 'forma.local', origin: 'https://evil.example' } }), false);
  assert.equal(originOk({ headers: { host: 'forma.local' } }), true);
  assert.equal(originOk({ headers: { 'x-forwarded-host': 'forma.local', host: 'interno', origin: 'https://forma.local' } }), true);
});

// ---------- Scanner guiado: contratos de qualidade no código servido ----------
test('scanner guiado: 24/16/12 setores, faixa de ângulos, disparo automático e trava de luz presentes', () => {
  const guided = fs.readFileSync(path.join(PUB, 'forma-guided.js'), 'utf8');
  assert.match(guided, /sectors: 24/); assert.match(guided, /sectors: 16/); assert.match(guided, /sectors: 12/);
  assert.match(guided, /data-gd-auto/); assert.match(guided, /data-gd-lock/); assert.match(guided, /gd-strip-row/); assert.match(guided, /gd-map/);
  assert.match(guided, /noveltyMax/, 'teto de novidade: pouca sobreposição é avisada');
  assert.match(guided, /photoSource/, 'uma só fonte de foto por sessão');
  assert.match(guided, /data-gd-discard/, 'descartar fotos pede confirmação');
  assert.doesNotMatch(guided, /lastKeyLuma = s\.luma;\s*\n\s*capture\(/, 'o keyframe só muda quando a foto é aceita');
  const pc = fs.readFileSync(path.join(PUB, 'scanner/photo-check.js'), 'utf8');
  assert.match(pc, /PASS_THROUGH/, 'HEIC/GIF são reencodados em JPEG antes do envio');
  const cap = fs.readFileSync(path.join(PUB, 'forma-capture.js'), 'utf8');
  assert.match(cap, /if \(closed\) return; \/\/ fechou durante a gravação/);
  assert.match(cap, /function resetRecordingUi/);
  const video = fs.readFileSync(path.join(PUB, 'forma-video.js'), 'utf8');
  assert.match(video, /o\.duration > 0/, 'MP4 fragmentado com duração 0 não é "confirmado"');
});
