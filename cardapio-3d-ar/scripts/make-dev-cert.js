// Gera um certificado autoassinado para testar a captura pela câmera no celular via HTTPS na rede
// local (getUserMedia exige página segura). Usa o `openssl` do sistema (vem com o Git para Windows).
// Saída: data/certs/dev-key.pem e data/certs/dev-cert.pem, válidos para localhost e para os IPs desta
// máquina. O celular mostrará um aviso de certificado na primeira abertura — é esperado; para um
// certificado confiável sem aviso, use o mkcert (https://github.com/FiloSottile/mkcert).
//   npm run cert            → depois: npm run dev:safe  (ou npm run start:https)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = path.resolve(process.env.DATA_DIR || 'data', 'certs');
fs.mkdirSync(dir, { recursive: true });
const key = path.join(dir, 'dev-key.pem'), cert = path.join(dir, 'dev-cert.pem');
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');

try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '90', '-subj', '/CN=Forma 3D dev', '-addext', `subjectAltName=${san}`], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
} catch (e) {
  if (e.stderr) console.error(String(e.stderr));
  console.error('Não foi possível executar o openssl. Instale o Git para Windows (inclui openssl) ou use o mkcert: mkcert -key-file data/certs/dev-key.pem -cert-file data/certs/dev-cert.pem localhost 127.0.0.1 ' + ips.join(' '));
  process.exit(1);
}
console.log(`Certificado gerado (90 dias) para ${san.replace(/(DNS|IP):/g, '')}`);
console.log(`  chave: ${key}\n  cert.: ${cert}`);
console.log('Agora: npm run dev:safe (KIRI falso, sem créditos) ou npm run start:https (processamento conforme o .env).');
for (const ip of ips.length ? ips : ['<ip-da-maquina>']) console.log(`No celular, na mesma rede Wi-Fi: https://${ip}:3001/studio/produtos/novo (dev:safe) — aceite o aviso do certificado.`);
