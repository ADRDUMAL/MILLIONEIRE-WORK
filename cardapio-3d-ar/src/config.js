import fs from 'node:fs';
import path from 'node:path';
import { formaConfig } from './forma/config.js';

// Carrega .env simples (sem dependência) se existir.
export function loadDotEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
  }
}

export function buildConfig(overrides = {}) {
  const env = process.env;
  const dataDir = overrides.dataDir || env.DATA_DIR || path.resolve('data');
  const cfg = {
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    // URL pública usada em links/QR. Sem ela, usa o host da requisição.
    baseUrl: (env.BASE_URL || '').replace(/\/$/, ''),
    dataDir,
    dbFile: path.join(dataDir, 'app.sqlite'),
    privateDir: path.join(dataDir, 'private'),
    publicDir: path.join(dataDir, 'public'),
    sessionSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : env.NODE_ENV === 'production',
    sessionDays: 30,
    maxPhotoBytes: 8 * 1024 * 1024,
    maxModelBytes: 40 * 1024 * 1024,
    // Modelo entregue ao celular acima disto gera aviso na publicação.
    modelWarnBytes: 10 * 1024 * 1024,
    tripo: {
      apiKey: env.TRIPO_API_KEY || '',
      baseUrl: env.TRIPO_BASE_URL || 'https://openapi.tripo3d.com/v3',
      model: env.TRIPO_MODEL || 'v3.0-20250812',
      // Estimativa (30 créditos × US$0,01) usada antes de o valor real chegar da API.
      estimatedCostUsd: Number(env.TRIPO_EST_COST_USD || 0.30),
      pollSeconds: Number(env.TRIPO_POLL_SECONDS || 20),
    },
    // Forma 3D (Fase 3B): reconstrução real server-side. Ver src/forma/config.js e .env.example.
    forma: formaConfig(env, dataDir),
    ...overrides,
  };
  if (overrides.forma) cfg.forma = { ...formaConfig(env, cfg.dataDir), ...overrides.forma, kiri: { ...formaConfig(env, cfg.dataDir).kiri, ...(overrides.forma.kiri || {}) } };
  return cfg;
}
