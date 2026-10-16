// KiriReconstructionProvider — adaptador server-side da API aberta do KIRI Engine (Photo Scan).
// Endpoints (docs.kiriengine.app, API v1; caminhos ajustáveis via env se a API mudar):
//   POST {base}/api/v1/open/photo/image   multipart: imagesFiles[] (20–300), modelQuality, textureQuality, isMask, textureSmoothing, fileFormat
//   POST {base}/api/v1/open/photo/video   multipart: videoFile, mesmos parâmetros
//   POST {base}/api/v1/open/featureless/image  multipart: imagesFiles[] (20–300), fileFormat — superfícies lisas/reflexivas
//   GET  {base}/api/v1/open/model/getStatus?serialize=...    -> { data: { serialize, status } }
//   GET  {base}/api/v1/open/model/getModelZip?serialize=...  -> { data: { serialize, modelUrl } }  (link temporário)
// Respostas: { code: 200, msg: 'success', ok: true, data } (confirmado ao vivo em /balance). Status: -1 Uploading · 3 Queuing · 0 Processing · 1 Failed · 2 Successful · 4 Expired.
//
// A chave só existe aqui (Authorization: Bearer). Nunca é logada nem devolvida em erros — `redact()`
// remove qualquer ocorrência acidental antes de a mensagem sair do provider.
import fs from 'node:fs';

export const KIRI_STATUS = { '-1': 'uploading', 3: 'queued', 0: 'processing', 1: 'error', 2: 'done', 4: 'expired' };
export const STAGE_LABEL = {
  uploading: 'Enviando arquivos ao serviço de reconstrução',
  queued: 'Na fila do serviço de reconstrução',
  processing: 'Reconstruindo o modelo a partir das imagens',
  done: 'Modelo pronto',
  error: 'Falha na reconstrução',
  expired: 'Resultado expirou no serviço',
  cancelled: 'Cancelado',
};
const PATHS = {
  photos: '/api/v1/open/photo/image',
  video: '/api/v1/open/photo/video',
  status: '/api/v1/open/model/getStatus',
  zip: '/api/v1/open/model/getModelZip',
  featureless: '/api/v1/open/featureless/image',
  balance: '/api/v1/open/balance',
};

// `kind` separa causas que o usuário precisa entender de forma diferente:
//   auth · credits · timeout · network · invalid_response · rejected · http
export class ProviderError extends Error {
  constructor(message, { temporary = false, code = null, httpStatus = null, kind = 'rejected' } = {}) {
    super(message); this.name = 'ProviderError'; this.temporary = temporary; this.code = code; this.httpStatus = httpStatus; this.kind = kind;
  }
}

// Mensagens do KIRI que indicam saldo/créditos (a API não documenta códigos estáveis para isso).
const CREDIT_RE = /credit|balance|insufficient|saldo|quota|余额|积分/i;
const AUTH_RE = /unauthori[sz]ed|forbidden|api ?key|token|invalid key|auth/i;

export function mapKiriStatus(n) {
  const key = String(Number(n));
  return KIRI_STATUS[key] || 'processing';
}

