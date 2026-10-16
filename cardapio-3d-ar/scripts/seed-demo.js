// Dados de demonstração para o teste no celular: 1 admin + 2 restaurantes isolados com donos.
// Uso: npm run seed:demo   (idempotente; não apaga nada)
import { loadDotEnv, buildConfig } from '../src/config.js';
import { openDb, get, run } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

loadDotEnv();
const cfg = buildConfig();
const db = openDb(cfg.dbFile);

const ACCOUNTS = [
  { email: 'admin@demo.local', password: 'admin12345', name: 'Admin Demo', admin: true },
  { email: 'dono-a@demo.local', password: 'demo12345', name: 'Dona Ana', restaurant: { name: 'Cantina da Ana', slug: 'cantina-da-ana', tagline: 'Comida caseira desde 1998' }, dishes: [['Pratos', 'Feijoada completa', 5990, 2, 28], ['Pratos', 'Moqueca de peixe', 7490, 2, 30], ['Sobremesas', 'Pudim de leite', 1490, 1, 12]] },
  { email: 'dono-b@demo.local', password: 'demo12345', name: 'Seu Bento', restaurant: { name: 'Bistrô do Bento', slug: 'bistro-do-bento', tagline: 'Cozinha contemporânea' }, dishes: [['Entradas', 'Burrata com tomate', 4200, 2, 22], ['Principais', 'Risoto de cogumelos', 6800, 1, 26]] },
];

function upsertUser(a) {
  let u = get(db, 'SELECT id FROM users WHERE email = ?', a.email);
  if (!u) u = { id: run(db, 'INSERT INTO users (email, password_hash, name, is_admin) VALUES (?,?,?,?)', a.email, hashPassword(a.password), a.name, a.admin ? 1 : 0).lastInsertRowid };
  return u.id;
}
for (const a of ACCOUNTS) {
  const uid = upsertUser(a);
  if (!a.restaurant) continue;
  let r = get(db, 'SELECT id FROM restaurants WHERE slug = ?', a.restaurant.slug);
  if (!r) {
    r = { id: run(db, 'INSERT INTO restaurants (name, slug, tagline, plan_name, max_dishes_3d, max_attempts, subscription_status) VALUES (?,?,?,?,?,?,?)', a.restaurant.name, a.restaurant.slug, a.restaurant.tagline, 'beta', 5, 10, 'trial').lastInsertRowid };
    for (const [cat, name, price, serves, width] of a.dishes) {
      let c = get(db, 'SELECT id FROM categories WHERE restaurant_id = ? AND name = ?', r.id, cat);
      if (!c) c = { id: run(db, 'INSERT INTO categories (restaurant_id, name, sort_order) VALUES (?,?, (SELECT COALESCE(MAX(sort_order),0)+1 FROM categories WHERE restaurant_id = ?))', r.id, cat, r.id).lastInsertRowid };
      run(db, 'INSERT INTO dishes (restaurant_id, category_id, name, price_cents, serves, width_cm) VALUES (?,?,?,?,?,?)', r.id, c.id, name, price, serves, width);
    }
  }
  run(db, 'INSERT OR IGNORE INTO memberships (user_id, restaurant_id, role) VALUES (?,?,?)', uid, r.id, 'owner');
}
db.close();
console.log('Contas de demonstração (troque as senhas antes de qualquer uso real):');
for (const a of ACCOUNTS) console.log(`  ${a.admin ? 'ADMIN      ' : 'RESTAURANTE'} ${a.email} / ${a.password}${a.restaurant ? `  -> /m/${a.restaurant.slug}` : ''}`);
