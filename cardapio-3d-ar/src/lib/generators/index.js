import { tripoProvider } from './tripo.js';

// Um único fornecedor por vez. Sem chave, o painel mostra "Gerador não configurado"
// e o caminho manual (upload de GLB/USDZ) continua disponível.
export function buildProvider(cfg) {
  const t = tripoProvider({ ...cfg.tripo, faceLimit: process.env.TRIPO_FACE_LIMIT });
  return t.configured ? t : { name: 'none', label: 'Gerador não configurado', configured: false, estimatedCostUsd: 0 };
}
