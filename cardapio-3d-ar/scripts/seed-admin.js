// Cria ou atualiza um administrador. Uso: npm run seed:admin -- email senha [nome]
// Ou via variáveis: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
import { loadDotEnv, buildConfig } from '../src/config.js';
import { openDb, get, run } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

loadDotEnv();
const [email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD, name = process.env.ADMIN_NAME || 'Admin'] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Uso: npm run seed:admin -- email senha(min 8) [nome]');
  process.exit(1);
}
const cfg = buildConfig();
const db = openDb(cfg.dbFile);
const e = email.trim().toLowerCase();
const hash = hashPassword(password);
if (get(db, 'SELECT id FROM users WHERE email = ?', e)) {
  run(db, 'UPDATE users SET password_hash = ?, is_admin = 1, name = ? WHERE email = ?', hash, name, e);
  console.log(`Admin atualizado: ${e}`);
} else {
  run(db, 'INSERT INTO users (email, password_hash, name, is_admin) VALUES (?,?,?,1)', e, hash, name);
  console.log(`Admin criado: ${e}`);
}
db.close();
