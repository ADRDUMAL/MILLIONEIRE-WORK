// Seleção do provider de reconstrução no servidor. Só o KIRI é real; qualquer outra situação
// devolve `mode: 'mock'` e o navegador continua com o MockReconstructionProvider (fallback).
import { kiriProvider } from './kiri.js';

export function buildFormaRuntime(cfg, { env = process.env, fetchImpl } = {}) {
  const f = cfg.forma;
  const production = env.NODE_ENV === 'production';
  let mode = 'mock', reason = '', provider = null;
  if (!f.realProcessingEnabled) reason = 'Processamento real desligado (FORMA_REAL_PROCESSING_ENABLED).';
  else if (f.providerName !== 'kiri') reason = `Provider "${f.providerName}" não é um serviço real; usando simulação.`;
  else if (!f.kiri.apiKey) reason = 'KIRI_API_KEY não configurada; usando simulação.';
  else if (production && !f.allowRealInProduction) reason = 'Em produção o processamento real exige FORMA_ALLOW_REAL_IN_PRODUCTION=1.';
  else {
    mode = 'kiri';
    provider = kiriProvider({ ...f.kiri, qualityPresets: f.qualityPresets, uploadTimeoutMs: f.uploadTimeoutMs, fetchImpl });
  }
  return {
    mode, reason, provider,
    enabled: mode === 'kiri',
    // Em produção, além das variáveis, exige sessão de administrador do painel existente.
    requiresAdmin: production,
    label: provider ? provider.label : 'Simulação (MockReconstructionProvider no navegador)',
  };
}
