import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from './db.js';
import { sessionMiddleware } from './auth.js';
import { buildProvider } from './lib/generators/index.js';
import { pollPending } from './lib/generation.js';
import authRoutes from './routes/auth.js';
import restaurantRoutes from './routes/restaurant.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import previewRoutes from './routes/preview.js';
import formaApiRoutes from './routes/forma-api.js';
import { buildFormaRuntime } from './forma/providers/index.js';
import { createJobService } from './forma/jobs.js';

const ROOT = path.resolve(import.meta.dirname, '..');

export function createApp(cfg, { log = console, formaFetch = undefined, formaEnv = process.env } = {}) {
  fs.mkdirSync(cfg.privateDir, { recursive: true });
  fs.mkdirSync(path.join(cfg.publicDir, 'models'), { recursive: true });
  fs.mkdirSync(path.join(cfg.publicDir, 'photos'), { recursive: true });
  const db = openDb(cfg.dbFile);
  db.exec("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  const provider = buildProvider(cfg);
  // Forma 3D: provider real (KIRI) só quando as variáveis permitem; caso contrário, modo simulado.
  const formaRuntime = buildFormaRuntime(cfg, { fetchImpl: formaFetch, env: formaEnv });
  const formaJobs = createJobService({ db, cfg, runtime: formaRuntime, log });
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.locals = { cfg, db, provider, log, forma: { runtime: formaRuntime, jobs: formaJobs } };

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  // Estáticos: nossos assets, o model-viewer local e os arquivos públicos (modelos/fotos publicados).
  app.use('/static', express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));
  app.use('/static/vendor', express.static(path.join(ROOT, 'node_modules/@google/model-viewer/dist'), { maxAge: '7d', immutable: true }));
  // Modelos de exemplo (prato + placeholders do preview Forma 3D).
  app.use('/static/samples', express.static(path.join(ROOT, 'samples'), { maxAge: 0 })); // revalida por ETag
  app.use('/files', express.static(cfg.publicDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));

  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '50kb' }));
  app.use(sessionMiddleware(db));

  app.use('/api/forma/reconstruction', formaApiRoutes({ cfg, runtime: formaRuntime, jobs: formaJobs, log }));
  app.use(previewRoutes); // landing anônima em '/', preview em /studio e /p/:slug
  app.use(authRoutes);
  app.use('/app', restaurantRoutes);
  app.use('/admin', adminRoutes);
  app.use(publicRoutes);

  app.use((req, res) => res.status(404).send('Página não encontrada.'));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).send('Arquivo grande demais.');
    if (err?.type === 'entity.too.large') return res.status(413).send('Envio grande demais.');
    log.error(`[erro] ${req.method} ${req.originalUrl}: ${err?.stack || err}`);
    res.status(500).send('Erro interno. Tente novamente.');
  });

  // Polling do gerador (nenhuma geração começa sozinha; só acompanha tarefas já iniciadas por admin).
  let timer = null;
  if (provider.configured && cfg.tripo.pollSeconds > 0) {
    timer = setInterval(() => pollPending({ db, cfg, provider, log }).catch((e) => log.error(e)), cfg.tripo.pollSeconds * 1000);
    timer.unref();
  }
  // Acompanhamento das tarefas reais da Forma 3D mesmo sem ninguém com a página aberta.
  let formaTimer = null;
  if (formaRuntime.enabled && cfg.forma.pollSeconds > 0) {
    formaTimer = setInterval(() => formaJobs.pollActive().catch((e) => log.error(`[forma] polling: ${e.message}`)), cfg.forma.pollSeconds * 1000);
    formaTimer.unref();
  }
  app.shutdown = () => { if (timer) clearInterval(timer); if (formaTimer) clearInterval(formaTimer); db.close(); };
  return app;
}
