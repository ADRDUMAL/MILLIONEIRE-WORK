// Serviço de tarefas de reconstrução da Forma 3D (Fase 3B). Independente do domínio de
// restaurantes: usa só as tabelas forma_reconstruction_* e a pasta DATA_DIR/forma.
//
// Fluxo: POST arquivos → validação no servidor → uploads/<job> → envio assíncrono ao provider →
// polling (server-side, com backoff) → download do ZIP → extração segura do GLB → models/<job>.glb.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, all, run } from '../db.js';
import { sniffImage, imageSize, resolveUnder, removeQuiet } from '../lib/files.js';
import { analyzeGlb } from '../lib/glb.js';
import { listEntries, extractEntry, findGlbEntry, isZip } from './zip.js';
import { probeMp4, isMp4Like } from './media.js';
import { STAGE_LABEL, ProviderError } from './providers/kiri.js';

const ACTIVE = ['uploading', 'queued', 'processing'];
const KEEP_FAILED_HOURS = 48; // arquivos de tarefas com falha ficam guardados para "Tentar novamente"
const TEMP_MAX_AGE_MS = 60 * 60e3; // pastas temp/in-* de uploads interrompidos por queda do processo
const DOWNLOAD_HOLD_MIN = 10;     // enquanto o modelo é baixado, nenhuma consulta ao serviço é repetida
// Falhas que reenviar as mesmas fotos não resolve: o botão "Tentar novamente" não aparece para elas.
const NOT_RETRYABLE_CODES = new Set(['RESULT_INVALID']);

// Código técnico estável de uma falha do provider, para a interface explicar a causa certa.
function providerCode(e, stage) {
  const kind = e && e.kind;
  if (kind === 'auth') return 'KIRI_AUTH';
  if (kind === 'credits') return 'KIRI_CREDITS';
  if (kind === 'invalid_response') return 'INVALID_RESPONSE';
  if (kind === 'timeout') return stage === 'upload' ? 'UPLOAD_TIMEOUT' : stage === 'download' ? 'DOWNLOAD_FAILED' : 'POLL_FAILED';
  if (kind === 'network') return stage === 'upload' ? 'UPLOAD_FAILED' : stage === 'download' ? 'DOWNLOAD_FAILED' : 'POLL_FAILED';
  return stage === 'upload' ? 'KIRI_REJECTED' : stage === 'download' ? 'RESULT_INVALID' : 'POLL_FAILED';
}
const nowIso = () => new Date().toISOString();

export class JobError extends Error {
  constructor(message, status = 400, code = 'INVALID') { super(message); this.name = 'JobError'; this.status = status; this.code = code; }
}

