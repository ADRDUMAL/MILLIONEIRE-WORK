import os from 'node:os';
import fs from 'node:fs';
import https from 'node:https';
import { loadDotEnv, buildConfig } from './config.js';
import { createApp } from './app.js';

loadDotEnv();
const cfg = buildConfig();
const app = createApp(cfg);

// HTTPS local opcional (Fase 4): a câmera ao vivo do celular (getUserMedia) só funciona em páginas
// seguras. Com HTTPS_KEY_FILE e HTTPS_CERT_FILE (ex.: gerados pelo mkcert) o servidor sobe em TLS
// na própria rede Wi-Fi, sem túnel. Sem as variáveis, HTTP como sempre.
const tls = process.env.HTTPS_KEY_FILE && process.env.HTTPS_CERT_FILE
  ? { key: fs.readFileSync(process.env.HTTPS_KEY_FILE), cert: fs.readFileSync(process.env.HTTPS_CERT_FILE) }
  : null;
const server = tls ? https.createServer(tls, app) : app;
const scheme = tls ? 'https' : 'http';

const listening = server.listen(cfg.port, cfg.host, () => {
  console.log(`Cardápio 3D no ar: ${scheme}://localhost:${cfg.port}${tls ? ' (HTTPS local)' : ''}`);
  if (cfg.host === '0.0.0.0') {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const ip of ips) console.log(`  na rede local (celular): ${scheme}://${ip}:${cfg.port}`);
    if (!tls) console.log('  captura pela câmera no celular exige HTTPS: veja "Captura guiada pela câmera" no README (mkcert ou túnel).');
  }
  console.log(`  gerador 3D: ${app.locals.provider.label}`);
  console.log(`  Forma 3D reconstrução: ${app.locals.forma.runtime.label}${app.locals.forma.runtime.enabled ? '' : ` — ${app.locals.forma.runtime.reason}`}`);
  if (cfg.baseUrl) console.log(`  BASE_URL: ${cfg.baseUrl}`);
});
// 300 fotos numa conexão lenta levam mais que os 5 minutos padrão do Node (requestTimeout).
// O limite de inatividade por requisição (req.setTimeout) continua valendo na rota de upload.
listening.requestTimeout = Math.max(listening.requestTimeout || 0, cfg.forma.uploadTimeoutMs + 60000);
listening.headersTimeout = Math.min(listening.headersTimeout || 60000, listening.requestTimeout - 1000);
