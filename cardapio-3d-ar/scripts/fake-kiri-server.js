// KIRI Engine FALSO para desenvolvimento: imita os endpoints usados pelo provider, avança a tarefa
// no tempo (fila → processando → pronto) e entrega um ZIP com um GLB de demonstração do projeto.
// Não consome créditos e não fala com a internet. Uso:
//   node scripts/fake-kiri-server.js            (porta 4747)
//   KIRI_BASE_URL=http://127.0.0.1:4747 KIRI_API_KEY=fake FORMA_REAL_PROCESSING_ENABLED=1 FORMA_RECONSTRUCTION_PROVIDER=kiri npm start
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { buildStoredZip } from '../src/forma/zip.js';

const PORT = Number(process.env.FAKE_KIRI_PORT || 4747);
const QUEUE_MS = Number(process.env.FAKE_KIRI_QUEUE_MS || 6000);
const PROCESS_MS = Number(process.env.FAKE_KIRI_PROCESS_MS || 12000);
const FAIL = process.env.FAKE_KIRI_FAIL === '1';
const glb = fs.readFileSync(path.resolve('samples/demo/cadeira.glb'));
const jobs = {};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  // Só a API exige a chave; o link do ZIP é um endereço temporário sem autenticação, como no serviço real.
  if (url.pathname.startsWith('/api/') && !/^Bearer .+/.test(req.headers.authorization || '')) return json(401, { code: 1001, msg: 'unauthorized', ok: false });
  req.on('data', () => {}); // consome o corpo (multipart) sem guardar
  req.on('end', () => {
    if (req.method === 'POST' && /^\/api\/v1\/open\/(photo\/(image|video)|featureless\/image)$/.test(url.pathname)) {
      const serialize = 'fake_' + Date.now().toString(36);
      jobs[serialize] = { createdAt: Date.now() };
      console.log(`[fake-kiri] tarefa ${serialize} criada (${url.pathname.endsWith('video') ? 'vídeo' : 'fotos'})`);
      return json(200, { code: 0, msg: 'success', ok: true, data: { serialize, calculateType: 1 } });
    }
    const ser = url.searchParams.get('serialize');
    if (req.method === 'GET' && url.pathname === '/api/v1/open/model/getStatus') {
      const j = jobs[ser]; if (!j) return json(200, { code: 2002, msg: 'serialize not found', ok: false });
      const age = Date.now() - j.createdAt;
      const status = FAIL && age > QUEUE_MS ? 1 : age < QUEUE_MS ? 3 : age < QUEUE_MS + PROCESS_MS ? 0 : 2;
      return json(200, { code: 0, ok: true, data: { serialize: ser, status } });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/open/model/getModelZip') {
      return json(200, { code: 0, ok: true, data: { serialize: ser, modelUrl: `http://127.0.0.1:${PORT}/zip/${ser}` } });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/zip/')) {
      const zip = buildStoredZip({ 'result/model.glb': glb, 'readme.txt': Buffer.from('fake kiri') });
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zip.length }); return res.end(zip);
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/open/balance') return json(200, { code: 0, ok: true, data: { balance: 999 } });
    json(404, { code: 1, msg: 'not found', ok: false });
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`KIRI falso em http://127.0.0.1:${PORT} (fila ${QUEUE_MS / 1000}s, processamento ${PROCESS_MS / 1000}s${FAIL ? ', modo FALHA' : ''})`));
