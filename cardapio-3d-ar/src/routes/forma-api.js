// API isolada da Forma 3D para reconstrução 3D real (Fase 3B). Montada em /api/forma/reconstruction.
// O navegador só fala com estas rotas; o KIRI é chamado exclusivamente pelo servidor.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { publicConfig } from '../forma/config.js';
import { JobError } from '../forma/jobs.js';

export default function formaApiRoutes({ cfg, runtime, jobs, log = console }) {
  const r = Router();
  const f = cfg.forma;

  const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
  const configView = () => publicConfig(f, { ...runtime, realJobsUsed: jobs.countRealJobs() });

  // Em produção o processamento real exige, além das variáveis, a sessão de administrador do painel.
  const isAdmin = (req) => !!(req.user && req.user.is_admin);
  function gate(req, res, next) {
    if (!runtime.enabled) return sendError(res, 503, 'REAL_PROCESSING_DISABLED', `Processamento real indisponível. ${runtime.reason}`.trim());
    if (runtime.requiresAdmin && !isAdmin(req)) return sendError(res, 403, 'ADMIN_REQUIRED', 'Em produção, o processamento real exige uma sessão de administrador.');
    next();
  }
  // Leitura (status e modelo): em produção também só para administrador; fora dela segue aberta
  // (beta privado por convite, ids com 72 bits de aleatoriedade).
  function readGate(req, res, next) {
    if (runtime.requiresAdmin && !isAdmin(req)) return sendError(res, 403, 'ADMIN_REQUIRED', 'Em produção, o processamento real exige uma sessão de administrador.');
    next();
  }
  // Antes de receber um único byte: teto de custo e tamanho total declarado. Quem já estourou
  // FORMA_MAX_REAL_JOBS não faz o servidor gravar gigabytes para então ouvir 429.
  function preUpload(req, res, next) {
    if (jobs.countRealJobs() >= f.maxRealJobs) return sendError(res, 429, 'JOB_LIMIT', `Limite de ${f.maxRealJobs} tarefa(s) real(is) atingido neste ambiente (FORMA_MAX_REAL_JOBS).`);
    const declared = Number(req.get('content-length') || 0);
    const method = String(req.query.method || 'photos');
    const ceiling = (method === 'video' ? f.maxVideoBytes : f.photosMax * f.maxPhotoBytes) + 2 * 1048576;
    if (declared > ceiling) return sendError(res, 413, 'FILE_TOO_LARGE', `O envio declara ${(declared / 1048576).toFixed(0)} MB; o máximo para ${method === 'video' ? 'um vídeo' : 'fotos'} é ${(ceiling / 1048576).toFixed(0)} MB.`);
    next();
  }

  // Upload em disco, direto na área temporária da Forma 3D; limites por arquivo e por quantidade.
  // Dois receptores: o de fotos limita cada arquivo a maxPhotoBytes; o de vídeo, a maxVideoBytes.
  // O cliente informa o método em ?method= (o campo do corpo só existe depois de ler tudo).
  const storage = multer.diskStorage({
    // Uma pasta temporária por requisição (não por arquivo), removida ao final em qualquer caso.
    destination: (req, file, cb) => {
      if (!req.formaTmpDir) { req.formaTmpDir = path.join(jobs.dirs.temp, 'in-' + crypto.randomBytes(6).toString('hex')); fs.mkdirSync(req.formaTmpDir, { recursive: true }); }
      cb(null, req.formaTmpDir);
    },
    filename: (req, file, cb) => cb(null, crypto.randomBytes(8).toString('hex')),
  });
  const uploadPhotos = multer({ storage, limits: { fileSize: f.maxPhotoBytes, files: f.photosMax + 1, fields: 20, parts: f.photosMax + 40 } })
    .fields([{ name: 'photos', maxCount: f.photosMax + 1 }, { name: 'video', maxCount: 1 }]);
  const uploadVideo = multer({ storage, limits: { fileSize: f.maxVideoBytes, files: 1, fields: 20, parts: 40 } })
    .fields([{ name: 'video', maxCount: 1 }, { name: 'photos', maxCount: 1 }]);
  const upload = (req, res, cb) => (String(req.query.method || 'photos') === 'video' ? uploadVideo : uploadPhotos)(req, res, cb);

  const discard = (req) => {
    if (req.formaTmpDir) { try { fs.rmSync(req.formaTmpDir, { recursive: true, force: true }); } catch { /* ignora */ } }
  };

  r.get('/config', (req, res) => res.json(configView()));

  r.post('/jobs', gate, preUpload, (req, res) => {
    req.setTimeout(f.uploadTimeoutMs);
    upload(req, res, async (err) => {
      if (err) {
        discard(req);
        if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'FILE_TOO_LARGE', `Um dos arquivos excede o tamanho máximo (fotos até ${Math.round(f.maxPhotoBytes / 1048576)} MB, vídeo até ${Math.round(f.maxVideoBytes / 1048576)} MB).`);
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return sendError(res, 400, 'TOO_MANY_FILES', `Envie no máximo ${f.photosMax} fotos ou 1 vídeo.`);
        return sendError(res, 400, 'UPLOAD_FAILED', 'Não foi possível receber os arquivos.');
      }
      try {
        const method = String(req.body?.method || (req.files?.video?.length ? 'video' : 'photos'));
        const clientKey = String(req.get('Idempotency-Key') || req.body?.clientKey || '').slice(0, 120);
        // Escopo da chave de idempotência: a conta logada ou, sem login, o IP.
        const ownerScope = req.user ? `u:${req.user.id}` : `ip:${req.ip || ''}`;
        const result = await jobs.createJob({
          method, photos: req.files?.photos || [], video: req.files?.video?.[0] || null,
          productId: String(req.body?.productId || '').slice(0, 80), clientKey, ownerScope,
          options: { quality: String(req.body?.quality || ''), surface: String(req.body?.surface || ''), isMask: req.body?.isMask },
        });
        // Arquivos movidos para uploads/<job>; o que sobrou na pasta temporária é descartado.
        discard(req);
        res.status(result.duplicate ? 200 : 202).json({ job: result.job, duplicate: result.duplicate, warning: result.warning || '' });
      } catch (e) {
        discard(req);
        if (e instanceof JobError) return sendError(res, e.status, e.code, e.message);
        log.error(`[forma] criação de tarefa: ${runtime.provider ? runtime.provider.redact(e.message) : e.message}`);
        sendError(res, 500, 'INTERNAL', 'Erro interno ao criar a tarefa.');
      }
    });
  });

  r.get('/jobs/:jobId', readGate, async (req, res) => {
    const id = String(req.params.jobId);
    if (!/^frj_[\w-]{6,40}$/.test(id)) return sendError(res, 404, 'NOT_FOUND', 'Tarefa não encontrada.');
    try {
      const row = await jobs.refresh(id);
      if (!row) return sendError(res, 404, 'NOT_FOUND', 'Tarefa não encontrada.');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ job: jobs.publicView(row) });
    } catch (e) {
      log.error(`[forma] consulta de tarefa ${id}: ${e.message}`);
      sendError(res, 500, 'INTERNAL', 'Erro ao consultar a tarefa.');
    }
  });

  r.get('/jobs/:jobId/model', readGate, (req, res) => {
    const id = String(req.params.jobId);
    const abs = /^frj_[\w-]{6,40}$/.test(id) ? jobs.modelPath(id) : null;
    if (!abs || !fs.existsSync(abs)) return sendError(res, 404, 'NOT_FOUND', 'Modelo não disponível.');
    // Cabeçalhos só na resposta bem-sucedida (um erro não pode ficar em cache com tipo de modelo).
    // `root` + nome relativo: sem isso o `send` recusa caminhos com pastas iniciadas por ponto (ex.: .claude).
    res.sendFile(path.basename(abs), {
      root: path.dirname(abs), dotfiles: 'deny', etag: true, lastModified: true,
      headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' },
    }, (err) => { if (err && !res.headersSent) sendError(res, err.status === 404 ? 404 : 500, 'MODEL_UNAVAILABLE', 'Modelo não disponível.'); });
  });

  // Nova tentativa sem reenvio: usa os arquivos que o servidor guardou da tentativa anterior.
  r.post('/jobs/:jobId/retry', gate, async (req, res) => {
    const id = String(req.params.jobId);
    if (!/^frj_[\w-]{6,40}$/.test(id)) return sendError(res, 404, 'NOT_FOUND', 'Tarefa não encontrada.');
    try {
      const row = await jobs.retry(id);
      if (!row) return sendError(res, 404, 'NOT_FOUND', 'Tarefa não encontrada.');
      res.status(202).json({ job: jobs.publicView(row) });
    } catch (e) {
      if (e instanceof JobError) return sendError(res, e.status, e.code, e.message);
      log.error(`[forma] nova tentativa ${id}: ${e.message}`);
      sendError(res, 500, 'INTERNAL', 'Erro ao reenviar a tarefa.');
    }
  });

  r.delete('/jobs/:jobId', gate, async (req, res) => {
    const id = String(req.params.jobId);
    try {
      const row = await jobs.cancel(id);
      if (!row) return sendError(res, 404, 'NOT_FOUND', 'Tarefa não encontrada.');
      if (String(req.query.purge) === '1') { jobs.remove(id); return res.status(204).end(); }
      res.json({ job: jobs.publicView(row) });
    } catch (e) {
      log.error(`[forma] cancelamento ${id}: ${e.message}`);
      sendError(res, 500, 'INTERNAL', 'Erro ao cancelar a tarefa.');
    }
  });

  return r;
}
