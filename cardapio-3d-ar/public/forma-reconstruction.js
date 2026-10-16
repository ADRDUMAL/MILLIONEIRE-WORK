// Provider de reconstrução 3D — ponto único de troca para a API real (KIRI Engine, Tripo, etc.).
//
// Contrato (todo método devolve Promise):
//   createJob({ productId, method, fileCount })  -> { jobId, status, steps }
//   getJobStatus(jobId)                          -> { jobId, status, progress, stepIndex, steps }
//   getResult(jobId)                             -> { modelUrl, format, simulated }
//   cancelJob(jobId)                             -> boolean
//
// ATENÇÃO: nesta fase existe apenas o MockReconstructionProvider. Ele NÃO reconstrói nada —
// percorre etapas por tempo decorrido e entrega um GLB de demonstração já presente no projeto.
// Toda a simulação (tempos, progresso, resultado) fica aqui; as telas só consultam o provider.
//
// Fase 3B: o provider real é o RemoteReconstructionProvider (fim do arquivo), que só chama o backend
// da Forma 3D (/api/forma/reconstruction). O servidor decide, via variáveis de ambiente, se fala com
// o KIRI Engine (src/forma/providers/kiri.js) ou se o navegador deve continuar na simulação.
window.FormaReconstruction = (function () {
  'use strict';
  var JKEY = 'forma3d.jobs.v1';

  // Etapas exibidas na tela de processamento (percentual em que cada uma conclui).
  var STEPS = [
    { label: 'Enviando imagens', done: 8 },
    { label: 'Verificando captura', done: 22 },
    { label: 'Reconstruindo geometria', done: 62 },
    { label: 'Criando textura', done: 90 },
    { label: 'Preparando modelo', done: 100 },
  ];
  // Modelos de demonstração usados como resultado simulado (já existem em samples/demo).
  var DEMO_MODELS = ['/static/samples/demo/caneca.glb', '/static/samples/demo/cadeira.glb', '/static/samples/demo/tenis.glb'];

  function readJobs() { try { return JSON.parse(localStorage.getItem(JKEY) || '{}') || {}; } catch (e) { return {}; } }
  function writeJobs(j) { try { localStorage.setItem(JKEY, JSON.stringify(j)); } catch (e) {} }

  var MockReconstructionProvider = {
    name: 'mock',
    simulated: true,

    // SIMULADO: nenhum arquivo é enviado a lugar nenhum; só registra a tarefa localmente.
    createJob: function (input) {
      input = input || {};
      var jobs = readJobs();
      var jobId = 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      // Duração proporcional à quantidade de arquivos, dentro de limites curtos para o preview.
      var files = Math.max(1, Number(input.fileCount) || 1);
      var duration = Math.min(42000, 14000 + files * 900);
      jobs[jobId] = {
        jobId: jobId, productId: input.productId || '', method: input.method || 'photos',
        startedAt: Date.now(), durationMs: duration, fileCount: files,
        modelUrl: DEMO_MODELS[Math.floor(Math.random() * DEMO_MODELS.length)],
        status: 'processing', failed: false,
      };
      writeJobs(jobs);
      return Promise.resolve({ jobId: jobId, status: 'processing', steps: STEPS.slice() });
    },

    getJobStatus: function (jobId) {
      var job = readJobs()[jobId];
      if (!job) return Promise.reject(new Error('Tarefa não encontrada. Ela pode ter sido removida deste navegador.'));
      var elapsed = Date.now() - job.startedAt;
      var progress = Math.max(0, Math.min(100, (elapsed / job.durationMs) * 100));
      var stepIndex = STEPS.findIndex(function (s) { return progress < s.done; });
      var done = progress >= 100;
      return Promise.resolve({
        jobId: jobId, status: job.failed ? 'error' : (done ? 'done' : 'processing'),
        progress: done ? 100 : progress, stepIndex: stepIndex < 0 ? STEPS.length - 1 : stepIndex,
        steps: STEPS.slice(), simulated: true,
        errorCode: job.failed ? 'RECONSTRUCTION_FAILED' : null, message: job.failed ? 'Falha simulada no preview.' : '', retryable: false,
      });
    },

    // SIMULADO: devolve um GLB de demonstração do próprio projeto, não um modelo do produto enviado.
    getResult: function (jobId) {
      var jobs = readJobs(), job = jobs[jobId];
      if (!job) return Promise.reject(new Error('Tarefa não encontrada.'));
      var elapsed = Date.now() - job.startedAt;
      if (elapsed < job.durationMs) return Promise.reject(new Error('A tarefa ainda está em processamento.'));
      job.status = 'done'; writeJobs(jobs);
      return Promise.resolve({ modelUrl: job.modelUrl, format: 'glb', simulated: true, provider: 'mock' });
    },

    cancelJob: function (jobId) {
      var jobs = readJobs();
      if (jobs[jobId]) { delete jobs[jobId]; writeJobs(jobs); }
      return Promise.resolve(true);
    },

    // Só para o preview: força o estado de erro e permite testar a tela de falha.
    failJob: function (jobId) {
      var jobs = readJobs();
      if (jobs[jobId]) { jobs[jobId].failed = true; writeJobs(jobs); }
      return Promise.resolve(true);
    },
    dropJob: function (jobId) { return this.cancelJob(jobId); },
  };

  // ---------- Provider remoto (Fase 3B): fala SOMENTE com o backend da Forma 3D ----------
  // O servidor é quem conversa com o KIRI Engine; a chave nunca chega ao navegador. Os ids de
  // tarefas reais começam com "frj_"; os simulados, com "job_" — assim tarefas antigas seguem funcionando.
  // Cinco etapas visíveis. O serviço real só informa três estados (enviando, na fila, processando):
  // geometria e textura acontecem juntas lá dentro, então as duas ficam ativas ao mesmo tempo —
  // nada de percentual ou etapa inventada.
  var REMOTE_STEPS = [
    { key: 'uploading', label: 'Enviando imagens' },
    { key: 'queued', label: 'Verificando captura' },
    { key: 'processing', label: 'Reconstruindo geometria' },
    { key: 'texture', label: 'Criando textura' },
    { key: 'finishing', label: 'Preparando modelo' },
  ];
  var API = '/api/forma/reconstruction';
  // Cabeçalho que o servidor exige nas mutações desta API (proteção CSRF sem token de formulário).
  var HDR = { 'X-Requested-With': 'FormaStudio' };
  function parseResponse(res) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      if (!res.ok) { var err = new Error((body.error && body.error.message) || ('Erro ' + res.status)); err.code = body.error && body.error.code; err.status = res.status; throw err; }
      return body;
    });
  }
  function remoteView(job) {
    var idx = { uploading: 0, queued: 1, processing: 2, done: 5 }[job.status];
    if (idx == null) idx = 2;
    var activeTo = idx === 2 ? 3 : idx;
    // O servidor baixa e valida o GLB depois que o serviço termina: é a etapa "Preparando modelo".
    if (job.status === 'processing' && /baixando|validando/i.test(job.stage || '')) { idx = 4; activeTo = 4; }
    return {
      activeTo: activeTo,
      jobId: job.jobId, status: job.status === 'expired' || job.status === 'cancelled' ? 'error' : job.status, rawStatus: job.status,
      stage: job.stage || '', message: job.message || '', warning: job.warning || '',
      errorCode: job.errorCode || null, errorStage: job.errorStage || null, retryable: !!job.retryable, attempts: job.attempts || 1,
      quality: job.quality || 'standard', surface: job.surface || 'normal', method: job.method, fileCount: job.fileCount, bytes: job.bytes,
      createdAt: job.createdAt, updatedAt: job.updatedAt,
      progress: null, stepIndex: idx, steps: REMOTE_STEPS.slice(), simulated: false, provider: job.provider || 'kiri', modelUrl: job.modelUrl || null,
    };
  }
  var RemoteReconstructionProvider = {
    name: 'remote',
    simulated: false,
    // XHR em vez de fetch: é o único jeito de ter progresso REAL do upload (upload.onprogress).
    createJob: function (input) {
      input = input || {};
      var fd = new FormData();
      fd.append('method', input.method || 'photos');
      fd.append('productId', input.productId || '');
      var o = input.options || {};
      if (o.quality) fd.append('quality', o.quality);
      if (o.surface) fd.append('surface', o.surface);
      if (o.isMask === 0 || o.isMask === 1) fd.append('isMask', String(o.isMask));
      (input.files || []).forEach(function (f) { fd.append(input.method === 'video' ? 'video' : 'photos', f, f.name); });
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API + '/jobs?method=' + encodeURIComponent(input.method || 'photos'));
        xhr.setRequestHeader('X-Requested-With', 'FormaStudio');
        if (input.clientKey) xhr.setRequestHeader('Idempotency-Key', input.clientKey);
        xhr.timeout = 20 * 60 * 1000;
        xhr.upload.onprogress = function (e) { if (input.onProgress && e.lengthComputable) input.onProgress(e.loaded, e.total); };
        var fail = function (code, message) { var err = new Error(message); err.code = code; reject(err); };
        xhr.onerror = function () { fail('UPLOAD_FAILED', 'A conexão caiu durante o envio.'); };
        xhr.ontimeout = function () { fail('UPLOAD_TIMEOUT', 'O envio demorou demais e foi interrompido.'); };
        xhr.onabort = function () { fail('UPLOAD_ABORTED', 'O envio foi cancelado.'); };
        xhr.onload = function () {
          var body = null;
          try { body = JSON.parse(xhr.responseText || 'null'); } catch (e) { body = null; }
          if (!body) return fail(xhr.status >= 500 || xhr.status === 0 ? 'SERVER_UNAVAILABLE' : 'INVALID_RESPONSE', 'O servidor respondeu de um jeito inesperado (HTTP ' + xhr.status + ').');
          if (xhr.status < 200 || xhr.status >= 300) { var err = new Error((body.error && body.error.message) || ('Erro ' + xhr.status)); err.code = body.error && body.error.code; err.status = xhr.status; return reject(err); }
          var v = remoteView(body.job); v.warning = body.warning || v.warning; v.duplicate = !!body.duplicate; resolve(v);
        };
        xhr.send(fd);
      });
    },
    retryJob: function (jobId) {
      return fetch(API + '/jobs/' + encodeURIComponent(jobId) + '/retry', { method: 'POST', headers: HDR }).then(parseResponse).then(function (body) { return remoteView(body.job); });
    },
    getJobStatus: function (jobId) {
      return fetch(API + '/jobs/' + encodeURIComponent(jobId), { cache: 'no-store' }).then(parseResponse).then(function (body) { return remoteView(body.job); });
    },
    getResult: function (jobId) {
      return this.getJobStatus(jobId).then(function (v) {
        if (v.status !== 'done' || !v.modelUrl) throw new Error('A tarefa ainda não terminou.');
        return { modelUrl: v.modelUrl, format: 'glb', simulated: false, provider: v.provider };
      });
    },
    cancelJob: function (jobId) { return fetch(API + '/jobs/' + encodeURIComponent(jobId), { method: 'DELETE', headers: HDR }).then(function (r) { return r.ok; }).catch(function () { return false; }); },
    failJob: function () { return Promise.resolve(false); }, // só existe no simulado
    dropJob: function (jobId) { return fetch(API + '/jobs/' + encodeURIComponent(jobId) + '?purge=1', { method: 'DELETE', headers: HDR }).then(function (r) { return r.ok; }).catch(function () { return false; }); },
  };

  // Seleção: o servidor informa se o processamento real está ligado; senão, simulação (fallback).
  var active = MockReconstructionProvider;
  var api = { STEPS: STEPS, REMOTE_STEPS: REMOTE_STEPS, mode: 'mock', simulated: true, config: null, providers: { mock: MockReconstructionProvider, remote: RemoteReconstructionProvider } };
  var providerFor = function (jobId) { return /^frj_/.test(String(jobId || '')) ? RemoteReconstructionProvider : MockReconstructionProvider; };
  api.ready = fetch(API + '/config', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (cfg) {
    api.config = cfg;
    if (cfg && cfg.enabled && cfg.mode === 'kiri') { active = RemoteReconstructionProvider; api.mode = 'kiri'; api.simulated = false; }
    return cfg;
  }).catch(function () {
    api.config = { enabled: false, mode: 'mock', simulated: true, reason: 'Servidor da Forma 3D indisponível; usando simulação.', limits: {} };
    return api.config;
  });
  api.createJob = function (input) {
    // A simulação não envia nada: o progresso de upload fecha na hora para a tela seguir igual.
    if (active === MockReconstructionProvider && input && input.onProgress) input.onProgress(1, 1);
    return active.createJob(input);
  };
  api.retryJob = function (jobId) { return /^frj_/.test(String(jobId || '')) ? RemoteReconstructionProvider.retryJob(jobId) : Promise.reject(new Error('Só tarefas reais podem ser reenviadas.')); };

  // ---------- Erros explicáveis ----------
  // Código técnico (servidor ou cliente) -> título humano + causa + o que fazer. Nunca só "Erro".
  var EXPLAIN = {
    FILE_TOO_LARGE: ['Arquivo grande demais', 'Um dos arquivos passa do tamanho aceito.', 'Reduza o arquivo ou use outro método.'],
    INVALID_VIDEO: ['Formato não suportado', 'O serviço aceita vídeo MP4 ou MOV.', 'Grave de novo pela câmera do celular ou exporte em MP4.'],
    VIDEO_TOO_LONG: ['Vídeo longo demais', 'O limite para envio direto é de 3 minutos.', 'Corte o vídeo para uma volta de 30 a 90 segundos.'],
    VIDEO_TOO_LARGE: ['Resolução acima do limite', 'O envio direto aceita vídeos até 1920 × 1080.', 'Grave em 1080p ou abra esta página no celular, que extrai os quadros aqui.'],
    TOO_FEW_PHOTOS: ['Poucas fotos', 'São necessárias pelo menos 20 fotos.', 'Faça mais uma volta ao redor do produto.'],
    TOO_MANY_PHOTOS: ['Fotos demais', 'O limite é de 300 fotos.', 'Remova as repetidas.'],
    INVALID_IMAGE: ['Imagem inválida', 'Um dos arquivos não é JPG, PNG ou WebP.', 'Remova o arquivo e tente de novo.'],
    UPLOAD_FAILED: ['O envio falhou', 'A conexão caiu durante o envio.', 'Confira a internet e tente de novo.'],
    UPLOAD_TIMEOUT: ['O envio demorou demais', 'A conexão está lenta para o tamanho dos arquivos.', 'Tente em uma rede Wi-Fi.'],
    UPLOAD_ABORTED: ['Envio cancelado', 'O envio foi interrompido.', 'Tente de novo.'],
    SERVER_UNAVAILABLE: ['Servidor indisponível', 'O servidor da Forma 3D não respondeu.', 'Tente de novo em alguns minutos.'],
    INVALID_RESPONSE: ['Resposta inesperada', 'O serviço de reconstrução respondeu de um jeito que não reconhecemos.', 'Tente de novo; se repetir, fale com o suporte.'],
    KIRI_AUTH: ['Problema de credencial', 'O serviço de reconstrução recusou a chave de acesso da Forma 3D.', 'Isso é do nosso lado: avise o suporte. Seus arquivos ficaram guardados.'],
    KIRI_CREDITS: ['Créditos esgotados', 'A conta do serviço de reconstrução está sem saldo.', 'Avise o suporte. Seus arquivos ficaram guardados para tentar de novo.'],
    KIRI_REJECTED: ['O serviço recusou o envio', 'O serviço de reconstrução não aceitou os arquivos.', 'Confira o formato e tente de novo.'],
    RECONSTRUCTION_FAILED: ['A reconstrução falhou', 'O serviço não conseguiu montar o modelo com estas imagens.', 'Mais fotos, luz uniforme e fundo simples costumam resolver.'],
    RESULT_EXPIRED: ['O resultado expirou', 'O modelo ficou pronto, mas expirou antes de ser baixado.', 'Tente de novo.'],
    RESULT_INVALID: ['Modelo inválido', 'O arquivo devolvido pelo serviço não passou na validação.', 'Tente de novo.'],
    DOWNLOAD_FAILED: ['Falha ao baixar o modelo', 'O modelo ficou pronto, mas o download falhou.', 'Tente de novo.'],
    POLL_FAILED: ['Perdemos contato com o serviço', 'O serviço de reconstrução parou de responder.', 'Tente de novo em alguns minutos.'],
    JOB_TIMEOUT: ['Tempo esgotado', 'A reconstrução passou do tempo limite.', 'Tente de novo.'],
    JOB_LIMIT: ['Limite de processamentos atingido', 'Este ambiente já usou todos os processamentos reais permitidos.', 'Aumente FORMA_MAX_REAL_JOBS no servidor.'],
    REAL_PROCESSING_DISABLED: ['Processamento indisponível', 'O processamento real está desligado neste servidor.', ''],
    FILES_GONE: ['Arquivos não estão mais guardados', 'Os arquivos desta tentativa já foram apagados do servidor.', 'Envie a captura de novo.'],
    VIDEO_FORMAT: ['Formato não suportado', 'O serviço aceita vídeo MP4 ou MOV.', 'Grave de novo pela câmera do celular ou exporte em MP4.'],
    VIDEO_FILE_SIZE: ['Arquivo grande demais', 'O vídeo passa do tamanho aceito para envio direto.', 'Abra esta página no celular em que o vídeo foi gravado: lá extraímos os quadros sem enviar o vídeo inteiro.'],
    VIDEO_RESOLUTION: ['Resolução acima do limite', 'O envio direto aceita vídeos até 1920 × 1080.', 'Grave em 1080p, ou abra esta página no navegador do celular para extrair os quadros aqui.'],
    VIDEO_CODEC: ['Codec não suportado neste navegador', 'O vídeo usa um codec que este navegador não abre.', 'Abra esta página no celular em que o vídeo foi gravado.'],
    VIDEO_FEW_FRAMES: ['Poucos ângulos no vídeo', 'O vídeo tem poucos trechos diferentes do produto.', 'Grave uma volta completa, devagar, com 30 segundos ou mais.'],
    ADMIN_REQUIRED: ['Acesso restrito', 'Neste servidor, o processamento real só pode ser acionado por um administrador conectado.', 'Entre com a conta de administrador e tente de novo.'],
    CSRF: ['Sessão expirada', 'A sessão desta página não é mais válida.', 'Recarregue a página e tente de novo.'],
    TOO_MANY_FILES: ['Arquivos demais', 'O limite é de 300 fotos ou 1 vídeo por envio.', 'Remova as repetidas e tente de novo.'],
    EMPTY_FILE: ['Arquivo vazio', 'Um dos arquivos enviados está vazio.', 'Remova o arquivo e tente de novo.'],
    NO_VIDEO: ['Vídeo ausente', 'O envio não trouxe nenhum vídeo.', 'Grave ou escolha um vídeo e tente de novo.'],
    INVALID_METHOD: ['Método inválido', 'O envio não disse se são fotos ou vídeo.', 'Recarregue a página e tente de novo.'],
    NOT_RETRYABLE: ['Não dá para reenviar', 'Reenviar os mesmos arquivos não mudaria o resultado.', 'Refaça a captura ou fale com o suporte.'],
    UPLOAD_INTERRUPTED: ['Envio interrompido', 'O servidor reiniciou enquanto enviava seus arquivos ao serviço.', 'Toque em "Tentar novamente": os arquivos ficaram guardados.'],
    NOT_FOUND: ['Tarefa não encontrada', 'Esta tarefa não existe mais no servidor.', 'Crie o produto de novo.'],
    MODEL_UNAVAILABLE: ['Modelo indisponível', 'O arquivo do modelo não está mais no servidor.', 'Reenvie a captura.'],
    INTERNAL: ['Erro no servidor', 'Algo deu errado do nosso lado.', 'Tente de novo; se repetir, fale com o suporte.'],
  };
  api.explain = function (code, message) {
    var e = EXPLAIN[code];
    return e ? { title: e[0], cause: e[1], action: e[2], code: code, detail: message || '' } : { title: 'Não foi possível concluir', cause: message || 'Ocorreu um erro inesperado.', action: 'Tente de novo.', code: code || 'UNKNOWN', detail: '' };
  };
  api.getJobStatus = function (jobId) { return providerFor(jobId).getJobStatus(jobId); };
  api.getResult = function (jobId) { return providerFor(jobId).getResult(jobId); };
  api.cancelJob = function (jobId) { return providerFor(jobId).cancelJob(jobId); };
  api.failJob = function (jobId) { return providerFor(jobId).failJob(jobId); };
  api.dropJob = function (jobId) { return providerFor(jobId).dropJob(jobId); };
  Object.defineProperty(api, 'provider', { get: function () { return active; } });
  return api;
})();
