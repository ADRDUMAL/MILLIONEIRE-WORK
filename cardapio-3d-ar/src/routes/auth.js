import { Router } from 'express';
import { get, run, audit } from '../db.js';
import { hashPassword, verifyPassword, createSession, destroySession, sha256, rateLimit } from '../auth.js';
import { html, page } from '../html.js';
import { readFlash, redirectWith } from '../lib/flash.js';

const r = Router();

r.get('/', (req, res) => {
  if (req.user) return res.redirect(req.user.is_admin ? '/admin' : '/app');
  res.redirect('/entrar');
});

const loginForm = (req, res, error = '') => res.status(error ? 401 : 200).send(page({
  title: 'Entrar', flash: error ? { type: 'error', text: error } : readFlash(req, res),
  body: html`
    <h1>Entrar</h1>
    <p class="muted">Acesso somente por convite. Peça o link ao administrador se ainda não tem senha.</p>
    <form method="post" action="/entrar" class="card">
      <input type="hidden" name="next" value="${req.query.next || ''}">
      <label>E-mail <input type="email" name="email" required autocomplete="username" inputmode="email"></label>
      <label>Senha <input type="password" name="password" required autocomplete="current-password"></label>
      <button class="primary">Entrar</button>
    </form>`,
}));

r.get('/entrar', (req, res) => (req.user ? res.redirect('/') : loginForm(req, res)));

r.post('/entrar', (req, res) => {
  const { db, cfg } = req.app.locals;
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!rateLimit(`login:${req.ip}:${email}`, 8, 15 * 60e3)) return loginForm(req, res, 'Muitas tentativas. Aguarde 15 minutos.');
  const user = get(db, 'SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(password, user.password_hash)) return loginForm(req, res, 'E-mail ou senha incorretos.');
  createSession(db, cfg, res, user.id);
  audit(db, { userId: user.id, action: 'login' });
  const next = String(req.body.next || '');
  res.redirect(next.startsWith('/') && !next.startsWith('//') ? next : (user.is_admin ? '/admin' : '/app'));
});

r.post('/sair', (req, res) => {
  destroySession(req.app.locals.db, req.app.locals.cfg, req, res);
  res.redirect('/entrar');
});

// Convite: define senha e vincula ao restaurante. Também usado para restaurar acesso.
function findInvite(db, token) {
  return get(db, "SELECT i.*, r.name AS restaurant_name FROM invites i JOIN restaurants r ON r.id = i.restaurant_id WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')", sha256(token));
}
const inviteForm = (res, inv, token, error = '') => res.status(error ? 400 : 200).send(page({
  title: 'Convite', flash: error ? { type: 'error', text: error } : null,
  body: html`
    <h1>Bem-vindo, ${inv.restaurant_name}</h1>
    <p>Defina a senha de acesso para <strong>${inv.email}</strong>.</p>
    <form method="post" action="/convite/${token}" class="card">
      <label>Seu nome <input name="name" required maxlength="80" autocomplete="name"></label>
      <label>Senha (mínimo 8 caracteres) <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <button class="primary">Criar acesso</button>
    </form>`,
}));

r.get('/convite/:token', (req, res) => {
  const inv = findInvite(req.app.locals.db, req.params.token);
  if (!inv) return res.status(404).send(page({ title: 'Convite', body: html`<h1>Convite inválido ou expirado</h1><p>Peça um novo link ao administrador.</p>` }));
  inviteForm(res, inv, req.params.token);
});

r.post('/convite/:token', (req, res) => {
  const { db, cfg } = req.app.locals;
  if (!rateLimit(`invite:${req.ip}`, 10, 15 * 60e3)) return res.status(429).send('Muitas tentativas.');
  const inv = findInvite(db, req.params.token);
  if (!inv) return res.status(404).send('Convite inválido ou expirado.');
  const name = String(req.body.name || '').trim().slice(0, 80);
  const password = String(req.body.password || '');
  if (!name || password.length < 8) return inviteForm(res, inv, req.params.token, 'Preencha nome e uma senha com pelo menos 8 caracteres.');
  const hash = hashPassword(password);
  db.exec('BEGIN');
  try {
    let user = get(db, 'SELECT * FROM users WHERE email = ?', inv.email);
    if (user) {
      run(db, 'UPDATE users SET password_hash = ?, name = ? WHERE id = ?', hash, name, user.id);
      run(db, 'DELETE FROM sessions WHERE user_id = ?', user.id);
    } else {
      user = { id: run(db, 'INSERT INTO users (email, password_hash, name) VALUES (?,?,?)', inv.email, hash, name).lastInsertRowid };
    }
    run(db, 'INSERT OR IGNORE INTO memberships (user_id, restaurant_id, role) VALUES (?,?,?)', user.id, inv.restaurant_id, 'owner');
    run(db, "UPDATE invites SET used_at = datetime('now') WHERE id = ?", inv.id);
    db.exec('COMMIT');
    audit(db, { userId: user.id, restaurantId: inv.restaurant_id, action: 'invite.accept' });
    createSession(db, cfg, res, user.id);
    redirectWith(res, '/app', 'ok', 'Acesso criado. Bem-vindo!');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

export default r;