export function createJobService({ db, cfg, runtime, log = console }) {
  const f = cfg.forma;
  const dirs = { uploads: path.join(f.dir, 'uploads'), models: path.join(f.dir, 'models'), temp: path.join(f.dir, 'temp'), jobs: path.join(f.dir, 'jobs') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const provider = runtime.provider;
  const jobDir = (id) => path.join(dirs.uploads, id);
  const cleanMessage = (e) => (provider ? provider.redact(e?.message || String(e)) : (e?.message || String(e))).slice(0, 500);
  // Downloads em andamento (um por tarefa). Sem isso, o timer e o GET do navegador disparavam dois
  // downloads do mesmo ZIP e gravavam dois assets para a mesma tarefa.
  const inflight = new Set();
  const activeWhere = `status IN ('uploading','queued','processing')`;

  // ---------- Validação no servidor (nunca confia no navegador) ----------
  // Devolve { files, info, warning }. Um HEIC ou GIF perdido no meio de 100 fotos não derruba o lote
  // inteiro: se sobram fotos suficientes, os inválidos ficam de fora e o aviso diz quais foram.
  function validatePhotos(files) {
    if (files.length < f.photosMin) throw new JobError(`Envie pelo menos ${f.photosMin} fotos (recebidas: ${files.length}).`, 400, 'TOO_FEW_PHOTOS');
    if (files.length > f.photosMax) throw new JobError(`Envie no máximo ${f.photosMax} fotos (recebidas: ${files.length}).`, 400, 'TOO_MANY_PHOTOS');
    const out = [], invalid = [], longs = [];
    for (const file of files) {
      if (file.size > f.maxPhotoBytes) throw new JobError(`${file.originalname} excede ${(f.maxPhotoBytes / 1048576).toFixed(0)} MB.`, 400, 'FILE_TOO_LARGE');
      const head = file.size ? readHead(file.path, 65536) : Buffer.alloc(0);
      const kind = file.size ? sniffImage(head) : null;
      if (!kind) { invalid.push(file.originalname || 'arquivo'); continue; }
      const dim = imageSize(head, kind.mime);
      if (dim && dim.width && dim.height) longs.push(Math.max(dim.width, dim.height));
      out.push({ path: file.path, name: safeName(file.originalname, kind.ext), mime: kind.mime, size: file.size });
    }
    if (invalid.length && out.length < f.photosMin) {
      throw new JobError(`${invalid.length === 1 ? 'Este arquivo não é' : `${invalid.length} arquivos não são`} JPG, PNG ou WebP: ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '…' : ''}.`, 400, 'INVALID_IMAGE');
    }
    longs.sort((a, b) => a - b);
    const info = { count: out.length, skipped: invalid.length, medianLong: longs.length ? longs[Math.floor(longs.length / 2)] : null, minLong: longs[0] ?? null };
    const warning = invalid.length ? `${invalid.length} ${invalid.length === 1 ? 'arquivo ficou de fora por não ser' : 'arquivos ficaram de fora por não serem'} JPG, PNG ou WebP (${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}).` : '';
    return { files: out, info, warning };
  }
  function validateVideo(file) {
    if (!file) throw new JobError('Envie um vídeo.', 400, 'NO_VIDEO');
    if (!file.size) throw new JobError('Arquivo de vídeo vazio.', 400, 'EMPTY_FILE');
    if (/\.(webm|mkv|avi)$/i.test(file.originalname || '')) throw new JobError('Formato de vídeo não suportado pelo serviço. Use MP4 ou MOV.', 400, 'INVALID_VIDEO');
    if (file.size > f.maxVideoBytes) throw new JobError(`O vídeo excede ${(f.maxVideoBytes / 1048576).toFixed(0)} MB.`, 400, 'FILE_TOO_LARGE');
    const head = readHead(file.path, 16);
    if (!isMp4Like(head)) throw new JobError('Formato de vídeo não suportado pelo serviço. Use MP4 ou MOV.', 400, 'INVALID_VIDEO');
    const info = probeMp4(file.path);
    if (info.durationSeconds != null && info.durationSeconds > f.videoMaxSeconds) {
      throw new JobError(`O vídeo tem ${Math.round(info.durationSeconds)} s; o máximo é ${f.videoMaxSeconds} s (3 minutos).`, 400, 'VIDEO_TOO_LONG');
    }
    if (info.width != null && (info.width > f.videoMaxWidth || info.height > f.videoMaxHeight) && (info.height > f.videoMaxWidth || info.width > f.videoMaxHeight)) {
      throw new JobError(`Resolução ${info.width}×${info.height} acima do máximo ${f.videoMaxWidth}×${f.videoMaxHeight}.`, 400, 'VIDEO_TOO_LARGE');
    }
    // MOV pelo brand do ftyp (qt), não só pela extensão.
    const ext = /\.mov$/i.test(file.originalname) || /^qt/.test(info.brand || '') ? 'mov' : 'mp4';
    return {
      file: { path: file.path, name: safeName(file.originalname, ext), mime: ext === 'mov' ? 'video/quicktime' : 'video/mp4', size: file.size },
      info, warning: info.confirmed ? '' : 'Não foi possível confirmar duração e resolução do vídeo no servidor; o serviço pode recusá-lo se passar de 3 minutos ou 1920×1080.',
    };
  }

  // ---------- Criação ----------
  // Opções que o navegador pode pedir. Tudo passa por lista fechada: nada vira parâmetro cru do KIRI.
  function cleanOptions(method, raw = {}) {
    const quality = Object.prototype.hasOwnProperty.call(f.qualityPresets || {}, raw.quality) ? raw.quality : 'standard';
    const surface = (f.surfaces || ['normal']).includes(raw.surface) ? raw.surface : 'normal';
    const isMask = raw.isMask === '0' || raw.isMask === 0 ? 0 : raw.isMask === '1' || raw.isMask === 1 ? 1 : null;
    return { quality, surface: method === 'photos' ? surface : 'normal', isMask, requestedSurface: surface };
  }

  async function createJob({ method, photos = [], video = null, productId = '', clientKey = '', ownerScope = '', options: rawOptions = {} }) {
    if (!runtime.enabled || !provider) throw new JobError(`Processamento real indisponível. ${runtime.reason}`.trim(), 503, 'REAL_PROCESSING_DISABLED');
    if (!['photos', 'video'].includes(method)) throw new JobError('Método inválido. Use "photos" ou "video".', 400, 'INVALID_METHOD');
    // Idempotência: o mesmo clique (mesma chave) devolve a mesma tarefa, sem criar outra. A chave
    // precisa ter entropia (≥ 16 caracteres) e vale só para quem a enviou: "click-1" de outra
    // pessoa nunca devolve a tarefa alheia.
    clientKey = /^[\w-]{16,120}$/.test(clientKey) ? crypto.createHash('sha256').update(`${ownerScope}:${clientKey}`).digest('base64url') : '';
    if (clientKey) {
      const dup = get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE client_key = ?', clientKey);
      if (dup) return { job: publicView(dup), duplicate: true };
    }
    if (countRealJobs() >= f.maxRealJobs) throw new JobError(`Limite de ${f.maxRealJobs} tarefa(s) real(is) atingido neste ambiente (FORMA_MAX_REAL_JOBS).`, 429, 'JOB_LIMIT');

    let files = [], warning = '', mediaInfo = null;
    if (method === 'photos') { const v = validatePhotos(photos); files = v.files; warning = v.warning; mediaInfo = v.info; }
    else { const v = validateVideo(video); files = [v.file]; warning = v.warning; mediaInfo = v.info; }
    const options = cleanOptions(method, rawOptions);
    if (method === 'video' && options.requestedSurface !== 'normal') {
      warning = [warning, 'O modo para superfícies lisas ou reflexivas só funciona com fotos; este vídeo segue pelo processamento normal.'].filter(Boolean).join(' ');
    }
    // Textura 4K só faz sentido com fotos grandes: abaixo de 2000 px no lado maior, ela só amplia o
    // borrão (e pesa 3× no celular). Vídeo 1080p idem. A escolha fica registrada na tarefa.
    if (options.quality === 'high' && ((method === 'photos' && mediaInfo?.medianLong && mediaInfo.medianLong < 2000) || method === 'video')) {
      options.quality = 'standard'; options.autoQuality = method === 'video' ? 'video-1080p' : `fotos-${mediaInfo.medianLong}px`;
      warning = [warning, method === 'video' ? 'Vídeo gera quadros de até 1080p: a textura sai em 2K (4K não acrescenta detalhe).' : `As fotos têm cerca de ${mediaInfo.medianLong} px no lado maior: a textura sai em 2K (4K só ampliaria o borrão).`].filter(Boolean).join(' ');
    }
    const plan = provider.paramsFor ? provider.paramsFor(method, options) : { endpoint: method, params: provider.params };

    const id = 'frj_' + crypto.randomBytes(9).toString('base64url');
    const dir = jobDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const stored = files.map((file, i) => {
      const dest = path.join(dir, `${String(i + 1).padStart(3, '0')}-${file.name}`);
      fs.renameSync(file.path, dest);
      return { ...file, path: dest };
    });
    const bytes = stored.reduce((n, s) => n + s.size, 0);
    try {
      run(db, `INSERT INTO forma_reconstruction_jobs (id, client_key, product_id, provider, method, status, stage, file_count, bytes, options_json, next_poll_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id, clientKey || null, productId || null, provider.name, method, 'uploading', STAGE_LABEL.uploading, stored.length, bytes,
        JSON.stringify({ params: plan.params, endpoint: plan.endpoint, options, warning, media: mediaInfo }), nowIso());
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true }); // sem linha no banco, nenhuma varredura removeria a pasta
      if (/UNIQUE/.test(e.message) && clientKey) { const dup = get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE client_key = ?', clientKey); return { job: publicView(dup), duplicate: true }; }
      throw e;
    }
    // O envio ao KIRI pode levar minutos (até 300 fotos): responde já e envia em segundo plano.
    const vid = mediaInfo ? `, vídeo ${mediaInfo.width || '?'}×${mediaInfo.height || '?'} ${mediaInfo.codec || 'codec ?'}${mediaInfo.durationSeconds ? ' ' + Math.round(mediaInfo.durationSeconds) + ' s' : ''}` : '';
    log.log?.(`[forma] tarefa ${id}: ${method}, ${stored.length} arquivo(s), ${(bytes / 1048576).toFixed(1)} MB, endpoint ${plan.endpoint}, qualidade ${options.quality}${vid}`);
    startUpload(id, method, stored, options).catch((e) => log.error(`[forma] tarefa ${id}: ${cleanMessage(e)}`));
    return { job: publicView(get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id)), duplicate: false, warning };
  }

  async function startUpload(id, method, files, options = {}) {
    const t0 = Date.now();
    try {
      const { providerRef, calculateType } = await provider.createJob({ method, files, options });
      // Registra o identificador do serviço ANTES de olhar o status: se a tarefa foi cancelada durante
      // o envio, o crédito já foi gasto e o `serialize` é a única prova para o suporte.
      const row = get(db, 'SELECT status, options_json FROM forma_reconstruction_jobs WHERE id = ?', id);
      const opts = safeJson(row?.options_json) || {};
      opts.history = [...(opts.history || []), { providerRef, calculateType: calculateType ?? null, at: nowIso() }];
      run(db, 'UPDATE forma_reconstruction_jobs SET options_json = ? WHERE id = ?', JSON.stringify(opts), id);
      const changed = run(db, "UPDATE forma_reconstruction_jobs SET provider_ref = ?, status = 'queued', stage = ?, updated_at = ?, next_poll_at = ? WHERE id = ? AND status = 'uploading'",
        providerRef, STAGE_LABEL.queued, nowIso(), nowIso(), id);
      log.log?.(`[forma] tarefa ${id}: aceita pelo serviço em ${((Date.now() - t0) / 1000).toFixed(1)} s · serialize ${providerRef}${calculateType != null ? ` · calculateType ${calculateType}` : ''}${changed?.changes === 0 ? ' · (tarefa já não estava em envio)' : ''}`);
    } catch (e) {
      fail(id, `Não foi possível enviar os arquivos ao serviço: ${cleanMessage(e)}`, 'error', { code: providerCode(e, 'upload'), stage: 'upload' });
    }
  }

  // Reinício do processo: tarefas que estavam enviando ficaram sem ninguém. Com os arquivos ainda
  // guardados, o envio recomeça sozinho; sem eles, a falha diz a etapa certa.
  function recoverOrphans() {
    for (const job of all(db, "SELECT * FROM forma_reconstruction_jobs WHERE status = 'uploading' AND provider_ref IS NULL AND provider = ?", provider ? provider.name : 'kiri')) {
      const files = storedFiles(job.id);
      if (files.length && runtime.enabled && provider) {
        const opts = safeJson(job.options_json) || {};
        log.log?.(`[forma] tarefa ${job.id}: envio interrompido por reinício; reenviando ${files.length} arquivo(s)`);
        startUpload(job.id, job.method, files, opts.options || {}).catch((e) => log.error(`[forma] tarefa ${job.id}: ${cleanMessage(e)}`));
      } else {
        fail(job.id, 'O envio ao serviço foi interrompido por um reinício do servidor.', 'error', { code: 'UPLOAD_INTERRUPTED', stage: 'upload' });
      }
    }
  }
  function sweepTemp() {
    try {
      for (const name of fs.readdirSync(dirs.temp)) {
        const p = path.join(dirs.temp, name);
        try { if (Date.now() - fs.statSync(p).mtimeMs > TEMP_MAX_AGE_MS) fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignora */ }
      }
    } catch { /* ignora */ }
  }

  // ---------- Acompanhamento ----------
  // Falha com etapa e código. Os arquivos ficam guardados (exceto no cancelamento) para permitir
  // "Tentar novamente" sem pedir reenvio; uma varredura remove sobras depois de KEEP_FAILED_HOURS.
  function fail(id, message, status = 'error', { code = null, stage = null } = {}) {
    // Compare-and-set: uma falha de polling que chega depois de um cancelamento não ressuscita a tarefa.
    const guard = status === 'cancelled' ? '' : " AND status <> 'cancelled'";
    run(db, `UPDATE forma_reconstruction_jobs SET status = ?, stage = ?, error_message = ?, error_code = ?, error_stage = ?, updated_at = ?, finished_at = ? WHERE id = ?${guard}`,
      status, STAGE_LABEL[status] || STAGE_LABEL.error, String(message).slice(0, 500), code, stage, nowIso(), nowIso(), id);
    if (status !== 'cancelled') log.error(`[forma] tarefa ${id} falhou (${code || status}${stage ? ` em ${stage}` : ''}): ${String(message).slice(0, 200)}`);
    if (status === 'cancelled' && !inflight.has(id)) cleanupUploads(id);
  }

  async function refresh(id, { force = false } = {}) {
    const job = get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
    if (!job) return null;
    if (!ACTIVE.includes(job.status)) return job;
    if (inflight.has(id)) return job; // o modelo está sendo baixado agora; nada a consultar
    const ageMin = (Date.now() - Date.parse(job.created_at)) / 60000;
    if (ageMin > f.jobTimeoutMin) {
      const stage = job.status === 'uploading' ? 'upload' : 'processing';
      fail(id, `Tempo limite de ${f.jobTimeoutMin} minutos excedido. Envie o produto novamente.`, 'error', { code: 'JOB_TIMEOUT', stage });
      return get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
    }
    if (!job.provider_ref) return job; // ainda enviando
    if (!force && job.next_poll_at && Date.parse(job.next_poll_at) > Date.now()) return job;
    // Mesmo com force, nunca consulta o KIRI mais de uma vez a cada 5 s por tarefa.
    if (job.last_polled_at && Date.now() - Date.parse(job.last_polled_at) < 5000) return job;

    try {
      const st = await provider.getJobStatus(job.provider_ref);
      const next = new Date(Date.now() + f.pollSeconds * 1000).toISOString();
      // Toda transição é compare-and-set: um cancelamento feito enquanto a consulta estava em voo prevalece.
      run(db, `UPDATE forma_reconstruction_jobs SET provider_status = ?, poll_attempts = poll_attempts + 1, poll_errors = 0, last_polled_at = ?, next_poll_at = ?, updated_at = ? WHERE id = ? AND ${activeWhere}`,
        st.providerStatus, nowIso(), next, nowIso(), id);
      if (st.status === 'done') {
        const hold = new Date(Date.now() + DOWNLOAD_HOLD_MIN * 60e3).toISOString();
        const r = run(db, `UPDATE forma_reconstruction_jobs SET status = 'processing', stage = 'Baixando e validando o modelo', next_poll_at = ? WHERE id = ? AND ${activeWhere}`, hold, id);
        // O download (até centenas de MB) acontece em segundo plano: a resposta ao navegador não
        // espera por ele, e o Set garante um único download por tarefa.
        if (r?.changes !== 0 && !inflight.has(id)) {
          inflight.add(id);
          fetchResult(id, job.provider_ref).catch((e) => log.error(`[forma] tarefa ${id}: ${cleanMessage(e)}`)).finally(() => inflight.delete(id));
        }
      } else if (st.status === 'error') {
        fail(id, 'O serviço não conseguiu reconstruir o modelo. Confira as orientações de captura (mais fotos, luz uniforme, fundo neutro) e envie novamente.', 'error', { code: 'RECONSTRUCTION_FAILED', stage: 'processing' });
      } else if (st.status === 'expired') {
        fail(id, 'O resultado expirou no serviço antes de ser baixado. Envie o produto novamente.', 'expired', { code: 'RESULT_EXPIRED', stage: 'download' });
      } else if (['uploading', 'queued', 'processing'].includes(st.status)) {
        run(db, `UPDATE forma_reconstruction_jobs SET status = ?, stage = ? WHERE id = ? AND ${activeWhere}`, st.status, st.stage, id);
      }
    } catch (e) {
      const temporary = e instanceof ProviderError ? e.temporary : true;
      const errors = (job.poll_errors || 0) + 1;
      if (!temporary || errors > f.maxPollErrors) {
        fail(id, `Falha ao consultar o serviço: ${cleanMessage(e)}`, 'error', { code: providerCode(e, 'processing'), stage: 'processing' });
      } else {
        // Backoff exponencial limitado a 5 minutos.
        const wait = Math.min(300, f.pollSeconds * 2 ** errors);
        run(db, `UPDATE forma_reconstruction_jobs SET poll_errors = ?, last_polled_at = ?, next_poll_at = ?, stage = ?, updated_at = ? WHERE id = ? AND ${activeWhere}`,
          errors, nowIso(), new Date(Date.now() + wait * 1000).toISOString(), `Serviço instável; nova tentativa em ${wait} s`, nowIso(), id);
        log.error(`[forma] tarefa ${id}: ${cleanMessage(e)} (tentativa ${errors})`);
      }
    }
    return get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
  }

  // ---------- Resultado: ZIP → GLB validado → models/<job>.glb ----------
  async function fetchResult(id, providerRef) {
    const t0 = Date.now();
    try {
      const { downloadUrl } = await provider.getResult(providerRef);
      const zip = await provider.download(downloadUrl, { maxBytes: f.maxZipBytes });
      if (!isZip(zip)) throw new Error('O pacote baixado não é um ZIP válido');
      const entries = listEntries(zip);
      const entry = findGlbEntry(entries);
      if (!entry) throw new Error('O pacote não contém um arquivo .glb');
      const glb = extractEntry(zip, entry, { maxBytes: f.maxModelBytes });
      const info = analyzeGlb(glb); // assinatura glTF 2.0, buffers embutidos, caixa, malhas
      if (!info.meshes || !info.bbox) throw new Error('O modelo não contém nenhuma malha');
      const rel = path.posix.join('models', `${id}.glb`);
      const abs = resolveUnder(f.dir, rel);
      fs.writeFileSync(abs, glb);
      // Se a tarefa foi cancelada durante o download, o modelo não é publicado.
      db.exec('BEGIN');
      try {
        const r = run(db, `UPDATE forma_reconstruction_jobs SET status = 'done', stage = ?, provider_status = 2, updated_at = ?, finished_at = ? WHERE id = ? AND ${activeWhere}`, STAGE_LABEL.done, nowIso(), nowIso(), id);
        if (r?.changes === 0) throw new JobError('Tarefa não está mais ativa', 409, 'NOT_ACTIVE');
        run(db, 'INSERT INTO forma_reconstruction_assets (job_id, kind, rel_path, bytes, bbox_json) VALUES (?,?,?,?,?)', id, 'model', rel, glb.length, JSON.stringify({ ...info.bbox, meshes: info.meshes, images: info.images, zipBytes: zip.length }));
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); if (e instanceof JobError) { removeQuiet(abs); return; } throw e; }
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      log.log?.(`[forma] tarefa ${id}: modelo pronto · ZIP ${(zip.length / 1048576).toFixed(1)} MB · GLB ${(glb.length / 1048576).toFixed(1)} MB · ${info.meshes} malha(s), ${info.images} textura(s) · download+validação em ${secs} s`);
      cleanupUploads(id);
    } catch (e) {
      // Soluço de rede no download não é falha da reconstrução: o resultado continua no serviço (até
      // expirar, status 4). Volta a "processando" e tenta baixar de novo na próxima rodada, sem reenvio.
      const temporary = e instanceof ProviderError && e.temporary;
      const job = get(db, 'SELECT poll_errors FROM forma_reconstruction_jobs WHERE id = ?', id);
      const errors = (job?.poll_errors || 0) + 1;
      if (temporary && errors <= f.maxPollErrors) {
        const wait = Math.min(300, f.pollSeconds * 2 ** errors);
        run(db, `UPDATE forma_reconstruction_jobs SET poll_errors = ?, next_poll_at = ?, last_polled_at = NULL, stage = ?, updated_at = ? WHERE id = ? AND ${activeWhere}`,
          errors, new Date(Date.now() + wait * 1000).toISOString(), `Download do modelo falhou; nova tentativa em ${wait} s`, nowIso(), id);
        log.error(`[forma] tarefa ${id}: ${cleanMessage(e)} (download, tentativa ${errors})`);
        return;
      }
      fail(id, `Não foi possível obter o modelo: ${cleanMessage(e)}`, 'error', { code: e instanceof ProviderError ? providerCode(e, 'download') : 'RESULT_INVALID', stage: 'download' });
    }
  }

  async function pollActive() {
    const active = all(db, `SELECT id FROM forma_reconstruction_jobs WHERE ${activeWhere} AND provider = ?`, provider ? provider.name : 'kiri');
    for (const { id } of active) await refresh(id);
    sweep();
    return active.length;
  }

  // Retenção: uploads de tarefas com falha somem depois de 48 h; temporários órfãos depois de 1 h.
  // Roda também sem processamento real (timer próprio em app.js), senão nada seria apagado em modo simulado.
  function sweep() {
    const cutoff = new Date(Date.now() - KEEP_FAILED_HOURS * 3600e3).toISOString();
    for (const { id } of all(db, "SELECT id FROM forma_reconstruction_jobs WHERE status IN ('error','expired') AND finished_at < ?", cutoff)) cleanupUploads(id);
    sweepTemp();
  }

  // Arquivos guardados de uma tarefa (na ordem original), ou [] quando já foram removidos.
  function storedFiles(id) {
    const dir = jobDir(id);
    if (!fs.existsSync(dir)) return [];
    const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' };
    return fs.readdirSync(dir).sort().map((name) => {
      const p = path.join(dir, name);
      return { path: p, name: name.replace(/^\d{3}-/, ''), mime: MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream', size: fs.statSync(p).size };
    });
  }

  // "Tentar novamente": reenvia ao serviço os arquivos já guardados, sem pedir upload de novo.
  // Conta como um novo envio no limite de custo (FORMA_MAX_REAL_JOBS).
  async function retry(id) {
    if (!runtime.enabled || !provider) throw new JobError(`Processamento real indisponível. ${runtime.reason}`.trim(), 503, 'REAL_PROCESSING_DISABLED');
    const job = get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
    if (!job) return null;
    if (!['error', 'expired'].includes(job.status)) throw new JobError('Só uma tarefa com falha pode ser reenviada.', 409, 'NOT_RETRYABLE');
    if (NOT_RETRYABLE_CODES.has(job.error_code)) throw new JobError('Reenviar as mesmas fotos não muda este resultado. Refaça a captura ou fale com o suporte.', 409, 'NOT_RETRYABLE');
    const files = storedFiles(id);
    if (!files.length) throw new JobError('Os arquivos desta tarefa não estão mais guardados. Envie a captura novamente.', 410, 'FILES_GONE');
    if (countRealJobs() >= f.maxRealJobs) throw new JobError(`Limite de ${f.maxRealJobs} envio(s) real(is) atingido neste ambiente (FORMA_MAX_REAL_JOBS).`, 429, 'JOB_LIMIT');
    const opts = safeJson(job.options_json) || {};
    // O `serialize` da tentativa anterior fica no histórico: é o que o suporte do serviço pede.
    opts.history = [...(opts.history || [])];
    if (job.provider_ref && !opts.history.some((h) => h.providerRef === job.provider_ref)) opts.history.push({ providerRef: job.provider_ref, at: job.created_at });
    if (opts.history.length) opts.history[opts.history.length - 1] = { ...opts.history[opts.history.length - 1], outcome: job.error_code || job.status, finishedAt: job.finished_at };
    opts.firstCreatedAt = opts.firstCreatedAt || job.created_at;
    run(db, `UPDATE forma_reconstruction_jobs SET status = 'uploading', stage = ?, error_message = NULL, error_code = NULL, error_stage = NULL, provider_ref = NULL,
             provider_status = NULL, poll_attempts = 0, poll_errors = 0, attempts = attempts + 1, created_at = ?, updated_at = ?, finished_at = NULL, next_poll_at = ?, options_json = ? WHERE id = ?`,
      STAGE_LABEL.uploading, nowIso(), nowIso(), nowIso(), JSON.stringify(opts), id);
    log.log?.(`[forma] tarefa ${id}: nova tentativa com ${files.length} arquivo(s) guardado(s)`);
    startUpload(id, job.method, files, opts.options || {}).catch((e) => log.error(`[forma] tarefa ${id}: ${cleanMessage(e)}`));
    return get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
  }

  async function cancel(id) {
    const job = get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
    if (!job) return null;
    if (ACTIVE.includes(job.status)) {
      if (provider && job.provider_ref) await provider.cancelJob(job.provider_ref).catch(() => {});
      fail(id, 'Cancelado pelo usuário.', 'cancelled');
    }
    return get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
  }

  function remove(id) {
    const job = get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
    if (!job) return false;
    for (const a of all(db, 'SELECT rel_path FROM forma_reconstruction_assets WHERE job_id = ?', id)) removeQuiet(resolveUnder(f.dir, a.rel_path));
    cleanupUploads(id);
    run(db, 'DELETE FROM forma_reconstruction_jobs WHERE id = ?', id);
    return true;
  }

  function cleanupUploads(id) { try { fs.rmSync(jobDir(id), { recursive: true, force: true }); } catch { /* ignora */ } }
  // Cada envio ao serviço conta (uma tarefa reenviada conta duas vezes): é o que consome créditos.
  function countRealJobs() { return get(db, "SELECT COALESCE(SUM(attempts), 0) AS n FROM forma_reconstruction_jobs WHERE provider = 'kiri' AND status <> 'cancelled'").n; }
  function modelPath(id) {
    const a = get(db, "SELECT rel_path FROM forma_reconstruction_assets WHERE job_id = ? AND kind = 'model' ORDER BY id DESC LIMIT 1", id);
    return a ? resolveUnder(f.dir, a.rel_path) : null;
  }

  // Visão pública: nunca inclui provider_ref, caminhos ou links temporários.
  function publicView(row) {
    if (!row) return null;
    const opts = safeJson(row.options_json);
    return {
      jobId: row.id, provider: row.provider, simulated: false, method: row.method,
      status: row.status, stage: row.stage || STAGE_LABEL[row.status] || '', providerStatus: row.provider_status,
      progress: null, // o KIRI não informa percentual; a interface mostra etapas e animação indeterminada
      message: row.error_message || '', warning: opts?.warning || '',
      errorCode: row.error_code || null, errorStage: row.error_stage || null, attempts: row.attempts || 1,
      retryable: ['error', 'expired'].includes(row.status) && !NOT_RETRYABLE_CODES.has(row.error_code) && fs.existsSync(jobDir(row.id)),
      quality: opts?.options?.quality || 'standard', surface: opts?.options?.surface || 'normal', endpoint: opts?.endpoint || row.method,
      fileCount: row.file_count, bytes: row.bytes, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at,
      modelUrl: row.status === 'done' ? `/api/forma/reconstruction/jobs/${row.id}/model` : null,
    };
  }

  const getJob = (id) => get(db, 'SELECT * FROM forma_reconstruction_jobs WHERE id = ?', id);
  // Boot: temporários órfãos somem e envios interrompidos recomeçam.
  sweepTemp();
  try { recoverOrphans(); } catch (e) { log.error(`[forma] recuperação de tarefas: ${cleanMessage(e)}`); }
  return { createJob, refresh, pollActive, sweep, cancel, remove, retry, countRealJobs, modelPath, publicView, getJob, dirs, validatePhotos, validateVideo, storedFiles };
}

function readHead(filePath, n) {
  const fd = fs.openSync(filePath, 'r');
  try { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, r); } finally { fs.closeSync(fd); }
}
function safeName(original, ext) {
  const base = String(original || 'arquivo').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'arquivo';
  return `${base}.${ext}`;
}
function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
