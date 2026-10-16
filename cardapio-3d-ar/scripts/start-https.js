// Sobe o servidor em HTTPS com o certificado local de data/certs (gerado por `npm run cert`).
// O processamento real segue o .env (chave KIRI, limites); para testar sem créditos use `npm run dev:safe`.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.env.DATA_DIR || 'data', 'certs');
process.env.HTTPS_KEY_FILE = process.env.HTTPS_KEY_FILE || path.join(dir, 'dev-key.pem');
process.env.HTTPS_CERT_FILE = process.env.HTTPS_CERT_FILE || path.join(dir, 'dev-cert.pem');
if (!fs.existsSync(process.env.HTTPS_KEY_FILE) || !fs.existsSync(process.env.HTTPS_CERT_FILE)) {
  console.error('Certificado local não encontrado. Gere com: npm run cert');
  process.exit(1);
}
await import('../src/server.js');
