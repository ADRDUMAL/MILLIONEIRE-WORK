// Ambiente SEGURO para testar a interface em modo real sem gastar créditos: sobe o KIRI falso
// (scripts/fake-kiri-server.js) no mesmo processo e o servidor da Forma 3D apontando para ele.
// Ignora KIRI_API_KEY e KIRI_BASE_URL do .env e usa um DATA_DIR próprio, para não misturar as
// tarefas falsas com o banco e o contador de tarefas reais.
//   npm run dev:safe            → http://localhost:3001 (PORT=... para mudar; HTTPS se houver data/certs)
import fs from 'node:fs';
import path from 'node:path';
process.env.PORT = process.env.PORT || '3001';
process.env.FORMA_REAL_PROCESSING_ENABLED = '1';
process.env.FORMA_RECONSTRUCTION_PROVIDER = 'kiri';
process.env.KIRI_API_KEY = 'fake-local-key';
process.env.KIRI_BASE_URL = 'http://127.0.0.1:' + (process.env.FAKE_KIRI_PORT || '4747');
process.env.FORMA_MAX_REAL_JOBS = process.env.FORMA_MAX_REAL_JOBS || '50';
process.env.FORMA_POLL_SECONDS = process.env.FORMA_POLL_SECONDS || '3';
process.env.DATA_DIR = process.env.DATA_DIR || './data/dev-safe';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// Com o certificado local de `npm run cert`, sobe em HTTPS automaticamente (câmera no celular).
// `--http` força HTTP mesmo com certificado (ex.: navegador que não aceita certificado autoassinado).
const certs = path.resolve('data', 'certs');
if (process.argv.includes('--http')) { delete process.env.HTTPS_KEY_FILE; delete process.env.HTTPS_CERT_FILE; }
else if (!process.env.HTTPS_KEY_FILE && fs.existsSync(path.join(certs, 'dev-key.pem')) && fs.existsSync(path.join(certs, 'dev-cert.pem'))) {
  process.env.HTTPS_KEY_FILE = path.join(certs, 'dev-key.pem');
  process.env.HTTPS_CERT_FILE = path.join(certs, 'dev-cert.pem');
}

await import('./fake-kiri-server.js');
await import('../src/server.js');
console.log('  modo seguro: KIRI falso em processo, nenhum crédito é consumido (DATA_DIR=' + process.env.DATA_DIR + ')');
