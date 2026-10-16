import crypto from 'node:crypto';
import { get, run } from './db.js';

// --- Senhas (scrypt do Node, sem dependência) ---
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  const [algo, saltB64, keyB64] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const token = (n = 32) => crypto.randomBytes(n).toString('base64url');

// --- Cookies ---
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// --- Sessões ---
export function createSession(db, cfg, res, userId) {
  const id = token(32);
  const csrf = token(24);
  const expires = new Date(Date.now() + cfg.sessionDays * 86400e3);
  run(db, 'INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?,?,?,?)', id, userId, csrf, expires.toISOString());
  res.setHeader('Set-Cookie', cookie('sid', id, { expires, secure: cfg.sessionSecure }));
}
export function destroySession(db, cfg, req, res) {
  if (req.sessionId) run(db, 'DELETE FROM sessions WHERE id = ?', req.sessionId);
  res.setHeader('Set-Cookie', cookie('sid', '', { expires: new Date(0), secure: cfg.sessionSecure }));
}
function cookie(name, value, { expires, secure }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? '; Secure' : ''}`;
}

const CSRF_EXEMPT = new Set(['/api/track']);

// Middleware: carrega req.user (com csrf) e req.restaurant (membership).
export function sessionMiddleware(db) {
  return (req, res, next) => {
    req.user = null; req.restaurant = null;
    const sid = parseCookies(req.headers.cookie).sid;
    if (sid) {
      const s = get(db, "SELECT s.id, s.csrf, s.expires_at, u.id AS uid, u.email, u.name, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')", sid);
      if (s) {
        req.sessionId = s.id;
        req.user = { id: s.uid, email: s.email, name: s.name, is_admin: !!s.is_admin, csrf: s.csrf };
        if (!s.is_admin) {
          req.restaurant = get(db, 'SELECT r.* FROM memberships m JOIN restaurants r ON r.id = m.restaurant_id WHERE m.user_id = ? ORDER BY r.id LIMIT 1', s.uid) || null;
        }
      }
    }
    // Proteção CSRF: toda mutação autenticada exige token da sessão (form ou header) e Origin compatível.
    // Em multipart o corpo ainda não foi lido: a rota chama csrfAfterUpload depois do multer.
    const isMultipart = /^multipart\/form-data/i.test(req.headers['content-type'] || '');
    const exempt = CSRF_EXEMPT.has(req.path); // rotas públicas sem efeito na conta (métricas anônimas)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.user && !isMultipart && !exempt && !verifyCsrf(req)) {
      return res.status(403).send('Sessão inválida (CSRF). Recarregue a página e tente de novo.');
    }
    next();
  };
}

export function verifyCsrf(req) {
  const sent = req.body?._csrf || req.headers['x-csrf-token'];
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  let originOk = true;
  if (origin && origin !== 'null') { try { originOk = new URL(origin).host === host; } catch { originOk = false; } }
  return !!req.user && sent === req.user.csrf && originOk;
}
// Para rotas multipart: usar logo após o multer.
export function csrfAfterUpload(req, res, next) {
  if (!verifyCsrf(req)) return res.status(403).json({ error: 'Sessão inválida (CSRF). Recarregue a página e tente de novo.' });
  next();
}

export function requireRestaurant(req, res, next) {
  if (!req.user) return res.redirect('/entrar?next=' + encodeURIComponent(req.originalUrl));
  if (req.user.is_admin) return res.redirect('/admin');
  if (!req.restaurant) return res.status(403).send('Sua conta não está vinculada a um restaurante.');
  next();
}
export function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/entrar?next=' + encodeURIComponent(req.originalUrl));
  if (!req.user.is_admin) return res.status(403).send('Acesso restrito aos administradores.');
  next();
}

// --- Limite simples de tentativas em memória (login / convite) ---
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return b.count <= max;
}
