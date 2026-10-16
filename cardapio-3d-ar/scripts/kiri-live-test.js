// Teste REAL contra o KIRI Engine — consome créditos. Só roda com KIRI_LIVE_TEST=true e após
// confirmação digitada no terminal. Cria exatamente UMA tarefa, acompanha até o fim, baixa e
// valida o GLB pelo mesmo serviço usado pelo servidor (src/forma/jobs.js).
//
//   npm run kiri:live -- ./pasta-com-20-a-300-fotos
//   npm run kiri:live -- ./video-360.mp4
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { loadDotEnv, buildConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { buildFormaRuntime } from '../src/forma/providers/index.js';
import { createJobService } from '../src/forma/jobs.js';

loadDotEnv();
const cfg = buildConfig();
const input = process.argv[2];

if (String(process.env.KIRI_LIVE_TEST).toLowerCase() !== 'true') {
  console.error('Recusado: defina KIRI_LIVE_TEST=true para permitir um teste real (consome créditos).');
  process.exit(2);
}
const runtime = buildFormaRuntime(cfg);
if (!runtime.enabled) {
  console.error(`Processamento real indisponível: ${runtime.reason}`);
  console.error('Configure FORMA_REAL_PROCESSING_ENABLED=1, FORMA_RECONSTRUCTION_PROVIDER=kiri e KIRI_API_KEY no .env.');
  process.exit(2);
}
if (!input || !fs.existsSync(input)) {
  console.error('Uso: npm run kiri:live -- <pasta-com-fotos | video.mp4>');
  process.exit(2);
}

const stat = fs.statSync(input);
let method, files;
if (stat.isDirectory()) {
  method = 'photos';
  files = fs.readdirSync(input).filter((n) => /\.(jpe?g|png|webp)$/i.test(n)).sort().map((n) => path.join(input, n));
} else {
  method = 'video';
  files = [input];
}
const asUpload = (p) => ({ path: p, originalname: path.basename(p), size: fs.statSync(p).size });

const db = openDb(cfg.dbFile);
const jobs = createJobService({ db, cfg, runtime, log: console });
const used = jobs.countRealJobs();
console.log(`Provider: ${runtime.label}`);
console.log(`Parâmetros: ${JSON.stringify(runtime.provider.params)}`);
console.log(`Entrada: ${method === 'photos' ? `${files.length} fotos em ${input}` : input}`);
console.log(`Tarefas reais já criadas neste ambiente: ${used} de ${cfg.forma.maxRealJobs} (FORMA_MAX_REAL_JOBS)`);
console.log('\nATENÇÃO: isto envia os arquivos ao KIRI Engine e consome créditos da sua conta.');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question('Digite SIM (maiúsculas) para criar 1 tarefa real, ou qualquer outra coisa para cancelar: ')).trim();
rl.close();
if (answer !== 'SIM') { console.log('Cancelado. Nenhum crédito consumido.'); db.close(); process.exit(0); }

// Copia para a área temporária (o serviço move os arquivos para uploads/<job>).
const tmp = path.join(jobs.dirs.temp, `live-${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
const staged = files.map((f) => { const d = path.join(tmp, path.basename(f)); fs.copyFileSync(f, d); return asUpload(d); });

let job;
try {
  const r = await jobs.createJob({ method, photos: method === 'photos' ? staged : [], video: method === 'video' ? staged[0] : null, productId: 'live-test', clientKey: `live-${Date.now()}` });
  job = r.job;
  if (r.warning) console.log(`Aviso: ${r.warning}`);
  console.log(`\nTarefa criada: ${job.jobId} (${job.status})`);
} catch (e) {
  console.error(`Falha ao criar a tarefa: ${e.message}`);
  fs.rmSync(tmp, { recursive: true, force: true }); db.close(); process.exit(1);
}
fs.rmSync(tmp, { recursive: true, force: true });

// Acompanha até terminar (o servidor, se estiver rodando, também faz isso em segundo plano).
let last = '';
const started = Date.now();
while (true) {
  await new Promise((r) => setTimeout(r, Math.max(5, cfg.forma.pollSeconds) * 1000));
  const row = await jobs.refresh(job.jobId, { force: true });
  const view = jobs.publicView(row);
  const line = `${view.status} · ${view.stage}`;
  if (line !== last) { console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${line}`); last = line; }
  if (['done', 'error', 'expired', 'cancelled'].includes(view.status)) {
    if (view.status === 'done') {
      console.log(`\nModelo salvo em: ${jobs.modelPath(job.jobId)}`);
      console.log(`Abra no visualizador: http://localhost:${cfg.port}/studio/tarefas/${job.jobId}`);
      console.log(`GLB direto:          http://localhost:${cfg.port}${view.modelUrl}`);
    } else {
      console.error(`\nTarefa terminou com ${view.status}: ${view.message}`);
    }
    break;
  }
}
db.close();
