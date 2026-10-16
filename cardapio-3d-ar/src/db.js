import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, datetime('now'))").run(f);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migração ${f} falhou: ${e.message}`);
    }
  }
}

export function get(db, sql, ...p) { return db.prepare(sql).get(...p); }
export function all(db, sql, ...p) { return db.prepare(sql).all(...p); }
export function run(db, sql, ...p) { return db.prepare(sql).run(...p); }

export function audit(db, { userId = null, restaurantId = null, dishId = null, action, detail = '' }) {
  run(db, 'INSERT INTO audit_log (user_id, restaurant_id, dish_id, action, detail) VALUES (?,?,?,?,?)',
    userId, restaurantId, dishId, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
}
