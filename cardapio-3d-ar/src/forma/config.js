// Configuração da reconstrução 3D da Forma 3D (Fase 3B). Lida só no servidor.
// A chave do KIRI nunca é copiada para objetos que possam ser serializados para o navegador:
// use `publicConfig()` para o que pode sair daqui.
import path from 'node:path';

const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v || '').trim().toLowerCase());
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export function formaConfig(env, dataDir) {
  const providerName = (env.FORMA_RECONSTRUCTION_PROVIDER || 'mock').trim().toLowerCase();
  return {
    dir: path.join(dataDir, 'forma'),
    realProcessingEnabled: bool(env.FORMA_REAL_PROCESSING_ENABLED),
    allowRealInProduction: bool(env.FORMA_ALLOW_REAL_IN_PRODUCTION),
    providerName,                                   // 'mock' | 'kiri'
    maxRealJobs: num(env.FORMA_MAX_REAL_JOBS, 1),   // teto de tarefas reais criadas (controle de custo)
    uploadTimeoutMs: num(env.FORMA_UPLOAD_TIMEOUT_MS, 10 * 60 * 1000),
    jobTimeoutMin: num(env.FORMA_JOB_TIMEOUT_MIN, 120),
    pollSeconds: num(env.FORMA_POLL_SECONDS, 15),
    maxPollErrors: num(env.FORMA_MAX_POLL_ERRORS, 8),
    maxPhotoBytes: num(env.FORMA_MAX_PHOTO_BYTES, 8 * 1024 * 1024),
    maxVideoBytes: num(env.FORMA_MAX_VIDEO_BYTES, 300 * 1024 * 1024),
    maxZipBytes: num(env.FORMA_MAX_ZIP_BYTES, 400 * 1024 * 1024),
    maxModelBytes: num(env.FORMA_MAX_MODEL_BYTES, 200 * 1024 * 1024),
    photosMin: 20,
    photosMax: 300,
    videoMaxSeconds: 180,
    videoMaxWidth: 1920,
    videoMaxHeight: 1080,
    kiri: {
      apiKey: env.KIRI_API_KEY || '',
      baseUrl: (env.KIRI_BASE_URL || 'https://api.kiriengine.app').replace(/\/$/, ''),
      // Parâmetros iniciais do Photo Scan (ver docs KIRI): GLB, qualidade Medium, textura 2K,
      // máscara ativada, suavização de textura desativada (prioriza fidelidade).
      fileFormat: env.KIRI_FILE_FORMAT || 'GLB',
      modelQuality: num(env.KIRI_MODEL_QUALITY, 1),     // 0 High · 1 Medium · 2 Low · 3 Ultra
      textureQuality: num(env.KIRI_TEXTURE_QUALITY, 1), // 0 4K · 1 2K · 2 1K · 3 8K
      isMask: num(env.KIRI_IS_MASK, 1),
      textureSmoothing: num(env.KIRI_TEXTURE_SMOOTHING, 0),
      // Caminho do algoritmo para superfícies lisas, metálicas ou transparentes (Featureless Object Scan).
      featurelessPath: env.KIRI_FEATURELESS_PATH || '/api/v1/open/featureless/image',
    },
    // Presets que o navegador pode pedir por tarefa. O navegador nunca escolhe números soltos:
    // só um destes nomes, e o servidor traduz. 'standard' = parâmetros do .env (KIRI_MODEL_QUALITY etc.).
    qualityPresets: {
      high: { modelQuality: 0, textureQuality: 0, label: 'Alta · textura 4K' },
      standard: { label: 'Padrão (definido no servidor)' },
    },
    surfaces: ['normal', 'smooth', 'metallic', 'transparent'],
  };
}

// Só o que pode ir para o navegador: nada de chave, URL base ou caminhos.
export function publicConfig(cfgForma, runtime) {
  return {
    enabled: !!runtime.enabled,
    mode: runtime.mode,                    // 'kiri' | 'mock'
    provider: runtime.mode === 'kiri' ? 'kiri' : 'mock',
    simulated: runtime.mode !== 'kiri',
    reason: runtime.reason || '',
    limits: {
      photosMin: cfgForma.photosMin, photosMax: cfgForma.photosMax,
      photoMaxBytes: cfgForma.maxPhotoBytes, videoMaxBytes: cfgForma.maxVideoBytes,
      videoMaxSeconds: cfgForma.videoMaxSeconds, videoMaxWidth: cfgForma.videoMaxWidth, videoMaxHeight: cfgForma.videoMaxHeight,
      videoFormats: ['video/mp4', 'video/quicktime'],
    },
    qualities: Object.keys(cfgForma.qualityPresets || {}),
    surfaces: cfgForma.surfaces || ['normal'],
    realJobsUsed: runtime.realJobsUsed || 0,
    realJobsMax: cfgForma.maxRealJobs,
  };
}