export function kiriProvider(opts) {
  const { apiKey = '', baseUrl = 'https://api.kiriengine.app', uploadTimeoutMs = 600000, requestTimeoutMs = 30000, fetchImpl = globalThis.fetch } = opts;
  const params = {
    fileFormat: String(opts.fileFormat || 'GLB'),
    modelQuality: String(opts.modelQuality ?? 1),
    textureQuality: String(opts.textureQuality ?? 1),
    isMask: String(opts.isMask ?? 1),
    textureSmoothing: String(opts.textureSmoothing ?? 0),
  };
  const redact = (s) => (apiKey ? String(s).split(apiKey).join('[chave removida]') : String(s));

  async function call(path, { method = 'GET', body, query, timeoutMs = requestTimeoutMs } = {}) {
    const url = baseUrl + path + (query ? '?' + new URLSearchParams(query).toString() : '');
    let res;
    try {
      res = await fetchImpl(url, { method, body, headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const timeout = e.name === 'TimeoutError';
      throw new ProviderError(redact(`Sem resposta do KIRI (${timeout ? 'tempo esgotado' : 'falha de rede'})`), { temporary: true, kind: timeout ? 'timeout' : 'network' });
    }
    let json = null;
    try { json = await res.json(); } catch { /* corpo não-JSON */ }
    const msg = String(json?.msg || '');
    if (!res.ok) {
      const temporary = res.status === 429 || res.status >= 500;
      const kind = res.status === 401 || res.status === 403 ? 'auth' : CREDIT_RE.test(msg) ? 'credits' : 'http';
      throw new ProviderError(redact(`KIRI respondeu HTTP ${res.status}${msg ? `: ${msg}` : ''}`), { temporary, httpStatus: res.status, code: json?.code ?? null, kind });
    }
    if (!json) throw new ProviderError('KIRI devolveu uma resposta que não é JSON', { kind: 'invalid_response', temporary: true });
    // Sucesso no KIRI: ok:true e code 200 (verificado ao vivo); aceitamos também code 0 por compatibilidade.
    const okCode = json.code == null || [0, 200].includes(Number(json.code));
    if (json.ok === false || !okCode) {
      const kind = CREDIT_RE.test(msg) ? 'credits' : AUTH_RE.test(msg) ? 'auth' : 'rejected';
      throw new ProviderError(redact(`KIRI recusou a chamada${msg ? `: ${msg}` : ''}${json.code != null ? ` (código ${json.code})` : ''}`), { code: json.code ?? null, kind });
    }
    return json.data ?? json;
  }

  return {
    name: 'kiri',
    label: 'KIRI Engine (Photo Scan)',
    configured: !!apiKey,
    simulated: false,
    params: { ...params },
    redact,

    // Parâmetros efetivos de uma tarefa: base do .env + preset pedido. Superfícies difíceis vão para o
    // algoritmo Featureless, que só aceita fotos e só recebe o formato de saída.
    paramsFor(method, options = {}) {
      const featureless = method === 'photos' && ['smooth', 'metallic', 'transparent'].includes(options.surface);
      if (featureless) return { endpoint: 'featureless', params: { fileFormat: params.fileFormat } };
      const preset = (opts.qualityPresets || {})[options.quality] || {};
      const out = { ...params };
      if (preset.modelQuality != null) out.modelQuality = String(preset.modelQuality);
      if (preset.textureQuality != null) out.textureQuality = String(preset.textureQuality);
      if (options.isMask === 0 || options.isMask === 1) out.isMask = String(options.isMask);
      return { endpoint: method === 'video' ? 'video' : 'photos', params: out };
    },

    // files: [{ path, name, mime }]. Envia os arquivos do disco em streaming (openAsBlob).
    async createJob({ method, files, options = {} }) {
      if (!apiKey) throw new ProviderError('KIRI_API_KEY não configurada', { kind: 'auth' });
      const plan = this.paramsFor(method, options);
      const fd = new FormData();
      for (const f of files) {
        const blob = await fs.openAsBlob(f.path, { type: f.mime });
        fd.append(method === 'video' ? 'videoFile' : 'imagesFiles', blob, f.name);
      }
      for (const [k, v] of Object.entries(plan.params)) fd.append(k, v);
      const path = plan.endpoint === 'featureless' ? (opts.featurelessPath || PATHS.featureless) : plan.endpoint === 'video' ? PATHS.video : PATHS.photos;
      const data = await call(path, { method: 'POST', body: fd, timeoutMs: uploadTimeoutMs });
      if (!data?.serialize) throw new ProviderError('KIRI não devolveu o identificador (serialize) da tarefa', { kind: 'invalid_response' });
      return { providerRef: String(data.serialize), calculateType: data.calculateType ?? null, endpoint: plan.endpoint, params: plan.params };
    },

    async getJobStatus(providerRef) {
      const data = await call(PATHS.status, { query: { serialize: providerRef } });
      const providerStatus = Number(data?.status);
      const status = mapKiriStatus(providerStatus);
      return { status, providerStatus, stage: STAGE_LABEL[status], progress: null }; // KIRI não informa percentual
    },

    async getResult(providerRef) {
      const data = await call(PATHS.zip, { query: { serialize: providerRef } });
      if (!data?.modelUrl) throw new ProviderError('KIRI não devolveu o link do pacote', { kind: 'invalid_response' });
      return { downloadUrl: String(data.modelUrl), format: 'zip' };
    },

    // A API pública não expõe cancelamento; o job segue no KIRI, mas deixamos de acompanhá-lo.
    async cancelJob() { return { supported: false }; },

    async getBalance() { const d = await call(PATHS.balance); return d; },

    // Baixa o pacote com limite de tamanho e tempo, sem repassar o link temporário ao navegador.
    async download(url, { maxBytes, timeoutMs = 300000 } = {}) {
      let res;
      try { res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) }); }
      catch (e) { throw new ProviderError(`Download do pacote falhou (${e.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de rede'})`, { temporary: true }); }
      if (!res.ok) throw new ProviderError(`Download do pacote falhou: HTTP ${res.status}`, { temporary: res.status >= 500 });
      const len = Number(res.headers.get('content-length') || 0);
      if (maxBytes && len > maxBytes) throw new ProviderError(`Pacote com ${(len / 1e6).toFixed(0)} MB excede o limite`);
      const chunks = []; let total = 0;
      for await (const chunk of res.body) {
        total += chunk.length;
        if (maxBytes && total > maxBytes) throw new ProviderError('Pacote excede o limite de tamanho');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
  };
}
