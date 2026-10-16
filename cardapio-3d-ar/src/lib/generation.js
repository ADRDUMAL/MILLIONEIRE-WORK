// Orquestra tentativas de geração 3D: início manual pelo admin, polling e recebimento do modelo.
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, audit } from '../db.js';
import { analyzeGlb } from './glb.js';
import { writeUnder, randomName, resolveUnder } from './files.js';

const IN_PIPELINE = ['awaiting_review', 'approved_for_generation', 'generating', 'model_review', 'published'];

export function planUsage(db, restaurant) {
  const dishes3d = get(db, `SELECT COUNT(*) AS n FROM dishes WHERE restaurant_id = ? AND status IN (${IN_PIPELINE.map(() => '?').join(',')})`, restaurant.id, ...IN_PIPELINE).n;
  const attempts = get(db, 'SELECT COUNT(*) AS n FROM generation_attempts a JOIN dishes d ON d.id = a.dish_id WHERE d.restaurant_id = ? AND a.provider != ?', restaurant.id, 'manual').n;
  const subscriptionOk = ['trial', 'active'].includes(restaurant.subscription_status);
  return {
    dishes3d, maxDishes3d: restaurant.max_dishes_3d, dishesLeft: Math.max(0, restaurant.max_dishes_3d - dishes3d),
    attempts, maxAttempts: restaurant.max_attempts, attemptsLeft: Math.max(0, restaurant.max_attempts - attempts),
    subscriptionOk,
  };
}

// Inicia uma tentativa com o fornecedor configurado. Nunca é chamado automaticamente.
export async function startGeneration({ db, cfg, provider, dish, restaurant, userId }) {
  if (!provider.configured) throw new Error('Gerador não configurado (TRIPO_API_KEY ausente). Use o envio manual de GLB.');
  const usage = planUsage(db, restaurant);
  if (!usage.subscriptionOk) throw new Error('Assinatura do restaurante não está ativa.');
  if (usage.attemptsLeft <= 0) throw new Error(`Limite de tentativas do plano atingido (${usage.attempts}/${usage.maxAttempts}). Aumente o limite no cadastro do restaurante.`);
  if (get(db, "SELECT 1 FROM generation_attempts WHERE dish_id = ? AND status IN ('queued','running')", dish.id)) throw new Error('Já existe uma geração em andamento para este prato.');

  const caps = Object.fromEntries(all(db, 'SELECT * FROM captures WHERE dish_id = ?', dish.id).map((c) => [c.position, c]));
  for (const p of ['front', 'left', 'back', 'right']) if (!caps[p]) throw new Error(`Falta a foto "${p}" para gerar.`);

  const attemptNo = (get(db, 'SELECT COALESCE(MAX(attempt_no),0) AS n FROM generation_attempts WHERE dish_id = ?', dish.id).n || 0) + 1;
  const { lastInsertRowid: attemptId } = run(db,
    'INSERT INTO generation_attempts (dish_id, attempt_no, provider, status, estimated_cost_usd, triggered_by) VALUES (?,?,?,?,?,?)',
    dish.id, attemptNo, provider.name, 'queued', provider.estimatedCostUsd, userId);
  run(db, "UPDATE dishes SET status = 'generating', updated_at = datetime('now') WHERE id = ?", dish.id);
  try {
    const tokens = {};
    for (const p of ['front', 'left', 'back', 'right']) {
      const abs = resolveUnder(cfg.privateDir, caps[p].private_path);
      tokens[p] = await provider.uploadImage(fs.readFileSync(abs), `${p}.${caps[p].mime.split('/')[1]}`, caps[p].mime);
    }
    const { taskId } = await provider.createMultiview(tokens);
    run(db, "UPDATE generation_attempts SET provider_task_id = ?, status = 'running' WHERE id = ?", taskId, attemptId);
    audit(db, { userId, restaurantId: dish.restaurant_id, dishId: dish.id, action: 'generation.start', detail: { attemptId, taskId } });
    return { attemptId, taskId };
  } catch (e) {
    run(db, "UPDATE generation_attempts SET status = 'failed', error_message = ?, finished_at = datetime('now') WHERE id = ?", String(e.message).slice(0, 500), attemptId);
    run(db, "UPDATE dishes SET status = 'failed', updated_at = datetime('now') WHERE id = ?", dish.id);
    throw e;
  }
}

// Verifica tentativas pendentes. Chamado por timer e pelo botão "Verificar agora".
export async function pollPending({ db, cfg, provider, log = console }) {
  if (!provider.configured) return [];
  const pending = all(db, "SELECT * FROM generation_attempts WHERE status IN ('queued','running') AND provider = ? AND provider_task_id IS NOT NULL", provider.name);
  const results = [];
  for (const a of pending) {
    try {
      const t = await provider.getTask(a.provider_task_id);
      if (t.status === 'queued' || t.status === 'running') {
        run(db, 'UPDATE generation_attempts SET progress = ? WHERE id = ?', t.progress, a.id);
      } else if (t.status === 'success' && t.modelUrl) {
        const buf = await provider.download(t.modelUrl, cfg.maxModelBytes);
        const info = analyzeGlb(buf); // valida estrutura e mede a caixa
        const rel = path.posix.join('models', randomName('glb'));
        writeUnder(cfg.privateDir, rel, buf);
        const { lastInsertRowid: modelId } = run(db,
          'INSERT INTO models (dish_id, attempt_id, source, original_private_path, bbox_json, glb_bytes) VALUES (?,?,?,?,?,?)',
          a.dish_id, a.id, provider.name, rel, JSON.stringify(info.bbox), buf.length);
        run(db, "UPDATE generation_attempts SET status = 'success', progress = 100, actual_credits = ?, finished_at = datetime('now') WHERE id = ?", t.credits, a.id);
        run(db, "UPDATE dishes SET status = 'model_review', updated_at = datetime('now') WHERE id = ?", a.dish_id);
        audit(db, { dishId: a.dish_id, action: 'generation.success', detail: { attemptId: a.id, modelId, credits: t.credits } });
      } else {
        run(db, "UPDATE generation_attempts SET status = ?, error_message = ?, actual_credits = ?, finished_at = datetime('now') WHERE id = ?",
          t.status === 'cancelled' ? 'cancelled' : 'failed', (t.error || 'sem modelo na resposta').slice(0, 500), t.credits, a.id);
        run(db, "UPDATE dishes SET status = 'failed', updated_at = datetime('now') WHERE id = ?", a.dish_id);
      }
      results.push({ attemptId: a.id, status: t.status });
    } catch (e) {
      log.error(`[geração] tentativa ${a.id}: ${e.message}`);
      results.push({ attemptId: a.id, error: e.message });
    }
  }
  return results;
}
