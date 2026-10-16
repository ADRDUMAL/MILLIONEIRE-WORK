// Adaptador Tripo (API v3). Referências oficiais:
//   POST {base}/files                            -> { data: { file_token } }
//   POST {base}/generation/multiview-to-model    -> { data: { task_id } }
//   GET  {base}/tasks/{task_id}                  -> { data: { status, progress, output.model_url, credits_consumed, error_message } }
// A chave nunca sai do servidor.

export function tripoProvider(cfg) {
  const { apiKey, baseUrl, model, estimatedCostUsd } = cfg;
  const headers = () => ({ Authorization: `Bearer ${apiKey}` });

  async function call(path, init = {}) {
    const res = await fetch(baseUrl + path, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
    let body = null;
    try { body = await res.json(); } catch { /* sem json */ }
    if (!res.ok || (body && body.code != null && body.code !== 0)) {
      const msg = body?.message || body?.error || `HTTP ${res.status}`;
      throw new Error(`Tripo ${path}: ${msg}`);
    }
    return body?.data ?? body;
  }

  return {
    name: 'tripo',
    label: `Tripo (${model})`,
    configured: !!apiKey,
    estimatedCostUsd,

    async uploadImage(buf, filename, mime) {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: mime }), filename);
      const data = await call('/files', { method: 'POST', body: fd });
      if (!data?.file_token) throw new Error('Tripo: upload sem file_token');
      return data.file_token;
    },

    // views: { front, left, back, right } -> file_token (front obrigatório).
    async createMultiview(views) {
      const inputs = [];
      for (const k of ['front', 'left', 'back', 'right']) if (views[k]) inputs.push({ [k]: { file_token: views[k] } });
      if (!views.front) throw new Error('Vista frontal é obrigatória');
      const payload = { inputs, model, texture: true, pbr: true, texture_quality: 'standard' };
      if (cfg.faceLimit) payload.face_limit = Number(cfg.faceLimit);
      const data = await call('/generation/multiview-to-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!data?.task_id) throw new Error('Tripo: resposta sem task_id');
      return { taskId: data.task_id };
    },

    // Normaliza para { status: queued|running|success|failed|cancelled, progress, modelUrl, credits, error }
    async getTask(taskId) {
      const d = await call(`/tasks/${encodeURIComponent(taskId)}`);
      const status = ['queued', 'running', 'success', 'failed', 'cancelled'].includes(d.status) ? d.status : (d.status === 'unknown' ? 'running' : 'failed');
      return {
        status,
        progress: Number(d.progress || 0),
        modelUrl: d.output?.model_url || d.output?.pbr_model || null,
        previewUrl: d.output?.rendered_image_url || null,
        credits: d.credits_consumed != null ? Number(d.credits_consumed) : null,
        error: d.error_message || (d.error_code ? `código ${d.error_code}` : ''),
      };
    },

    async download(url, maxBytes) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download do modelo falhou: HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > maxBytes) throw new Error(`Modelo com ${(len / 1e6).toFixed(1)} MB excede o limite`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error('Modelo excede o limite de tamanho');
      return buf;
    },
  };
}
