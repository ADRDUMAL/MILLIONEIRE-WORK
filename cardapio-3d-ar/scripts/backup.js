// Backup consistente: cópia do SQLite (VACUUM INTO) + arquivos privados/públicos.
// Uso: npm run backup  -> backups/AAAA-MM-DDTHHMM/
import fs from 'node:fs';
import path from 'node:path';
import { loadDotEnv, buildConfig } from '../src/config.js';
import { DatabaseSync } from 'node:sqlite';

loadDotEnv();
const cfg = buildConfig();
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const out = path.resolve(process.env.BACKUP_DIR || 'backups', stamp);
fs.mkdirSync(out, { recursive: true });
const db = new DatabaseSync(cfg.dbFile, { readOnly: true });
const target = path.join(out, 'app.sqlite').split(path.sep).join('/').replace(/'/g, "''");
db.exec(`VACUUM INTO '${target}'`);
db.close();
for (const dir of ['private', 'public']) {
  const src = path.join(cfg.dataDir, dir);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, dir), { recursive: true });
}
console.log(`Backup gravado em ${out}`);
